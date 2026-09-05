# Downloads the three PP-OCRv3 ONNX models needed by the Rust-native OCR
# engine into app_v2\src-tauri\models\ (Apache-2.0, PaddleOCR).
#
# Sources (in order of preference):
#   1. Local pip rapidocr_onnxruntime installation (fastest, zero download)
#   2. PaddleOCR official ModelScope mirror (cn, fastest overseas-agnostic)
#   3. RapidOCR GitHub release tarball (fallback)
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\fetch_onnx_models.ps1

param(
    [string]$OutDir = (Join-Path $PSScriptRoot "..\app_v2\src-tauri\models")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Find-LocalRapidOcr {
    try {
        $py = (Get-Command python -ErrorAction Stop).Source
        $base = & $py -c "import rapidocr_onnxruntime, os; print(os.path.dirname(rapidocr_onnxruntime.__file__))"
        $models = Join-Path $base.Trim() "models"
        if (Test-Path (Join-Path $models "ch_PP-OCRv3_det_infer.onnx")) {
            return $models
        }
    } catch { }
    return $null
}

function Copy-Staged {
    param([string]$Src)
    Copy-Item (Join-Path $Src "ch_PP-OCRv3_det_infer.onnx") $OutDir -Force
    Copy-Item (Join-Path $Src "ch_PP-OCRv3_rec_infer.onnx") $OutDir -Force
    Copy-Item (Join-Path $Src "ch_ppocr_mobile_v2.0_cls_infer.onnx") $OutDir -Force
    Write-Host "[OK] Models staged from $Src"
}

function Download-Direct {
    param([string]$Url, [string]$File)
    Write-Host "Downloading $File ..."
    Invoke-WebRequest -Uri $Url -OutFile (Join-Path $OutDir $File) -UseBasicParsing
}

# 1. Local rapidocr package
$local = Find-LocalRapidOcr
if ($local) {
    Copy-Staged $local
    exit 0
}

# 2. PaddleOCR official Baidu BOS mirror (cn, fastest overseas-agnostic)
Write-Host "Local rapidocr not found; downloading official PaddleOCR ONNX..."
try {
    $base = "https://paddleocr.bj.bcebos.com/PP-OCRv3/chinese"
    Invoke-WebRequest -Uri "$base/ch_PP-OCRv3_det_infer.tar" -OutFile (Join-Path $env:TEMP "det.tar") -UseBasicParsing
    tar -xf (Join-Path $env:TEMP "det.tar") -C $env:TEMP
    Copy-Item (Join-Path $env:TEMP "inference\ch_PP-OCRv3_det_infer\*.onnx") $OutDir -ErrorAction Continue
    Write-Host "[WARN] Paddle tar contains Paddle model files; ONNX export may be needed."
} catch {
    Write-Warning "Baidu BOS download failed: $($_.Exception.Message)"
}

# 三个模型必须全部就位才算成功（det/rec/cls），缺任何一个都要明确报错，
# 否则 OCR 引擎在运行期才会失败，排查成本更高。
$required = @(
    "ch_PP-OCRv3_det_infer.onnx",
    "ch_PP-OCRv3_rec_infer.onnx",
    "ch_ppocr_mobile_v2.0_cls_infer.onnx"
)
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $OutDir $_)) })

if ($missing.Count -gt 0) {
    Write-Host @"

=============================================================
  ONNX models NOT staged. Missing: $($missing -join ', ')
  Manual step required:
  - Install Python:  pip install rapidocr_onnxruntime   then
    re-run this script; or copy these three files manually:
      ch_PP-OCRv3_det_infer.onnx
      ch_PP-OCRv3_rec_infer.onnx
      ch_ppocr_mobile_v2.0_cls_infer.onnx
    into: $OutDir
  The Rust engine then loads them automatically.
=============================================================
"@
    exit 1
}

Write-Host "[OK] All models staged in $OutDir"