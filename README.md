# Synergy Guild Website

A three-page Neverwinter site for Synergy members and visitors. It brings together official game news and events, the guild roster and activity, and information about the guild’s community and policies.

[News](https://jsynon.github.io/synergy-dashboard/news.html) · [Guild Roster](https://jsynon.github.io/synergy-dashboard/) · [Guild Info](https://jsynon.github.io/synergy-dashboard/guild-info.html) · [Masterwork Forge](https://jsynon.github.io/synergy-craft/) · [Discord](https://discord.gg/eMzcD6wJzh)

## News

The [News page](https://jsynon.github.io/synergy-dashboard/news.html) brings current Neverwinter announcements together with upcoming game events. The compact Upcoming Events card lists event names and dates. Recent Articles presents official headlines, publication dates, summaries, and available-platform details, with links to the original articles on the Neverwinter site.

The news cache is built from the official Arc Games news feed. `scripts/fetch-neverwinter-news.mjs` retrieves up to 100 English entries and writes `data/neverwinter-news.json`. The page reads this same-origin file. The `.github/workflows/refresh-neverwinter-news.yml` workflow refreshes the cache every six hours and can also be run manually.

## Guild Roster

The [Guild Roster page](https://jsynon.github.io/synergy-dashboard/) is the searchable directory and activity view. Its member search filters characters and accounts by name, rank, or class. The directory shows each character’s account, rank, class, join date, and last-online status, with counts for characters and unique accounts. Selecting an account opens a popup listing its characters and their roster details.

The page also includes a searchable Recent Activity archive, a collapsible Guild Bank Activity log, Upcoming Promotions, and Inactivity Alerts. Activity filters narrow results by event type and time period. The bank log can be searched by character, account, item, or category; account names open the same character-details popup. Promotion milestones use the account’s earliest verified join date. Inactivity alerts use the most recent activity across an account’s characters and apply the guild’s rank-based limits and exemptions.

## Guild Info

The [Guild Info page](https://jsynon.github.io/synergy-dashboard/guild-info.html) explains the guild and what members can expect. Its expandable cards cover the Guild Overview, support and progression, community culture, learning and participation, reasons to join, guild rules, rank progression, and the Guild Charter. The page also presents Synergy’s history—from BAMF and Lady Vega through the guild’s renewal and the creation of Synergy Academy and the Masterwork Forge—and includes the guild’s Discord information.

## Update roster, activity, and bank data

1. Export the roster, guild activity, and guild bank logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It selects the newest `GuildMembersListLogs*.csv` and copies the activity and bank exports from `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs` into the local `data` folder, then rebuilds `data/snapshot.json`.
3. Commit and push the updated snapshot to the GitHub Pages branch.

Each rebuild merges new activity and bank entries into the existing snapshot, removing duplicates so records are retained when Neverwinter trims its exports. The snapshot also carries forward each account’s earliest known guild join date for promotion milestones. Raw CSV exports are ignored by Git; the generated snapshot omits member, status, and officer comments.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the updated data.

## GitHub Pages

The project has no site build step. GitHub Pages serves the repository from the `main` branch root. Keep `data/snapshot.json` tracked so the published roster page can load it; `.gitignore` excludes raw `data/*.csv` exports.
