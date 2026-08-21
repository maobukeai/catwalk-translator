import numpy as np
from PIL import Image
from PyQt6.QtGui import QColor

class BackgroundSampler:
    def __init__(self, padding: int = 4):
        self.padding = padding

    def _to_numpy(self, image):
        if isinstance(image, np.ndarray):
            return image
        return np.array(image.convert('RGB'))

    def sample_background_color(self, image, box: list) -> dict:
        """
        输入完整的截屏（PIL Image 或已转换的 RGB ndarray）和单个文字的多边形顶点 Box
        输出采样得到的背景色 QColor 与文字亮暗倾向 (is_dark_bg)
        """
        img_np = self._to_numpy(image)
        h_img, w_img, _ = img_np.shape

        pts = np.array(box, dtype=np.int32)
        xmin, ymin = np.min(pts, axis=0)
        xmax, ymax = np.max(pts, axis=0)

        # 向外外扩 padding 像素
        pad_xmin = max(0, xmin - self.padding)
        pad_ymin = max(0, ymin - self.padding)
        pad_xmax = min(w_img, xmax + self.padding)
        pad_ymax = min(h_img, ymax + self.padding)

        # 提取外包环形区域像素 (即外扩框扣去内框)
        outer_crop = img_np[pad_ymin:pad_ymax, pad_xmin:pad_xmax]
        
        # 使用外框上、下、左、右四条边线的边缘像素来代表背景色
        top_edge = outer_crop[0, :, :]
        bottom_edge = outer_crop[-1, :, :]
        left_edge = outer_crop[:, 0, :]
        right_edge = outer_crop[:, -1, :]

        edge_pixels = np.vstack([top_edge, bottom_edge, left_edge, right_edge])
        
        # 计算中位数颜色 (避免噪点或个别字体边缘影响)
        median_rgb = np.median(edge_pixels, axis=0).astype(int)
        r, g, b = median_rgb[0], median_rgb[1], median_rgb[2]

        # 判定背景亮度 (Perceived Brightness)
        brightness = 0.299 * r + 0.587 * g + 0.114 * b
        is_dark_bg = brightness < 128

        # 稍微提升透明度度，使背景自然融入 UI
        bg_qcolor = QColor(r, g, b, 240)
        # 前景色 (字色): 深底匹配白色/浅黄字，浅底匹配黑色/深灰字
        text_qcolor = QColor(255, 255, 255) if is_dark_bg else QColor(20, 20, 25)

        return {
            'bg_color': bg_qcolor,
            'text_color': text_qcolor,
            'is_dark_bg': is_dark_bg,
            'median_rgb': (r, g, b)
        }

if __name__ == "__main__":
    sampler = BackgroundSampler()
    test_img = Image.new('RGB', (200, 100), color=(44, 48, 56))
    sample_res = sampler.sample_background_color(test_img, [[20, 20], [100, 20], [100, 50], [20, 50]])
    print("背景采样测试结果:", sample_res['median_rgb'], "暗色背景:", sample_res['is_dark_bg'])
