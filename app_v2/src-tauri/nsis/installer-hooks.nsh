; 猫步翻译 NSIS 安装与卸载自定义增强钩子
; 作用：在安装、升级或卸载时，自动静默关闭后台常驻进程，彻底解决 Windows 文件占用导致的「无法卸载！」弹窗。

!macro customInit
  ; 静默结束所有旧版本进程（不弹黑框）
  nsExec::Exec 'taskkill /F /IM MaobuTranslator.exe /T'
  nsExec::Exec 'taskkill /F /IM "猫步翻译.exe" /T'
  nsExec::Exec 'taskkill /F /IM catwalk.exe /T'
!macroend

!macro customInstall
  ; 1. 显式删除并重建桌面快捷方式，强迫 Windows 绑定新 exe 内部的最新图标
  Delete "$DESKTOP\猫步翻译.lnk"
  Delete "$DESKTOP\MaobuTranslator.lnk"
  CreateShortcut "$DESKTOP\猫步翻译.lnk" "$INSTDIR\MaobuTranslator.exe" "" "$INSTDIR\MaobuTranslator.exe" 0

  ; 2. 刷新 Windows Shell 图标与文件关联缓存（彻底解决覆盖升级后桌面/任务栏快捷方式显示旧图标问题）
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  System::Call 'shell32.dll::SHChangeNotify(i 0x00001000, i 0x0005, w "$DESKTOP", i 0)'
  
  ; 3. 触发 Windows 内置 ie4uinit 刷新图标缓存数据库
  nsExec::Exec 'ie4uinit.exe -show'
  nsExec::Exec 'ie4uinit.exe -ClearIconCache'
!macroend

!macro customUnInit
  ; 卸载前自动静默结束运行中的进程
  nsExec::Exec 'taskkill /F /IM MaobuTranslator.exe /T'
  nsExec::Exec 'taskkill /F /IM "猫步翻译.exe" /T'
  nsExec::Exec 'taskkill /F /IM catwalk.exe /T'
!macroend

!macro customUnInstall
  ; 卸载后刷新桌面与外壳图标通知
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  System::Call 'shell32.dll::SHChangeNotify(i 0x00001000, i 0x0005, w "$DESKTOP", i 0)'
!macroend

