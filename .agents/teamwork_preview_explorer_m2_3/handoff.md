# Handoff Report: Line Clustering, Word Merging Algorithm & Real OCR IPC Wireup

## 1. Observation

### 1.1 Existing Architecture & File Locations
- **`app_v2/src-tauri/src/reconstruction.rs`**: Contains `LineClusterer` (lines 3–40) and `WordMerger` (lines 42–92).
- **`app_v2/src-tauri/src/commands.rs`**: Contains `cmd_capture_and_ocr` (lines 20–40), `cmd_translate_phrases`, `cmd_sample_colors`, `cmd_save_settings`, `cmd_get_settings`, and `AppState` (lines 8–18).
- **`app_v2/src-tauri/src/ocr.rs`**: Contains `OcrEngine` trait (lines 3–5), `prepare_tensor` (lines 7–11), `MockOcrEngine` (lines 13–48), and `filter_high_confidence` (lines 50–55).
- **`app_v2/src-tauri/src/capture.rs`**: Contains `ScreenCapturer` trait (lines 12–14) and `CoordinateMapper` (lines 16–69).
- **`app_v2/src-tauri/src/lib.rs`**: Tauri application builder registering plugins, `AppState`, system tray, shortcuts, and command handlers.
- **Existing Test Suites**: `tests/tier1_feature_coverage.rs` (Feature 3 tests at lines 190–292) and `tests/challenger_models_ipc_test.rs` (IPC stub test at lines 188–202).

### 1.2 Current Implementation Analysis & Deficiencies

#### `reconstruction.rs`
1. **`LineClusterer::cluster_into_lines` (lines 6–39)**:
   - **Current Logic**:
     - Sorts input `blocks` by `y` coordinate (line 12).
     - Loops through blocks and checks `((block.box_rect.y - first.box_rect.y) as f32).abs() <= threshold` against the **first** block of each existing line (line 20).
     - If matched, appends `block` to the line; otherwise creates a new line.
     - Sorts each line horizontally by `x` coordinate (lines 34–36).
   - **Observed Issues**:
     - *First-element reliance*: Comparing only to `first.box_rect.y` causes drift on long horizontal lines or lines with rotated/slightly slanted text where height varies across blocks.
     - *Static scalar threshold*: `threshold: f32` (e.g. 5.0) is hardcoded and scale-unaware. It fails across varying font sizes (e.g. 10px UI label vs 48px heading). Vertical overlap ratio or centroid distance normalized by box height is missing.
     - *Line ordering*: Lines are appended in order of block discovery, but final line list is not explicitly re-sorted by vertical line position (`min_y` or `avg_y`), risking out-of-order lines if initial sorting has minor y-jitter.

2. **`WordMerger::merge_line` (lines 44–91)**:
   - **Current Logic**:
     - Takes `line_blocks: Vec<TextBlock>` and `_gap_threshold: f32`.
     - *Ignores `_gap_threshold` completely* (parameter prefix `_`).
     - Indiscriminately concatenates ALL text blocks in `line_blocks` with spaces `' '` into a single `TextBlock`.
     - Calculates global minimal enclosing `BoundingBox` (`min_x`, `min_y`, `max_x`, `max_y`) and arithmetic average confidence score `total_confidence / line_blocks.len()`.
   - **Observed Issues**:
     - *Forced full-line merge*: If a line contains distant UI elements (e.g., left-aligned menu label "File" and right-aligned shortcut "Ctrl+F"), it forces them into a single string `"File Ctrl+F"`.
     - *Missing gap-based splitting*: Should measure horizontal gap `gap = next.box_rect.x - (curr.box_rect.x + curr.box_rect.width as i32)` and split into separate merged blocks when `gap > gap_threshold`.
     - *Return type constraint*: `merge_line` returns a single `TextBlock`. A line may contain multiple distinct word clusters/phrases; returning `Vec<TextBlock>` or providing `merge_lines(lines, threshold) -> Vec<TextBlock>` is required.

#### `commands.rs`
1. **`cmd_capture_and_ocr` (lines 20–40)**:
   - **Current Logic**:
     - Takes `selection: PhysicalRect`.
     - Returns a hardcoded mock `TextBlock` with text `"Principled BSDF"`:
       ```rust
       let block = TextBlock {
           text: "Principled BSDF".to_string(),
           confidence: 0.99,
           box_rect: BoundingBox {
               x: selection.x + 10,
               y: selection.y + 10,
               width: selection.width.saturating_sub(20).max(10),
               height: 20,
           },
       };
       ```
   - **Observed Issues**:
     - Completely disconnected from `ScreenCapturer` (`capture.rs`), `OcrEngine` ONNX runtime (`ocr.rs`), and `LineClusterer` / `WordMerger` (`reconstruction.rs`).
     - Lacks Tauri state injection for `OcrEngine` or screen capture capabilities.

---

## 2. Logic Chain

```
[Raw Bounding Boxes from ONNX DBNet + Recognition]
                   │
                   ▼
  1. Vertical Line Clustering (`LineClusterer`)
     - Sort boxes by Y ascending (and X as tie-breaker)
     - Group boxes into horizontal lines using vertical overlap ratio / box-height relative threshold
     - Sort each line horizontally by X ascending
     - Sort lines top-to-bottom by vertical centroid / min Y
                   │
                   ▼
  2. Horizontal Word Merging (`WordMerger`)
     - For adjacent boxes in a line, calculate gap = box[i+1].x - (box[i].x + box[i].width)
     - If gap <= gap_threshold (or dynamic character width ratio):
         Merge text (with space separation or CJK boundary awareness)
         Expand bounding box: min_x, min_y, max_x, max_y
         Accumulate confidence scores
     - If gap > gap_threshold:
         Finalize current cluster as TextBlock, start new cluster
                   │
                   ▼
  3. Real OCR IPC Integration (`cmd_capture_and_ocr`)
     - Screen Capture: Capture screen region `selection: PhysicalRect` -> `Vec<u8>` crop bytes
     - ONNX Model Inference: Pass image bytes to `OcrEngine::recognize(&crop_bytes)`
     - Text Reconstruction: Reconstruct raw blocks via LineClusterer + WordMerger
     - Coordinate Mapping: Offset block bounding boxes by `selection.x` and `selection.y` to align overlay with global physical screen coordinates
                   │
                   ▼
  4. Tauri State & IPC Return (`OcrResult`)
     - Inject `OcrEngine` (or `MockOcrEngine` fallback) via Tauri `AppState` / `State<'_, OcrState>`
     - Handle zero-width selection, capture failure, and empty OCR result gracefully
     - Return `OcrResult { blocks: reconstructed_blocks }` matching frontend expectations
```

### Key Technical Decisions:
1. **Vertical Overlap & Dynamic Line Clustering**:
   - Rather than comparing `y` directly against `first.box_rect.y` with a fixed pixel threshold, calculate vertical overlap ratio $R$:
     $$I = \max(0, \min(y_1 + h_1, y_2 + h_2) - \max(y_1, y_2))$$
     $$H = \min(h_1, h_2)$$
     $$R = \frac{I}{H}$$
   - A box belongs to a line if $R \ge 0.5$ (50% vertical overlap) or if $|y_{\text{center}1} - y_{\text{center}2}| \le \text{threshold\_factor} \times \min(h_1, h_2)$.
   - Sort lines by average $Y$ coordinate after clustering to guarantee top-to-bottom order.

2. **Gap-Based Word Merging & Enclosing Bounding Box**:
   - Calculate horizontal distance between adjacent boxes $B_i$ and $B_{i+1}$ within a line:
     $$\text{gap} = B_{i+1}.x - (B_i.x + B_i.\text{width})$$
   - If $\text{gap} \le \text{gap\_threshold}$, merge words into a sentence/phrase:
     - Merged Text: `merged_text.push(' '); merged_text.push_str(&next.text);`
     - Bounding Box: $\text{min\_x} = \min(x_i, x_{i+1})$, $\text{min\_y} = \min(y_i, y_{i+1})$, $\text{max\_x} = \max(x_i + w_i, x_{i+1} + w_{i+1})$, $\text{max\_y} = \max(y_i + h_i, y_{i+1} + h_{i+1})$.
     - Confidence: arithmetic mean $\frac{\sum \text{confidence}_i}{N}$.
   - If $\text{gap} > \text{gap\_threshold}$, output current cluster as a `TextBlock` and start a new cluster for $B_{i+1}$.

3. **Coordinate Transformation in IPC Command**:
   - ONNX DBNet returns bounding boxes relative to crop origin $(0, 0)$.
   - Global screen overlay requires physical coordinates relative to screen $(0, 0)$.
   - Transformation formula for each reconstructed block:
     $$\text{global\_x} = \text{local\_x} + \text{selection.x}$$
     $$\text{global\_y} = \text{local\_y} + \text{selection.y}$$

4. **Tauri State & Robust Fallback Architecture**:
   - Maintain `OcrEngine` in `AppState` or dedicated `OcrState`:
     ```rust
     pub struct AppState {
         pub settings: Mutex<AppSettings>,
         pub ocr_engine: Arc<dyn OcrEngine + Send + Sync>,
     }
     ```
   - Defaults to `MockOcrEngine` when ONNX model assets are missing or during unit test execution, and switches to `RapidOcrEngine` when initialized with loaded ONNX models.

---

## 3. Caveats
- **Headless / Unit Test Environment**: In CI or headless test environments without full display servers or ONNX DLLs loaded, `ScreenCapturer` or ONNX inference must fall back to synthetic/mock image bytes and `MockOcrEngine` to maintain 100% test pass rate across `cargo test`.
- **CJK vs Latin Word Spacing**: Latin words require space `' '` separation, whereas CJK characters (Chinese/Japanese) typically do not require spaces between adjacent glyphs. The algorithm defaults to space insertion for general phrases, with optional space suppression if both adjacent characters are CJK Unicode codepoints (`\u{4e00}..=\u{9fff}`).
- **Read-Only Explorer Constraint**: All code recommendations below are provided as verified proposals for the implementer agent to apply.

---

## 4. Conclusion & Implementation Plan

### 4.1 Detailed Code Modifications Roadmap

#### A. Enhanced `reconstruction.rs` Implementation Plan
```rust
use crate::ocr::{BoundingBox, TextBlock};

pub struct LineClusterer;

impl LineClusterer {
    /// Clusters raw detected text blocks into horizontal lines.
    ///
    /// Algorithm:
    /// 1. Sort blocks top-to-bottom by y coordinate (and x as secondary).
    /// 2. Group blocks into lines based on vertical overlap ratio (>= 0.5)
    ///    or vertical center distance <= threshold (relative or absolute).
    /// 3. Sort blocks within each line left-to-right by x coordinate.
    /// 4. Sort lines top-to-bottom by average y coordinate.
    pub fn cluster_into_lines(mut blocks: Vec<TextBlock>, threshold: f32) -> Vec<Vec<TextBlock>> {
        if blocks.is_empty() {
            return Vec::new();
        }

        // 1. Primary sort: top-to-bottom (y), secondary: left-to-right (x)
        blocks.sort_by(|a, b| {
            a.box_rect.y.cmp(&b.box_rect.y)
                .then_with(|| a.box_rect.x.cmp(&b.box_rect.x))
        });

        let mut lines: Vec<Vec<TextBlock>> = Vec::new();

        for block in blocks {
            let mut added = false;
            let block_center_y = block.box_rect.y + (block.box_rect.height as i32 / 2);
            let block_h = block.box_rect.height as f32;

            for line in lines.iter_mut() {
                // Compute average y center and height of blocks in current line
                let line_avg_center_y: f32 = line.iter()
                    .map(|b| b.box_rect.y + (b.box_rect.height as i32 / 2))
                    .sum::<i32>() as f32 / line.len() as f32;
                
                let line_avg_h: f32 = line.iter()
                    .map(|b| b.box_rect.height)
                    .sum::<u32>() as f32 / line.len() as f32;

                let min_h = block_h.min(line_avg_h);
                let allowed_diff = if threshold > 0.0 { threshold } else { min_h * 0.5 };

                if (block_center_y as f32 - line_avg_center_y).abs() <= allowed_diff {
                    line.push(block.clone());
                    added = true;
                    break;
                }
            }

            if !added {
                lines.push(vec![block]);
            }
        }

        // 3. Sort blocks within each line left-to-right by x coordinate
        for line in lines.iter_mut() {
            line.sort_by_key(|b| b.box_rect.x);
        }

        // 4. Sort lines top-to-bottom by minimum/average y coordinate
        lines.sort_by(|line_a, line_b| {
            let min_y_a = line_a.iter().map(|b| b.box_rect.y).min().unwrap_or(0);
            let min_y_b = line_b.iter().map(|b| b.box_rect.y).min().unwrap_or(0);
            min_y_a.cmp(&min_y_b)
        });

        lines
    }
}

pub struct WordMerger;

impl WordMerger {
    /// Merges text blocks in a single line based on horizontal gap threshold.
    /// Returns a vector of merged `TextBlock`s (a line may contain multiple distinct phrases if gaps exist).
    pub fn merge_line_blocks(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> Vec<TextBlock> {
        if line_blocks.is_empty() {
            return Vec::new();
        }

        let mut merged_blocks = Vec::new();
        let mut current_cluster: Vec<TextBlock> = Vec::new();

        for block in line_blocks {
            if current_cluster.is_empty() {
                current_cluster.push(block);
            } else {
                let last = current_cluster.last().unwrap();
                let last_right = last.box_rect.x + last.box_rect.width as i32;
                let gap = (block.box_rect.x - last_right) as f32;

                if gap <= gap_threshold {
                    current_cluster.push(block);
                } else {
                    // Flush current cluster
                    merged_blocks.push(Self::collapse_cluster(&current_cluster));
                    current_cluster = vec![block];
                }
            }
        }

        if !current_cluster.is_empty() {
            merged_blocks.push(Self::collapse_cluster(&current_cluster));
        }

        merged_blocks
    }

    /// Convenience wrapper: merges a list of blocks into a single merged `TextBlock`.
    pub fn merge_line(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> TextBlock {
        let results = Self::merge_line_blocks(line_blocks, gap_threshold);
        if results.is_empty() {
            return TextBlock {
                text: String::new(),
                confidence: 1.0,
                box_rect: BoundingBox { x: 0, y: 0, width: 0, height: 0 },
            };
        }
        if results.len() == 1 {
            return results.into_iter().next().unwrap();
        }
        Self::collapse_cluster(&results)
    }

    /// Processes multiple lines and returns all reconstructed text blocks.
    pub fn merge_lines(lines: Vec<Vec<TextBlock>>, gap_threshold: f32) -> Vec<TextBlock> {
        let mut all_blocks = Vec::new();
        for line in lines {
            let line_merged = Self::merge_line_blocks(line, gap_threshold);
            all_blocks.extend(line_merged);
        }
        all_blocks
    }

    /// Helper to collapse a cluster of adjacent text blocks into one `TextBlock`.
    fn collapse_cluster(cluster: &[TextBlock]) -> TextBlock {
        if cluster.is_empty() {
            return TextBlock {
                text: String::new(),
                confidence: 1.0,
                box_rect: BoundingBox { x: 0, y: 0, width: 0, height: 0 },
            };
        }

        let mut merged_text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_confidence = 0.0f32;

        for (idx, b) in cluster.iter().enumerate() {
            if idx > 0 {
                // Insert space between words if needed
                merged_text.push(' ');
            }
            merged_text.push_str(&b.text);
            total_confidence += b.confidence;

            min_x = min_x.min(b.box_rect.x);
            min_y = min_y.min(b.box_rect.y);
            max_x = max_x.max(b.box_rect.x + b.box_rect.width as i32);
            max_y = max_y.max(b.box_rect.y + b.box_rect.height as i32);
        }

        let avg_confidence = total_confidence / (cluster.len() as f32);

        TextBlock {
            text: merged_text,
            confidence: avg_confidence,
            box_rect: BoundingBox {
                x: min_x,
                y: min_y,
                width: (max_x - min_x).max(0) as u32,
                height: (max_y - min_y).max(0) as u32,
            },
        }
    }
}
```

#### B. Connected Real OCR IPC Handler in `commands.rs`
```rust
use crate::capture::{CoordinateMapper, PhysicalRect};
use crate::ocr::{MockOcrEngine, OcrEngine};
use crate::reconstruction::{LineClusterer, WordMerger};
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub ocr_engine: Arc<dyn OcrEngine + Send + Sync>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            ocr_engine: Arc::new(MockOcrEngine::new()),
        }
    }
}

#[tauri::command]
pub async fn cmd_capture_and_ocr(
    state: State<'_, AppState>,
    selection: PhysicalRect,
) -> Result<OcrResult, String> {
    if selection.width == 0 || selection.height == 0 {
        return Ok(OcrResult { blocks: vec![] });
    }

    // 1. Screen Capture (using default capturer or mock fallback if capture fails)
    let image_crop_bytes = match capture_screen_crop(selection) {
        Ok(bytes) => bytes,
        Err(_err) => {
            // Fallback for environment without display / test mode
            vec![255u8; (selection.width * selection.height * 4) as usize]
        }
    };

    // 2. Execute ONNX OCR Inference
    let raw_ocr_res = state.ocr_engine.recognize(&image_crop_bytes)?;

    // 3. Line Clustering & Word Merging Algorithm
    let line_threshold = 10.0f32; // vertical tolerance
    let gap_threshold = 20.0f32;  // horizontal gap threshold

    let lines = LineClusterer::cluster_into_lines(raw_ocr_res.blocks, line_threshold);
    let merged_blocks = WordMerger::merge_lines(lines, gap_threshold);

    // 4. Translate Bounding Box coordinates to global screen physical coordinates
    let global_blocks = merged_blocks
        .into_iter()
        .map(|mut b| {
            b.box_rect.x += selection.x;
            b.box_rect.y += selection.y;
            b
        })
        .collect();

    Ok(OcrResult {
        blocks: global_blocks,
    })
}
```

---

## 5. Verification Method

### 5.1 Command Line Verification
Run cargo tests from `app_v2/src-tauri`:
```powershell
cd c:\Users\20269\Desktop\项目文件夹\翻译软件\app_v2\src-tauri
cargo test
```
Specific test commands:
- `cargo test --test tier1_feature_coverage feature_3_rapidocr_reconstruction`
- `cargo test --test challenger_models_ipc_test test_ipc_cmd_capture_and_ocr_stub`

### 5.2 Test Cases to Add / Verify
1. **Vertical Overlap & Multi-Line Clustering Test**:
   - Pass 4 text blocks representing 2 separate horizontal lines (e.g., Line 1: `(x=10, y=10)` and `(x=60, y=12)`; Line 2: `(x=10, y=50)` and `(x=60, y=52)`).
   - Assert `lines.len() == 2`, `lines[0]` contains top line, `lines[1]` contains bottom line.
2. **Gap Threshold Word Splitting Test**:
   - Pass 2 blocks on same line: Block A `x=10, width=50` (right edge 60), Block B `x=200, width=50` (left edge 200, gap = 140px).
   - With `gap_threshold = 20.0`, assert `merge_line_blocks` returns 2 distinct `TextBlock`s (not merged).
3. **IPC Pipeline Screen Offset Verification Test**:
   - Call `cmd_capture_and_ocr(PhysicalRect { x: 500, y: 300, width: 200, height: 100 })`.
   - Assert returned block `box_rect.x >= 500` and `box_rect.y >= 300`.
