@echo off
cd /d "%~dp0"
call npm.cmd run desktop:dev
if errorlevel 1 pause
