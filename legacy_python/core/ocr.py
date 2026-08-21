import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

class OCREngine:
    def __init__(self):
        # 初始化 RapidOCR 本地推理引擎（基于 ONNX Runtime，无需 GPU/Torch）
        self.engine = RapidOCR()

    def detect_and_recognize(self, pil_image: Image.Image):
        """
        输入 PIL Image 对象
        返回格式:
        [
            {
                "box": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]],
                "text": "Hello World",
                "score": 0.95
            },
            ...
        ]
        """
        # 将 PIL Image 转换为 OpenCV/numpy 格式 (RGB -> BGR)
        img_np = np.array(pil_image.convert('RGB'))
        img_bgr = img_np[:, :, ::-1]

        result, _ = self.engine(img_bgr)
        items = []
        if result:
            for line in result:
                box, text, score = line
                items.append({
                    "box": box, # 顶点坐标 4x2
                    "text": text.strip(),
                    "score": float(score)
                })
        return items

if __name__ == "__main__":
    # 简单的自我测试代码
    import sys
    engine = OCREngine()
    print("RapidOCR 初始化成功!")
