@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  python build\build.py %*
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 build\build.py %*
  ) else (
    echo [ERROR] Python 3.10+ not found in PATH.
    pause
    exit /b 1
  )
)

set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" (
  echo [ERROR] Build failed with code %RC%.
)
if "%~1"=="" pause
exit /b %RC%
