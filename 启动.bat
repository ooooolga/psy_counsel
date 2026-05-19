@echo off
chcp 65001 >nul
title 事事如嗦 - 嗦语陪伴
cd /d "%~dp0"

echo.
echo  ========================================
echo    事事如嗦 - 正在启动...
echo  ========================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo  [提示] 未检测到 npm，请先安装 Node.js：
  echo         https://nodejs.org/  （选 LTS 版本，一路下一步即可）
  echo.
  echo  若只想先看界面，可直接双击 index.html 用浏览器打开。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo  首次运行，正在安装依赖（只需一次）...
  call npm install
  if errorlevel 1 (
    echo  依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

REM 检查 3000 端口是否已有服务在运行
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo  [提示] 服务已在运行中（端口 3000 已被占用）
  echo         无需重复启动，直接在浏览器使用即可：
  echo.
  echo      http://localhost:3000
  echo.
  echo  若要重新启动：先关掉之前那个黑色命令行窗口，再双击本文件。
  echo.
  start http://localhost:3000
  pause
  exit /b 0
)

echo  启动成功！请在浏览器打开：
echo.
echo      http://localhost:3000
echo.
echo  关闭本窗口即可停止服务。
echo.

start http://localhost:3000
call npm start

pause
