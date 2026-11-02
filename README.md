# Synergy Guild Dashboard

A static, single-page Neverwinter guild dashboard. Visitors see the same latest published snapshot from `data/snapshot.json`.

## Dashboard features

- Character and unique account counts, rank totals, and online status at export time
- Searchable roster with rank/class filters and sortable columns
- Monthly activity chart and recent guild activity
- Responsive layout with no framework or third-party runtime dependencies

## Refresh and publish guild data

1. Export the roster and activity logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It finds the newest `GuildMembersListLogs*.csv` and the fixed `GuildActivityLogs.csv` in `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs`, copies them into the local `data` folder, and rebuilds `data/snapshot.json`.
3. Commit and push the changed `data/snapshot.json` to the GitHub Pages branch. The published page then shows the snapshot to every visitor.

The batch file handles roster filenames with or without an export timestamp by matching `GuildMembersListLogs*.csv` and selecting the most recently modified match. Raw CSVs are ignored by Git. The generated JSON includes only character name, rank, class, level, join date, last-online date, online status, account total, and activity summaries. It omits member/status/officer comments and account handles. Activity text keeps character names but strips account handles.

The account total is recalculated as the number of case-insensitive unique values in the roster CSV's `Account` column. The supplied export has 374 character rows and 146 unique account names.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the new local snapshot.

## GitHub Pages

The project has no build step. Push the files to the repository and enable Pages from the `main` branch root. Keep `data/snapshot.json` tracked so Pages serves it. The `.gitignore` excludes `data/*.csv`, so the raw source exports are not committed by default.
