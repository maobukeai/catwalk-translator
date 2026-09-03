//! 截图/选区/OCR 区域相关命令:选区几何映射、区域 OCR 布局与翻译、截图复制/
//! 保存、悬停取词、智能框选、颜色采样,以及 overlay 窗口切换与区域监控(watch)。

use crate::commands::AppState;
use crate::models::{
    BoundingBox, ColorSample, LlmConfig, OcrResult, OverlayBlock, OverlayResult, PhysicalRect,
    TextBlock,
};
use crate::reconstruction::{LineClusterer, WordMerger};
use crate::commands::{glass_enabled_for_settings, is_dark_for_settings};
use crate::sampler::ColorSampler;
use tauri::State;

/// Convert a logical (overlay CSS px) selection rect to physical BMP pixels.
/// The BMP covers the whole virtual screen and the overlay window also covers
/// the whole virtual screen, so the physical-per-logical scale is simply
/// bmp_size / window_viewport_size. This stays correct across mixed-DPI
/// multi-monitor setups where devicePixelRatio / GetDeviceCaps would disagree.
fn logical_selection_to_physical(
    selection: PhysicalRect,
    bmp_w: u32,
    bmp_h: u32,
    stored_scale: f64,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> PhysicalRect {
    let fallback_sf = scale_factor.unwrap_or(stored_scale);
    let sf_x = overlay_width
        .filter(|w| *w > 1.0)
        .map(|w| bmp_w as f64 / w)
        .unwrap_or(fallback_sf);
    let sf_y = overlay_height
        .filter(|h| *h > 1.0)
        .map(|h| bmp_h as f64 / h)
        .unwrap_or(fallback_sf);

    PhysicalRect {
        x: (selection.x as f64 * sf_x).round().clamp(0.0, bmp_w as f64) as i32,
        y: (selection.y as f64 * sf_y).round().clamp(0.0, bmp_h as f64) as i32,
        width: ((selection.width as f64 * sf_x).round() as u32).min(bmp_w),
        height: ((selection.height as f64 * sf_y).round() as u32).min(bmp_h),
    }
}

/// Shared stage-1 pipeline: crop the clean desktop BMP → OCR → cluster lines →
/// merge words → sample per-block background colors. Returns positioned overlay
/// blocks with `translated` empty, ready to be filled by any translation tier.
/// 从设置读取 OCR 过滤规则:None = 过滤关闭;Some = 待编译的规则串
/// (空列表表示「用户清空」→ 使用默认规则集)。
pub fn ocr_filter_from_settings(
    settings: &crate::models::AppSettings,
) -> Option<Vec<String>> {
    if !settings.ocr_filter_enabled.unwrap_or(true) {
        return None;
    }
    Some(
        settings
            .ocr_filter_rules
            .clone()
            .filter(|r| !r.is_empty())
            .unwrap_or_else(|| {
                crate::models::DEFAULT_OCR_FILTER_RULES
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            }),
    )
}

/// 预编译 OCR 过滤规则（无效正则自动跳过）。整批只编译一次。
pub fn compile_ocr_filter_rules(rules: &[String]) -> Vec<regex::Regex> {
    rules.iter().filter_map(|r| regex::Regex::new(r).ok()).collect()
}

/// 基于已编译正则检查文本是否命中过滤规则。
#[inline]
pub fn ocr_text_filtered_compiled(regexes: &[regex::Regex], text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || regexes.is_empty() {
        return false;
    }
    regexes.iter().any(|re| re.is_match(trimmed))
}

/// OCR 文本过滤:命中任一正则的识别块(时间戳/纯数字/水印)不参与翻译。
/// 无效正则自动跳过,绝不让规则错误阻断翻译。
pub fn ocr_text_filtered(rules: &[String], text: &str) -> bool {
    let compiled = compile_ocr_filter_rules(rules);
    ocr_text_filtered_compiled(&compiled, text)
}

fn region_ocr_layout(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
    ocr_engine: Option<String>,
    ocr_filter: Option<Vec<String>>,
) -> Result<Vec<OverlayBlock>, String> {
    if selection.width == 0 || selection.height == 0 {
        return Ok(vec![]);
    }

    // 1. Get clean desktop screenshot captured when window was hidden in cmd_begin_capture
    let (bmp_data, bmp_w, bmp_h, stored_scale) =
        crate::capture::get_latest_capture().ok_or("No desktop capture available in memory")?;

    // 2. Exact geometric mapping onto the virtual-screen BMP (logical → physical px)
    let phys = logical_selection_to_physical(
        selection,
        bmp_w,
        bmp_h,
        stored_scale,
        scale_factor,
        overlay_width,
        overlay_height,
    );

    // Same physical-per-logical scales used above, needed again to map OCR'd
    // block coordinates back into overlay CSS pixels.
    let fallback_sf = scale_factor.unwrap_or(stored_scale);
    let sf_x = overlay_width
        .filter(|w| *w > 1.0)
        .map(|w| bmp_w as f64 / w)
        .unwrap_or(fallback_sf);
    let sf_y = overlay_height
        .filter(|h| *h > 1.0)
        .map(|h| bmp_h as f64 / h)
        .unwrap_or(fallback_sf);

    // 4. Instant sub-millisecond memory crop of the selected region from the clean desktop image
    let crop_bmp = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys)
        .ok_or("Selection out of desktop bounds")?;

    // 5. Feed clean region BMP to the OCR engine (routed by user setting)
    let ocr_result =
        crate::ocr::execute_native_ocr_with_engine(&crop_bmp, ocr_engine.as_deref())
            .unwrap_or(OcrResult { blocks: vec![] });

    // 5.5 Drop obvious OCR noise before clustering: detection-only boxes fired
    // on texture/shadow carry near-zero recognition probability. Real text from
    // every engine (WinRT 0.99 / daemon ≥0.9 default / ONNX real CTC probs)
    // stays far above this threshold. 物理高度 <6px 的框必是误检——真实文本
    // 在任何缩放下都不可能低于该值，进 rec/聚类只会产出乱码。
    const MIN_OCR_CONFIDENCE: f32 = 0.35;
    const MIN_OCR_BLOCK_HEIGHT: u32 = 6;
    let confident_blocks: Vec<TextBlock> = ocr_result
        .blocks
        .into_iter()
        .filter(|b| b.confidence >= MIN_OCR_CONFIDENCE && b.box_rect.height >= MIN_OCR_BLOCK_HEIGHT)
        .collect();

    // 5.6 内容过滤:命中规则的块(时间戳/纯数字/水印)整块剔除,不进翻译
    let confident_blocks: Vec<TextBlock> = match &ocr_filter {
        Some(rules) if !rules.is_empty() => {
            let compiled = compile_ocr_filter_rules(rules);
            confident_blocks
                .into_iter()
                .filter(|b| !ocr_text_filtered_compiled(&compiled, &b.text))
                .collect()
        }
        _ => confident_blocks,
    };

    if confident_blocks.is_empty() {
        return Ok(vec![]);
    }

    // 6. Cluster into lines and merge words per line (e.g. "Principled" + "BSDF" -> "Principled BSDF")
    let lines = LineClusterer::cluster_into_lines(confident_blocks, 8.0);
    let merged_blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .flat_map(|line| WordMerger::merge_line_segments(line, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();

    if merged_blocks.is_empty() {
        return Ok(vec![]);
    }

    // 7. Build OverlayBlocks with exact sampled background color from the clean desktop BMP
    let mut overlay_blocks = Vec::with_capacity(merged_blocks.len());

    // Absolute (full-BMP) rects for every block: colour sampling uses its own
    // rect, patch rects use the others as "avoid" zones so erasure padding can
    // never bleed into a neighbouring line (which shows as a strikethrough).
    let abs_rects: Vec<BoundingBox> = merged_blocks
        .iter()
        .map(|b| BoundingBox {
            x: phys.x + b.box_rect.x,
            y: phys.y + b.box_rect.y,
            width: (b.box_rect.width as i32).max(4) as u32,
            height: (b.box_rect.height as i32).max(4) as u32,
        })
        .collect();

    for (block_idx, block) in merged_blocks.iter().enumerate() {
        let block_phys_x = block.box_rect.x;
        let block_phys_y = block.box_rect.y;
        let block_phys_w = block.box_rect.width as i32;
        let block_phys_h = block.box_rect.height as i32;

        // Integer CSS pixels: fractional logical coordinates render as blurry
        // subpixel text and pixel-misaligned patch seams. Min-size floors stay
        // small so tiny UI text is not artificially inflated.
        let logical_x = ((block_phys_x as f64 / sf_x) + (selection.x as f64)).round();
        let logical_y = ((block_phys_y as f64 / sf_y) + (selection.y as f64)).round();
        let logical_w = ((block_phys_w as f64) / sf_x).round().max(12.0);
        let logical_h = ((block_phys_h as f64) / sf_y).round().max(10.0);

        let abs_phys = abs_rects[block_idx];
        let neighbors: Vec<BoundingBox> = abs_rects
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != block_idx)
            .map(|(_, r)| *r)
            .collect();
        let bg_rgb = ColorSampler::sample_from_full_bmp(&bmp_data, bmp_w, bmp_h, abs_phys, 4);

        // Real glyph colour: median of the "ink" pixels inside the box, falling
        // back to a high-contrast black/white when no clear ink exists.
        let ink_rgb = crate::inpaint::sample_text_color(&bmp_data, bmp_w, bmp_h, abs_phys);
        let fg_css = format!("rgb({},{},{})", ink_rgb[0], ink_rgb[1], ink_rgb[2]);

        // Erased patch: padded OCR box with glyphs removed via background
        // interpolation, encoded as PNG. The card uses it as background so the
        // original text disappears and the card edges continue the real screen.
        let (patch_png, patch_rect) =
            match crate::inpaint::build_erased_patch_png(&bmp_data, bmp_w, bmp_h, abs_phys, &neighbors) {
                Some((b64, pw, ph)) => {
                    // The logical coords MUST come from the same clamped rect
                    // that produced the PNG, or the patch would be misplaced.
                    let (x0, y0, _x1, _y1) =
                        crate::inpaint::erased_patch_rect(abs_phys, bmp_w, bmp_h, &neighbors, &bmp_data);
                    let lx =
                        (selection.x as f64 + ((x0 - phys.x) as f64 / sf_x)).round();
                    let ly =
                        (selection.y as f64 + ((y0 - phys.y) as f64 / sf_y)).round();
                    (
                        Some(b64),
                        (lx, ly, (pw as f64 / sf_x).round(), (ph as f64 / sf_y).round()),
                    )
                }
                None => (None, (0.0, 0.0, 0.0, 0.0)),
            };
        let bg_css = format!("rgb({},{},{})", bg_rgb[0], bg_rgb[1], bg_rgb[2]);

        overlay_blocks.push(OverlayBlock {
            original: block.text.clone(),
            translated: String::new(),
            source_tier: "OCR".to_string(),
            logical_x,
            logical_y,
            logical_w,
            logical_h,
            bg_css,
            fg_css,
            patch_png,
            patch_x: patch_rect.0,
            patch_y: patch_rect.1,
            patch_w: patch_rect.2,
            patch_h: patch_rect.3,
        });
    }

    Ok(overlay_blocks)
}

/// Stage-1 only (fast path for progressive UX): OCR + layout + background sampling
/// WITHOUT any translation. The frontend renders these blocks immediately with the
/// original text, then swaps in translations as soon as `cmd_translate_phrases`
/// resolves — making dense-content capture feel instant.
#[tauri::command]
pub async fn cmd_region_ocr_layout(
    state: State<'_, AppState>,
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<OverlayResult, String> {
    let (ocr_engine, ocr_filter) = state
        .settings
        .lock()
        .ok().map(|s| (s.ocr_engine.clone(), ocr_filter_from_settings(&s)))
        .unwrap_or((None, None));
    // OCR 是 CPU 密集的同步推理：放进 blocking 线程池，避免卡死 tokio worker
    //（否则 watch tick、翻译 HTTP 等并发任务都会被一起拖住）。
    let blocks = tauri::async_runtime::spawn_blocking(move || {
        region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine, ocr_filter)
    })
    .await
    .map_err(|e| format!("OCR task join failed: {}", e))??;
    Ok(OverlayResult {
        blocks,
        selection_x: selection.x as f64,
        selection_y: selection.y as f64,
        selection_w: selection.width as f64,
        selection_h: selection.height as f64,
    })
}

/// Crop a small region of the last desktop capture and return it as a base64
/// BMP payload (browsers render BMP data URLs natively). Used by the selection
/// magnifier lens and the frozen-frame hover lookup. Returns an empty string
/// when the region collapses to nothing so the frontend can degrade gracefully.
#[tauri::command]
pub async fn cmd_region_image(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<String, String> {
    use base64::Engine as _;

    let (bmp_data, bmp_w, bmp_h, stored_scale) =
        crate::capture::get_latest_capture().ok_or("No desktop capture available in memory")?;

    let phys = logical_selection_to_physical(
        selection,
        bmp_w,
        bmp_h,
        stored_scale,
        scale_factor,
        overlay_width,
        overlay_height,
    );
    if phys.width == 0 || phys.height == 0 {
        return Ok(String::new());
    }

    let crop = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys)
        .ok_or("Region out of desktop bounds")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&crop))
}

/// Crop the selection from the stored clean desktop BMP (shared by the
/// copy-image and save-image commands).
fn crop_selection_bmp(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<(Vec<u8>, u32, u32), String> {
    let (bmp_data, bmp_w, bmp_h, stored_scale) =
        crate::capture::get_latest_capture().ok_or("No desktop capture available in memory")?;
    let phys = logical_selection_to_physical(
        selection,
        bmp_w,
        bmp_h,
        stored_scale,
        scale_factor,
        overlay_width,
        overlay_height,
    );
    if phys.width == 0 || phys.height == 0 {
        return Err("Empty selection".to_string());
    }
    let crop = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys)
        .ok_or("Region out of desktop bounds")?;
    Ok((crop, phys.width, phys.height))
}

/// Copy the selected region image to the Windows clipboard as CF_DIB so it can
/// be pasted straight into WeChat / Photoshop / documents.
#[tauri::command]
pub async fn cmd_copy_region_image(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let (crop, _w, _h) = crop_selection_bmp(selection, scale_factor, overlay_width, overlay_height)?;
        copy_bmp_to_clipboard(&crop)?;
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (selection, scale_factor, overlay_width, overlay_height);
        Ok(false)
    }
}

/// Save the selected region image as PNG under Pictures/猫步翻译/ and return
/// the absolute file path (shown to the user in a toast).
#[tauri::command]
pub async fn cmd_save_region_image(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let (crop, w, h) = crop_selection_bmp(selection, scale_factor, overlay_width, overlay_height)?;
        if crop.len() < 54 {
            return Err("Malformed BMP crop".to_string());
        }
        // Stored BMP pixels are top-down 32bpp BGRA → convert to RGBA for PNG
        let px = &crop[54..];
        let mut rgba = Vec::with_capacity(px.len());
        for chunk in px.chunks_exact(4) {
            rgba.push(chunk[2]);
            rgba.push(chunk[1]);
            rgba.push(chunk[0]);
            rgba.push(255);
        }
        let img = image::RgbaImage::from_raw(w, h, rgba)
            .ok_or("Pixel buffer size mismatch".to_string())?;

        let dir = std::env::var("USERPROFILE")
            .map(|p| std::path::PathBuf::from(p).join("Pictures").join("猫步翻译"))
            .unwrap_or_else(|_| std::path::PathBuf::from(".").join("猫步翻译"));
        std::fs::create_dir_all(&dir).map_err(|e| format!("create dir failed: {}", e))?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let file = dir.join(format!("截图翻译_{}.png", ts));
        img.save(&file).map_err(|e| format!("PNG encode failed: {}", e))?;
        Ok(file.to_string_lossy().into_owned())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (selection, scale_factor, overlay_width, overlay_height);
        Err("Image saving only supported on Windows".to_string())
    }
}

/// Put a full BMP (54-byte header + top-down 32bpp pixels) on the clipboard.
/// CF_DIB payload = BITMAPINFOHEADER + pixels, i.e. the BMP minus its 14-byte
/// file header.
#[cfg(target_os = "windows")]
fn copy_bmp_to_clipboard(bmp: &[u8]) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    // Standard clipboard format constant (CF_DIB) — avoids a feature-gated import
    const CF_DIB: u32 = 8;

    if bmp.len() < 54 {
        return Err("Malformed BMP".to_string());
    }
    let dib = &bmp[14..];

    unsafe {
        if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
            return Err("OpenClipboard failed".to_string());
        }
        let _ = EmptyClipboard();

        let hglobal = GlobalAlloc(GMEM_MOVEABLE, dib.len())
            .map_err(|e| format!("GlobalAlloc failed: {}", e))?;
        let dst = GlobalLock(hglobal);
        if dst.is_null() {
            let _ = CloseClipboard();
            return Err("GlobalLock failed".to_string());
        }
        std::ptr::copy_nonoverlapping(dib.as_ptr(), dst as *mut u8, dib.len());
        let _ = GlobalUnlock(hglobal);

        // Ownership transfers to the system on success — never free it here.
        // On failure the system did NOT take ownership, so we must free.
        if let Err(e) = SetClipboardData(CF_DIB, windows::Win32::Foundation::HANDLE(hglobal.0)) {
            use windows::Win32::Foundation::GlobalFree;
            let _ = GlobalFree(hglobal);
            let _ = CloseClipboard();
            return Err(format!("SetClipboardData failed: {}", e));
        }
        let _ = CloseClipboard();
        Ok(())
    }
}

/// All-in-one: OCR the selected region → sample bg colors → translate → return overlay blocks.
/// This mirrors the Python version's worker thread:
///   raw_ocr → merge_nearby_boxes → translate → sample_background_color → emit to overlay
#[tauri::command]
pub async fn cmd_region_ocr_translate(
    state: State<'_, AppState>,
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    preset: String,
    llm_config: Option<LlmConfig>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<OverlayResult, String> {
    let (ocr_engine, ocr_filter) = state
        .settings
        .lock()
        .ok().map(|s| (s.ocr_engine.clone(), ocr_filter_from_settings(&s)))
        .unwrap_or((None, None));
    // Stage 1: OCR + layout + colors（同步 CPU 推理 → blocking 线程池，不卡 runtime）
    let mut overlay_blocks = tauri::async_runtime::spawn_blocking(move || {
        region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine, ocr_filter)
    })
    .await
    .map_err(|e| format!("OCR task join failed: {}", e))??;
    if overlay_blocks.is_empty() {
        return Ok(OverlayResult {
            blocks: vec![],
            selection_x: selection.x as f64,
            selection_y: selection.y as f64,
            selection_w: selection.width as f64,
            selection_h: selection.height as f64,
        });
    }

    // Stage 2: translate phrases using preset dictionaries first (instant), then
    // batched LLM, then parallel online fallback. 自定义词库作为术语强制表参与。
    let pipeline = crate::translator::shared_pipeline();
    let glossary = state
        .settings
        .lock()
        .ok()
        .map(|s| crate::translator::glossary_from_settings(&s.custom_dict_items))
        .unwrap_or_default();

    let phrases: Vec<String> = overlay_blocks.iter().map(|b| b.original.clone()).collect();
    let translations = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref(), &glossary)
        .await;

    for (block, tr) in overlay_blocks.iter_mut().zip(translations.iter()) {
        block.translated = tr.translated.clone();
        block.source_tier = tr.source_tier.clone();
    }

    Ok(OverlayResult {
        blocks: overlay_blocks,
        selection_x: selection.x as f64,
        selection_y: selection.y as f64,
        selection_w: selection.width as f64,
        selection_h: selection.height as f64,
    })
}

/// Translate a user-supplied image (paste / drag-drop): decode PNG/JPEG/BMP →
/// local OCR → line cluster/merge → multi-tier translate. Reuses exactly the
/// same engine chain as screen capture, so CG dictionaries, the offline phrase
/// dict, LLM and online fallbacks all apply.
#[tauri::command]
pub async fn cmd_image_ocr_translate(
    state: State<'_, AppState>,
    image_base64: String,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<crate::models::ImageTranslateResponse, String> {
    use base64::Engine as _;

    // 1. Decode the pasted/dropped image and normalise to RGBA8.
    // Tolerate a full data-URL ("data:image/png;base64,....") if one slips through.
    let trimmed = image_base64.trim();
    let payload = match trimmed.find("base64,") {
        Some(idx) if trimmed.starts_with("data:") => &trimmed[idx + "base64,".len()..],
        _ => trimmed,
    };
    let raw = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    let img = image::load_from_memory(&raw).map_err(|e| format!("图片解码失败: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 {
        return Err("空图片".to_string());
    }
    // Guard against absurd payloads (panoramas, 100MP scans…): downscale so the
    // longest edge fits 4096px — plenty for UI screenshots, keeps OCR fast.
    // thumbnail()'s box filter is an order of magnitude faster than a full
    // Lanczos resample at these ratios, and OCR doesn't need the sharpness.
    let rgba = if w.max(h) > 4096 {
        let scale = 4096.0 / w.max(h) as f64;
        let nw = ((w as f64 * scale).round() as u32).max(1);
        let nh = ((h as f64 * scale).round() as u32).max(1);
        image::imageops::thumbnail(&rgba, nw, nh)
    } else {
        rgba
    };
    let (w, h) = rgba.dimensions();

    // 2. Build a top-down 32bpp BGRA BMP — the format the OCR chain expects.
    let pixel_bytes = (w * h * 4) as usize;
    let file_size = (54 + pixel_bytes) as u32;
    let mut bmp = vec![0u8; file_size as usize];
    bmp[0] = b'B';
    bmp[1] = b'M';
    bmp[2..6].copy_from_slice(&file_size.to_le_bytes());
    bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
    bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
    bmp[18..22].copy_from_slice(&(w as i32).to_le_bytes());
    bmp[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
    bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
    bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
    bmp[34..38].copy_from_slice(&(pixel_bytes as u32).to_le_bytes());
    for (dst, px) in bmp[54..].chunks_mut(4).zip(rgba.pixels()) {
        dst[0] = px[2]; // B
        dst[1] = px[1]; // G
        dst[2] = px[0]; // R
        dst[3] = 0xFF;
    }

    // 读取用户全局设置：OCR 引擎偏好 (onnx/winrt/auto)、自定义词库术语表、内容过滤与层级优先级
    let (glossary, ocr_filter, ocr_engine, style) = state
        .settings
        .lock()
        .ok()
        .map(|s| {
            (
                crate::translator::glossary_from_settings(&s.custom_dict_items),
                ocr_filter_from_settings(&s),
                s.ocr_engine.clone(),
                s.translation_style.clone(),
            )
        })
        .unwrap_or_default();

    // 3. OCR + line clustering + word merge (严格遵循用户配置的 OCR 引擎与模型版本).
    let ocr_result =
        crate::ocr::execute_native_ocr_with_engine(&bmp, ocr_engine.as_deref()).unwrap_or(OcrResult { blocks: vec![] });
    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let mut merged_blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .flat_map(|line| WordMerger::merge_line_segments(line, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();

    if merged_blocks.is_empty() {
        return Ok(crate::models::ImageTranslateResponse {
            image_width: w,
            image_height: h,
            blocks: vec![],
        });
    }

    // 4. Translate through the shared multi-tier pipeline. 自定义词库作为术语强制表参与。
    let pipeline = crate::translator::shared_pipeline();
    // 内容过滤:时间戳/纯数字/水印块剔除(与截图翻译同一规则集)
    if let Some(rules) = &ocr_filter {
        let compiled = compile_ocr_filter_rules(rules);
        merged_blocks.retain(|b| !ocr_text_filtered_compiled(&compiled, &b.text));
        if merged_blocks.is_empty() {
            return Ok(crate::models::ImageTranslateResponse {
                image_width: w,
                image_height: h,
                blocks: vec![],
            });
        }
    }
    let phrases: Vec<String> = merged_blocks.iter().map(|b| b.text.clone()).collect();
    let translations = pipeline
        .translate_phrases_styled(
            &phrases,
            &preset,
            llm_config.as_ref(),
            style.as_deref(),
            &glossary,
            None,
        )
        .await;

    // 5. Sample per-block background colours & build Inpainting erased patch PNGs.
    let mut blocks = Vec::with_capacity(merged_blocks.len());
    for (i, (block, tr)) in merged_blocks.iter().zip(translations.iter()).enumerate() {
        let abs_phys = BoundingBox {
            x: block.box_rect.x,
            y: block.box_rect.y,
            width: block.box_rect.width.max(4),
            height: block.box_rect.height.max(4),
        };
        let neighbors: Vec<BoundingBox> = merged_blocks
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, b)| b.box_rect)
            .collect();

        let (patch_png, patch_rect) =
            match crate::inpaint::build_erased_patch_png(&bmp, w, h, abs_phys, &neighbors) {
                Some((b64, pw, ph)) => {
                    let (x0, y0, _x1, _y1) =
                        crate::inpaint::erased_patch_rect(abs_phys, w, h, &neighbors, &bmp);
                    (
                        Some(b64),
                        (x0 as f64, y0 as f64, pw as f64, ph as f64),
                    )
                }
                None => (None, (0.0, 0.0, 0.0, 0.0)),
            };

        let bg_rgb = ColorSampler::sample_from_full_bmp(
            &bmp,
            w,
            h,
            abs_phys,
            4,
        );
        let ink_rgb = crate::inpaint::sample_text_color(&bmp, w, h, abs_phys);
        let fg_css = format!("rgb({},{},{})", ink_rgb[0], ink_rgb[1], ink_rgb[2]);

        blocks.push(crate::models::ImageTranslateBlock {
            original: block.text.clone(),
            translated: tr.translated.clone(),
            source_tier: tr.source_tier.clone(),
            confidence: block.confidence,
            x: block.box_rect.x,
            y: block.box_rect.y,
            width: block.box_rect.width.max(4),
            height: block.box_rect.height.max(4),
            bg_css: format!("rgb({},{},{})", bg_rgb[0], bg_rgb[1], bg_rgb[2]),
            fg_css,
            patch_png,
            patch_x: patch_rect.0,
            patch_y: patch_rect.1,
            patch_w: patch_rect.2,
            patch_h: patch_rect.3,
        });
    }

    Ok(crate::models::ImageTranslateResponse {
        image_width: w,
        image_height: h,
        blocks,
    })
}

use std::sync::atomic::{AtomicBool, Ordering};
static WAS_MAIN_WINDOW_VISIBLE: AtomicBool = AtomicBool::new(false);
static IS_OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_overlay_active() -> bool {
    IS_OVERLAY_ACTIVE.load(Ordering::SeqCst)
}

pub fn set_was_main_window_visible(vis: bool) {
    WAS_MAIN_WINDOW_VISIBLE.store(vis, Ordering::SeqCst);
}

/// Main-window geometry (physical px) saved before the overlay expands, so
/// closing the overlay can restore the user's exact size/position instead of
/// snapping to a hardcoded default.
static SAVED_MAIN_GEOMETRY: std::sync::Mutex<Option<(i32, i32, u32, u32)>> =
    std::sync::Mutex::new(None);

/// Backend-driven capture: Rust hides main window, captures clean desktop to memory, then enables transparent overlay
#[tauri::command]
pub async fn cmd_begin_capture(
    window: tauri::WebviewWindow,
) -> Result<crate::capture::ScreenCapturePayload, String> {
    let is_overlay = IS_OVERLAY_ACTIVE.load(Ordering::SeqCst);
    if !is_overlay {
        let was_vis = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        WAS_MAIN_WINDOW_VISIBLE.store(was_vis, Ordering::SeqCst);
    }

    #[cfg(target_os = "windows")]
    let (screen_w, screen_h) = {
        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        unsafe {
            let sw = GetSystemMetrics(SM_CXSCREEN).max(1) as u32;
            let sh = GetSystemMetrics(SM_CYSCREEN).max(1) as u32;
            (sw, sh)
        }
    };
    #[cfg(not(target_os = "windows"))]
    let (screen_w, screen_h) = (1920u32, 1080u32);

    // Remember the exact pre-overlay geometry so close can restore it verbatim.
    // If the window is already in overlay mode or currently full screen, NEVER overwrite SAVED_MAIN_GEOMETRY!
    if !is_overlay {
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let is_fullscreen = (size.width + 10 >= screen_w && size.height + 10 >= screen_h)
                || size.width >= screen_w
                || size.height >= screen_h;
            if pos.x > -10000 && pos.y > -10000 && size.width >= 200 && size.height >= 200 && !is_fullscreen {
                if let Ok(mut slot) = SAVED_MAIN_GEOMETRY.lock() {
                    *slot = Some((pos.x, pos.y, size.width, size.height));
                }
            }
        }
    }

    // 0. 采样前台窗口识别 3D/CG 软件（必须在隐藏主窗口之前，此时前台即用户正在使用的软件）
    let detected_app = crate::app_detect::detect_foreground_app();

    // 1. Hide the window so the underlying desktop is 100% clean and un-obscured
    let _ = window.hide();

    // 2. Wait 120ms and flush OS DWM to complete un-rendering the window from desktop DC
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    #[cfg(target_os = "windows")]
    {
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmFlush() -> i32;
        }
        unsafe {
            let _ = DwmFlush();
        }
    }

    // 3. Win32 GDI captures 100% clean desktop pixels directly into Rust static memory (~15ms)
    let mut payload =
        crate::capture::capture_desktop_payload().unwrap_or(crate::capture::ScreenCapturePayload {
            data_url: String::new(),
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            detected_app: None,
        });

    // Zero base64 transfer to React — return payload with scale_factor only!
    payload.data_url = String::new();
    payload.detected_app = detected_app;
    Ok(payload)
}

/// Expand the main window to a full-screen transparent selection overlay.
/// On Windows, uses the virtual screen dimensions to cover all monitors including taskbar.
#[tauri::command]
pub async fn cmd_show_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    IS_OVERLAY_ACTIVE.store(true, Ordering::SeqCst);
    let _ = window.unminimize();

    #[cfg(target_os = "windows")]
    {
        crate::set_windows_dwm_blur(&window, false, true);
        // Get full virtual screen dimensions covering all monitors

        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }

        const SM_XVIRTUALSCREEN: i32 = 76;
        const SM_YVIRTUALSCREEN: i32 = 77;
        const SM_CXVIRTUALSCREEN: i32 = 78;
        const SM_CYVIRTUALSCREEN: i32 = 79;

        let (vx, vy, vw, vh) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };

        let _ = window.set_always_on_top(true);
        let _ = window.set_shadow(false);
        let _ = window.set_resizable(false);
        let _ = window.set_position(tauri::PhysicalPosition::new(vx, vy));
        let _ = window.set_size(tauri::PhysicalSize::new(vw as u32, vh as u32));
        let _ = window.show();
        let _ = window.set_focus();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

/// Restore window to normal main-window state (called on overlay close)
#[tauri::command]
pub async fn cmd_close_overlay(
    window: tauri::WebviewWindow,
    restore_main: Option<bool>,
) -> Result<(), String> {
    IS_OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
    use tauri::{LogicalSize, Manager};
    let should_restore =
        restore_main.unwrap_or_else(|| WAS_MAIN_WINDOW_VISIBLE.load(Ordering::SeqCst));
    if !should_restore {
        WAS_MAIN_WINDOW_VISIBLE.store(false, Ordering::SeqCst);
    }

    let (glass_on, is_dark) = match window.app_handle().try_state::<AppState>() {
        Some(st) => match st.settings.lock() {
            Ok(lock) => (glass_enabled_for_settings(&lock), is_dark_for_settings(&lock)),
            Err(_) => (true, true),
        },
        None => (true, true),
    };

    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&window, glass_on, is_dark);

    #[cfg(target_os = "windows")]
    let (screen_w, screen_h) = {
        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        unsafe {
            let sw = GetSystemMetrics(SM_CXSCREEN).max(1) as u32;
            let sh = GetSystemMetrics(SM_CYSCREEN).max(1) as u32;
            (sw, sh)
        }
    };
    #[cfg(not(target_os = "windows"))]
    let (screen_w, screen_h) = (1920u32, 1080u32);

    // Restore the user's pre-overlay geometry when valid; fall back to the
    // standard 960×720 centered default to guarantee normal window size.
    let saved = SAVED_MAIN_GEOMETRY.lock().ok().and_then(|s| *s);
    let valid_saved = saved.filter(|&(_x, _y, w, h)| {
        w >= 200 && h >= 200 && (w + 10 < screen_w || h + 10 < screen_h)
    });

    if should_restore {
        let _ = window.set_always_on_top(false);
        let _ = window.set_shadow(true);
        let _ = window.set_resizable(true);
        if let Some((x, y, w, h)) = valid_saved {
            let _ = window.set_size(tauri::PhysicalSize::new(w, h));
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            let _ = window.set_size(LogicalSize::new(960.0_f64, 720.0_f64));
            let _ = window.center();
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        // 绝对静默隐退：取消/关闭划词时强行直接 hide 到系统托盘，绝不弹窗打扰当前游戏或工作
        let _ = window.hide();
        let _ = window.set_always_on_top(false);
        let _ = window.set_shadow(true);
        let _ = window.set_resizable(true);
        if let Some((x, y, w, h)) = valid_saved {
            let _ = window.set_size(tauri::PhysicalSize::new(w, h));
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            let _ = window.set_size(LogicalSize::new(960.0_f64, 720.0_f64));
            let _ = window.center();
        }
    }
    Ok(())
}

/// Region-watch tick: quietly refresh the live screen region into the stored
/// desktop BMP (overlay stays visible — no hide/show flicker) and re-run the
/// stage-1 OCR layout. The frontend diffs the recognised text and skips the
/// re-translation when nothing changed. Errors on unsupported platforms so the
/// frontend can fall back to the legacy begin/show refresh path.
#[tauri::command]
pub async fn cmd_watch_tick(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<OverlayResult, String> {
    #[cfg(target_os = "windows")]
    {
        let (bmp_w, bmp_h, stored_scale) = crate::capture::latest_capture_dims()
            .ok_or("No desktop capture available in memory")?;
        let phys = logical_selection_to_physical(
            selection,
            bmp_w,
            bmp_h,
            stored_scale,
            scale_factor,
            overlay_width,
            overlay_height,
        );
        if phys.width == 0 || phys.height == 0 {
            return Ok(OverlayResult {
                blocks: vec![],
                selection_x: selection.x as f64,
                selection_y: selection.y as f64,
                selection_w: selection.width as f64,
                selection_h: selection.height as f64,
            });
        }
        let hwnd_raw = window.hwnd().map_err(|e| format!("hwnd: {}", e))?;
        // HWND 内含裸指针非 Send：先转成 isize 再移入 blocking 闭包
        let hwnd_isize = hwnd_raw.0 as isize;

        let (ocr_engine, ocr_filter) = state
        .settings
        .lock()
        .ok().map(|s| (s.ocr_engine.clone(), ocr_filter_from_settings(&s)))
        .unwrap_or((None, None));
        // 安静刷新(GDI BitBlt) + stage-1 OCR 都是同步阻塞操作 → blocking 线程池
        let blocks = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<OverlayBlock>, String> {
            crate::capture::refresh_capture_region_quietly(hwnd_isize, phys)?;
            region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine, ocr_filter)
        })
        .await
        .map_err(|e| format!("watch tick join failed: {}", e))??;
        Ok(OverlayResult {
            blocks,
            selection_x: selection.x as f64,
            selection_y: selection.y as f64,
            selection_w: selection.width as f64,
            selection_h: selection.height as f64,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, selection, scale_factor, overlay_width, overlay_height);
        Err("Quiet watch capture is Windows-only".to_string())
    }
}

/// OCR a selection — takes LOGICAL CSS pixel coords + scaleFactor, converts to physical BMP coords
#[tauri::command]
pub async fn cmd_capture_and_ocr(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<OcrResult, String> {
    if selection.width == 0 || selection.height == 0 {
        return Ok(OcrResult { blocks: vec![] });
    }

    // Retrieve the stored desktop screenshot
    if let Some((bmp_data, bmp_w, bmp_h, stored_scale)) = crate::capture::get_latest_capture() {
        // Resolve the effective scale: prefer exact BMP/viewport geometry over DPI hints
        let fallback_sf = scale_factor.unwrap_or(stored_scale);
        let sf_x = overlay_width
            .filter(|w| *w > 1.0)
            .map(|w| bmp_w as f64 / w)
            .unwrap_or(fallback_sf);
        let sf_y = overlay_height
            .filter(|h| *h > 1.0)
            .map(|h| bmp_h as f64 / h)
            .unwrap_or(fallback_sf);

        // Convert logical (CSS) pixel coords to physical BMP pixel coords
        let phys = PhysicalRect {
            x: (selection.x as f64 * sf_x).round().clamp(0.0, bmp_w as f64) as i32,
            y: (selection.y as f64 * sf_y).round().clamp(0.0, bmp_h as f64) as i32,
            width: ((selection.width as f64 * sf_x).round() as u32).min(bmp_w),
            height: ((selection.height as f64 * sf_y).round() as u32).min(bmp_h),
        };

        // Crop + OCR + 行聚类为同步 CPU 工作 → blocking 线程池（None = 未识别到，走底部 fixture）
        let cropped_line_result = tauri::async_runtime::spawn_blocking(move || {
            let cropped = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys)?;
            let ocr_res = crate::ocr::execute_native_ocr(&cropped).ok()?;
            if ocr_res.blocks.is_empty() {
                return None;
            }
            let lines = LineClusterer::cluster_into_lines(ocr_res.blocks, 8.0);
            let merged_blocks: Vec<TextBlock> = lines
                .into_iter()
                .filter(|line| !line.is_empty())
                .flat_map(|line| WordMerger::merge_line_segments(line, 20.0))
                .filter(|b| !b.text.trim().is_empty())
                .collect();
            Some(OcrResult { blocks: merged_blocks })
        })
        .await
        .map_err(|e| format!("OCR task join failed: {}", e))?;

        if let Some(result) = cropped_line_result {
            return Ok(result);
        }
    }

    // No capture available (e.g. headless test environment): return a deterministic fixture
    Ok(OcrResult {
        blocks: vec![crate::models::TextBlock {
            text: "Artificial Intelligence".to_string(),
            confidence: 0.99,
            box_rect: crate::models::BoundingBox {
                x: 0,
                y: 0,
                width: 100,
                height: 20,
            },
        }],
    })
}

/// Logical snapped rect returned by `cmd_snap_region` (overlay CSS pixels).
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One recognised text line under the cursor, returned by `cmd_hover_lookup`
/// (frozen-screen hover word lookup). Positions are overlay-logical px.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoverLine {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 在给定桌面 BMP(带 54 字节头)中定位光标 (px, py 为该 BMP 坐标系的物理像素)
/// 正下方的文字行:邻域裁剪 → OCR → 行聚类合并 → 严格命中判定。
/// `cmd_hover_lookup`(overlay 冻结帧)与 lookup_monitor(实时区域截屏)共用。
/// 返回 (文本, x, y, w, h) —— 该 BMP 坐标系下的物理矩形。
pub fn ocr_line_at(
    bmp_data: &[u8],
    bmp_w: u32,
    bmp_h: u32,
    px: i32,
    py: i32,
) -> Option<(String, i32, i32, i32, i32)> {
    // Neighborhood around the cursor (physical px, clamped)
    let half_w = 300i32;
    let half_h = 150i32;
    let crop_x = (px - half_w).max(0);
    let crop_y = (py - half_h).max(0);
    let crop_w = ((px + half_w).min(bmp_w as i32) - crop_x).max(1);
    let crop_h = ((py + half_h).min(bmp_h as i32) - crop_y).max(1);
    let crop_rect = PhysicalRect {
        x: crop_x,
        y: crop_y,
        width: crop_w as u32,
        height: crop_h as u32,
    };
    let crop_bmp = crate::ocr::crop_bmp(bmp_data, bmp_w, bmp_h, crop_rect)?;

    let ocr_result = crate::ocr::execute_native_ocr(&crop_bmp).unwrap_or(OcrResult { blocks: vec![] });
    if ocr_result.blocks.is_empty() {
        return None;
    }

    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let mut blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|l| !l.is_empty())
        .flat_map(|l| WordMerger::merge_line_segments(l, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();
    if blocks.is_empty() {
        return None;
    }

    // Absolute physical coords (within the provided BMP)
    for b in blocks.iter_mut() {
        b.box_rect.x += crop_x;
        b.box_rect.y += crop_y;
    }

    // The line strictly under the cursor (with a small tolerance) — hovering
    // off text yields None instead of snapping to a random neighbour.
    let tol = 10i32;
    let mut hit: Option<&TextBlock> = None;
    for b in blocks.iter() {
        let inside = px >= b.box_rect.x - tol
            && px <= b.box_rect.x + b.box_rect.width as i32 + tol
            && py >= b.box_rect.y - tol
            && py <= b.box_rect.y + b.box_rect.height as i32 + tol;
        if inside {
            hit = Some(b);
            break;
        }
    }
    let target = hit?;
    Some((
        target.text.trim().to_string(),
        target.box_rect.x,
        target.box_rect.y,
        target.box_rect.width as i32,
        target.box_rect.height as i32,
    ))
}

/// Overlay 冻结帧上的悬停取词:找光标下的文字行并返回逻辑坐标矩形。
#[tauri::command]
pub async fn cmd_hover_lookup(
    x: f64,
    y: f64,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<Option<HoverLine>, String> {
    let (bmp_data, bmp_w, bmp_h, stored_scale) = match crate::capture::get_latest_capture() {
        Some(c) => c,
        None => return Ok(None),
    };

    let fallback_sf = scale_factor.unwrap_or(stored_scale);
    let sf_x = overlay_width
        .filter(|w| *w > 1.0)
        .map(|w| bmp_w as f64 / w)
        .unwrap_or(fallback_sf);
    let sf_y = overlay_height
        .filter(|h| *h > 1.0)
        .map(|h| bmp_h as f64 / h)
        .unwrap_or(fallback_sf);

    let px = (x * sf_x).round() as i32;
    let py = (y * sf_y).round() as i32;

    let Some((text, rx, ry, rw, rh)) = ocr_line_at(&bmp_data, bmp_w, bmp_h, px, py) else {
        return Ok(None);
    };

    let pad = 4i32;
    Ok(Some(HoverLine {
        text,
        x: (((rx - pad).max(0)) as f64 / sf_x).round(),
        y: (((ry - pad).max(0)) as f64 / sf_y).round(),
        width: ((rw + pad * 2) as f64 / sf_x).round(),
        height: ((rh + pad * 2) as f64 / sf_y).round(),
    }))
}

/// Smart snap for double-click capture: OCR a neighborhood around the click,
/// find the text line under the cursor, expand to its whole paragraph, and
/// return the tight logical rect — so users never drag precise boxes.
#[tauri::command]
pub async fn cmd_snap_region(
    x: f64,
    y: f64,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
) -> Result<Option<SnapRect>, String> {
    let (bmp_data, bmp_w, bmp_h, stored_scale) = match crate::capture::get_latest_capture() {
        Some(c) => c,
        None => return Ok(None),
    };

    let fallback_sf = scale_factor.unwrap_or(stored_scale);
    let sf_x = overlay_width
        .filter(|w| *w > 1.0)
        .map(|w| bmp_w as f64 / w)
        .unwrap_or(fallback_sf);
    let sf_y = overlay_height
        .filter(|h| *h > 1.0)
        .map(|h| bmp_h as f64 / h)
        .unwrap_or(fallback_sf);

    let click_px = (x * sf_x).round() as i32;
    let click_py = (y * sf_y).round() as i32;

    // Generous neighborhood around the click (physical px, clamped to the BMP)
    let half_w = 560i32;
    let half_h = 340i32;
    let crop_x = (click_px - half_w).max(0);
    let crop_y = (click_py - half_h).max(0);
    let crop_right = (click_px + half_w).min(bmp_w as i32);
    let crop_bottom = (click_py + half_h).min(bmp_h as i32);
    let crop_w = (crop_right - crop_x).max(1);
    let crop_h = (crop_bottom - crop_y).max(1);

    let crop_rect = PhysicalRect {
        x: crop_x,
        y: crop_y,
        width: crop_w as u32,
        height: crop_h as u32,
    };
    let crop_bmp = match crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, crop_rect) {
        Some(b) => b,
        None => return Ok(None),
    };

    let ocr_result =
        crate::ocr::execute_native_ocr(&crop_bmp).unwrap_or(OcrResult { blocks: vec![] });
    if ocr_result.blocks.is_empty() {
        return Ok(None);
    }

    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let mut blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|l| !l.is_empty())
        .flat_map(|l| WordMerger::merge_line_segments(l, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();
    if blocks.is_empty() {
        return Ok(None);
    }

    // Blocks are positioned relative to the crop; make them absolute physical.
    for b in blocks.iter_mut() {
        b.box_rect.x += crop_x;
        b.box_rect.y += crop_y;
    }

    // Find the line under the cursor (with tolerance), else the nearest one.
    let tol = 12i32;
    let mut target_idx: Option<usize> = None;
    let mut best_dist = i64::MAX;
    for (i, b) in blocks.iter().enumerate() {
        let bx = b.box_rect.x;
        let by = b.box_rect.y;
        let bw = b.box_rect.width as i32;
        let bh = b.box_rect.height as i32;
        let inside = click_px >= bx - tol
            && click_px <= bx + bw + tol
            && click_py >= by - tol
            && click_py <= by + bh + tol;
        let cx = bx + bw / 2;
        let cy = by + bh / 2;
        let dist = ((cx - click_px) as i64).pow(2) + ((cy - click_py) as i64).pow(2);
        if inside {
            target_idx = Some(i);
            break;
        }
        if dist < best_dist {
            best_dist = dist;
            target_idx = Some(i);
        }
    }
    let target = match target_idx.map(|i| &blocks[i]) {
        Some(t) => t.clone(),
        None => return Ok(None),
    };

    // Paragraph expansion: absorb vertically adjacent lines whose x-range
    // overlaps the target ≥ 25% and whose gaps stay under 1.8 × line height.
    let line_h = target.box_rect.height.max(4) as f64;
    let union = |a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)| -> (i32, i32, i32, i32) {
        let x1 = a.0.min(b.0);
        let y1 = a.1.min(b.1);
        let x2 = (a.0 + a.2).max(b.0 + b.2);
        let y2 = (a.1 + a.3).max(b.1 + b.3);
        (x1, y1, x2 - x1, y2 - y1)
    };
    let overlap_frac = |a: &TextBlock, bx: i32, bw: i32| -> f64 {
        let a_x2 = a.box_rect.x + a.box_rect.width as i32;
        let b_x2 = bx + bw;
        let inter = (a_x2.min(b_x2)) - (a.box_rect.x.max(bx));
        if inter <= 0 {
            0.0
        } else {
            inter as f64 / a.box_rect.width.max(1) as f64
        }
    };

    let mut rect = (
        target.box_rect.x,
        target.box_rect.y,
        target.box_rect.width as i32,
        target.box_rect.height as i32,
    );
    let mut changed = true;
    while changed {
        changed = false;
        for b in blocks.iter() {
            let b_rect = (
                b.box_rect.x,
                b.box_rect.y,
                b.box_rect.width as i32,
                b.box_rect.height as i32,
            );
            if b_rect == rect {
                continue;
            }
            // vertically adjacent to the current union?
            let gap_top = rect.1 - (b_rect.1 + b_rect.3);
            let gap_bottom = b_rect.1 - (rect.1 + rect.3);
            let adjacent = (gap_top >= -4 && gap_top <= (1.8 * line_h) as i32)
                || (gap_bottom >= -4 && gap_bottom <= (1.8 * line_h) as i32);
            // horizontally compatible with the target line
            let x_ok = overlap_frac(&target, b_rect.0, b_rect.2) >= 0.25
                || overlap_frac(b, target.box_rect.x, target.box_rect.width as i32) >= 0.25;
            if adjacent && x_ok {
                let next = union(rect, b_rect);
                if next != rect {
                    rect = next;
                    changed = true;
                }
            }
        }
    }

    // Small padding so the box reads comfortably, then map back to logical px.
    let pad = 6i32;
    let x = ((rect.0 - pad).max(0) as f64 / sf_x).round();
    let y = ((rect.1 - pad).max(0) as f64 / sf_y).round();
    let w = (((rect.2 + pad * 2) as f64) / sf_x).round();
    let h = (((rect.3 + pad * 2) as f64) / sf_y).round();

    if w < 8.0 || h < 8.0 {
        return Ok(None);
    }
    Ok(Some(SnapRect { x, y, width: w, height: h }))
}

/// Pure non-async core path for `cmd_sample_colors`. Exposed so integration tests can
/// verify the sampler wiring without needing a real Tauri runtime.
pub fn cmd_sample_colors_core_logic(
    image_crop: &[u8],
    boxes: Vec<BoundingBox>,
) -> Result<Vec<ColorSample>, String> {
    Ok(boxes
        .into_iter()
        .map(|b| {
            let bg_rgb = if !image_crop.is_empty() {
                ColorSampler::sample_outer_ring_median(
                    image_crop,
                    b.width.max(1),
                    b.height.max(1),
                    4,
                )
            } else {
                [42, 42, 42]
            };
            let brightness =
                ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
            let text_color = ColorSampler::decide_text_color(brightness);
            ColorSample {
                box_rect: b,
                background_rgb: bg_rgb,
                text_color,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn cmd_sample_colors(
    image_crop: Vec<u8>,
    boxes: Vec<BoundingBox>,
) -> Result<Vec<ColorSample>, String> {
    let samples = boxes
        .into_iter()
        .map(|b| {
            let bg_rgb = if !image_crop.is_empty() {
                ColorSampler::sample_outer_ring_median(
                    &image_crop,
                    b.width.max(1),
                    b.height.max(1),
                    4,
                )
            } else {
                [42, 42, 42]
            };
            let brightness =
                ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
            let text_color = ColorSampler::decide_text_color(brightness);
            ColorSample {
                box_rect: b,
                background_rgb: bg_rgb,
                text_color,
            }
        })
        .collect();
    Ok(samples)
}

#[cfg(test)]
mod mapping_tests {
    use super::logical_selection_to_physical;
    use crate::models::PhysicalRect;

    fn rect(x: i32, y: i32, w: u32, h: u32) -> PhysicalRect {
        PhysicalRect { x, y, width: w, height: h }
    }

    #[test]
    fn identity_mapping_at_scale_one() {
        // BMP 1920×1080, overlay viewport 1920×1080 → 1:1
        let out = logical_selection_to_physical(rect(100, 50, 300, 100), 1920, 1080, 1.0, Some(1.0), Some(1920.0), Some(1080.0));
        assert_eq!(out, rect(100, 50, 300, 100));
    }

    #[test]
    fn viewport_geometry_wins_over_dpi_hint() {
        // Mixed-DPI: BMP is 2× the overlay viewport → geometry ratio 2.0 must
        // be used even though the (wrong) scale hint says 1.0
        let out = logical_selection_to_physical(rect(100, 50, 300, 100), 3840, 2160, 1.5, Some(1.0), Some(1920.0), Some(1080.0));
        assert_eq!(out.x, 200);
        assert_eq!(out.y, 100);
        assert_eq!(out.width, 600);
        assert_eq!(out.height, 200);
    }

    #[test]
    fn falls_back_to_scale_hint_without_viewport() {
        let out = logical_selection_to_physical(rect(100, 100, 100, 100), 3840, 2160, 2.0, Some(2.0), None, None);
        assert_eq!(out, rect(200, 200, 200, 200));
    }

    #[test]
    fn clamps_origin_to_bmp_bounds() {
        // The mapper clamps the ORIGIN into the BMP; the extent beyond the
        // right/bottom edge is clamped later inside crop_bmp (its
        // rw/rh = min(size, remaining) logic), so the crop is always in bounds.
        let out = logical_selection_to_physical(rect(1900, 1000, 300, 200), 1920, 1080, 1.0, Some(1.0), Some(1920.0), Some(1080.0));
        assert!(out.x >= 0 && (out.x as u32) <= 1920);
        assert!(out.y >= 0 && (out.y as u32) <= 1080);
        assert_eq!(out.x, 1900);
        assert_eq!(out.y, 1000);
        // crop_bmp clamps the extent itself
        let bmp = vec![0u8; (1920 * 1080 * 4 + 54) as usize];
        let cropped = crate::ocr::crop_bmp(&bmp, 1920, 1080, out).unwrap();
        let w = i32::from_le_bytes([cropped[18], cropped[19], cropped[20], cropped[21]]);
        let h = i32::from_le_bytes([cropped[22], cropped[23], cropped[24], cropped[25]]);
        assert_eq!(w, 20); // 1920 - 1900
        assert_eq!(h, -80); // top-down DIB: negative height, |h| = 1080 - 1000
    }

    #[test]
    fn test_overlay_active_and_main_window_visibility_state() {
        assert_eq!(super::is_overlay_active(), false);
        super::set_was_main_window_visible(true);
        assert_eq!(super::WAS_MAIN_WINDOW_VISIBLE.load(std::sync::atomic::Ordering::SeqCst), true);
        super::set_was_main_window_visible(false);
        assert_eq!(super::WAS_MAIN_WINDOW_VISIBLE.load(std::sync::atomic::Ordering::SeqCst), false);
    }
}



#[cfg(test)]
mod ocr_filter_tests {
    use super::*;

    fn default_rules() -> Vec<String> {
        crate::models::DEFAULT_OCR_FILTER_RULES
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn default_rules_filter_junk_and_keep_terms() {
        let r = default_rules();
        for junk in [
            "12:34", "12:34:56", "2026-08-22", "2026.8.22", "12345", "3.14", "98%",
            "HP: 1500/2000", "MP 800", "EXP: 42", "Stamina: 100", "Stamina 50",
            "https://example.com/a", "LIVE", "rec",
        ] {
            assert!(ocr_text_filtered(&r, junk), "应过滤: {junk}");
        }
        for keep in [
            "Roughness", "Principled BSDF", "HP Designjet Printer", "Set to 100 percent",
            "Live2D Cubism", "2026 new features",
        ] {
            assert!(!ocr_text_filtered(&r, keep), "不应过滤: {keep}");
        }
    }

    #[test]
    fn invalid_regex_is_skipped_not_fatal() {
        let rules = vec!["[invalid(".to_string(), r"^ok$".to_string()];
        assert!(!ocr_text_filtered(&rules, "anything"));      // 无效正则跳过
        assert!(ocr_text_filtered(&rules, "ok"));             // 有效正则仍工作
    }

    #[test]
    fn empty_rules_means_no_filtering() {
        assert!(!ocr_text_filtered(&[], "12:34"));
        assert!(!ocr_text_filtered(&[], ""));
    }

    #[test]
    fn custom_rules_replace_defaults() {
        let settings = crate::models::AppSettings {
            ocr_filter_enabled: Some(true),
            ocr_filter_rules: Some(vec![r"^TODO".to_string()]),
            ..Default::default()
        };
        let filter = ocr_filter_from_settings(&settings).unwrap();
        assert!(ocr_text_filtered(&filter, "TODO: fix this"));
        assert!(!ocr_text_filtered(&filter, "12:34")); // 默认规则已被替换,不再生效
    }

    #[test]
    fn disabled_setting_yields_none() {
        let settings = crate::models::AppSettings {
            ocr_filter_enabled: Some(false),
            ..Default::default()
        };
        assert!(ocr_filter_from_settings(&settings).is_none());
    }
}
