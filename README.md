# Synergy Guild Website

The Synergy website brings together four Neverwinter pages for guild members and visitors. This repository contains the News, Guild Roster, and Guild Info pages. The [Masterwork Forge](https://jsynon.github.io/synergy-craft/) is part of the same website experience, but it is maintained and published from the separate [`synergy-craft` repository](https://github.com/jsynon/synergy-craft). The pages share navigation, visual styling, and the Synergy community links.

[News](https://jsynon.github.io/synergy-dashboard/news.html) · [Guild Roster](https://jsynon.github.io/synergy-dashboard/) · [Guild Info](https://jsynon.github.io/synergy-dashboard/guild-info.html) · [Masterwork Forge](https://jsynon.github.io/synergy-craft/) · [Discord](https://discord.gg/eMzcD6wJzh)

## News

The [News page](https://jsynon.github.io/synergy-dashboard/news.html) combines the compact Upcoming Events calendar with Recent Articles. The calendar reads Discord Scheduled Events from Synergy’s server, showing event names and dates, linking titles to the Discord event, and linking a “Somewhere Else” URL (such as a Raid-Helper signup post) when one is present. Dates display in Eastern Time without showing event times. The site currently reads Synergy events; adding events from another Discord server requires the bot to be installed there and that server to be configured too.

Recent Articles presents official headlines, publication dates, summaries, and available-platform details, with links to the original articles on the Neverwinter site.

The news cache is built from the official Arc Games news feed. `scripts/fetch-neverwinter-news.mjs` retrieves up to 100 English entries and writes `data/neverwinter-news.json`. `scripts/fetch-discord-events.mjs` retrieves Synergy’s Scheduled Events and writes `data/discord-events.json`. The `.github/workflows/refresh-neverwinter-news.yml` workflow refreshes both caches every six hours and can also be run manually. It reads the `DISCORD_BOT_TOKEN` GitHub Actions secret and `DISCORD_GUILD_ID` repository variable; the token is never included in the public site data.

## Guild Roster

The [Guild Roster page](https://jsynon.github.io/synergy-dashboard/) is the searchable directory and activity view. Its member search filters characters and accounts by name, rank, or class. The directory shows each character’s account, rank, class, join date, and last-online status, with counts for characters and unique accounts. Selecting an account opens a popup listing its characters and their roster details.

The page also includes a searchable Recent Activity archive, a collapsible Guild Bank Activity log, Upcoming Promotions, and Inactivity Alerts. Activity filters narrow results by event type and time period. The bank log can be searched by character, account, item, or category; account names open the same character-details popup. Promotion milestones use the account’s earliest verified join date. Inactivity alerts use the most recent activity across an account’s characters and apply the guild’s rank-based limits and exemptions.

## Guild Info

The [Guild Info page](https://jsynon.github.io/synergy-dashboard/guild-info.html) explains the guild and what members can expect. Its expandable cards cover the Guild Overview, support and progression, community culture, learning and participation, reasons to join, guild rules, rank progression, and the Guild Charter. The page also presents Synergy’s history—from BAMF and Lady Vega through the guild’s renewal and the creation of Synergy Academy and the Masterwork Forge—and includes the guild’s Discord information.

## Masterwork Forge

The [Masterwork Forge](https://jsynon.github.io/synergy-craft/) is Synergy’s crafting reference for Neverwinter Masterwork recipes. It includes verified recipes for all nine character classes, with search and filters for class and material source. Players can look up recipes, items, materials, and where ingredients come from.

The Forge is a separate project in the [`synergy-craft` GitHub repository](https://github.com/jsynon/synergy-craft), rather than a page stored in this repository. It is published at its own GitHub Pages address and linked through the shared Synergy navigation, so it remains part of the same website for visitors.

## Update roster, activity, and bank data

1. Export the roster, guild activity, and guild bank logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It selects the newest `GuildMembersListLogs*.csv` and copies the activity and bank exports from `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs` into the local `data` folder, then rebuilds `data/snapshot.json`.
3. Commit and push the updated snapshot to the GitHub Pages branch.

Each rebuild merges new activity and bank entries into the existing snapshot, removing duplicates so records are retained when Neverwinter trims its exports. The snapshot also carries forward each account’s earliest known guild join date for promotion milestones. Raw CSV exports are ignored by Git; the generated snapshot omits member, status, and officer comments.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the updated data.

## GitHub Pages

This repository has no site build step. GitHub Pages serves it from the `main` branch root. Keep `data/snapshot.json` tracked so the published roster page can load it; `.gitignore` excludes raw `data/*.csv` exports. The Masterwork Forge has its own deployment configuration in the separate `synergy-craft` repository.
