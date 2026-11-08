# Guild data files

- `snapshot.json` is the sanitized, tracked snapshot loaded by the website.
- `roster.csv`, `activity.csv`, and `bank.csv` are local source exports. They are ignored by Git.

Run `update-dashboard.bat` to copy the newest exports from Neverwinter's `guildlogs` folder and rebuild the public snapshot. The builder includes roster character and account details, and publishes the roster's member comment when one is present. It omits status and officer comments and raw source exports. It converts bank transactions to plain text fields and removes the game's markup before publishing them. It calculates the account total from unique roster `Account` values.
