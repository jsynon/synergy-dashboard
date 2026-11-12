# Synergy Guild Website

The Synergy website brings together four Neverwinter pages for guild members and visitors — News, Guild Roster, Guild Info, and the Masterwork Crafting Ledger — all maintained and published from this repository at [synergyonline.org](https://synergyonline.org/). The pages share navigation, visual styling, and the Synergy community links.

[News](https://synergyonline.org/) · [Guild Roster](https://synergyonline.org/roster.html) · [Guild Info](https://synergyonline.org/guild-info.html) · [Masterwork Crafting Ledger](https://synergyonline.org/masterwork.html) · [Discord](https://discord.gg/eMzcD6wJzh)

## News

The [News page](https://synergyonline.org/) is the site's homepage (`index.html`). It combines the compact Upcoming Events calendar with Recent Articles. The calendar merges manually maintained Neverwinter in-game events with upcoming and active events from Synergy’s Discord server. Event names link to Discord, and a “Somewhere Else” URL (such as a Raid-Helper signup post) appears as a secondary link. Dates display in Eastern Time without event times.

Update the in-game event list in `data/manual-events.json`. Use `startDate` and `endDate` in `YYYY-MM-DD` format; events that have ended are hidden automatically. In-game events end at 10:30 AM Eastern on their end date, and the calendar drops each one at that moment. The one exception is the stronghold's Mysterious Merchant, whose seven days run from when its structure was built: give its entry the real start and end dates plus an `endTime` (`"HH:MM"`, 24-hour Eastern) and it ends at that time instead. Discord events are fetched by `scripts/fetch-discord-events.mjs` into `data/discord-events.json`. Recent Articles presents official headlines, publication dates, summaries, and available-platform details, with links to the original Neverwinter articles.

The news cache is built from the official Arc Games news feed. `scripts/fetch-neverwinter-news.mjs` retrieves up to 100 English entries and writes `data/neverwinter-news.json`. The `.github/workflows/refresh-neverwinter-news.yml` workflow refreshes the official news and Discord event caches every six hours and can also be run manually. The same workflow runs `scripts/fetch-suno-music.mjs`, which refreshes the Synergy Soundtrack track list in `data/suno-music.json` from the guild's public Suno profile; because that source is unofficial, a failed Suno fetch keeps the previous soundtrack data and never blocks the news refresh. It reads the `DISCORD_BOT_TOKEN` GitHub Actions secret and `DISCORD_GUILD_ID` repository variable; the token is never included in the public site data. The workflow writes the refreshed article list into `index.html`; the old `news.html` address is now a redirect stub that sends visitors to the homepage.

## Guild Roster

The [Guild Roster page](https://synergyonline.org/roster.html) is the searchable directory and activity view. Its member search filters characters and accounts by name, rank, or class. The directory shows each character’s account, rank, class, join date, and last-online status, with counts for characters and unique accounts. Selecting an account opens a popup listing its characters and their roster details.

The page also includes a searchable Recent Activity archive, a collapsible Guild Bank Activity log, Upcoming Promotions, and Inactivity Alerts. Activity filters narrow results by event type and time period. The bank log can be searched by character, account, item, or category; account names open the same character-details popup. Promotion milestones use the account’s earliest verified join date. Inactivity alerts use the most recent activity across an account’s characters and apply the guild’s rank-based limits and exemptions.

## Guild Info

The [Guild Info page](https://synergyonline.org/guild-info.html) explains the guild and what members can expect. A topic menu at the top of the page switches between six sections — Guild Overview, Guild Rules, the Guild Charter, Guild History, the Synergy Soundtrack, and Synergy Academy — and each section keeps the full text of the expandable card it replaced, with its own link (for example, `guild-info.html#rules`); without JavaScript the sections simply stack open. The page also presents Synergy’s history—from BAMF and Lady Vega through the guild’s renewal and the creation of Synergy Academy and the Masterwork Forge. A Synergy Soundtrack section presents the guild's original music — Neverwinter-inspired songs created by Antilogic — as a track list that refreshes automatically from [Suno](https://suno.com/@antilogic).

## Masterwork Crafting Ledger

The [Masterwork Crafting Ledger](https://synergyonline.org/masterwork.html) is Synergy’s crafting reference for Neverwinter Masterwork recipes. It includes verified recipes for all nine character classes, with search and filters for class and material source. Players can look up recipes, items, materials, and where ingredients come from.

The Forge lives in this repository as `masterwork.html`. It was originally a separate project in the [`synergy-craft` GitHub repository](https://github.com/jsynon/synergy-craft); that repository is now archived, and its old GitHub Pages address serves a redirect to [synergyonline.org/masterwork.html](https://synergyonline.org/masterwork.html). Keep the archived repository in place — deleting it would break that redirect.

## Update roster, activity, and bank data

1. Export the roster, guild activity, and guild bank logs in Neverwinter.
2. Double-click `update-dashboard.bat`. It selects the newest `GuildMembersListLogs*.csv` and copies the activity and bank exports from `C:\Program Files (x86)\Neverwinter_en\Neverwinter\Live\guildlogs` into the local `data` folder, then rebuilds `data/snapshot.json`.
3. Commit and push the updated snapshot to the GitHub Pages branch.

Each rebuild merges new activity and bank entries into the existing snapshot, removing duplicates so records are retained when Neverwinter trims its exports. The snapshot also carries forward each account’s earliest known guild join date for promotion milestones. Raw CSV exports are ignored by Git; the generated snapshot omits member, status, and officer comments.

## Run locally

Double-click `run-local.bat` (requires Python on Windows), then visit <http://localhost:8000>. The local server reads `data/snapshot.json`. After running `update-dashboard.bat`, refresh the page to see the updated data.

## GitHub Pages

This repository has no site build step. GitHub Pages serves it from the `main` branch root at the custom domain [synergyonline.org](https://synergyonline.org/) (bound by the `CNAME` file, with HTTPS enforced); the old `jsynon.github.io` addresses redirect to the domain automatically. `sitemap.xml` and `robots.txt` describe the four pages for search engines. Keep `data/snapshot.json` tracked so the published roster page can load it; `.gitignore` excludes raw `data/*.csv` exports.
