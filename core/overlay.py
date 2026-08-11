from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import Qt, QRectF, QPointF
from PyQt6.QtGui import QPainter, QColor, QFont, QPen, QPainterPath
from core.layout import LayoutEngine

class OverlayWidget(QWidget):
    def __init__(self, offset_x: int, offset_y: int, items_with_styles: list, parent=None):
        super().__init__(parent)
        self.offset_x = offset_x
        self.offset_y = offset_y
        self.items = items_with_styles # [{'box': [...], 'text': '...', 'translated_text': '...', 'bg_color': QColor, 'text_color': QColor}, ...]
        self.layout_engine = LayoutEngine()

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMouseTracking(True)
        self.setCursor(Qt.CursorShape.OpenHandCursor)

        if self.items:
            min_x = min([min([pt[0] for pt in item['box']]) for item in self.items])
            min_y = min([min([pt[1] for pt in item['box']]) for item in self.items])
            max_x = max([max([pt[0] for pt in item['box']]) for item in self.items])
            max_y = max([max([pt[1] for pt in item['box']]) for item in self.items])
            
            margin = 20
            left = int(self.offset_x + min_x - margin)
            top = int(self.offset_y + min_y - margin)
            width = int(max_x - min_x + margin * 2)
            height = int(max_y - min_y + margin * 2)

            self.setGeometry(left, top, width, height)
        else:
            self.setGeometry(offset_x, offset_y, 100, 100)

    def paintEvent(self, event):
        if not self.items:
            return

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)

        for item in self.items:
            box = item['box']
            trans_text = item.get('translated_text', '')
            orig_text = item.get('text', '')

            # 待翻译期间先显示原文（半透明占位样式），翻译完成后替换为译文
            if trans_text:
                display_text = trans_text
                bg_color = item.get('bg_color', QColor(30, 32, 38, 240))
                text_color = item.get('text_color', QColor(255, 255, 255))
            elif orig_text:
                display_text = orig_text
                bg_color = QColor(38, 40, 46, 170)
                text_color = QColor(255, 255, 255, 200)
            else:
                continue

            # 转换成 Overlay 局部画布相对坐标
            xs = [pt[0] + self.offset_x - self.geometry().x() for pt in box]
            ys = [pt[1] + self.offset_y - self.geometry().y() for pt in box]
            
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            
            box_w = max(x_max - x_min, 12.0)
            box_h = max(y_max - y_min, 12.0)

            rect = QRectF(x_min - 2, y_min - 2, box_w + 4, box_h + 4)

            # 1. 使用采样出来的精致背景色进行自然圆角遮罩绘制
            path = QPainterPath()
            path.addRoundedRect(rect, 4, 4)
            painter.fillPath(path, bg_color)
            
            # 微弱的外框边缘描边
            stroke_color = QColor(text_color.red(), text_color.green(), text_color.blue(), 60)
            painter.setPen(QPen(stroke_color, 1))
            painter.drawPath(path)

            # 2. 使用 LayoutEngine 精确适配字体大小
            fitted_font, _ = self.layout_engine.compute_fitting_font(display_text, box_w, box_h)
            painter.setFont(fitted_font)
            painter.setPen(text_color)

            # 3. 绘制文本（译文或待译原文）
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, display_text)

    def update_items(self, items: list):
        """OCR 结果渐进更新：翻译完成一项即调用一次，原地重绘"""
        self.items = items
        self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()
        elif event.button() == Qt.MouseButton.RightButton:
            self.close()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, '_drag_pos'):
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self.close()
