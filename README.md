# Synergy Guild Dashboard

A static, single-page Neverwinter guild dashboard. Visitors see the latest published snapshot from `data/snapshot.json`.

## What the page shows

- Character count, unique account count, and open account spots
- A prominent searchable directory with character name, rank, class, join date, and last-online date
- Counted, clickable rank and class filters built into the directory
- Monthly grouped activity for character joins, departures, rank changes, and other logged events
- Recent activity and a short introduction to Synergy with the Discord invite

## Refresh and publish guild data

1. Export the roster and activity logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It finds the newest `GuildMembersListLogs*.csv` and the fixed `GuildActivityLogs.csv` in `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs`, copies them into the local `data` folder, and rebuilds `data/snapshot.json`.
3. Commit and push the changed `data/snapshot.json` to the GitHub Pages branch. The published page then shows the updated snapshot to every visitor.

The batch file selects the most recently modified roster match, so timestamped filenames work. Raw CSVs are ignored by Git. The generated JSON includes only character name, rank, class, level, join date, last-online date, online status, account total, and activity summaries. It omits member/status/officer comments and account handles. Activity text keeps character names but strips account handles.

The account total is calculated from case-insensitive unique values in the roster CSV's `Account` column. The supplied export has 374 character rows and 146 unique account names. Guild capacity is currently 150 accounts.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the new snapshot.

## GitHub Pages

The project has no build step. Push the files to the repository and enable Pages from the `main` branch root. Keep `data/snapshot.json` tracked so Pages serves it. The `.gitignore` excludes `data/*.csv`, so raw source exports are not committed by default.
