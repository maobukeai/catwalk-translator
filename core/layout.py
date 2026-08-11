from PyQt6.QtGui import QFont, QFontMetrics
from PyQt6.QtCore import QRectF

class LayoutEngine:
    def __init__(self, font_family: str = "Microsoft YaHei"):
        self.font_family = font_family

    def compute_fitting_font(self, text: str, box_width: float, box_height: float, min_size: int = 8, max_size: int = 40) -> tuple[QFont, QRectF]:
        """
        计算完全充满可用 Rectangle 的最大合适 QFont 对象及实际边界 Rect
        """
        target_w = max(box_width, 15.0)
        target_h = max(box_height, 12.0)

        best_font_size = min_size
        max_possible = int(min(target_h * 0.85, max_size))
        
        # 从可能的最大字号向下搜索试探
        for size in range(max_possible, min_size - 1, -1):
            font = QFont(self.font_family, size, QFont.Weight.Bold)
            metrics = QFontMetrics(font)
            text_w = metrics.horizontalAdvance(text)
            text_h = metrics.height()

            if text_w <= target_w * 0.98 and text_h <= target_h * 0.98:
                best_font_size = size
                break

        final_font = QFont(self.font_family, best_font_size, QFont.Weight.Bold)
        return final_font, QRectF(0, 0, target_w, target_h)

if __name__ == "__main__":
    from PyQt6.QtWidgets import QApplication
    import sys
    app = QApplication(sys.argv)
    layout = LayoutEngine()
    font, rect = layout.compute_fitting_font("基础颜色", 120, 30)
    print("适配计算得出的字号:", font.pointSize())
