from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import Qt, QRect, pyqtSignal, QPoint, QSize
from PyQt6.QtGui import QPainter, QColor, QPen, QPixmap, QGuiApplication, QImage
from PIL import Image
import numpy as np

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
        self.virtual_geom = None

    def _grab_virtual_desktop(self) -> tuple:
        """
        抓取虚拟桌面并返回 (pixmap, virtual_geometry)
        确保pixmap的坐标系统和widget逻辑坐标完全一致。
        """
        screens = QGuiApplication.screens()
        virtual = QGuiApplication.primaryScreen().virtualGeometry()
        self.virtual_geom = virtual
        
        # 创建和虚拟桌面逻辑尺寸相同的画布
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
            
            # 目标位置：相对于画布左上角（虚拟桌面左上角）
            target = QRect(
                geom.x() - virtual.x(),
                geom.y() - virtual.y(),
                geom.width(),
                geom.height(),
            )
            
            # 将物理像素截图绘制到逻辑位置（Qt自动处理DPI缩放）
            painter.drawPixmap(target, shot)
        
        painter.end()
        return canvas

    def start_capture(self):
        if not QGuiApplication.screens():
            return

        self.full_screen_pixmap = self._grab_virtual_desktop()

        # 设置窗口为虚拟桌面大小（逻辑坐标）
        self.setGeometry(self.virtual_geom)

        self.start_point = QPoint()
        self.end_point = QPoint()
        self.is_selecting = False

        # show() 而不是 showFullScreen()，确保窗口大小严格等于 virtual_geom
        # showFullScreen() 在某些平台/多屏设置下可能改变窗口大小
        self.show()
        self.raise_()
        self.activateWindow()

    def paintEvent(self, event):
        if not self.full_screen_pixmap:
            return
        
        painter = QPainter(self)
        
        # 绘制完整桌面截图
        # 注意：widget的(0,0)对应virtualGeom.topLeft()，
        # 但canvas的(0,0)也是virtualGeom.topLeft()，所以直接绘制到(0,0)
        painter.drawPixmap(0, 0, self.full_screen_pixmap)
        
        # 绘制选区
        selection_rect = QRect(self.start_point, self.end_point).normalized()
        if not selection_rect.isEmpty():
            pen = QPen(QColor(0, 200, 255), 2, Qt.PenStyle.SolidLine)
            painter.setPen(pen)
            painter.drawRect(selection_rect)

    def _qpixmap_to_pil(self, pixmap: QPixmap) -> Image.Image:
        """安全地将QPixmap转换为PIL Image（RGB格式）"""
        image = pixmap.toImage()
        
        # 确保格式是RGB32（每个像素4字节，BGRA顺序在内存中）
        if image.format() != QImage.Format.Format_RGB32:
            image = image.convertToFormat(QImage.Format.Format_RGB32)
        
        width = image.width()
        height = image.height()
        
        ptr = image.bits()
        ptr.setsize(height * width * 4)
        
        # Format_RGB32在内存中是0xFFRRGGBB（小端序为BBGGRR），即BGRA但A总是0xFF
        arr = np.frombuffer(ptr, np.uint8).reshape(height, width, 4)
        # arr是[B, G, R, A]，转换为RGB
        rgb_arr = arr[:, :, :3][:, :, ::-1].copy()  # BGR->RGB，并复制以确保内存连续
        
        return Image.fromarray(rgb_arr, 'RGB')

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
                # 裁剪选区
                cropped_pixmap = self.full_screen_pixmap.copy(selection_rect)
                
                # 转换为PIL Image
                pil_img = self._qpixmap_to_pil(cropped_pixmap)
                
                # 计算选区左上角的全局屏幕坐标
                # widget坐标 + virtualGeom.topLeft() = 全局坐标
                # 因为widget.setGeometry(virtualGeom)，所以widget(0,0) = global(virtualGeom.x(), virtualGeom.y())
                global_x = self.virtual_geom.x() + selection_rect.x()
                global_y = self.virtual_geom.y() + selection_rect.y()
                
                self.captured.emit(pil_img, global_x, global_y)
            else:
                self.cancelled.emit()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self.close()
            self.cancelled.emit()
