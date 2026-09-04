# 猫步翻译 - 开发调试端口自愈清理脚本
$ErrorActionPreference = 'SilentlyContinue'

try {
    $connections = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections.OwningProcess | Select-Object -Unique
        foreach ($pidToKill in $pids) {
            if ($pidToKill -gt 0) {
                Write-Host "[*] 正在释放端口 1420 占用的孤儿进程 (PID: $pidToKill)..." -ForegroundColor Yellow
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch {
}

try {
    $procs = Get-Process -Name "MaobuTranslator" -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Host "[*] 正在关闭旧的 MaobuTranslator.exe 进程..." -ForegroundColor Yellow
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    }
} catch {
}

Write-Host "[OK] 端口 1420 与运行环境已完全清理完毕，准备启动！" -ForegroundColor Green
