# Synergy Guild Dashboard

A static, single-page Neverwinter guild dashboard. Visitors see the latest published snapshot from `data/snapshot.json`.

Part of the Synergy guild site: [News](https://jsynon.github.io/synergy-dashboard/news.html) · [Guild Roster](https://jsynon.github.io/synergy-dashboard/) · [Guild Info](https://jsynon.github.io/synergy-dashboard/guild-info.html) · [Masterwork Forge](https://jsynon.github.io/synergy-craft/) · [Discord](https://discord.gg/eMzcD6wJzh)

## Neverwinter News

The dedicated [Neverwinter News page](https://jsynon.github.io/synergy-dashboard/news.html) displays recent official headlines, dates, summaries, platform availability, and links to the full articles. `scripts/fetch-neverwinter-news.mjs` retrieves up to 100 English entries from the official Arc Games news JSON endpoint and writes the public cache to `data/neverwinter-news.json`. The page reads this same-origin file, avoiding browser cross-origin restrictions.

The GitHub Actions workflow in `.github/workflows/refresh-neverwinter-news.yml` refreshes the cache every six hours and supports manual runs. When the feed changes, it commits the new JSON and explicitly requests a GitHub Pages branch build so the refreshed data is published. `robots.txt` and `sitemap.xml` describe the public pages for search crawlers.

## What the page shows

- Member directory with character count, unique account count, character name, account name, rank, class, join date, and last-online date
- Counted, clickable rank and class filters built into the directory
- A searchable activity archive with member links, event-type filters, and time-range filters
- Clickable account names that open a character-by-character account detail popup
- Upcoming account promotion milestones, based on original verified account join dates
- A compact account-level inactivity alert card using each account’s most recent character activity; officers, guild leaders, protected accounts, and leave-of-absence accounts are excluded
- Links to the Masterwork Forge and Synergy Discord

## Refresh and publish guild data

1. Export the roster and activity logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It finds the newest `GuildMembersListLogs*.csv` and `GuildActivityLogs.csv` in `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs`, copies them to the stable local names `data/roster.csv` and `data/activity.csv`, verifies the copies, and rebuilds `data/snapshot.json`. Each rebuild merges new activity records into the existing published event history, deduplicating by timestamp, event type, and text, so events remain available after Neverwinter trims its export. The script prints the selected source filename and source/destination sizes so you can confirm what it copied.
3. Commit and push the changed `data/snapshot.json` to the GitHub Pages branch. The published page then shows the updated snapshot to every visitor. The snapshot carries forward account-level original join dates so later exports do not reset tenure when a member leaves and returns.

The batch file selects the most recently modified roster match, so timestamped filenames work. Raw CSVs are ignored by Git. The generated JSON includes character name, account name, rank, class, level, join date, last-online date, online status, account total, and activity summaries. It omits member/status/officer comments. Activity text retains account handles for searching and links matching character names to the current roster. The activity search matches character names, account names, and event text. Event type and time-range dropdowns narrow the full archive. Clicking a character@account link in the activity archive, promotion list, inactivity alerts, or directory opens the shared account popup with all current characters on that account.

The account total is calculated from case-insensitive unique values in the roster CSV's `Account` column. Promotion milestones use account-level tenure: 1 month for Initiate→Wayfarer, 3 months for Wayfarer→Stalwart, 6 months for Stalwart→Veteran, and 1 year for Veteran→Elder. The snapshot preserves the earliest known account join date across updates; new accounts start with the earliest join date in the roster export. These dates mark eligibility and do not trigger automatic promotions.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the new snapshot.

## GitHub Pages

The project has no build step. Push the files to the repository and enable Pages from the `main` branch root. Keep `data/snapshot.json` tracked so Pages serves it. The `.gitignore` excludes `data/*.csv`, so raw source exports are not committed by default.
