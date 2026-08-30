"""生成「划词场景」OCR 测试图：每张约两个词，中英混排，模拟真实 UI 截取。

输出 /tmp/ocrcase/NN.png 与 truth.tsv（编号 → 期望文本）。
字体用 Microsoft YaHei（同时覆盖中英），字号/粗细/明暗主题按真实界面分布取值。
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = "/tmp/ocrcase"
os.makedirs(OUT, exist_ok=True)

YAHEI = "C:/Windows/Fonts/msyh.ttc"
YAHEI_BD = "C:/Windows/Fonts/msyhbd.ttc"

# (文本, 字号, 字体, 是否暗色主题)
CASES = [
    ("启用 Shader", 14, YAHEI, False),
    ("材质 Material", 14, YAHEI, False),
    ("导出 FBX", 13, YAHEI, False),
    ("法线贴图 Normal", 13, YAHEI, False),
    ("AI 模型", 15, YAHEI, False),
    ("渲染 Render", 16, YAHEI_BD, False),
    ("缩放 Scale", 12, YAHEI, False),
    ("批量 Export", 14, YAHEI, True),
    ("顶点 Vertex", 14, YAHEI, False),
    ("令牌路由 Router", 20, YAHEI_BD, False),
    ("采样率 Sampling", 13, YAHEI, False),
    ("统一访问 Access", 14, YAHEI, True),
]

PAD_X, PAD_Y = 12, 7

truth = []
for i, (text, size, font_path, dark) in enumerate(CASES, start=1):
    font = ImageFont.truetype(font_path, size)
    probe = Image.new("RGB", (10, 10))
    box = ImageDraw.Draw(probe).textbbox((0, 0), text, font=font)
    w = box[2] - box[0] + PAD_X * 2
    h = box[3] - box[1] + PAD_Y * 2
    bg = (24, 26, 32) if dark else (255, 255, 255)
    fg = (235, 237, 242) if dark else (28, 30, 36)
    img = Image.new("RGB", (w, h), bg)
    ImageDraw.Draw(img).text((PAD_X - box[0], PAD_Y - box[1]), text, font=font, fill=fg)
    name = f"{i:02d}.png"
    img.save(os.path.join(OUT, name))
    truth.append(f"{name}\t{text}\t{size}px{'/粗' if font_path == YAHEI_BD else ''}{'/暗底' if dark else ''}")

with open(os.path.join(OUT, "truth.tsv"), "w", encoding="utf-8") as f:
    f.write("\n".join(truth) + "\n")

print(f"generated {len(CASES)} cases in {OUT}")
for line in truth:
    print(" ", line)
