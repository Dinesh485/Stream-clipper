@echo off
echo Starting Stream Clipper...

start "Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate && uvicorn main:app --reload --port 8000"
timeout /t 2 /nobreak >nul
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend running on http://localhost:8000
echo Frontend running on http://localhost:5173
echo.
echo Opening browser...
timeout /t 3 /nobreak >nul
start http://localhost:5173
