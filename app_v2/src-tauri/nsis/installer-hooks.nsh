; 猫步翻译 NSIS 安装与卸载自定义增强钩子
; 作用：在安装、升级或卸载时，自动静默关闭后台常驻进程，彻底解决 Windows 文件占用导致的「无法卸载！」弹窗。

!macro customInit
  ; 静默结束所有旧版本进程（不弹黑框）
  nsExec::Exec 'taskkill /F /IM MaobuTranslator.exe /T'
  nsExec::Exec 'taskkill /F /IM "猫步翻译.exe" /T'
  nsExec::Exec 'taskkill /F /IM catwalk.exe /T'
!macroend

!macro customUnInit
  ; 卸载前自动静默结束运行中的进程
  nsExec::Exec 'taskkill /F /IM MaobuTranslator.exe /T'
  nsExec::Exec 'taskkill /F /IM "猫步翻译.exe" /T'
  nsExec::Exec 'taskkill /F /IM catwalk.exe /T'
!macroend
