#!/usr/bin/env python3
"""Build the public dashboard snapshot from local Neverwinter CSV exports."""
import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROSTER_PATH = ROOT / "data" / "roster.csv"
ACTIVITY_PATH = ROOT / "data" / "activity.csv"
OUTPUT_PATH = ROOT / "data" / "snapshot.json"
RANK_NAMES = {
    1: "Initiate", 2: "Wayfarer", 3: "Stalwart", 4: "Veteran",
    5: "Elder", 6: "Officer", 7: "Guild Leader",
}


def read_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        headers = [(header or "").strip() for header in next(reader, [])]
        records = []
        for values in reader:
            # Some exports contain unquoted commas in comment fields; only the known
            # leading columns are needed, so ignore overflow after the header columns.
            records.append({header: (values[i] if i < len(values) else "").strip()
                            for i, header in enumerate(headers)})
        return records


def parse_date(value: str):
    if not value:
        return None
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).isoformat(timespec="seconds")
        except ValueError:
            pass
    return None


def event_kind(row):
    kind, text = row.get("Type", ""), row.get("Text", "").lower()
    if kind == "3" or "has joined the guild" in text:
        return "join"
    if kind == "4" or "has left the guild" in text or "was kicked from the guild" in text:
        return "exit"
    if kind == "5" or "guild rank is now" in text:
        return "rank"
    return "other"


def main():
    roster_rows = read_csv(ROSTER_PATH)
    activity_rows = read_csv(ACTIVITY_PATH)
    if roster_rows and "Name" not in roster_rows[0]:
        raise SystemExit(f"{ROSTER_PATH.name} is missing the Name column.")
    if activity_rows and "Text" not in activity_rows[0]:
        raise SystemExit(f"{ACTIVITY_PATH.name} is missing the Text column.")

    members = []
    accounts = set()
    for row in roster_rows:
        account = row.get("Account", "").strip().casefold()
        if account:
            accounts.add(account)
        match = re.match(r"^(\d+)", row.get("Guild Rank", ""))
        rank_order = int(match.group(1)) if match else 0
        members.append({
            "name": row.get("Name", "") or "Unknown",
            "account": row.get("Account", ""),
            "rank": RANK_NAMES.get(rank_order, row.get("Guild Rank", "") or "Unranked"),
            "rankOrder": rank_order,
            "class": row.get("Class", "") or "Unknown",
            "level": row.get("Level", ""),
            "joinDate": parse_date(row.get("Guild join date", "")),
            "lastOnline": parse_date(row.get("Last online date", "")),
            "onlineNow": bool(row.get("Location", "").strip()
                               and row.get("Location", "").strip().casefold() != "offline"),
        })

    events = []
    for row in activity_rows:
        date = parse_date(row.get("Time", ""))
        if not date:
            continue
        text = re.sub(r"\\s+", " ", row.get("Text", "")).strip()
        events.append({"date": date, "kind": event_kind(row), "text": text})
    events.sort(key=lambda event: event["date"], reverse=True)

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accountCount": len(accounts),
        "roster": members,
        "events": events,
    }
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}: {len(members)} characters, "
          f"{len(accounts)} unique accounts, {len(events)} activity records.")


if __name__ == "__main__":
    main()
