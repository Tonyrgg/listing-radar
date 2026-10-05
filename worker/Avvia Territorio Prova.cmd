@echo off
cd /d "%~dp0"
call npm.cmd run territory:dev
if errorlevel 1 pause
