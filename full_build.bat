@echo off
set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm
set ELECTRON_RUN_AS_NODE=
call npm run build
