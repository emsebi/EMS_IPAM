@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Check-EMS-Client.ps1"
if errorlevel 1 echo EMS-IPAM: operation failed. Read the error above.
pause
