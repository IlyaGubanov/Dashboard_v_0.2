@echo off
rem MVS ST local run on Windows. Commands: setup, start, demo. See docs/11-lokalnyy-zapusk.md
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local.ps1" %*
