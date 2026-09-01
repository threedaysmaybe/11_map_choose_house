@echo off
chcp 65001 >nul
title 成都选房三维地图
cd /d "%~dp0"

echo ==========================================
echo    成都金融城 + 大源 · 选房三维地图
echo ==========================================
echo.

rem 检查 Node.js 是否安装
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

rem 清理旧的服务器进程（避免卡死后端口被占用导致重开 bat 无效）
echo 清理旧的服务器进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo 正在启动本地服务器...
start "" /min node serve.js
timeout /t 2 /nobreak >nul

rem 打开浏览器
start "" http://localhost:8080

echo.
echo 浏览器已打开: http://localhost:8080
echo.
echo 提示: 关闭本窗口不影响地图使用（服务器在后台运行）。
echo       如需彻底停止服务器，请在任务管理器结束 node.exe
echo.
timeout /t 3 /nobreak >nul
