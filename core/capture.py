from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import Qt, QRect, pyqtSignal, QPoint
from PyQt6.QtGui import QPainter, QColor, QPen, QPixmap, QGuiApplication
from PIL import Image

class ScreenCaptureWidget(QWidget):
    # 截图完成信号：传出 (PIL.Image, x_offset, y_offset)
    captured = pyqtSignal(object, int, int)
    cancelled = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setMouseTracking(True)

        self.start_point = QPoint()
        self.end_point = QPoint()
        self.is_selecting = False
        self.full_screen_pixmap = None

    def _grab_virtual_desktop(self) -> QPixmap:
        """
        将每个物理屏幕的截图按【逻辑坐标】合成到一张虚拟桌面大小的画布上。

        关键：grabWindow 返回的是物理像素（高 DPI 下等于逻辑尺寸 × scale_factor），
        直接贴到逻辑尺寸窗口会导致图片只覆盖部分区域，其余区域全黑。
        这里把每张图缩放绘制到其逻辑 rect，最终画布 DPR 为 1，
        保证 paintEvent 绘制、选区高亮、裁剪切图全部使用同一套逻辑坐标。
        """
        screens = QGuiApplication.screens()
        virtual = QGuiApplication.primaryScreen().virtualGeometry()
        canvas = QPixmap(virtual.size())
        canvas.fill(QColor(0, 0, 0))
        painter = QPainter(canvas)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        for screen in screens:
            geom = screen.geometry()
            try:
                shot = screen.grabWindow(0)
            except Exception:
                continue
            target = QRect(
                geom.x() - virtual.x(),
                geom.y() - virtual.y(),
                geom.width(),
                geom.height(),
            )
            painter.drawPixmap(target, shot)
        painter.end()
        return canvas

    def start_capture(self):
        # 1. 抓取完整虚拟桌面（多显示器 + 高 DPI 兼容）
        if not QGuiApplication.screens():
            return

        self.full_screen_pixmap = self._grab_virtual_desktop()

        # 适应虚拟桌面全屏尺寸
        geometry = QGuiApplication.primaryScreen().virtualGeometry()
        self.setGeometry(geometry)

        self.start_point = QPoint()
        self.end_point = QPoint()
        self.is_selecting = False

        self.showFullScreen()
        self.raise_()
        self.activateWindow()

    def paintEvent(self, event):
        if not self.full_screen_pixmap:
            return
        
        painter = QPainter(self)
        
        # 绘制全亮原始桌面背景（不叠加变黑变暗遮罩，保持屏幕正常显示）
        painter.drawPixmap(0, 0, self.full_screen_pixmap)
        
        # 如果正在选取或选区有效，绘制选取框线
        selection_rect = QRect(self.start_point, self.end_point).normalized()
        if not selection_rect.isEmpty():
            # 绘制显眼的青色选区框线
            pen = QPen(QColor(0, 200, 255), 2, Qt.PenStyle.SolidLine)
            painter.setPen(pen)
            painter.drawRect(selection_rect)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.start_point = event.pos()
            self.end_point = event.pos()
            self.is_selecting = True
            self.update()
        elif event.button() == Qt.MouseButton.RightButton:
            self.close()
            self.cancelled.emit()

    def mouseMoveEvent(self, event):
        if self.is_selecting:
            self.end_point = event.pos()
            self.update()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and self.is_selecting:
            self.is_selecting = False
            self.end_point = event.pos()
            selection_rect = QRect(self.start_point, self.end_point).normalized()
            
            self.close()
            
            if selection_rect.width() > 10 and selection_rect.height() > 10:
                # 裁剪选择的 QPixmap 区域并转换为 PIL Image
                cropped_pixmap = self.full_screen_pixmap.copy(selection_rect)
                
                buffer = cropped_pixmap.toImage()
                ptr = buffer.bits()
                ptr.setsize(buffer.height() * buffer.width() * 4)
                
                pil_img = Image.frombuffer('RGBA', (buffer.width(), buffer.height()), ptr, 'raw', 'BGRA', 0, 1)
                
                # 绝对坐标偏移 (x, y)
                screen_pos = self.mapToGlobal(selection_rect.topLeft())
                self.captured.emit(pil_img, screen_pos.x(), screen_pos.y())
            else:
                self.cancelled.emit()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self.close()
            self.cancelled.emit()
