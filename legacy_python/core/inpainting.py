import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from PyQt6.QtGui import QColor
import os

class ImageInpainter:
    def __init__(self, dilation_pixels: int = 2):
        self.dilation_pixels = dilation_pixels
        self._font_cache = {}

    def _get_font(self, font_size: int) -> ImageFont.FreeTypeFont:
        """获取合适的字体，带缓存"""
        if font_size in self._font_cache:
            return self._font_cache[font_size]
        
        # 尝试加载系统字体
        font_paths = [
            # Windows
            "C:/Windows/Fonts/msyh.ttc",      # 微软雅黑
            "C:/Windows/Fonts/msyhbd.ttc",    # 微软雅黑粗体
            "C:/Windows/Fonts/simhei.ttf",    # 黑体
            "C:/Windows/Fonts/simsun.ttc",    # 宋体
            "C:/Windows/Fonts/arial.ttf",     # Arial
            # macOS
            "/System/Library/Fonts/PingFang.ttc",
            "/Library/Fonts/Arial.ttf",
            # Linux
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        
        font = None
        for path in font_paths:
            if os.path.exists(path):
                try:
                    font = ImageFont.truetype(path, font_size)
                    break
                except:
                    continue
        
        if font is None:
            font = ImageFont.load_default()
        
        self._font_cache[font_size] = font
        return font

    def boxes_to_mask(self, image_shape: tuple, boxes: list) -> np.ndarray:
        """
        将多个文字框转换为掩码图像
        image_shape: (height, width, channels)
        boxes: list of [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        返回: 单通道掩码，255表示需要修复的区域
        """
        h, w = image_shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        
        for box in boxes:
            pts = np.array(box, dtype=np.int32)
            # 填充多边形区域
            cv2.fillPoly(mask, [pts], 255)
        
        # 稍微膨胀掩码，确保文字边缘也被覆盖
        if self.dilation_pixels > 0:
            kernel = np.ones((self.dilation_pixels * 2 + 1, self.dilation_pixels * 2 + 1), np.uint8)
            mask = cv2.dilate(mask, kernel, iterations=1)
        
        return mask

    def inpaint_image(self, pil_image: Image.Image, boxes: list) -> tuple:
        """
        对图像进行修复，抹除指定框内的文字
        返回: (修复后的PIL Image, 掩码图像)
        """
        # 转换为OpenCV格式 (RGB -> BGR)
        img_np = np.array(pil_image.convert('RGB'))
        img_bgr = img_np[:, :, ::-1].copy()
        
        # 创建掩码
        mask = self.boxes_to_mask(img_np.shape, boxes)
        
        # 使用TELEA算法进行图像修复 (适合文字抹除)
        # inpaintRadius: 修复半径，设小一点更适合文字
        inpainted_bgr = cv2.inpaint(img_bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        
        # 对修复区域做轻微的模糊处理，让过渡更自然
        # 创建一个比mask稍大的区域用于模糊混合
        blur_kernel_size = 3
        blurred_bgr = cv2.GaussianBlur(inpainted_bgr, (blur_kernel_size, blur_kernel_size), 0)
        
        # 只在掩码区域（稍大一点）混合模糊结果
        if self.dilation_pixels > 0:
            blend_kernel = np.ones((self.dilation_pixels * 4 + 1, self.dilation_pixels * 4 + 1), np.uint8)
            blend_mask = cv2.dilate(mask, blend_kernel, iterations=1)
            blend_mask_3ch = cv2.cvtColor(blend_mask, cv2.COLOR_GRAY2BGR) / 255.0
            inpainted_bgr = (blurred_bgr * blend_mask_3ch + inpainted_bgr * (1 - blend_mask_3ch)).astype(np.uint8)
        
        # 转换回RGB -> PIL
        inpainted_rgb = inpainted_bgr[:, :, ::-1]
        inpainted_pil = Image.fromarray(inpainted_rgb)
        
        return inpainted_pil, mask

    def estimate_text_properties(self, image_np: np.ndarray, box: list) -> dict:
        """
        估计文字区域的字体大小和颜色属性
        返回: {'font_size': int, 'text_color': tuple(R,G,B), 'bg_color': tuple(R,G,B), 
               'box_width': float, 'box_height': float, 'is_dark_bg': bool}
        """
        pts = np.array(box, dtype=np.float32)
        xmin, ymin = np.min(pts, axis=0)
        xmax, ymax = np.max(pts, axis=0)
        box_w = xmax - xmin
        box_h = ymax - ymin
        
        xmin_i, ymin_i = int(xmin), int(ymin)
        xmax_i, ymax_i = int(xmax), int(ymax)
        
        h, w = image_np.shape[:2]
        xmin_i = max(0, xmin_i)
        ymin_i = max(0, ymin_i)
        xmax_i = min(w, xmax_i)
        ymax_i = min(h, ymax_i)
        
        if xmax_i <= xmin_i or ymax_i <= ymin_i:
            return {
                'font_size': max(10, int(box_h * 0.82)),
                'text_color': (0, 0, 0),
                'bg_color': (255, 255, 255),
                'box_width': box_w,
                'box_height': box_h,
                'is_dark_bg': False
            }
        
        # 采样边缘背景色（外扩几像素）
        pad = 4
        bg_samples = []
        # 上边缘
        if ymin_i - pad >= 0:
            bg_samples.append(image_np[max(0, ymin_i - pad):ymin_i, xmin_i:xmax_i].reshape(-1, 3))
        # 下边缘
        if ymax_i + pad <= h:
            bg_samples.append(image_np[ymax_i:min(h, ymax_i + pad), xmin_i:xmax_i].reshape(-1, 3))
        # 左边缘
        if xmin_i - pad >= 0:
            bg_samples.append(image_np[ymin_i:ymax_i, max(0, xmin_i - pad):xmin_i].reshape(-1, 3))
        # 右边缘
        if xmax_i + pad <= w:
            bg_samples.append(image_np[ymin_i:ymax_i, xmax_i:min(w, xmax_i + pad)].reshape(-1, 3))
        
        if bg_samples:
            bg_pixels = np.vstack(bg_samples)
            bg_rgb = np.median(bg_pixels, axis=0).astype(int)
            bg_color = (int(bg_rgb[0]), int(bg_rgb[1]), int(bg_rgb[2]))
            bg_brightness = 0.299 * bg_rgb[0] + 0.587 * bg_rgb[1] + 0.114 * bg_rgb[2]
            is_dark_bg = bg_brightness < 128
        else:
            bg_color = (255, 255, 255)
            is_dark_bg = False
        
        # 裁剪文字区域
        region = image_np[ymin_i:ymax_i, xmin_i:xmax_i]
        
        # 估计文字颜色：取与背景差异最大的像素
        if region.size > 0:
            # 计算每个像素与背景色的距离
            bg_flat = np.array(bg_color, dtype=np.float32)
            region_flat = region.reshape(-1, 3).astype(np.float32)
            distances = np.sqrt(np.sum((region_flat - bg_flat) ** 2, axis=1))
            
            # 取距离最大的前15%像素的中位数作为文字颜色（排除文字边缘的抗锯齿像素）
            if len(distances) > 10:
                threshold = np.percentile(distances, 85)
                text_pixels = region_flat[distances >= threshold]
            else:
                text_pixels = region_flat
                
            if len(text_pixels) > 0:
                text_rgb = np.median(text_pixels, axis=0).astype(int)
                text_color = (int(text_rgb[0]), int(text_rgb[1]), int(text_rgb[2]))
            else:
                text_color = (255, 255, 255) if is_dark_bg else (20, 20, 20)
        else:
            text_color = (255, 255, 255) if is_dark_bg else (20, 20, 20)
        
        # 估计字号：基于框高度
        font_size = max(8, int(box_h * 0.82))
        
        return {
            'font_size': font_size,
            'text_color': text_color,
            'bg_color': bg_color,
            'box_width': box_w,
            'box_height': box_h,
            'is_dark_bg': is_dark_bg
        }

    def _calculate_font_size_for_width(self, text: str, target_width: float, target_height: float, base_font_size: int) -> int:
        """
        计算适合目标宽度和高度的最大字号
        """
        # 从base_font_size开始向下搜索，找到能容纳下的最大字号
        for size in range(base_font_size, 6, -1):
            font = self._get_font(size)
            try:
                left, top, right, bottom = font.getbbox(text)
                text_w = right - left
                text_h = bottom - top
                # 给文字留一点边距（5%），不要完全贴边
                if text_w <= target_width * 0.95 and text_h <= target_height * 0.92:
                    return size
            except:
                pass
        
        return max(8, int(target_height * 0.5))

    def render_text_on_image(self, pil_image: Image.Image, items: list) -> Image.Image:
        """
        在修复后的图像上渲染译文文字（使用PIL进行高质量渲染）
        items: [{'box': [...], 'text': str, 'translated_text': str, 'props': {...}}, ...]
        """
        # 复制图像并转换为RGBA以支持透明度混合
        result_img = pil_image.copy().convert('RGBA')
        
        for item in items:
            box = item['box']
            # 优先使用译文，没有则使用原文
            display_text = item.get('translated_text', '') or item.get('text', '')
            props = item.get('props', {})
            
            if not display_text:
                continue
            
            pts = np.array(box, dtype=np.float32)
            xmin, ymin = np.min(pts, axis=0)
            xmax, ymax = np.max(pts, axis=0)
            box_w = xmax - xmin
            box_h = ymax - ymin
            
            base_font_size = props.get('font_size', max(10, int(box_h * 0.82)))
            text_color = props.get('text_color', (0, 0, 0))
            
            # 自适应字号
            font_size = self._calculate_font_size_for_width(display_text, box_w, box_h, base_font_size)
            font = self._get_font(font_size)
            
            # 计算文字的精确bbox（相对于锚点）
            try:
                left, top, right, bottom = font.getbbox(display_text)
                text_w = right - left
                text_h = bottom - top
            except:
                left, top, right, bottom = 0, 0, int(box_w * 0.9), int(box_h * 0.8)
                text_w = right - left
                text_h = bottom - top
            
            # 精确居中：让文字bbox的中心与box中心对齐
            # PIL text锚点在(0,0)时，文字覆盖区域为(anchor_x+left, anchor_y+top)到(anchor_x+right, anchor_y+bottom)
            text_x = xmin + (box_w - text_w) / 2 - left
            text_y = ymin + (box_h - text_h) / 2 - top
            
            # 在透明图层上绘制文字以获得更好的抗锯齿效果
            txt_layer = Image.new('RGBA', result_img.size, (0, 0, 0, 0))
            txt_draw = ImageDraw.Draw(txt_layer)
            txt_draw.text((text_x, text_y), display_text, font=font, fill=text_color + (255,))
            result_img = Image.alpha_composite(result_img, txt_layer)
        
        return result_img.convert('RGB')

if __name__ == "__main__":
    inpainter = ImageInpainter()
    print("图像修复模块初始化成功!")
