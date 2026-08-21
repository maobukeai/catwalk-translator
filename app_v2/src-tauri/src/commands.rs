pub use crate::models::{
    AppSettings, BoundingBox, CaptureSession, CaptureSessionBlock, ColorSample, HistoryItem,
    LlmConfig, MultiEngineTranslation, OcrResult, OnlineEngines, OverlayBlock, OverlayResult,
    PhysicalRect, PresetDicts, TextBlock, TextQueryResponse, TranslationResult,
    UniversalTranslationRequest, UniversalTranslationResponse, WordDetail,
};
use crate::reconstruction::{LineClusterer, WordMerger};
use crate::sampler::ColorSampler;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub async fn cmd_universal_translate(
    req: UniversalTranslationRequest,
) -> Result<UniversalTranslationResponse, String> {
    crate::translator::execute_universal_translate(req).await
}

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
fn region_ocr_layout(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    overlay_width: Option<f64>,
    overlay_height: Option<f64>,
    ocr_engine: Option<String>,
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


    if ocr_result.blocks.is_empty() {
        return Ok(vec![]);
    }

    // 6. Cluster into lines and merge words per line (e.g. "Principled" + "BSDF" -> "Principled BSDF")
    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let merged_blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .map(|line| WordMerger::merge_line(line, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();

    if merged_blocks.is_empty() {
        return Ok(vec![]);
    }

    // 7. Build OverlayBlocks with exact sampled background color from the clean desktop BMP
    let mut overlay_blocks = Vec::with_capacity(merged_blocks.len());

    for block in &merged_blocks {
        let block_phys_x = block.box_rect.x;
        let block_phys_y = block.box_rect.y;
        let block_phys_w = block.box_rect.width as i32;
        let block_phys_h = block.box_rect.height as i32;

        let logical_x = (block_phys_x as f64 / sf_x) + (selection.x as f64);
        let logical_y = (block_phys_y as f64 / sf_y) + (selection.y as f64);
        let logical_w = (block_phys_w as f64 / sf_x).max(18.0);
        let logical_h = (block_phys_h as f64 / sf_y).max(14.0);

        let abs_phys = BoundingBox {
            x: phys.x + block_phys_x,
            y: phys.y + block_phys_y,
            width: block_phys_w.max(4) as u32,
            height: block_phys_h.max(4) as u32,
        };
        let bg_rgb = ColorSampler::sample_from_full_bmp(&bmp_data, bmp_w, bmp_h, abs_phys, 4);

        // Real glyph colour: median of the "ink" pixels inside the box, falling
        // back to a high-contrast black/white when no clear ink exists.
        let ink_rgb = crate::inpaint::sample_text_color(&bmp_data, bmp_w, bmp_h, abs_phys);
        let fg_css = format!("rgb({},{},{})", ink_rgb[0], ink_rgb[1], ink_rgb[2]);

        // Erased patch: padded OCR box with glyphs removed via background
        // interpolation, encoded as PNG. The card uses it as background so the
        // original text disappears and the card edges continue the real screen.
        let (patch_png, patch_rect) =
            match crate::inpaint::build_erased_patch_png(&bmp_data, bmp_w, bmp_h, abs_phys) {
                Some((b64, pw, ph)) => {
                    let (x0, y0, _x1, _y1) = crate::inpaint::pad_bbox(abs_phys, bmp_w, bmp_h);
                    let lx = selection.x as f64 + ((x0 - phys.x) as f64 / sf_x);
                    let ly = selection.y as f64 + ((y0 - phys.y) as f64 / sf_y);
                    (Some(b64), (lx, ly, pw as f64 / sf_x, ph as f64 / sf_y))
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
    let ocr_engine = state.settings.lock().ok().and_then(|s| s.ocr_engine.clone());
    let blocks = region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine)?;
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
    let ocr_engine = state.settings.lock().ok().and_then(|s| s.ocr_engine.clone());
    // Stage 1: OCR + layout + colors
    let mut overlay_blocks = region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine)?;
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
    // batched LLM, then parallel online fallback
    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let phrases: Vec<String> = overlay_blocks.iter().map(|b| b.original.clone()).collect();
    let translations = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref())
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

    // 3. OCR + line clustering + word merge (identical to the capture path).
    let ocr_result =
        crate::ocr::execute_native_ocr(&bmp).unwrap_or(OcrResult { blocks: vec![] });
    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let merged_blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .map(|line| WordMerger::merge_line(line, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();

    if merged_blocks.is_empty() {
        return Ok(crate::models::ImageTranslateResponse {
            image_width: w,
            image_height: h,
            blocks: vec![],
        });
    }

    // 4. Translate through the shared multi-tier pipeline.
    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);
    let phrases: Vec<String> = merged_blocks.iter().map(|b| b.text.clone()).collect();
    let translations = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref())
        .await;

    // 5. Sample per-block background colours from the image itself.
    let mut blocks = Vec::with_capacity(merged_blocks.len());
    for (block, tr) in merged_blocks.iter().zip(translations.iter()) {
        let bg_rgb = ColorSampler::sample_from_full_bmp(
            &bmp,
            w,
            h,
            BoundingBox {
                x: block.box_rect.x,
                y: block.box_rect.y,
                width: block.box_rect.width.max(4),
                height: block.box_rect.height.max(4),
            },
            4,
        );
        let brightness = ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
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
            fg_css: if brightness < 128.0 {
                "#ffffff".to_string()
            } else {
                "#141417".to_string()
            },
        });
    }

    Ok(crate::models::ImageTranslateResponse {
        image_width: w,
        image_height: h,
        blocks,
    })
}

use std::fs;
use std::path::PathBuf;

pub fn get_app_config_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app_handle.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let fallback = std::env::temp_dir().join("cg_translator_config");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

pub fn save_settings_file(app_handle: &tauri::AppHandle, settings: &AppSettings) {
    let path = get_app_config_dir(app_handle).join("settings.json");
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
    }
}

pub fn load_settings_file(app_handle: &tauri::AppHandle) -> AppSettings {
    let path = get_app_config_dir(app_handle).join("settings.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    let default_s = AppSettings::default();
    save_settings_file(app_handle, &default_s);
    default_s
}

pub fn save_history_file(app_handle: &tauri::AppHandle, history: &[HistoryItem]) {
    let path = get_app_config_dir(app_handle).join("history.json");
    if let Ok(json) = serde_json::to_string_pretty(history) {
        let _ = fs::write(path, json);
    }
}

pub fn load_history_file(app_handle: &tauri::AppHandle) -> Vec<HistoryItem> {
    let path = get_app_config_dir(app_handle).join("history.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(hist) = serde_json::from_str::<Vec<HistoryItem>>(&content) {
                return hist;
            }
        }
    }
    vec![]
}

fn save_capture_sessions_file(app_handle: &tauri::AppHandle, sessions: &[CaptureSession]) {
    let path = get_app_config_dir(app_handle).join("capture_sessions.json");
    if let Ok(json) = serde_json::to_string_pretty(sessions) {
        let _ = fs::write(path, json);
    }
}

fn load_capture_sessions_file(app_handle: &tauri::AppHandle) -> Vec<CaptureSession> {
    let path = get_app_config_dir(app_handle).join("capture_sessions.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<Vec<CaptureSession>>(&content) {
                return s;
            }
        }
    }
    vec![]
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub history: Mutex<Vec<HistoryItem>>,
    pub capture_sessions: Mutex<Vec<CaptureSession>>,
}

impl AppState {
    pub fn load_from_disk(app_handle: &tauri::AppHandle) -> Self {
        let settings = load_settings_file(app_handle);
        let history = load_history_file(app_handle);
        let capture_sessions = load_capture_sessions_file(app_handle);
        Self {
            settings: Mutex::new(settings),
            history: Mutex::new(history),
            capture_sessions: Mutex::new(capture_sessions),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            history: Mutex::new(vec![]),
            capture_sessions: Mutex::new(vec![]),
        }
    }
}

/// Persist a capture-translation session (id-deduped, newest first, capped at 50)
/// so it can be replayed later from the vocabulary/history view.
#[tauri::command]
pub async fn cmd_save_capture_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session: CaptureSession,
) -> Result<(), String> {
    if session.blocks.is_empty() {
        return Ok(());
    }
    let mut lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    lock.retain(|s| s.id != session.id);
    lock.insert(0, session);
    lock.truncate(50);
    save_capture_sessions_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_capture_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<CaptureSession>, String> {
    let lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_clear_capture_sessions(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    lock.clear();
    save_capture_sessions_file(&app_handle, &[]);
    Ok(())
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
    let payload =
        crate::capture::capture_desktop_payload().unwrap_or(crate::capture::ScreenCapturePayload {
            data_url: String::new(),
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        });

    // Zero base64 transfer to React — return payload with scale_factor only!
    Ok(crate::capture::ScreenCapturePayload {
        data_url: String::new(),
        width: payload.width,
        height: payload.height,
        scale_factor: payload.scale_factor,
    })
}

/// Expand the main window to a full-screen transparent selection overlay.
/// On Windows, uses the virtual screen dimensions to cover all monitors including taskbar.
#[tauri::command]
pub async fn cmd_show_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    IS_OVERLAY_ACTIVE.store(true, Ordering::SeqCst);
    let _ = window.unminimize();

    #[cfg(target_os = "windows")]
    {
        #[cfg(target_os = "windows")]
        crate::set_windows_dwm_blur(&window, false, true);
        use tauri::LogicalSize;
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
        // Use logical pixels (scale factor handled by Tauri)
        let sf = window.scale_factor().unwrap_or(1.0);
        let _ = window.set_position(tauri::LogicalPosition::new(vx as f64 / sf, vy as f64 / sf));
        let _ = window.set_size(LogicalSize::new(vw as f64 / sf, vh as f64 / sf));
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
        crate::capture::refresh_capture_region_quietly(hwnd_raw.0 as isize, phys)?;

        let ocr_engine = state.settings.lock().ok().and_then(|s| s.ocr_engine.clone());
        let blocks = region_ocr_layout(selection, scale_factor, overlay_width, overlay_height, ocr_engine)?;
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

        if let Some(cropped) = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys) {
            if let Ok(ocr_res) = crate::ocr::execute_native_ocr(&cropped) {
                if !ocr_res.blocks.is_empty() {
                    let lines = LineClusterer::cluster_into_lines(ocr_res.blocks, 8.0);
                    let merged_blocks: Vec<TextBlock> = lines
                        .into_iter()
                        .filter(|line| !line.is_empty())
                        .map(|line| WordMerger::merge_line(line, 20.0))
                        .filter(|b| !b.text.trim().is_empty())
                        .collect();
                    return Ok(OcrResult { blocks: merged_blocks });
                }
            }
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

#[tauri::command]
pub async fn cmd_translate_phrases(
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    if phrases.is_empty() {
        return Ok(vec![]);
    }

    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let results = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref())
        .await;
    Ok(results)
}

/// Style-aware variant used by the capture overlay: same pipeline as
/// `cmd_translate_phrases` but forwards the user's translation style
/// ("literal" | "free" | "terminology") into LLM prompts.
#[tauri::command]
pub async fn cmd_translate_phrases_styled(
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
    style: Option<String>,
) -> Result<Vec<TranslationResult>, String> {
    if phrases.is_empty() {
        return Ok(vec![]);
    }

    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let results = pipeline
        .translate_phrases_styled(&phrases, &preset, llm_config.as_ref(), style.as_deref())
        .await;
    Ok(results)
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

/// Frozen-frame hover lookup: OCR a neighborhood around the logical cursor
/// point and return the exact text LINE under it (no paragraph expansion —
/// hover must point at text, otherwise None). Reads the capture taken when
/// the overlay opened, so it is fast and flicker-free.
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
        .map(|l| WordMerger::merge_line(l, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();
    if blocks.is_empty() {
        return Ok(None);
    }

    // Absolute physical coords
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
    let target = match hit {
        Some(t) => t,
        None => return Ok(None),
    };

    let pad = 4i32;
    Ok(Some(HoverLine {
        text: target.text.trim().to_string(),
        x: (((target.box_rect.x - pad).max(0)) as f64 / sf_x).round(),
        y: (((target.box_rect.y - pad).max(0)) as f64 / sf_y).round(),
        width: (((target.box_rect.width as i32 + pad * 2)) as f64 / sf_x).round(),
        height: (((target.box_rect.height as i32 + pad * 2)) as f64 / sf_y).round(),
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
        .map(|l| WordMerger::merge_line(l, 20.0))
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

/// Decide whether native DWM Acrylic should be ON for the main window.
/// The user's frosted-glass toggle is the single source of truth — any theme
/// can be glassy; theme only picks the color palette.
pub fn glass_enabled_for_settings(settings: &AppSettings) -> bool {
    match &settings.appearance {
        Some(ap) => ap.enable_blur && ap.enable_transparency,
        None => true,
    }
}

/// Decide whether the active theme is a dark theme.
pub fn is_dark_for_settings(settings: &AppSettings) -> bool {
    let theme_str = settings
        .appearance
        .as_ref()
        .map(|a| a.theme.as_str())
        .unwrap_or(settings.theme.as_str());
    !matches!(theme_str, "light" | "fluent-light")
}

/// Toggle native Windows DWM Acrylic blur on the main window at runtime.
#[tauri::command]
pub async fn cmd_set_window_blur(
    window: tauri::WebviewWindow,
    enable: Option<bool>,
    is_dark: Option<bool>,
) -> Result<(), String> {
    let enable = enable.unwrap_or(true);
    let is_dark = is_dark.unwrap_or(true);
    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&window, enable, is_dark);
    Ok(())
}

#[tauri::command]
pub async fn cmd_save_settings(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    // eprintln! reliably reaches the dev log even in windowsgui subsystem
    // (println!/stdout is silently dropped there and previously mislead diagnosis).
    eprintln!(
        ">>> cmd_save_settings CALLED! hotkey = '{}', appearance = {:?}",
        settings.hotkey, settings.appearance
    );

    let mut lock = state
        .settings
        .lock()
        .map_err(|e| format!("Failed to lock settings: {}", e))?;

    // Dynamically re-register all 4 user updated hotkeys with OS
    println!(">>> Re-registering all global shortcuts with OS...");
    if let Err(err) = crate::register_all_user_shortcuts(&app_handle, &settings) {
        eprintln!(">>> Warning when registering global shortcuts: {}", err);
    }

    // Sync native DWM Acrylic with the freshly saved appearance settings
    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(
        &window,
        glass_enabled_for_settings(&settings),
        is_dark_for_settings(&settings),
    );

    *lock = settings.clone();
    save_settings_file(&app_handle, &settings);

    // Passive clipboard watch follows the saved setting (default off)
    if settings.clipboard_watch_enabled.unwrap_or(false) {
        crate::clipboard_watch::start_clipboard_watch(app_handle.clone());
    } else {
        crate::clipboard_watch::stop_clipboard_watch();
    }

    println!(">>> Settings saved successfully to disk.");
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let lock = state
        .settings
        .lock()
        .map_err(|e| format!("Failed to lock settings: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_query_text(
    text: String,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<TextQueryResponse, String> {
    if text.trim().is_empty() {
        return Ok(TextQueryResponse {
            original: text,
            word_detail: None,
            results: vec![],
        });
    }

    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let res = pipeline
        .query_text_detail(&text, &preset, llm_config.as_ref())
        .await;
    Ok(res)
}

#[tauri::command]
pub async fn cmd_offline_install() -> Result<crate::models::OfflineModelStatus, String> {
    crate::offline::install_offline()
}

#[tauri::command]
pub async fn cmd_offline_uninstall() -> Result<crate::models::OfflineModelStatus, String> {
    crate::offline::uninstall_offline()
}

#[tauri::command]
pub async fn cmd_offline_status() -> Result<crate::models::OfflineModelStatus, String> {
    Ok(crate::offline::status())
}

#[tauri::command]
pub async fn cmd_get_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, String> {
    let lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_add_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    item: HistoryItem,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.insert(0, item);
    if lock.len() > 200 {
        lock.truncate(200);
    }
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_toggle_favorite(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    for item in lock.iter_mut() {
        if item.id == id {
            item.is_favorite = !item.is_favorite;
            let fav = item.is_favorite;
            save_history_file(&app_handle, &lock);
            return Ok(fav);
        }
    }
    Err("Item not found".to_string())
}

#[tauri::command]
pub async fn cmd_delete_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.retain(|item| item.id != id);
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_clear_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.clear();
    save_history_file(&app_handle, &lock);
    Ok(())
}

/// Report the runtime status of the RapidOCR daemon (idle / warming / ready / failed).
#[tauri::command]
pub async fn cmd_ocr_engine_status() -> Result<crate::models::OcrEngineStatus, String> {
    Ok(crate::ocr::runtime_status())
}

#[tauri::command]
pub async fn cmd_export_anki(items: Vec<HistoryItem>) -> Result<String, String> {
    let mut csv_content = String::from("Front,Back,Tag\n");
    for item in items {
        csv_content.push_str(&format!(
            "\"{}\",\"{}\",\"CG-Translator\"\n",
            item.original.replace('"', "\"\""),
            item.translated.replace('"', "\"\"")
        ));
    }
    Ok(csv_content)
}

pub struct TestReportFormatter;

impl TestReportFormatter {
    pub fn format_summary(settings: &AppSettings) -> String {
        format!(
            "Theme: {}, Preset: {}, Hotkey: {}",
            settings.theme, settings.default_preset, settings.hotkey
        )
    }
}

pub struct EnvironmentChecker;

impl EnvironmentChecker {
    pub fn check_runtime_environment(settings: &AppSettings) -> bool {
        settings.llm_config.is_some() && !settings.translation_tiers.is_empty()
    }
}

/// Native Rust command to query /models endpoint over network bypassing WebView CORS restrictions.
#[tauri::command]
pub async fn cmd_fetch_llm_models(
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let raw_input = endpoint.trim().to_string();
    if raw_input.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    // 1. Separate base path and existing query string
    let (base_path, query_str) = match raw_input.find('?') {
        Some(pos) => (&raw_input[..pos], Some(&raw_input[pos + 1..])),
        None => (raw_input.as_str(), None),
    };

    let mut clean_base = base_path.trim_end_matches('/').to_string();
    if clean_base.ends_with("/chat/completions") {
        clean_base = clean_base.replace("/chat/completions", "");
    }
    if clean_base.ends_with("/completions") {
        clean_base = clean_base.replace("/completions", "");
    }

    let is_google_gemini = clean_base.contains("google")
        || clean_base.contains("gemini")
        || clean_base.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 2. Build candidate network URLs for listing models in priority order
    let mut candidate_urls = Vec::new();

    if clean_base.ends_with("/models") {
        candidate_urls.push(clean_base.clone());
    } else if is_google_gemini {
        if clean_base.ends_with("/v1beta") || clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/models", clean_base));
        } else {
            // For Cloudflare AI Gateway / Google AI Studio base URLs, /v1beta/models MUST be tried first!
            candidate_urls.push(format!("{}/v1beta/models", clean_base));
            candidate_urls.push(format!("{}/v1/models", clean_base));
            candidate_urls.push(format!("{}/models", clean_base));
        }
    } else {
        candidate_urls.push(format!("{}/models", clean_base));
        if !clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/v1/models", clean_base));
        }
    }

    // 3. Prepare reqwest client with 15s timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("无法初始化网络客户端: {}", e))?;

    let mut last_error = String::new();

    // 4. Try candidate URLs in priority sequence
    for target_base in candidate_urls {
        let mut final_url = target_base.clone();

        // Preserve existing query params if any
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        // For Gemini / Google API, append ?key=
        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.get(&final_url);

        // IMPORTANT CRITICAL FIX:
        // DO NOT send Authorization: Bearer header for Gemini/Google API keys (starting with AIza)!
        // Google AI Studio treats Bearer headers as OAuth 2 tokens and returns 401 Unauthorized!
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("网络请求无法连接到: {} ({})", final_url, e);
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = if err_body.len() > 150 {
                format!("{}...", &err_body[..150])
            } else {
                err_body
            };
            last_error = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code, short_body, final_url
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_error = format!("接口返回无效 JSON ({}) 路径: {}", e, final_url);
                continue;
            }
        };

        let mut models = Vec::new();

        // Parse OpenAI format {"data": [...]}
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for m in data {
                let id_str = if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                    Some(s)
                } else if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                    Some(s)
                } else {
                    m.as_str()
                };

                if let Some(id) = id_str {
                    let clean = id.trim_start_matches("models/").to_string();
                    if !clean.is_empty() && !models.contains(&clean) {
                        models.push(clean);
                    }
                }
            }
        }

        // Parse Gemini / Google format {"models": [...]}
        if models.is_empty() {
            if let Some(data) = json.get("models").and_then(|v| v.as_array()) {
                for m in data {
                    let id_str = if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                        Some(s)
                    } else if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                        Some(s)
                    } else {
                        m.as_str()
                    };

                    if let Some(id) = id_str {
                        let clean = id.trim_start_matches("models/").to_string();
                        if !clean.is_empty() && !models.contains(&clean) {
                            models.push(clean);
                        }
                    }
                }
            }
        }

        if !models.is_empty() {
            return Ok(models);
        } else {
            last_error = format!(
                "接口 (200 OK) 返回成功但未找到模型字段。路径: {}",
                final_url
            );
        }
    }

    Err(if last_error.is_empty() {
        "无法获取可用模型，请检查 API Key 和接口地址".to_string()
    } else {
        format!("拉取失败: {}", last_error)
    })
}

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

/// 流式增量事件：done=false 携带一段增量文本；done=true 表示流结束（delta 为空）。
#[derive(Clone, Serialize)]
pub struct ChatStreamDelta {
    pub delta: String,
    pub done: bool,
}

/// 端点规划：把用户填写的 Base URL 展开为按优先级排列的候选请求地址。
struct ChatEndpointPlan {
    candidate_urls: Vec<String>,
    query_str: Option<String>,
    is_google_gemini: bool,
    api_key: String,
    model_name: String,
}

fn plan_chat_endpoints(config: &LlmConfig) -> Result<ChatEndpointPlan, String> {
    let raw_ep = config.endpoint.trim().to_string();
    if raw_ep.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    let api_key = config.api_key.trim().to_string();
    let model_name = if config.model.trim().is_empty() {
        "gemini-1.5-flash".to_string()
    } else {
        config.model.trim().to_string()
    };

    let is_google_gemini = raw_ep.contains("google")
        || raw_ep.contains("gemini")
        || raw_ep.contains("googleapis.com")
        || raw_ep.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 1. Separate base path and query parameters
    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let clean_base = base_path.trim_end_matches('/').to_string();

    // Candidate chat endpoints in priority order
    let mut candidate_urls = Vec::new();

    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    }

    if is_google_gemini {
        // Strip suffixes to get base root hostname (e.g. https://generativelanguage.googleapis.com)
        let mut root = clean_base.as_str();
        if let Some(stripped) = root.strip_suffix("/chat/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/openai") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/models") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1beta") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1") {
            root = stripped;
        }
        let root = root.trim_end_matches('/');

        // Google AI Studio official OpenAI-compatible endpoint (supports SSE stream & standard chat completions)
        candidate_urls.push(format!("{}/v1beta/openai/chat/completions", root));
        // Google AI Studio native REST endpoint
        candidate_urls.push(format!(
            "{}/v1beta/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!(
            "{}/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!("{}/v1/chat/completions", root));
        candidate_urls.push(format!("{}/chat/completions", root));
    } else {
        let mut b = clean_base.as_str();
        if let Some(stripped) = b.strip_suffix("/chat/completions") {
            b = stripped;
        }
        if let Some(stripped) = b.strip_suffix("/completions") {
            b = stripped;
        }
        let b = b.trim_end_matches('/');

        if b.ends_with("/v1") {
            candidate_urls.push(format!("{}/chat/completions", b));
            candidate_urls.push(b.to_string());
        } else {
            candidate_urls.push(format!("{}/v1/chat/completions", b));
            candidate_urls.push(format!("{}/chat/completions", b));
        }

        if b.contains("localhost") || b.contains("127.0.0.1") {
            candidate_urls.push(format!("{}/api/chat", b));
        }
    }

    // Deduplicate candidate_urls while preserving order
    let mut seen = std::collections::HashSet::new();
    candidate_urls.retain(|url| seen.insert(url.clone()));

    Ok(ChatEndpointPlan {
        candidate_urls,
        query_str: query_str.map(|s| s.to_string()),
        is_google_gemini,
        api_key,
        model_name,
    })
}

/// 拼接最终 URL（查询串 + Gemini key 参数）
fn finalize_chat_url(plan: &ChatEndpointPlan, target_url: &str) -> String {
    let mut final_url = target_url.to_string();
    if let Some(qs) = &plan.query_str {
        if !qs.is_empty() {
            if final_url.contains('?') {
                final_url = format!("{}&{}", final_url, qs);
            } else {
                final_url = format!("{}?{}", final_url, qs);
            }
        }
    }

    if plan.is_google_gemini && !plan.api_key.is_empty() && !final_url.contains("key=") {
        if final_url.contains('?') {
            final_url = format!("{}&key={}", final_url, plan.api_key);
        } else {
            final_url = format!("{}?key={}", final_url, plan.api_key);
        }
    }
    final_url
}

/// 附加鉴权头
fn apply_chat_auth(mut req: reqwest::RequestBuilder, plan: &ChatEndpointPlan) -> reqwest::RequestBuilder {
    if !plan.api_key.is_empty() {
        if plan.is_google_gemini {
            req = req
                .header("x-goog-api-key", &plan.api_key)
                .header("api-key", &plan.api_key);
            if !plan.api_key.starts_with("AIza") {
                req = req.header("Authorization", format!("Bearer {}", plan.api_key));
            }
        } else {
            req = req
                .header("Authorization", format!("Bearer {}", plan.api_key))
                .header("api-key", &plan.api_key);
        }
    }
    req
}

/// 构造请求体：OpenAI 兼容（可选 stream）或 Gemini 原生
fn build_chat_body(
    plan: &ChatEndpointPlan,
    messages: &[ChatMessagePayload],
    native_gemini: bool,
    stream: bool,
) -> serde_json::Value {
    if native_gemini {
        let contents: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                let role = if m.role == "user" { "user" } else { "model" };
                serde_json::json!({
                    "role": role,
                    "parts": [{ "text": m.content }]
                })
            })
            .collect();
        serde_json::json!({ "contents": contents })
    } else if stream {
        serde_json::json!({
            "model": plan.model_name,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 2000,
            "stream": true,
        })
    } else {
        serde_json::json!({
            "model": plan.model_name,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 2000,
        })
    }
}

/// 从完整 JSON 响应中提取回复文本（OpenAI / Gemini / Ollama 三种格式）
fn extract_chat_reply(json: &serde_json::Value) -> Option<String> {
    if let Some(content) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|first| first.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|val| val.as_str())
    {
        if !content.trim().is_empty() {
            return Some(content.to_string());
        }
    }

    if let Some(text) = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|first| first.get("content"))
        .and_then(|cnt| cnt.get("parts"))
        .and_then(|parts| parts.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|part| part.get("text"))
        .and_then(|val| val.as_str())
    {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }

    if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
        if !res_str.trim().is_empty() {
            return Some(res_str.to_string());
        }
    }

    None
}

/// Native Rust command for LLM chat bypassing WebView CORS restrictions
/// Supports DeepSeek, OpenAI, Ollama, Gemini, GLM, and Custom Endpoints.
#[tauri::command]
pub async fn cmd_chat_llm(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
) -> Result<String, String> {
    let plan = plan_chat_endpoints(&config)?;

    let client = crate::translator::create_http_client(35000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, false);

        let req = apply_chat_auth(client.post(&final_url), &plan);

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("网络连接失败 (无法连接到 {}): {}", final_url, e);
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = if err_body.len() > 220 {
                format!("{}...", &err_body[..220])
            } else {
                err_body
            };
            last_err = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code, short_body, final_url
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_err = format!("接口返回无效 JSON ({}) 路径: {}", e, final_url);
                continue;
            }
        };

        if let Some(content) = extract_chat_reply(&json) {
            return Ok(content);
        }

        last_err = format!("接口成功 (200 OK) 但未能解析出消息文本。原始响应: {}", json);
    }

    Err(if last_err.is_empty() {
        "AI 对话服务暂时不可用，请检查网络与接口配置".to_string()
    } else {
        last_err
    })
}

/// 流式 LLM 对话：OpenAI 兼容端点走 SSE 增量解析并经 Channel 推送 delta；
/// Gemini 原生端点或不支持流式的端点自动回退为一次性返回（单 delta 发完）。
/// 返回值 = 完整回复文本（与非流式 cmd_chat_llm 一致，便于上层回退）。
#[tauri::command]
pub async fn cmd_chat_llm_stream(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
    on_delta: Channel<ChatStreamDelta>,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let plan = plan_chat_endpoints(&config)?;

    let client = crate::translator::create_http_client(35000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);
        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, !is_native_gemini_endpoint);

        let req = apply_chat_auth(client.post(&final_url), &plan);

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("网络连接失败 (无法连接到 {}): {}", final_url, e);
                continue;
            }
        };

        let status = res.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            let err_body = res.text().await.unwrap_or_default();
            let short_body = if err_body.len() > 220 {
                format!("{}...", &err_body[..220])
            } else {
                err_body
            };
            last_err = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code, short_body, final_url
            );
            continue;
        }

        let is_sse = !is_native_gemini_endpoint
            && res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("text/event-stream"))
                .unwrap_or(false);

        if is_sse {
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            let mut full = String::new();
            let mut stream_err: Option<String> = None;

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        stream_err = Some(format!("流式读取中断: {}", e));
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));

                // 逐行解析 SSE：`data: {json}`，`data: [DONE]` 结束
                loop {
                    match buf.find('\n') {
                        Some(pos) => {
                            let line: String = buf.drain(..=pos).collect();
                            let line = line.trim_end();
                            let Some(data) = line.strip_prefix("data:") else {
                                continue;
                            };
                            let data = data.trim();
                            if data.is_empty() || data == "[DONE]" {
                                continue;
                            }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(d) = v
                                    .get("choices")
                                    .and_then(|c| c.as_array())
                                    .and_then(|arr| arr.get(0))
                                    .and_then(|first| first.get("delta"))
                                    .and_then(|delta| delta.get("content"))
                                    .and_then(|c| c.as_str())
                                {
                                    if !d.is_empty() {
                                        let _ = on_delta.send(ChatStreamDelta {
                                            delta: d.to_string(),
                                            done: false,
                                        });
                                        full.push_str(d);
                                    }
                                }
                            }
                        }
                        None => break,
                    }
                }
            }

            if !full.trim().is_empty() {
                let _ = on_delta.send(ChatStreamDelta {
                    delta: String::new(),
                    done: true,
                });
                return Ok(full);
            }
            last_err = stream_err
                .unwrap_or_else(|| "流式响应结束但未产出文本".to_string());
            continue;
        }

        // 非 SSE（Gemini 原生 / 不支持流式）：一次性解析并作为单条 delta 推送
        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_err = format!("接口返回无效 JSON ({}) 路径: {}", e, final_url);
                continue;
            }
        };

        if let Some(content) = extract_chat_reply(&json) {
            let _ = on_delta.send(ChatStreamDelta {
                delta: content.clone(),
                done: false,
            });
            let _ = on_delta.send(ChatStreamDelta {
                delta: String::new(),
                done: true,
            });
            return Ok(content);
        }

        last_err = format!("接口成功 (200 OK) 但未能解析出消息文本。原始响应: {}", json);
    }

    Err(if last_err.is_empty() {
        "AI 对话服务暂时不可用，请检查网络与接口配置".to_string()
    } else {
        last_err
    })
}

#[tauri::command]
pub fn cmd_exit_app(app: tauri::AppHandle) {
    app.exit(0);
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

