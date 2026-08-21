from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import Qt, QRect
from PyQt6.QtGui import QPainter, QPixmap, QImage
from PIL import Image
import numpy as np

class OverlayWidget(QWidget):
    def __init__(self, offset_x: int, offset_y: int, result: dict, parent=None):
        super().__init__(parent)
        self.offset_x = offset_x
        self.offset_y = offset_y
        self.result = result
        self._pixmap = None

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMouseTracking(True)
        self.setCursor(Qt.CursorShape.OpenHandCursor)

        # 从结果中提取图像并定位
        self._update_pixmap()
        self._position_overlay()

    def _pil_to_qpixmap(self, pil_image: Image.Image) -> QPixmap:
        """将PIL Image转换为QPixmap"""
        img_np = np.array(pil_image.convert('RGB'))
        h, w, ch = img_np.shape
        bytes_per_line = ch * w
        # QImage需要RGB数据（PIL输出是RGB）
        q_image = QImage(img_np.data.tobytes(), w, h, bytes_per_line, QImage.Format.Format_RGB888)
        return QPixmap.fromImage(q_image.copy())

    def _update_pixmap(self):
        """从当前result更新pixmap"""
        current_image = self.result.get('current_image')
        if current_image:
            self._pixmap = self._pil_to_qpixmap(current_image)

    def _position_overlay(self):
        """将浮层定位到截图区域的精确位置（整张图覆盖）"""
        if self._pixmap:
            # 浮层窗口位置就是截图区域的左上角，大小就是截图大小
            # 这样图像坐标(0,0)对应全局坐标(offset_x, offset_y)
            # 图像上的任何点(x,y)对应全局(offset_x + x, offset_y + y)
            # 和OCR/渲染使用的坐标系统完全一致
            self.setGeometry(
                self.offset_x, 
                self.offset_y, 
                self._pixmap.width(), 
                self._pixmap.height()
            )
        else:
            self.setGeometry(self.offset_x, self.offset_y, 100, 100)

    def paintEvent(self, event):
        if not self._pixmap:
            return

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        
        # 直接绘制整张图像（覆盖整个窗口）
        painter.drawPixmap(self.rect(), self._pixmap)

    def update_result(self, result: dict):
        """翻译进度更新：替换result并重绘"""
        self.result = result
        self._update_pixmap()
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
