@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" "helper\desktop.py"
  exit /b
)
py -3.12 -c "import tkinter" >nul 2>&1
if errorlevel 1 (
  start "" "helper\first-run.html"
  exit /b
)
start "" pyw -3.12 "helper\desktop.py"
