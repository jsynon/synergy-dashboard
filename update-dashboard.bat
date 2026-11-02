@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "DATA_DIR=%PROJECT_DIR%data"
set "SOURCE_DIR=C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs"
set "ROSTER_NAME="

if not exist "%SOURCE_DIR%\" (
  echo Could not find the Neverwinter guild logs folder:
  echo %SOURCE_DIR%
  pause
  exit /b 1
)

rem Select the newest roster export. The game may append a timestamp to this filename.
for /f "delims=" %%F in ('dir /b /a-d /o-d "%SOURCE_DIR%\GuildMembersListLogs*.csv" 2^>nul') do if not defined ROSTER_NAME set "ROSTER_NAME=%%F"
if not defined ROSTER_NAME (
  echo Could not find GuildMembersListLogs*.csv in:
  echo %SOURCE_DIR%
  pause
  exit /b 1
)
if not exist "%SOURCE_DIR%\GuildActivityLogs.csv" (
  echo Could not find GuildActivityLogs.csv in:
  echo %SOURCE_DIR%
  pause
  exit /b 1
)
if not exist "%DATA_DIR%\" mkdir "%DATA_DIR%"

copy /y "%SOURCE_DIR%\%ROSTER_NAME%" "%DATA_DIR%\roster.csv" >nul
if errorlevel 1 goto copy_failed
copy /y "%SOURCE_DIR%\GuildActivityLogs.csv" "%DATA_DIR%\activity.csv" >nul
if errorlevel 1 goto copy_failed

echo Copied roster: %ROSTER_NAME%
echo Copied activity log: GuildActivityLogs.csv
cd /d "%PROJECT_DIR%"
py scripts\build_snapshot.py
if errorlevel 1 goto build_failed

echo.
echo Snapshot refreshed. Commit and push data\snapshot.json to update the hosted page for all visitors.
pause
exit /b 0

:copy_failed
echo Failed to copy the guild CSV exports into the data folder.
pause
exit /b 1

:build_failed
echo Snapshot generation failed. Confirm both exports are valid CSV files.
pause
exit /b 1
