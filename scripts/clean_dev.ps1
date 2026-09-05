# 猫步翻译 - 开发调试端口自愈清理脚本
$ErrorActionPreference = 'SilentlyContinue'

# 1. 检测并彻底递归关闭占用 1420 (Vite HTTP) 与 1421 (Vite HMR) 端口的进程树
foreach ($port in @(1420, 1421)) {
    try {
        $pids = @()
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connections) {
            $pids += ($connections.OwningProcess | Select-Object -Unique)
        }
        # 双重保险：从 netstat 获取可能未被 Get-NetTCPConnection 捕获的 IPv6/隐式监听进程
        $netstatLines = netstat -ano | Select-String ":$port\s"
        foreach ($line in $netstatLines) {
            $parts = ($line.ToString().Trim() -split '\s+')
            if ($parts.Length -ge 5) {
                $p = [int]$parts[-1]
                if ($p -gt 0) { $pids += $p }
            }
        }
        $uniquePids = $pids | Select-Object -Unique
        foreach ($pidToKill in $uniquePids) {
            if ($pidToKill -gt 0 -and $pidToKill -ne $PID) {
                Write-Host "[*] 正在释放端口 $port 占用的进程树 (PID: $pidToKill)..." -ForegroundColor Yellow
                & taskkill.exe /F /T /PID $pidToKill 2>$null
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}

# 2. 清理残留的 MaobuTranslator.exe
try {
    $procs = Get-Process -Name "MaobuTranslator" -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Host "[*] 正在关闭旧的 MaobuTranslator.exe 进程..." -ForegroundColor Yellow
        $procs | ForEach-Object {
            & taskkill.exe /F /T /PID $_.Id 2>$null
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}

# 3. 清理残留的 cargo/rustc 进程（释放 artifact 目录锁）
try {
    $cargoProcs = Get-Process | Where-Object { $_.ProcessName -match "^(cargo|rustc)$" } -ErrorAction SilentlyContinue
    if ($cargoProcs) {
        $workspacePath = (Split-Path -Parent $PSScriptRoot)
        foreach ($cp in $cargoProcs) {
            try {
                $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($cp.Id)" -ErrorAction SilentlyContinue
                if ($procInfo -and $procInfo.CommandLine -and $procInfo.CommandLine -like "*$workspacePath*") {
                    Write-Host "[*] 正在释放历史构建锁 (PID: $($cp.Id))..." -ForegroundColor Yellow
                    & taskkill.exe /F /T /PID $cp.Id 2>$null
                    Stop-Process -Id $cp.Id -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
    }
} catch {}

# 4. 清理残留的 node/vite/tauri 孤儿开发进程
try {
    $nodeProcs = Get-Process | Where-Object { $_.ProcessName -match "^node$" } -ErrorAction SilentlyContinue
    if ($nodeProcs) {
        $workspacePath = (Split-Path -Parent $PSScriptRoot)
        foreach ($np in $nodeProcs) {
            try {
                $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($np.Id)" -ErrorAction SilentlyContinue
                if ($procInfo -and $procInfo.CommandLine -and ($procInfo.CommandLine -like "*$workspacePath*" -or $procInfo.CommandLine -match "(vite|@tauri-apps)")) {
                    Write-Host "[*] 正在释放历史 Node/Vite 进程 (PID: $($np.Id))..." -ForegroundColor Yellow
                    & taskkill.exe /F /T /PID $np.Id 2>$null
                    Stop-Process -Id $np.Id -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
    }
} catch {}

Start-Sleep -Milliseconds 500
Write-Host "[OK] 端口 1420/1421 与运行环境已完全清理完毕，准备启动！" -ForegroundColor Green