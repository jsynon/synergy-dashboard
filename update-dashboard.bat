@echo off
setlocal EnableExtensions
set "PROJECT_DIR=%~dp0"
set "DATA_DIR=%PROJECT_DIR%data"
set "SOURCE_DIR=C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs"
set "ROSTER_NAME="

echo Project folder: "%PROJECT_DIR%"
echo Guild logs:    "%SOURCE_DIR%"
echo.

if not exist "%SOURCE_DIR%\" (
  echo ERROR: Could not find the Neverwinter guild logs folder.
  echo Expected: "%SOURCE_DIR%"
  pause
  exit /b 1
)

rem Select the newest roster export. The game may append a timestamp to its filename.
for /f "delims=" %%F in ('dir /b /a-d /o-d "%SOURCE_DIR%\GuildMembersListLogs*.csv" 2^>nul') do if not defined ROSTER_NAME set "ROSTER_NAME=%%F"
if not defined ROSTER_NAME (
  echo ERROR: No GuildMembersListLogs*.csv file was found in the guild logs folder.
  pause
  exit /b 1
)
if not exist "%SOURCE_DIR%\GuildActivityLogs.csv" (
  echo ERROR: GuildActivityLogs.csv was not found in the guild logs folder.
  pause
  exit /b 1
)
if not exist "%DATA_DIR%\" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\" (
  echo ERROR: Could not access the project data folder: "%DATA_DIR%"
  pause
  exit /b 1
)

echo Selected roster source: "%ROSTER_NAME%"
for %%F in ("%SOURCE_DIR%\%ROSTER_NAME%") do echo Source modified: %%~tF   Size: %%~zF bytes
for %%F in ("%SOURCE_DIR%\GuildActivityLogs.csv") do echo Activity modified: %%~tF   Size: %%~zF bytes
echo.
echo Copying to the stable project filenames:
echo   "%DATA_DIR%\roster.csv"
copy /y "%SOURCE_DIR%\%ROSTER_NAME%" "%DATA_DIR%\roster.csv"
if errorlevel 1 goto copy_failed
fc /b "%SOURCE_DIR%\%ROSTER_NAME%" "%DATA_DIR%\roster.csv" >nul
if errorlevel 1 goto verify_failed

echo   "%DATA_DIR%\activity.csv"
copy /y "%SOURCE_DIR%\GuildActivityLogs.csv" "%DATA_DIR%\activity.csv"
if errorlevel 1 goto copy_failed
fc /b "%SOURCE_DIR%\GuildActivityLogs.csv" "%DATA_DIR%\activity.csv" >nul
if errorlevel 1 goto verify_failed

for %%F in ("%DATA_DIR%\roster.csv") do echo Verified roster.csv: %%~zF bytes
for %%F in ("%DATA_DIR%\activity.csv") do echo Verified activity.csv: %%~zF bytes
echo.
cd /d "%PROJECT_DIR%"
py scripts\build_snapshot.py
if errorlevel 1 goto build_failed

echo.
echo Snapshot refreshed. Commit and push data\snapshot.json to update the hosted page.
pause
exit /b 0

:copy_failed
echo ERROR: Windows could not copy one of the guild CSV exports.
pause
exit /b 1

:verify_failed
echo ERROR: A copied CSV does not match its source file.
pause
exit /b 1

:build_failed
echo ERROR: Snapshot generation failed. Confirm both exports are valid CSV files.
pause
exit /b 1
