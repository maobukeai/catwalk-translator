"""
猫步翻译 - RapidOCR 守护进程
==============================
作为常驻后台进程运行，从 stdin 读取 BMP 文件路径，
通过 stdout 返回 JSON 识别结果。

通信协议（基于行分隔的 JSON，无状态请求-响应）：
  stdin  <- {"id": 1, "path": "/tmp/crop.bmp"}
  stdout -> {"id": 1, "blocks": [...]}

引擎在启动时预热（加载 ONNX 模型），之后每次识别仅需 ~100-300ms。
"""

import sys
import json
import os
import signal
import io
import base64

def main():
    # 1. 预热 RapidOCR（此步骤需 ~2-4s，只在进程启动时执行一次）
    try:
        import numpy as np
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
        
        # 参数调优：初始化采用无参默认构造防 KeyError('model_path')，在调用处传入 det 选项
        engine = RapidOCR()
        
        # 发送就绪信号
        sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({"status": "error", "message": str(e)}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    # 2. 主循环：监听 stdin 请求（支持内存 base64 直传与磁盘文件路径）
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break  # stdin 关闭（父进程退出）

            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            req_id = req.get("id", 0)
            file_path = req.get("path", "")
            b64_data = req.get("b64", "")

            # 3. 内存直接加载 vs 磁盘读取
            try:
                if b64_data:
                    img_bytes = base64.b64decode(b64_data)
                    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                elif file_path and os.path.exists(file_path):
                    img = Image.open(file_path).convert("RGB")
                else:
                    sys.stdout.write(json.dumps({"id": req_id, "blocks": [], "error": "no image data"}) + "\n")
                    sys.stdout.flush()
                    continue

                img_np = np.array(img)
                img_bgr = img_np[:, :, ::-1]

                result, _ = engine(img_bgr, det_limit_side_len=480, det_db_thresh=0.3)
                blocks = []

                if result:
                    for line_item in result:
                        box, text, score = line_item
                        xs = [p[0] for p in box]
                        ys = [p[1] for p in box]
                        blocks.append({
                            "text": text.strip(),
                            "confidence": float(score),
                            "boxRect": {
                                "x": int(min(xs)),
                                "y": int(min(ys)),
                                "width": int(max(xs) - min(xs)),
                                "height": int(max(ys) - min(ys)),
                            }
                        })

                sys.stdout.write(json.dumps({"id": req_id, "blocks": blocks}, ensure_ascii=False) + "\n")
                sys.stdout.flush()

            except Exception as e:
                sys.stdout.write(json.dumps({"id": req_id, "blocks": [], "error": str(e)}) + "\n")
                sys.stdout.flush()

        except json.JSONDecodeError:
            continue
        except KeyboardInterrupt:
            break
        except Exception:
            break

if __name__ == "__main__":
    # 忽略 SIGINT，让父进程控制生命周期
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    main()
