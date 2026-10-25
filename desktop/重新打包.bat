@echo off
chcp 65001 >nul
title 聚影 - 重新打包
REM 一键重新生成安装包:改完网页代码(src/)或软件配置(desktop/main.js)后运行本脚本即可
REM 首次运行需联网下载依赖(约 2-5 分钟),之后利用缓存会快很多

cd /d "%~dp0.."

echo ========================================
echo   [1/4] 安装网页依赖...
echo ========================================
call npm install || goto :fail

echo ========================================
echo   [2/4] 构建网页(standalone)...
echo ========================================
set DOCKER_BUILD=1
call npm run build || goto :fail
xcopy /e /i /y .next\static .next\standalone\.next\static\ >nul || goto :fail
xcopy /e /i /y public .next\standalone\public\ >nul || goto :fail

echo ========================================
echo   [3/4] 同步服务端产物到打包目录...
echo ========================================
if exist desktop\server-bundle rmdir /s /q desktop\server-bundle
mkdir desktop\server-bundle
xcopy /e /i /y .next\standalone desktop\server-bundle\ >nul || goto :fail

echo ========================================
echo   [4/4] 打包安装程序(首次需下载依赖)...
echo ========================================
cd desktop
call npm install || goto :fail
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win nsis || goto :fail

echo.
echo ========================================
echo   完成! 安装包在 desktop\out\聚影-安装版-1.0.0.exe
echo ========================================
pause
exit /b 0

:fail
echo.
echo   打包失败,请把上面的报错信息发给助手排查。
pause
exit /b 1
