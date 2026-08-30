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
    let img = image::load_from_memory(&raw).map_err(|e| e.to_string())?;
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
    bmp[22..26].copy_from_slice(&( -(h as i32)).to_le_bytes());
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
            b.confidence,
            b.box_rect.x,
            b.box_rect.y,
            b.box_rect.width,
            b.box_rect.height,
            b.text
        );
    }
    println!();
}

fn dump_merged(label: &str, mut blocks: Vec<TextBlock>) {
    blocks.retain(|b| b.confidence >= 0.35 && b.box_rect.height >= 6);
    let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
    println!("════ {label} → merged lines ════");
    for line in &lines {
        let merged = WordMerger::merge_line(line.clone(), 20.0);
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

/// 按环境变量选择识别通道：CATWALK_REPRO_ENGINE=winrt 走系统内置 OCR
///（零模型/零下载），缺省走 ONNX（配合 CATWALK_OCR_VERSION / MODELS_DIR）。
fn recognize_current(bmp: &[u8]) -> Result<app_v2_lib::models::OcrResult, String> {
    match std::env::var("CATWALK_REPRO_ENGINE").as_deref() {
        Ok("winrt") => app_v2_lib::ocr::execute_native_ocr_with_engine(bmp, Some("winrt")),
        _ => app_v2_lib::onnx_ocr::recognize_bmp(bmp),
    }
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
    if let Ok(ver) = std::env::var("CATWALK_OCR_VERSION") {
        if !ver.is_empty() {
            match app_v2_lib::onnx_ocr::switch_active_version(&ver) {
                Ok(()) => println!("[repro] active model version = {ver}"),
                Err(e) => println!("[repro] switch to {ver} failed: {e}"),
            }
        }
    }

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
#[test]
#[ignore]
fn dump_ocr_pipeline_for_image() {
    let path = match std::env::var("CATWALK_REPRO_IMAGE") {
        Ok(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => return, // env not set → skip silently
    };
    let bmp = png_to_ocr_bmp(&path).expect("png → bmp");

    // Optional model-version override so the same image can be compared across
    // PP-OCRv3 / v4 / v5 in one place.
    if let Ok(ver) = std::env::var("CATWALK_OCR_VERSION") {
        if !ver.is_empty() {
            match app_v2_lib::onnx_ocr::switch_active_version(&ver) {
                Ok(()) => println!("[repro] active model version = {ver}"),
                Err(e) => println!("[repro] switch to {ver} failed: {e}"),
            }
        }
    }

    // Warm up (model load / first-run allocation) so timings measure steady state.
    let _ = app_v2_lib::onnx_ocr::recognize_bmp(&bmp);

    let mut timings = Vec::new();
    let mut last = None;
    for _ in 0..3 {
        let t0 = std::time::Instant::now();
        let res = app_v2_lib::onnx_ocr::recognize_bmp(&bmp);
        timings.push(t0.elapsed().as_secs_f64() * 1000.0);
        last = Some(res);
    }
    let best = timings.iter().copied().fold(f64::INFINITY, f64::min);
    println!(
        "════ TIMING: best {:.1} ms of {:?} (ms) ════",
        best,
        timings.iter().map(|t| (t * 10.0).round() / 10.0).collect::<Vec<_>>()
    );

    match last.unwrap() {
        Ok(res) => {
            println!("[repro] rec units: {}", res.blocks.len());
            let mut raw = res.blocks.clone();
            dump_stage("ONNX RAW", &mut raw);
            dump_merged("ONNX", res.blocks);
        }
        Err(e) => println!("[repro] ONNX engine error: {e}"),
    }
}
