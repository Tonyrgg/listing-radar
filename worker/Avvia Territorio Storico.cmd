@echo off
cd /d "%~dp0"
call npm.cmd run territory:live
if errorlevel 1 pause
