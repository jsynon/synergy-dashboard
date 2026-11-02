# Guild data files

- `snapshot.json` is the sanitized, tracked snapshot loaded by the website.
- `roster.csv` and `activity.csv` are local source exports. They are ignored by Git.

Run `update-dashboard.bat` to copy the newest exports from Neverwinter's `guildlogs` folder and rebuild the public snapshot. The builder excludes comments and account handles while calculating the account total from unique roster `Account` values.
