# Handoff Report: RapidOCR ONNX Inference Engine Setup & Architecture Investigation

**Agent**: `teamwork_preview_explorer_m2_2`  
**Milestone**: M2 — High-DPI Capture & RapidOCR ONNX Engine  
**Target Module**: `app_v2/src-tauri/src/ocr.rs`  
**Status**: Investigation Complete — Hard Handoff  

---

## 1. Observation

### 1.1 Existing File Inspections
- **`app_v2/src-tauri/src/ocr.rs`**:
  - Currently contains only `pub trait OcrEngine` and a stub implementation `MockOcrEngine` returning a single static text block `"Principled BSDF"` at line 37.
  - Helper `prepare_tensor` at line 7 returns dummy `(byte_count, shape)` without actual matrix transformations.
- **`app_v2/src-tauri/Cargo.toml`**:
  - Lines 20–27 list current dependencies: `tauri = { version = "2", features = ["tray-icon"] }`, `tauri-plugin-opener`, `tauri-plugin-global-shortcut`, `serde`, `serde_json`, `reqwest`, `tokio`.
  - **Missing**: `ort` crate for ONNX Runtime inference, `image` crate for decoding/resizing/normalizing image buffers, and `ndarray` for multi-dimensional tensor creation.
- **`app_v2/src-tauri/assets/models/`**:
  - Directory `app_v2/src-tauri/assets/models/` does **not** currently exist on disk.
  - Expected model assets:
    1. `ch_PP-OCRv4_det_infer.onnx` (~4.7 MB) — DBNet detection model.
    2. `ch_PP-OCRv4_rec_infer.onnx` (~10.8 MB) — SVTR text recognition model.
    3. `ppocr_keys_v1.txt` (~100 KB) — CTC vocabulary key dictionary containing 6,623+ Chinese/English/symbol characters.
- **`app_v2/src-tauri/src/commands.rs`**:
  - Line 21 (`cmd_capture_and_ocr`): Currently returns mock data with static bounding box `(selection.x + 10, selection.y + 10)`.

---

## 2. Logic Chain

1. **Missing Asset Dependencies**:
   - *Observation*: `assets/models/` is missing and `Cargo.toml` lacks `ort`, `image`, and `ndarray`.
   - *Deduction*: Before actual ONNX inference can run, `Cargo.toml` must add `ort = "2.0.0-rc.9"`, `image = "0.25"`, `ndarray = "0.16"`. The PP-OCRv4 ONNX model files and dictionary file must be downloaded / placed into `app_v2/src-tauri/assets/models/`.
2. **Binary Embedding vs Runtime Asset Path**:
   - *Observation*: Requirement A1/A2 specifies desktop EXE portability and startup under 500ms.
   - *Deduction*: Using `include_bytes!("assets/models/ch_PP-OCRv4_det_infer.onnx")` embeds the models (~15.5MB total) directly into the compiled executable. This guarantees zero runtime file path lookups or missing asset crashes, keeping total EXE size under 35MB (<40MB limit).
3. **Detection Pre-processing (DBNet)**:
   - *Observation*: DBNet model requires input tensor shape `[1, 3, H, W]` where `H` and `W` are multiples of 32.
   - *Deduction*: Input RGBA image crop must be resized such that its maximum side length is capped (e.g., 960px), dimensions rounded to the nearest multiple of 32, normalized using standard ImageNet mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`, and formatted into NCHW float32 memory layout.
4. **Detection Post-processing (DBNet Binarization & Polygon Unclipping)**:
   - *Observation*: DBNet outputs a probability map tensor `[1, 1, H, W]`.
   - *Deduction*: Post-processing requires binarizing the probability map (`threshold = 0.3`), extracting connected contour boundaries, fitting minimum bounding rectangles (`box_threshold = 0.6`), applying Vatti unclipping (`unclip_ratio = 1.5`), and mapping the box coordinates back to the original image dimensions.
5. **Recognition Pre- & Post-processing (SVTR + CTC Greedy Decoder)**:
   - *Observation*: PP-OCRv4 SVTR model expects height 48 normalized text crop tensors `[1, 3, 48, W]`, and outputs logit logits `[1, T, C]`.
   - *Deduction*: Each detected text box must be cropped (and deskewed if rotated), resized to height 48 (maintaining aspect ratio, normalized to `[-1.0, 1.0]`), passed through `rec_session`, and decoded using CTC greedy decoding against `ppocr_keys_v1.txt` (skipping blank token index 0 and removing consecutive duplicate characters).
6. **Thread Safety & Lifecycle**:
   - *Observation*: `cmd_capture_and_ocr` is an async Tauri IPC command triggered on user hotkey/selection.
   - *Deduction*: Model loading takes ~50-100ms. ONNX sessions must be held in a thread-safe global structure `Arc<RapidOcrEngine>` (or `OnceLock<RapidOcrEngine>`), enabling re-use across screenshot requests without re-allocating ONNX sessions.

---

## 3. Caveats

- **Caveat 1 (ONNX Runtime Binary Dependency)**: `ort` v2.0 downloads or links `onnxruntime.dll` on Windows. Build system must ensure `onnxruntime.dll` is packaged alongside the Tauri EXE or statically bundled.
- **Caveat 2 (Clipper / Polygon Unclip Dependency)**: DBNet polygon expansion uses Vatti clipping ($d = \frac{\text{Area} \times 1.5}{\text{Perimeter}}$). In pure Rust, this can be implemented via `cavity` / `clipper-sys` / `geo` or an explicit polygon scaling algorithm.
- **Caveat 3 (Rotated vs Axis-Aligned Crops)**: High-DPI screen text in CG applications (Blender/Substance) is mostly axis-aligned horizontal text. If text is rotated, perspective warping is required before recognition. Standard minimum bounding rectangle crop suffices for horizontal UI labels.

---

## 4. Conclusion & Complete Technical Specification

### 4.1 Required Crate Dependencies (`app_v2/src-tauri/Cargo.toml`)
```toml
[dependencies]
ort = { version = "2.0.0-rc.9", features = ["download-binaries"] }
image = "0.25"
ndarray = "0.16"
geo = "0.29" # For polygon area/perimeter and bounding rect calculations
```

### 4.2 Detailed Pre-processing Specification for Detection
- **Input**: Raw RGBA pixel array `&[u8]`, width $W_{src}$, height $H_{src}$.
- **Resize Strategy**:
  1. Determine scale: $S = \min\left(1.0, \frac{960}{\max(W_{src}, H_{src})}\right)$.
  2. Compute target dimensions:
     $$W_{target} = \max\left(32, \text{round}\left(\frac{W_{src} \times S}{32}\right) \times 32\right)$$
     $$H_{target} = \max\left(32, \text{round}\left(\frac{H_{src} \times S}{32}\right) \times 32\right)$$
  3. Resize image to $(W_{target}, H_{target})$ using bilinear interpolation.
- **Tensor Normalization**:
  For each pixel $(x, y)$ and channel $c \in \{0 (\text{R}), 1 (\text{G}), 2 (\text{B})\}$:
  $$\text{val}_{norm}[c, y, x] = \frac{\frac{P[x, y, c]}{255.0} - \text{mean}[c]}{\text{std}[c]}$$
  where $\text{mean} = [0.485, 0.456, 0.406]$, $\text{std} = [0.229, 0.224, 0.225]$.
- **Shape**: `[1, 3, H_target, W_target]` float32 tensor.

### 4.3 Detailed Post-processing Specification for Detection (DBNet)
1. **Probability Map**: Extract probability map array $P_{det}[y, x] \in [0.0, 1.0]$ from output tensor `[1, 1, H_target, W_target]`.
2. **Binarization**: Generate boolean mask $B[y, x] = (P_{det}[y, x] > 0.3)$.
3. **Contour Extraction**: Extract closed polygons from $B$.
4. **Candidate Box Evaluation**:
   - Compute polygon minimum bounding box $(x, y, w, h)$.
   - Calculate average probability score $S_{avg}$ within box from $P_{det}$. Filter out if $S_{avg} < 0.6$ or $\min(w, h) < 3$.
5. **Unclip Polygon Expansion**:
   - Compute polygon Area $A$ and Perimeter $L$.
   - Expansion distance $d = \frac{A \times 1.5}{L}$.
   - Expand polygon vertices outward by $d$.
6. **Coordinate Rescaling**:
   - Scale box coordinates to original space:
     $$x_{orig} = x \times \frac{W_{src}}{W_{target}}, \quad y_{orig} = y \times \frac{H_{src}}{H_{target}}$$

### 4.4 Detailed Pre- & Post-processing Specification for Recognition (SVTR + CTC)
- **Pre-processing**:
  1. Crop bounding box region from original RGBA image.
  2. Fixed target height $H_{rec} = 48$.
  3. Dynamic width $W_{rec} = \text{clamp}\left(\text{round}\left(W_{crop} \times \frac{48}{H_{crop}}\right), 10, 640\right)$.
  4. Normalize pixels: $\text{val} = (\frac{P}{255.0} - 0.5) / 0.5 \in [-1.0, 1.0]$.
  5. Tensor shape `[1, 3, 48, W_rec]`.
- **CTC Greedy Decoding**:
  1. Output logits shape `[1, T, 6624]`.
  2. For timestep $t = 0 \dots T-1$:
     - $c_t = \arg\max_{k} (\text{logits}[0, t, k])$, $p_t = \max_{k} (\text{softmax}(\text{logits})[0, t, k])$.
     - Skip if $c_t == 0$ (blank token).
     - Skip if $c_t == c_{t-1}$ (duplicate character).
     - Character $ch = \text{keys}[c_t - 1]$. Append $ch$ to text string.
  3. Aggregate confidence score = mean of timestep probabilities $p_t$.

### 4.5 Recommended `OcrEngine` Architecture
```rust
use std::sync::{Arc, Mutex};
use ort::Session;

pub trait OcrEngine: Send + Sync {
    fn recognize(&self, image_bytes: &[u8]) -> Result<OcrResult, String>;
}

pub struct RapidOcrEngine {
    det_session: Arc<Mutex<Session>>,
    rec_session: Arc<Mutex<Session>>,
    keys: Vec<String>,
}

impl RapidOcrEngine {
    pub fn new() -> Result<Self, String> {
        let det_bytes = include_bytes!("../assets/models/ch_PP-OCRv4_det_infer.onnx");
        let rec_bytes = include_bytes!("../assets/models/ch_PP-OCRv4_rec_infer.onnx");
        let keys_str = include_str!("../assets/models/ppocr_keys_v1.txt");

        let det_session = Session::builder()
            .map_err(|e| format!("Failed to create det session builder: {}", e))?
            .commit_from_memory(det_bytes)
            .map_err(|e| format!("Failed to load det model: {}", e))?;

        let rec_session = Session::builder()
            .map_err(|e| format!("Failed to create rec session builder: {}", e))?
            .commit_from_memory(rec_bytes)
            .map_err(|e| format!("Failed to load rec model: {}", e))?;

        let keys: Vec<String> = keys_str.lines().map(|s| s.to_string()).collect();

        Ok(Self {
            det_session: Arc::new(Mutex::new(det_session)),
            rec_session: Arc::new(Mutex::new(rec_session)),
            keys,
        })
    }
}
```

---

## 5. Verification Method

1. **Asset File Verification**:
   - Check presence of `ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`, and `ppocr_keys_v1.txt` in `app_v2/src-tauri/assets/models/`.
2. **Cargo Compilation Check**:
   - Command: `cargo check --manifest-path app_v2/src-tauri/Cargo.toml`
3. **Unit Test Execution**:
   - Command: `cargo test --manifest-path app_v2/src-tauri/Cargo.toml -- --nocapture`
   - Invalidation condition: Any panic or failure in DBNet tensor shape calculation or CTC decoding logic.
