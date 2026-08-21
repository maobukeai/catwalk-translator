import sys
import os
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
from PyQt6.QtWidgets import (
    QApplication, QSystemTrayIcon, QMenu, QWidget, QMainWindow,
    QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QComboBox, QFrame
)
from PyQt6.QtCore import pyqtSignal, QObject, Qt
from PyQt6.QtGui import QIcon, QAction, QPixmap, QColor, QPainter, QImage
from pynput import keyboard

# Ensure Windows Taskbar displays custom icon instead of generic Python icon
if sys.platform == 'win32':
    try:
        import ctypes
        myappid = 'maobu.catwalk.translator.v2'
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
    except Exception as e:
        print(f"[系统] 设置 AppUserModelID 失败: {e}")

from core.capture import ScreenCaptureWidget
from core.ocr import OCREngine
from core.reconstruction import TextReconstructor
from core.inpainting import ImageInpainter
from core.translator import Translator, TranslationPreset
from core.overlay import OverlayWidget

class SignalBus(QObject):
    trigger_capture_signal = pyqtSignal()
    # seq 用于丢弃过期结果：防止上一轮 OCR 的迟到结果覆盖新一轮浮层
    ocr_finish_signal = pyqtSignal(int, object, int, int)  # seq, result_dict, offset_x, offset_y
    translation_progress_signal = pyqtSignal(int, object)  # seq, updated_result_dict

class MainWindow(QMainWindow):
    def __init__(self, app_instance):
        super().__init__()
        self.app_instance = app_instance
        self.setWindowTitle("猫步翻译软件")
        self.resize(480, 320)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #121316;
            }
            QLabel {
                color: #E4E4E7;
                font-family: 'Segoe UI', Microsoft YaHei, sans-serif;
            }
            QPushButton {
                background-color: #0284C7;
                color: #FFFFFF;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
                font-size: 15px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #0369A1;
            }
            QPushButton:pressed {
                background-color: #075985;
            }
            QComboBox {
                background-color: #1E2026;
                color: #F4F4F5;
                border: 1px solid #3F3F46;
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 13px;
            }
        """)

        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(32, 28, 32, 28)
        layout.setSpacing(20)

        # Title Header
        title_label = QLabel("🐱 猫步翻译软件")
        title_label.setStyleSheet("font-size: 20px; font-weight: bold; color: #38BDF8;")
        layout.addWidget(title_label)

        sub_label = QLabel("专为日常、科技与专业设计打造的猫步智能原位翻译浮层工具")
        sub_label.setStyleSheet("font-size: 12px; color: #A1A1AA;")
        sub_label.setWordWrap(True)
        layout.addWidget(sub_label)

        # Preset Switcher
        preset_layout = QHBoxLayout()
        preset_lbl = QLabel("专业词库 Preset：")
        preset_lbl.setStyleSheet("font-size: 13px;")
        
        self.combo = QComboBox()
        self.combo.addItems(["通用模式", "专业设计模式", "科技工程模式", "游戏引擎模式"])
        self.combo.currentIndexChanged.connect(self.on_preset_changed)
        
        preset_layout.addWidget(preset_lbl)
        preset_layout.addWidget(self.combo)
        layout.addLayout(preset_layout)

        # Big Action Button
        self.btn_capture = QPushButton("🚀 开始截图翻译 (Ctrl+Alt+D 或 F4)")
        self.btn_capture.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_capture.clicked.connect(self.app_instance.start_capture)
        layout.addWidget(self.btn_capture)

        # Status Bar
        status_lbl = QLabel("🟢 状态：RapidOCR ONNX + Inpainting 引擎已就绪 | 按 F4 随时截屏")
        status_lbl.setStyleSheet("font-size: 11px; color: #4ADE80;")
        layout.addWidget(status_lbl)

    def on_preset_changed(self, index):
        presets = [
            TranslationPreset.GENERAL,
            TranslationPreset.BLENDER,
            TranslationPreset.SUBSTANCE,
            TranslationPreset.UNITY
        ]
        self.app_instance.translator.set_preset(presets[index])

class MainApplication:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self.app.setQuitOnLastWindowClosed(False)

        # Set Application Icon
        base_dir = os.path.dirname(os.path.abspath(__file__))
        icon_path = os.path.join(base_dir, "app_icon.ico")
        if not os.path.exists(icon_path):
            icon_path = os.path.join(base_dir, "app_icon.png")
        
        self.app_icon = QIcon(icon_path) if os.path.exists(icon_path) else None
        if self.app_icon and not self.app_icon.isNull():
            self.app.setWindowIcon(self.app_icon)

        self.bus = SignalBus()
        self.bus.trigger_capture_signal.connect(self.start_capture)
        self.bus.ocr_finish_signal.connect(self.show_overlay)
        self.bus.translation_progress_signal.connect(self.update_overlay)

        print("[系统] 正在初始化 猫步翻译软件 高级引擎...")
        self.ocr_engine = OCREngine()
        self.reconstructor = TextReconstructor()
        self.inpainter = ImageInpainter(dilation_pixels=2)
        self.translator = Translator(default_preset=TranslationPreset.GENERAL)
        print("[系统] 引擎加载完毕 (OCR + 智能行重构 + 图像修复Inpainting + 译文渲染)!")

        self.capture_widget = None
        self.current_overlay = None

        # 交互状态：防重复触发 + 过期结果判定
        self.capture_active = False
        self.current_seq = 0

        self.main_window = MainWindow(self)
        if self.app_icon and not self.app_icon.isNull():
            self.main_window.setWindowIcon(self.app_icon)
        self.main_window.show()
        self.main_window.raise_()
        self.main_window.activateWindow()

        self.init_tray_icon()
        self.init_hotkey()

    def init_tray_icon(self):
        if self.app_icon and not self.app_icon.isNull():
            tray_qicon = self.app_icon
        else:
            pixmap = QPixmap(32, 32)
            pixmap.fill(Qt.GlobalColor.transparent)
            painter = QPainter(pixmap)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            painter.setBrush(QColor(0, 180, 255))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawRoundedRect(2, 2, 28, 28, 6, 6)
            painter.setPen(QColor(255, 255, 255))
            painter.drawText(pixmap.rect(), Qt.AlignmentFlag.AlignCenter, "猫步")
            painter.end()
            tray_qicon = QIcon(pixmap)

        self.tray_icon = QSystemTrayIcon(tray_qicon, self.app)
        self.tray_icon.setToolTip("猫步翻译软件 (快捷键: Ctrl+Alt+D 或 F4)")

        menu = QMenu()

        preset_menu = menu.addMenu("专业词库 Preset 模式")
        blender_act = QAction("Blender 模式", self.app)
        blender_act.triggered.connect(lambda: self.translator.set_preset(TranslationPreset.BLENDER))
        substance_act = QAction("Substance Painter 模式", self.app)
        substance_act.triggered.connect(lambda: self.translator.set_preset(TranslationPreset.SUBSTANCE))
        general_act = QAction("通用 3D/设计 模式", self.app)
        general_act.triggered.connect(lambda: self.translator.set_preset(TranslationPreset.GENERAL))
        
        preset_menu.addAction(blender_act)
        preset_menu.addAction(substance_act)
        preset_menu.addAction(general_act)

        menu.addSeparator()

        show_win_act = QAction("显示主控制面板", self.app)
        show_win_act.triggered.connect(self.main_window.show)
        menu.addAction(show_win_act)

        capture_action = QAction("开始截图翻译 (Ctrl+Alt+D)", self.app)
        capture_action.triggered.connect(self.start_capture)
        menu.addAction(capture_action)

        menu.addSeparator()

        quit_action = QAction("退出程序", self.app)
        quit_action.triggered.connect(self.quit_app)
        menu.addAction(quit_action)

        self.tray_icon.setContextMenu(menu)
        self.tray_icon.activated.connect(self.on_tray_icon_activated)
        self.tray_icon.show()

    def on_tray_icon_activated(self, reason):
        # 仅在鼠标左键单击 (Trigger) 或双击 (DoubleClick) 时打开软件主界面
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            if self.main_window:
                self.main_window.show()
                self.main_window.setWindowState(
                    self.main_window.windowState() & ~Qt.WindowState.WindowMinimized | Qt.WindowState.WindowActive
                )
                self.main_window.activateWindow()

    def init_hotkey(self):
        def on_activate():
            self.bus.trigger_capture_signal.emit()

        hotkey = keyboard.GlobalHotKeys({
            '<ctrl>+<alt>+d': on_activate,
            '<f4>': on_activate
        })
        hotkey_thread = threading.Thread(target=hotkey.start, daemon=True)
        hotkey_thread.start()
        print("[系统] 全局热键监听开启 (Ctrl+Alt+D 或 F4)")

    def start_capture(self):
        # 防抖：截屏浮层已打开时忽略重复触发（避免二次抓屏导致黑屏闪烁）
        if self.capture_active:
            return

        if self.current_overlay:
            self.current_overlay.close()
            self.current_overlay = None

        if not self.capture_widget:
            self.capture_widget = ScreenCaptureWidget()
            self.capture_widget.captured.connect(self.handle_captured_image)
            self.capture_widget.cancelled.connect(self.on_capture_cancelled)

        self.capture_active = True
        self.capture_widget.start_capture()

    def on_capture_cancelled(self):
        self.capture_active = False

    def handle_captured_image(self, pil_image, offset_x, offset_y):
        self.capture_active = False
        self.current_seq += 1
        seq = self.current_seq

        def worker():
            try:
                print("[1. OCR] 开始文字识别与 Polygon 检测...")
                raw_ocr_items = self.ocr_engine.detect_and_recognize(pil_image)

                print(f"[2. 行重构] 合并前: {len(raw_ocr_items)} 项")
                merged_items = self.reconstructor.merge_nearby_boxes(raw_ocr_items)
                print(f"[2. 行重构] 智能短语合并后: {len(merged_items)} 项")

                if not merged_items:
                    print("[警告] 未检测到任何文字")
                    self.bus.ocr_finish_signal.emit(seq, None, offset_x, offset_y)
                    return

                # 转换为numpy数组供后续处理
                np_img = np.array(pil_image.convert('RGB'))

                # 3. 为每个文字项估计文字属性
                items = []
                boxes_for_inpainting = []
                for merged in merged_items:
                    props = self.inpainter.estimate_text_properties(np_img, merged['box'])
                    item = {
                        'box': merged['box'],
                        'text': merged['text'],
                        'score': merged['score'],
                        'translated_text': '',
                        'props': props,
                        'translated': False
                    }
                    items.append(item)
                    boxes_for_inpainting.append(merged['box'])

                # 4. 图像修复：一次性抹除所有原文区域
                print("[3. Inpainting] 正在抹除原文并修复背景...")
                inpainted_pil, _ = self.inpainter.inpaint_image(pil_image, boxes_for_inpainting)
                
                # 准备结果数据结构
                result = {
                    'original_image': pil_image,
                    'inpainted_image': inpainted_pil,
                    'items': items,
                    'current_image': inpainted_pil.copy()
                }

                # 5. 立即上屏（先显示抹除原文后的干净背景）
                self.bus.ocr_finish_signal.emit(seq, result, offset_x, offset_y)

                # 6. 并行翻译，每完成一项就更新图像
                translation_lock = threading.Lock()
                completed_count = [0]
                total_count = len(items)

                def translate_index(i):
                    item = items[i]
                    orig_text = item['text']
                    try:
                        translated = self.translator.translate_text(orig_text)
                    except Exception as e:
                        print(f"[翻译失败] '{orig_text}': {e}")
                        translated = orig_text  # 失败时显示原文
                    
                    with translation_lock:
                        item['translated_text'] = translated
                        item['translated'] = True
                        completed_count[0] += 1
                        
                        # 渲染当前已翻译的所有项到修复后的图像上
                        current_img = self.inpainter.render_text_on_image(
                            inpainted_pil, 
                            [it for it in items if it['translated']]
                        )
                        result['current_image'] = current_img
                        
                        print(f" -> [{completed_count[0]}/{total_count}] '{orig_text}' => '{translated}'")
                    
                    # 推送增量更新
                    self.bus.translation_progress_signal.emit(seq, result)

                # 使用线程池并行翻译
                with ThreadPoolExecutor(max_workers=5) as executor:
                    futures = [executor.submit(translate_index, i) for i in range(len(items))]
                    for f in futures:
                        try:
                            f.result()  # 等待每个任务完成，捕获可能的异常
                        except Exception as e:
                            print(f"[Worker异常] {e}")
                            import traceback
                            traceback.print_exc()

                print(f"[完成] 全部 {total_count} 项翻译渲染完毕!")

            except Exception as e:
                print(f"[OCR Worker Error] {e}")
                import traceback
                traceback.print_exc()
                self.bus.ocr_finish_signal.emit(seq, None, offset_x, offset_y)

        t = threading.Thread(target=worker, daemon=True)
        t.start()

    def show_overlay(self, seq, result, offset_x, offset_y):
        if seq != self.current_seq:
            return  # 过期结果，丢弃
        
        if result is None:
            print("[警告] 未检测到任何文字")
            return

        if self.current_overlay:
            self.current_overlay.close()

        self.current_overlay = OverlayWidget(offset_x, offset_y, result)
        self.current_overlay.show()
        self.current_overlay.raise_()

    def update_overlay(self, seq, result):
        if seq != self.current_seq or not self.current_overlay:
            return
        self.current_overlay.update_result(result)

    def quit_app(self):
        self.tray_icon.hide()
        self.app.quit()

    def run(self):
        return self.app.exec()

if __name__ == "__main__":
    main_app = MainApplication()
    sys.exit(main_app.run())
