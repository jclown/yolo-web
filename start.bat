@echo off
echo ========================================
echo   YOLO Platform - Quick Start
echo ========================================
echo.

set PYTHON_ENV=pdfword
set BACKEND_PORT=3001
set FRONTEND_PORT=5173

set /p INPUT_PYTHON_ENV="Enter Python Conda env name (default: yolo): "
if not "%INPUT_PYTHON_ENV%"=="" set PYTHON_ENV=%INPUT_PYTHON_ENV%

set /p INPUT_BACKEND_PORT="Enter backend port (default: 3001): "
if not "%INPUT_BACKEND_PORT%"=="" set BACKEND_PORT=%INPUT_BACKEND_PORT%

set /p INPUT_FRONTEND_PORT="Enter frontend port (default: 5173): "
if not "%INPUT_FRONTEND_PORT%"=="" set FRONTEND_PORT=%INPUT_FRONTEND_PORT%

echo.
echo Configuration:
echo - Python Conda env: %PYTHON_ENV%
echo - Backend port: %BACKEND_PORT%
echo - Frontend port: %FRONTEND_PORT%
echo.

echo [1/4] Checking ports...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%BACKEND_PORT% ^| findstr LISTENING') do (
    echo Killing process on backend port %BACKEND_PORT% (PID: %%a)
    taskkill /F /PID %%a >nul 2>nul
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do (
    echo Killing process on frontend port %FRONTEND_PORT% (PID: %%a)
    taskkill /F /PID %%a >nul 2>nul
)

timeout /t 1 /nobreak >nul
echo Port check completed
echo.

echo [2/4] Getting Python path from Conda env...
for /f "delims=" %%i in ('conda info --base 2^>nul') do set CONDA_BASE=%%i
if "%CONDA_BASE%"=="" (
    echo [ERROR] Cannot find Conda installation
    echo Please ensure Conda is properly installed
    pause
    exit /b 1
)
set PYTHON_PATH=%CONDA_BASE%\envs\%PYTHON_ENV%\python.exe
if not exist "%PYTHON_PATH%" (
    echo [ERROR] Python executable not found: %PYTHON_PATH%
    echo Please check if Conda env '%PYTHON_ENV%' exists
    pause
    exit /b 1
)
echo Python path: %PYTHON_PATH%
echo.

echo [3/4] Starting backend server (Node.js) on port %BACKEND_PORT%...
start "YOLO Backend" cmd /k "cd /d %~dp0 && set PYTHON_PATH=%PYTHON_PATH% && set PORT=%BACKEND_PORT% && npm run server:dev"
timeout /t 2 /nobreak >nul
echo Backend starting...
echo.

echo [4/4] Starting frontend server on port %FRONTEND_PORT%...
start "YOLO Frontend" cmd /k "cd /d %~dp0 && set BACKEND_PORT=%BACKEND_PORT% && npm run client:dev -- --port %FRONTEND_PORT%"
timeout /t 2 /nobreak >nul
echo Frontend starting...
echo.

echo ========================================
echo   Start Completed!
echo ========================================
echo.
echo Backend: http://localhost:%BACKEND_PORT%
echo Frontend: http://localhost:%FRONTEND_PORT%
echo.
echo Tip: Close terminal windows to stop services
echo.
pause
