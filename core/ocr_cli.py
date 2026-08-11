import sys
import json
import base64
import io
from PIL import Image
from core.ocr import OCREngine

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"blocks": []}))
        return

    input_arg = sys.argv[1]
    
    try:
        if input_arg.startswith("data:image"):
            # Base64 data URL
            b64_data = input_arg.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(img_bytes))
        elif input_arg.startswith("base64:"):
            b64_data = input_arg[7:]
            img_bytes = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(img_bytes))
        else:
            # File path
            img = Image.open(input_arg)
        
        engine = OCREngine()
        results = engine.detect_and_recognize(img)
        
        blocks = []
        for item in results:
            text = item["text"]
            score = item["score"]
            box = item["box"]
            
            # Compute bounding box
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            min_x = min(xs)
            max_x = max(xs)
            min_y = min(ys)
            max_y = max(ys)
            
            blocks.append({
                "text": text,
                "confidence": score,
                "boxRect": {
                    "x": int(min_x),
                    "y": int(min_y),
                    "width": int(max_x - min_x),
                    "height": int(max_y - min_y)
                }
            })
            
        print(json.dumps({"blocks": blocks}, ensure_ascii=False))
    except Exception as e:
        sys.stderr.write(f"OCR Error: {e}\n")
        print(json.dumps({"blocks": []}))

if __name__ == "__main__":
    main()
