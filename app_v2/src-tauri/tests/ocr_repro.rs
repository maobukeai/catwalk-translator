// Repro harness (NOT run in CI): dumps the real ONNX OCR pipeline output for a
// PNG so detection/clustering behaviour can be inspected offline.
//
// Usage (from src-tauri/):
//   CATWALK_REPRO_IMAGE=<png path> \
//   CATWALK_OCR_MODELS_DIR=<models dir> \
//   cargo test --test ocr_repro -- --nocapture --ignored
use app_v2_lib::models::TextBlock;
use app_v2_lib::reconstruction::{LineClusterer, WordMerger};

fn png_to_ocr_bmp(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let raw = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut img = image::load_from_memory(&raw).map_err(|e| e.to_string())?;
    if let Ok(spec) = std::env::var("CATWALK_REPRO_CROP") {
        let values: Vec<u32> = spec.split(',').filter_map(|part| part.trim().parse().ok()).collect();
        if let [x, y, width, height] = values.as_slice() {
            if *width == 0 || *height == 0 || x.saturating_add(*width) > img.width()
                || y.saturating_add(*height) > img.height()
            {
                return Err(format!("invalid diagnostic crop {spec:?} for {}x{}", img.width(), img.height()));
            }
            img = img.crop_imm(*x, *y, *width, *height);
            println!("[repro] diagnostic crop=({x},{y}) {width}x{height}");
        } else {
            return Err(format!("CATWALK_REPRO_CROP must be x,y,width,height: {spec:?}"));
        }
    }
    if let Ok(scale) = std::env::var("CATWALK_REPRO_SCALE") {
        let scale: u32 = scale.parse().map_err(|_| "CATWALK_REPRO_SCALE must be 1..=4")?;
        if !(1..=4).contains(&scale) {
            return Err("CATWALK_REPRO_SCALE must be 1..=4".to_string());
        }
        if scale > 1 {
            img = img.resize_exact(img.width() * scale, img.height() * scale,
                image::imageops::FilterType::CatmullRom);
            println!("[repro] diagnostic upscaling={scale}x");
        }
    }
    if let Ok(percent) = std::env::var("CATWALK_REPRO_PERCENT") {
        let percent: u32 = percent.parse().map_err(|_| "CATWALK_REPRO_PERCENT must be 25..=200")?;
        if !(25..=200).contains(&percent) {
            return Err("CATWALK_REPRO_PERCENT must be 25..=200".to_string());
        }
        img = img.resize_exact(
            (img.width() as u64 * percent as u64 / 100).max(1) as u32,
            (img.height() as u64 * percent as u64 / 100).max(1) as u32,
            image::imageops::FilterType::CatmullRom,
        );
        println!("[repro] diagnostic resize={percent}%");
    }
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
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
        dst[0] = px[2];
        dst[1] = px[1];
        dst[2] = px[0];
        dst[3] = 0xFF;
    }
    Ok(bmp)
}

fn dump_stage(label: &str, blocks: &mut Vec<TextBlock>) {
    blocks.sort_by_key(|b| (b.box_rect.y, b.box_rect.x));
    println!("════ {label}: {} boxes ════", blocks.len());
    for b in blocks {
        println!(
            "  conf={:.2} box=({},{}) {}x{} text={:?}",
            b.confidence, b.box_rect.x, b.box_rect.y, b.box_rect.width, b.box_rect.height, b.text
        );
    }
    println!();
}

fn merge_for_diagnostics(mut blocks: Vec<TextBlock>) -> Vec<TextBlock> {
    blocks.retain(|b| {
        let len = b.text.chars().filter(|c| !c.is_whitespace()).count();
        let min_conf = if len <= 1 {
            0.75
        } else if len == 2 {
            0.65
        } else {
            0.35
        };
        b.confidence >= min_conf && b.box_rect.height >= 6
    });
    let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
    let segments: Vec<TextBlock> = lines
        .into_iter()
        .flat_map(|line| WordMerger::merge_line_segments(line, 20.0))
        .collect();
    WordMerger::merge_prose_rows(segments)
}

fn dump_merged(label: &str, blocks: Vec<TextBlock>) {
    let merged_blocks = merge_for_diagnostics(blocks);
    println!("════ {label} → merged lines ════");
    for merged in &merged_blocks {
        println!(
            "  box=({},{}) {}x{} text={:?}",
            merged.box_rect.x,
            merged.box_rect.y,
            merged.box_rect.width,
            merged.box_rect.height,
            merged.text
        );
    }
    println!();
}

fn normalized_chars(text: &str) -> Vec<char> {
    // Preserve word boundaries: dropping all whitespace hid errors such as
    // WinRT's "a ny" for "any" in the password-dialog fixture.
    text.replace('’', "'").replace('‘', "'").replace('＇', "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .collect()
}

fn char_edit_distance(expected: &[char], actual: &[char]) -> usize {
    let mut previous: Vec<usize> = (0..=actual.len()).collect();
    let mut current = vec![0; actual.len() + 1];
    for (row, expected_char) in expected.iter().enumerate() {
        current[0] = row + 1;
        for (column, actual_char) in actual.iter().enumerate() {
            current[column + 1] = (previous[column + 1] + 1)
                .min(current[column] + 1)
                .min(previous[column] + usize::from(expected_char != actual_char));
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[actual.len()]
}

/// A few real fixtures now have manually checked line text and broad physical
/// regions. This reports character error by row, so one correct keyword cannot
/// hide a broken sentence, and reports OCR blocks outside all annotated rows.
fn print_fixture_quality(path: &std::path::Path, blocks: &[TextBlock], label: &str) -> Option<(usize, usize, usize)> {
    if std::env::var_os("CATWALK_REPRO_CROP").is_some()
        || std::env::var_os("CATWALK_REPRO_PERCENT").is_some() {
        println!("[quality] skipped: diagnostic crop coordinates differ from full-image annotations");
        return None;
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/ocr_real_cases.json");
    let Ok(bytes) = std::fs::read(&manifest) else { return None };
    let Ok(cases) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes) else { return None };
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else { return None };
    let Some(lines) = cases.iter()
        .find(|case| case["image"].as_str() == Some(name))
        .and_then(|case| case["expectedLines"].as_array())
    else { return None };

    let mut matched = vec![false; blocks.len()];
    let mut errors = 0usize;
    let mut total = 0usize;
    for (line_index, line) in lines.iter().enumerate() {
        let Some(truth) = line["text"].as_str() else { continue };
        let rect = &line["boxRect"];
        let Some((x, y, width, height)) = rect["x"].as_i64()
            .zip(rect["y"].as_i64())
            .zip(rect["width"].as_i64().zip(rect["height"].as_i64()))
            .map(|((x, y), (width, height))| (x, y, width, height))
        else { continue };
        let mut row: Vec<&TextBlock> = blocks.iter().enumerate().filter_map(|(index, block)| {
            let box_rect = block.box_rect;
            let center_y = box_rect.y as i64 + box_rect.height as i64 / 2;
            let overlap_x = (box_rect.x as i64 + box_rect.width as i64).min(x + width)
                - (box_rect.x as i64).max(x);
            if center_y >= y && center_y < y + height && overlap_x > 0 {
                matched[index] = true;
                Some(block)
            } else {
                None
            }
        }).collect();
        row.sort_by_key(|block| block.box_rect.x);
        let actual = row.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" ");
        let expected_chars = normalized_chars(truth);
        let actual_chars = normalized_chars(&actual);
        let distance = char_edit_distance(&expected_chars, &actual_chars);
        total += expected_chars.len();
        errors += distance;
        println!("[quality:{label}] row {}: edit={}/{} actual={:?}", line_index + 1, distance, expected_chars.len(), actual);
    }
    let extras: Vec<_> = blocks.iter().zip(matched.iter())
        .filter_map(|(block, &is_matched)| (!is_matched).then_some(block.text.as_str()))
        .collect();
    println!("[quality:{label}] CER={:.1}% ({errors}/{total}), unmatched blocks={:?}",
        errors as f64 * 100.0 / total.max(1) as f64, extras);
    Some((errors, total, extras.len()))
}

/// Character recall alone misses the opposite error: icons presented as
/// translatable words. Evaluate selected, manually checked non-text pixels
/// after the same short-fragment filter used by the capture pipeline.
fn print_non_text_quality(path: &std::path::Path, blocks: &[TextBlock]) -> Option<usize> {
    if std::env::var_os("CATWALK_REPRO_CROP").is_some()
        || std::env::var_os("CATWALK_REPRO_PERCENT").is_some() {
        return None;
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/ocr_real_cases.json");
    let cases: Vec<serde_json::Value> = serde_json::from_slice(&std::fs::read(manifest).ok()?).ok()?;
    let name = path.file_name()?.to_str()?;
    let regions = cases.iter().find(|case| case["image"].as_str() == Some(name))?
        ["nonTextRegions"].as_array()?;
    let visible = app_v2_lib::commands_capture::retain_usable_ocr_with_context(blocks.to_vec());
    let mut hits = Vec::new();
    for region in regions {
        let rect = &region["boxRect"];
        let (Some(x), Some(y), Some(width), Some(height)) = (
            rect["x"].as_i64(), rect["y"].as_i64(),
            rect["width"].as_i64(), rect["height"].as_i64(),
        ) else { continue };
        if width <= 0 || height <= 0 { continue; }
        for block in &visible {
            let b = block.box_rect;
            let overlap_x = (x + width).min(b.x as i64 + b.width as i64) - x.max(b.x as i64);
            let overlap_y = (y + height).min(b.y as i64 + b.height as i64) - y.max(b.y as i64);
            if overlap_x.max(0) * overlap_y.max(0) * 5 >= width * height * 2 {
                hits.push(format!("{}: {:?} {:?}", region["label"].as_str().unwrap_or("region"), block.text, b));
            }
        }
    }
    println!("[quality] non-text regions={}, visible OCR hits={:?}", regions.len(), hits);
    Some(hits.len())
}

/// 按环境变量选择识别通道：CATWALK_REPRO_ENGINE=winrt 走系统内置 OCR
///（零模型/零下载），缺省走 ONNX（配合 CATWALK_OCR_VERSION / MODELS_DIR）。
fn recognize_current(bmp: &[u8]) -> Result<app_v2_lib::models::OcrResult, String> {
    match std::env::var("CATWALK_REPRO_ENGINE").as_deref() {
        Ok("winrt") => app_v2_lib::ocr::execute_native_ocr_with_engine(bmp, Some("winrt")),
        Ok("raw-onnx") => app_v2_lib::onnx_ocr::recognize_bmp(bmp),
        _ => app_v2_lib::ocr::execute_native_ocr_with_engine(bmp, Some("onnx")),
    }
}

fn configure_requested_model_version() {
    if let Ok(ver) = std::env::var("CATWALK_OCR_VERSION") {
        if !ver.is_empty() {
            app_v2_lib::onnx_ocr::switch_active_version(&ver).unwrap_or_else(|error| {
                panic!("requested OCR model {ver} is unavailable: {error}")
            });
        }
    }
    let requested = app_v2_lib::onnx_ocr::get_active_version();
    let effective = app_v2_lib::onnx_ocr::best_available_version(&requested)
        .unwrap_or_else(|| "<none>".to_string());
    let dir = app_v2_lib::onnx_ocr::resolve_models_dir_for_version(&effective)
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<none>".to_string());
    println!("[repro] requested model={requested}; effective model={effective}; validated model directory={dir}");
}

/// 批量模式：对目录内所有 PNG 逐张识别，输出「文件名<TAB>识别文本<TAB>耗时ms」。
/// 用于「划词场景」这类小图集合的横向模型对比（每张约两个词、中英混排）。
#[test]
#[ignore]
fn dump_ocr_for_directory() {
    let dir = match std::env::var("CATWALK_REPRO_DIR") {
        Ok(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => return,
    };
    configure_requested_model_version();

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .expect("read repro dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("png"))
        .collect();
    files.sort();

    // 预热一张，避免首次模型加载/内存分配计入耗时。
    if let Some(first) = files.first() {
        if let Ok(bmp) = png_to_ocr_bmp(first) {
            let _ = recognize_current(&bmp);
        }
    }

    let mut total_ms = 0.0;
    for path in &files {
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("?");
        let bmp = match png_to_ocr_bmp(path) {
            Ok(b) => b,
            Err(e) => {
                println!("{name}\t<decode error: {e}>\t0");
                continue;
            }
        };
        // 取 3 次最优，抵消调度抖动。
        let mut best = f64::INFINITY;
        let mut last = None;
        for _ in 0..3 {
            let t0 = std::time::Instant::now();
            let r = recognize_current(&bmp);
            best = best.min(t0.elapsed().as_secs_f64() * 1000.0);
            last = Some(r);
        }
        total_ms += best;
        let text = match last.unwrap() {
            Ok(res) => {
                let mut blocks = res.blocks;
                blocks.retain(|b| b.confidence >= 0.35 && b.box_rect.height >= 6);
                let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
                lines
                    .into_iter()
                    .map(|l| WordMerger::merge_line(l, 20.0).text)
                    .filter(|t| !t.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            Err(e) => format!("<error: {e}>"),
        };
        println!("{name}\t{text}\t{best:.1}");
    }
    println!(
        "[repro] {} images, total {:.1} ms, avg {:.1} ms",
        files.len(),
        total_ms,
        total_ms / (files.len().max(1) as f64)
    );
}

/// 常规模式：对单张 PNG 完整 dump 检测框/合并行 + 计时（用于页面截图诊断）。
/// CATWALK_REPRO_ENGINE 可切换 production / WinRT / raw-ONNX；缺省使用 Blender 回归截图。
#[test]
#[ignore]
fn dump_ocr_pipeline_for_image() {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let fixture_path = fixtures.join("blender_toolbar.png");
    let path = std::env::var("CATWALK_REPRO_IMAGE")
        .ok()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| fixture_path.clone());
    let is_blender_fixture = path == fixture_path;
    let is_terminal_fixture = path == fixtures.join("windows_terminal_dense.png");
    let is_password_fixture = path == fixtures.join("password_dialog_dense.png");
    let is_password_heading_fixture = path == fixtures.join("password_heading_crop.png");
    let is_chat_fixture = path == fixtures.join("green_chat_bubble.png");
    let is_chinese_prose_fixture = path == fixtures.join("chinese_prose_spacing.png");
    let is_dense_chinese_prose_fixture = path == fixtures.join("dense_chinese_prose_source.png");
    let enforce_quality_gate = std::env::var_os("CATWALK_REPRO_CROP").is_none()
        && std::env::var_os("CATWALK_REPRO_PERCENT").is_none() && !matches!(
        std::env::var("CATWALK_REPRO_ENGINE").as_deref(),
        Ok("raw-onnx" | "winrt")
    );
    let bmp = png_to_ocr_bmp(&path).expect("png → bmp");

    // Optional model-version override so the same image can be compared across
    // PP-OCRv6 Small / Tiny in one place.
    configure_requested_model_version();

    // Warm up (model load / first-run allocation) so timings measure steady state.
    let _ = recognize_current(&bmp);

    let mut timings = Vec::new();
    let mut last = None;
    for _ in 0..3 {
        let t0 = std::time::Instant::now();
        let res = recognize_current(&bmp);
        timings.push(t0.elapsed().as_secs_f64() * 1000.0);
        last = Some(res);
    }
    let best = timings.iter().copied().fold(f64::INFINITY, f64::min);
    println!(
        "════ TIMING: best {:.1} ms of {:?} (ms) ════",
        best,
        timings
            .iter()
            .map(|t| (t * 10.0).round() / 10.0)
            .collect::<Vec<_>>()
    );

    match last.unwrap() {
        Ok(res) => {
            println!("[repro] rec units: {}", res.blocks.len());
            let quality = print_fixture_quality(&path, &res.blocks, "raw");
            let production_quality = if is_terminal_fixture {
                let usable = app_v2_lib::commands_capture::retain_usable_ocr_with_context(res.blocks.clone());
                let lines = LineClusterer::cluster_into_lines(usable, 8.0);
                let merged: Vec<_> = lines.into_iter()
                    .flat_map(|line| WordMerger::merge_line_segments(line, 20.0)).collect();
                let merged = WordMerger::merge_prose_rows(merged);
                let merged = WordMerger::merge_terminal_row_fragments(merged);
                print_fixture_quality(&path, &merged, "production")
            } else { None };
            if enforce_quality_gate && is_terminal_fixture
                && std::env::var("CATWALK_OCR_VERSION").as_deref() == Ok("v6t")
            {
                let (errors, total, _) = production_quality
                    .expect("terminal must have production-layout annotations");
                assert_eq!(total, 356);
                assert!(errors <= 19,
                    "terminal production grouping regressed: {errors}/{total} errors");
            }
            let non_text_hits = print_non_text_quality(&path, &res.blocks);
            if enforce_quality_gate && is_dense_chinese_prose_fixture
                && std::env::var("CATWALK_OCR_VERSION").as_deref() == Ok("v6")
            {
                let (errors, total, extras) = quality.expect("dense prose must have line annotations");
                assert_eq!(total, 225);
                assert!(errors <= 8 && extras == 0,
                    "v6 dense Chinese prose regressed: {errors}/{total} errors, {extras} extra boxes");
                assert_eq!(res.blocks.len(), 5, "dense prose must remain five physical rows");
            }
            // The real v6t fixtures are our current regression floor. Keep
            // checking full annotated rows, not only a few easy keywords.
            if enforce_quality_gate && std::env::var("CATWALK_OCR_VERSION").as_deref() == Ok("v6t") {
                // The inline link icon on this new fixture occupies the same
                // detector box as legitimate text. Box overlap is not proof
                // that the icon itself was transcribed; keep it diagnostic.
                if let Some(hits) = non_text_hits.filter(|_| !is_dense_chinese_prose_fixture) {
                    assert_eq!(hits, 0, "v6t detected text inside annotated non-text regions");
                }
                if let Some((errors, total, extras)) = quality {
                    let limit = if is_password_fixture { Some((2, 228)) }
                        else if is_password_heading_fixture { Some((0, 67)) }
                        else if is_chat_fixture { Some((0, 52)) }
                        else if is_terminal_fixture { Some((17, 356)) }
                        else if is_dense_chinese_prose_fixture { Some((8, 225)) }
                        else { None };
                    if let Some((max_errors, expected_total)) = limit {
                        assert_eq!(total, expected_total, "fixture annotations changed; revisit the quality gate");
                        assert!(errors <= max_errors && (extras == 0 || is_terminal_fixture),
                            "v6t quality regression: {errors}/{total} errors, {extras} unannotated boxes");
                    }
                }
            }
            let recognized: String = res
                .blocks
                .iter()
                .map(|b| b.text.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            if is_terminal_fixture && enforce_quality_gate
                && std::env::var("CATWALK_OCR_VERSION").as_deref() == Ok("v6t")
            {
                assert!(res.blocks.iter().any(|block|
                    (95..115).contains(&block.box_rect.y) && block.text.contains("端口")),
                    "terminal full-row review must retain the recovered 口 glyph");
                assert!(recognized.contains("VITE V7.3.6")
                    && recognized.contains("Running BeforeDevCommand"),
                    "terminal word gaps must survive the real OCR path: {recognized}");
            }
            if is_password_heading_fixture
                && std::env::var("CATWALK_REPRO_PERCENT").as_deref() == Ok("75")
                && !matches!(std::env::var("CATWALK_REPRO_ENGINE").as_deref(), Ok("raw-onnx" | "winrt"))
            {
                assert_eq!(res.blocks.len(), 2, "75% heading must remain two physical rows");
                assert_eq!(recognized,
                    "You'll stay signed in on these devices after\nchanging your password:");
            }
            if is_blender_fixture
                && std::env::var("CATWALK_REPRO_CROP").as_deref() == Ok("200,20,110,30")
                && !matches!(std::env::var("CATWALK_REPRO_ENGINE").as_deref(), Ok("raw-onnx" | "winrt"))
            {
                assert_eq!(recognized, "F5切英文", "small selection must not translate the power icon");
            }
            if is_blender_fixture {
                if enforce_quality_gate {
                    assert!(
                        !recognized.contains("F5切英文U"),
                        "power icon must not be appended to the adjacent toolbar label: {recognized}"
                    );
                }
                let expected = [
                    "布局", "建模", "雕刻", "UV编辑", "纹理绘制", "着色", "动画", "渲染",
                    "合成", "几何节点", "脚本", "物体模式", "视图", "选择", "添加", "物体",
                    "F5切英文",
                ];
                let raw_found: Vec<_> = expected
                    .iter()
                    .filter(|token| recognized.contains(**token))
                    .copied()
                    .collect();
                let merged_blocks = merge_for_diagnostics(res.blocks.clone());
                let merged_text: String = merged_blocks
                    .iter()
                    .map(|block| block.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let merged_found: Vec<_> = expected
                    .iter()
                    .filter(|token| merged_text.contains(**token))
                    .copied()
                    .collect();
                let missing: Vec<_> = expected
                    .iter()
                    .filter(|token| !merged_text.contains(**token))
                    .copied()
                    .collect();
                println!(
                    "[repro] Blender toolbar recall: raw {}/{}, reconstructed {}/{}; raw found={raw_found:?}; missing={missing:?}",
                    raw_found.len(),
                    expected.len(),
                    merged_found.len(),
                    expected.len()
                );
                if enforce_quality_gate {
                    for expected in ["布局", "建模", "雕刻", "UV编辑", "纹理绘制", "着色", "动画", "渲染", "合成", "几何节点", "脚本", "物体模式", "视图", "选择", "添加", "物体", "F5切英文"] {
                        assert!(
                            merged_text.contains(expected),
                            "Blender toolbar fixture should reconstruct {expected:?}; output:\n{merged_text}"
                        );
                    }
                    assert!(
                        merged_blocks.iter().any(|block| block.text == "添加")
                            && merged_blocks.iter().any(|block| block.text == "物体")
                            && !merged_blocks.iter().any(|block| block.text.contains("添加物体")),
                        "Blender's Add and Object are distinct adjacent menus, not one label: {merged_blocks:?}"
                    );
                }
            }
            if is_terminal_fixture {
                let expected = [
                    "后端热重载",
                    "Cargo",
                    "Watch",
                    "VITE",
                    "localhost:1420",
                    "ONNX",
                ];
                let found: Vec<_> = expected
                    .iter()
                    .filter(|token| recognized.contains(**token))
                    .copied()
                    .collect();
                let missing: Vec<_> = expected
                    .iter()
                    .filter(|token| !recognized.contains(**token))
                    .copied()
                    .collect();
                println!(
                    "[repro] terminal fixture token recall: {}/{}; found={found:?}; missing={missing:?}",
                    found.len(),
                    expected.len()
                );
                if enforce_quality_gate {
                    assert!(!recognized.contains("[Cargo Watch]:鑫"),
                        "a low-confidence punctuation-tail artifact must be confirmed by the full-row crop");
                    for expected in ["后端热重载", "Cargo", "VITE", "localhost:1420", "ONNX"] {
                        assert!(
                            recognized.contains(expected),
                            "terminal fixture should retain {expected:?}; output:\n{recognized}"
                        );
                    }
                    let merged = merge_for_diagnostics(res.blocks.clone());
                    assert!(merged.iter().any(|block| {
                        block.box_rect.y >= 40 && block.box_rect.y < 60
                            && block.text.contains("后端热重载")
                            && block.text.contains("代码自动重新编译并重载")
                    }), "terminal status sentence must render as one physical OCR row: {merged:?}");
                }
            }
            if is_password_fixture && enforce_quality_gate {
                let normalized = recognized.to_lowercase();
                assert!(res.blocks.iter().any(|block| block.text == "You'll stay signed in on these devices after"),
                    "password-dialog heading row one should remain intact; output:\n{recognized}");
                assert!(res.blocks.iter().any(|block| block.text == "changing your password:"),
                    "password-dialog heading row two should remain intact; output:\n{recognized}");
                for expected in ["stay signed in", "changing your password", "android", "change password"] {
                    assert!(
                        normalized.contains(expected),
                        "password-dialog fixture should retain {expected:?}; output:\n{recognized}"
                    );
                }
            }
            if is_password_heading_fixture && enforce_quality_gate {
                assert_eq!(res.blocks.len(), 2, "cropped heading must remain two complete lines");
                assert_eq!(res.blocks[0].text, "You'll stay signed in on these devices after");
                assert_eq!(res.blocks[1].text, "changing your password:");
            }
            if is_chat_fixture && enforce_quality_gate {
                let rows = LineClusterer::cluster_into_lines(res.blocks.clone(), 8.0);
                assert_eq!(rows.len(), 2, "chat bubble should remain two physical lines");
                assert_eq!(rows[0].iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" "),
                    "我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工");
                assert_eq!(rows[1].iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" "),
                    "具集成到 vids.new 中");
                let compact_alphanumeric: String = recognized
                    .chars()
                    .filter(|character| character.is_alphanumeric())
                    .collect();
                for expected in ["Gemini Omni", "1.1", "Flash", "一套", "控制工", "vids.new"] {
                    assert!(
                        recognized.contains(expected),
                        "chat-bubble fixture should retain {expected:?}; output:\n{recognized}"
                    );
                }
                assert!(
                    compact_alphanumeric.contains("11"),
                    "chat-bubble fixture should retain the 1.1 version number; output:\n{recognized}"
                );
            }
            if is_chinese_prose_fixture && enforce_quality_gate
                && std::env::var("CATWALK_OCR_VERSION").as_deref() == Ok("v6")
                && app_v2_lib::onnx_ocr::model_files_present_for_version("v6")
            {
                let merged = merge_for_diagnostics(res.blocks.clone());
                assert!(merged.len() <= 12,
                    "Chinese prose must not remain dozens of independently translated OCR fragments: {merged:?}");
                assert!(merged.iter().any(|block| block.text.starts_with("翻译结果的原位显示：")
                    && block.text.contains("背景擦除和滚动后的对齐")),
                    "the first paragraph line should be reconstructed as one block: {merged:?}");
                assert!(merged.iter().any(|block| block.text.contains("写进文档。目前README仍是Tauri模板内容。")),
                    "wrapped prose tail should not have isolated fragments: {merged:?}");
            }
            let mut raw = res.blocks.clone();
            dump_stage("OCR RAW", &mut raw);
            dump_merged("OCR", res.blocks);
        }
        Err(e) => println!("[repro] ONNX engine error: {e}"),
    }
}
