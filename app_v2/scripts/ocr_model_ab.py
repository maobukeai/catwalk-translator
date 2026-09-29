"""Isolated PP-OCRv6 tier comparison on the project's annotated screenshots.

Run with: uv run --no-project --python 3.12 --with rapidocr --with onnxruntime \
    python app_v2/scripts/ocr_model_ab.py <temporary model root>

This compares model outputs using one RapidOCR pipeline. It is not an app-overlay
benchmark and does not alter installed models or product settings.
"""

import argparse
import json
import time
from pathlib import Path

from rapidocr import RapidOCR


FIXTURES = Path(__file__).resolve().parents[1] / "src-tauri/tests/fixtures"
FILENAMES = {
    "small": ("ch_PP-OCRv6_det_infer.onnx", "ch_PP-OCRv6_rec_infer.onnx"),
    "tiny": ("ch_PP-OCRv6_tiny_det_infer.onnx", "ch_PP-OCRv6_tiny_rec_infer.onnx"),
    "medium": ("ch_PP-OCRv6_det_infer.onnx", "ch_PP-OCRv6_rec_infer.onnx"),
}


def normalize(value):
    return " ".join(value.replace("’", "'").replace("‘", "'").replace("＇", "'").lower().split())


def distance(left, right):
    row = list(range(len(right) + 1))
    for i, char in enumerate(left, 1):
        next_row = [i]
        for j, other in enumerate(right, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (char != other)))
        row = next_row
    return row[-1]


def rectangle(box):
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def analyze(case, result):
    boxes = list(result.boxes) if result.boxes is not None else []
    texts = list(result.txts) if result.txts is not None else []
    rows = []
    errors = total = matched_count = 0
    matched = set()
    for line in case.get("expectedLines", []):
        expected = normalize(line["text"])
        rect = line["boxRect"]
        x1, y1 = rect["x"], rect["y"]
        x2, y2 = x1 + rect["width"], y1 + rect["height"]
        indices = []
        for index, box in enumerate(boxes):
            left, top, right, bottom = rectangle(box)
            if y1 <= (top + bottom) / 2 < y2 and min(right, x2) > max(left, x1):
                indices.append(index)
                matched.add(index)
        indices.sort(key=lambda index: rectangle(boxes[index])[0])
        actual = " ".join(texts[index] for index in indices)
        edit = distance(expected, normalize(actual))
        errors += edit
        total += len(expected)
        matched_count += bool(indices)
        rows.append({"expected": line["text"], "actual": actual, "edit": edit})

    # Some annotated icon regions touch genuine text boxes. These overlaps are
    # diagnostic candidates, not a reliable false-positive count.
    non_text_overlaps = []
    for region in case.get("nonTextRegions", []):
        rect = region["boxRect"]
        x1, y1 = rect["x"], rect["y"]
        x2, y2 = x1 + rect["width"], y1 + rect["height"]
        for box, text in zip(boxes, texts):
            left, top, right, bottom = rectangle(box)
            area = max(0, min(right, x2) - max(left, x1)) * max(0, min(bottom, y2) - max(top, y1))
            if area * 5 >= rect["width"] * rect["height"] * 2:
                non_text_overlaps.append({"region": region["label"], "text": text})
    return {
        "errors": errors,
        "characters": total,
        "matched_lines": matched_count,
        "annotated_lines": len(rows),
        "unmatched_boxes": [texts[index] for index in range(len(texts)) if index not in matched],
        "non_text_region_overlaps": non_text_overlaps,
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_root", type=Path)
    parser.add_argument("--image", help="Only evaluate this named fixture")
    parser.add_argument("--tiers", nargs="+", choices=FILENAMES, default=list(FILENAMES))
    parser.add_argument("--raw", action="store_true", help="Include recognized boxes and texts")
    args = parser.parse_args()
    model_root = args.model_root.resolve()
    cases = json.loads((FIXTURES / "ocr_real_cases.json").read_text(encoding="utf-8"))
    if args.image:
        cases = [case for case in cases if case["image"] == args.image]
        if not cases:
            parser.error(f"unknown fixture: {args.image}")
    for tier in args.tiers:
        det_name, rec_name = FILENAMES[tier]
        model_dir = model_root / tier
        ocr = RapidOCR(params={
            "Det.model_path": str(model_dir / det_name),
            "Rec.model_path": str(model_dir / rec_name),
            "Global.use_cls": False,
            "Global.log_level": "error",
            "Det.unclip_ratio": 1.0,
            "EngineConfig.onnxruntime.intra_op_num_threads": 4,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        })
        for case in cases:
            image = FIXTURES / case["image"]
            ocr(image)
            timings = []
            for _ in range(3):
                started = time.perf_counter()
                result = ocr(image)
                timings.append(round((time.perf_counter() - started) * 1000, 1))
            metrics = analyze(case, result)
            raw = {"boxes": [rectangle(box) for box in result.boxes],
                   "texts": list(result.txts)} if args.raw and result.boxes is not None else {}
            print(json.dumps({"tier": tier, "image": case["image"],
                              "best_ms": min(timings), "times_ms": timings, **metrics, **raw},
                             ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
