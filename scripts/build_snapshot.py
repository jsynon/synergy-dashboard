#!/usr/bin/env python3
"""Build the public dashboard snapshot from local Neverwinter CSV exports."""
import csv
import html
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROSTER_PATH = ROOT / "data" / "roster.csv"
ACTIVITY_PATH = ROOT / "data" / "activity.csv"
BANK_LOG_PATH = ROOT / "data" / "bank.csv"
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
            # Some exports contain unquoted commas in comment fields. Map the known
            # columns normally and retain raw cells so leave-of-absence notes survive overflow.
            record = {header: (values[i] if i < len(values) else "").strip()
                      for i, header in enumerate(headers)}
            record["_raw_values"] = values
            header_indexes = {
                re.sub(r"\\s+", " ", header).strip().casefold(): index
                for index, header in enumerate(headers)
            }
            comment_index = next((header_indexes[name] for name in
                                  ("member comments", "member comment", "comment")
                                  if name in header_indexes), None)
            if comment_index is not None:
                # The game writes generated "Last online ..." text in Status comments.
                # Find that field after Member comments so it is never displayed as a member note.
                status_index = next(
                    (index for index in range(comment_index, len(values))
                     if re.match(r"^\\s*Last online\\b", values[index], re.IGNORECASE)),
                    None,
                )
                if status_index is not None:
                    comment_values = values[comment_index:status_index]
                elif len(values) > len(headers):
                    # Preserve unquoted commas in a member comment while reserving the
                    # trailing status and officer comment columns.
                    trailing_columns = sum(
                        name in header_indexes
                        for name in ("status comments", "officer comments")
                    )
                    comment_values = values[comment_index:max(comment_index, len(values) - trailing_columns)]
                else:
                    comment_values = values[comment_index:comment_index + 1]
                record["_member_comment"] = re.sub(
                    r"\\s+", " ", ",".join(comment_values)
                ).strip(" ,")
            records.append(record)
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


def parse_bank_amount(value: str):
    """Parse the signed stack delta from a bank-log row."""
    normalized = re.sub(r"[\s,]", "", str(value or ""))
    return int(normalized) if re.fullmatch(r"[+-]?\d+", normalized) else None


def read_bank_log(path: Path):
    """Normalize bank-log rows, including the export's occasional unquoted commas."""
    events = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        headers = [(header or "").strip() for header in next(reader, [])]
        required = {"Time", "Player", "Action", "ItemName", "Amount", "Text"}
        if not required.issubset(headers):
            raise SystemExit(f"{path.name} is missing one or more expected bank-log columns.")
        positions = {header: headers.index(header) for header in required}
        for values in reader:
            if len(values) <= positions["Amount"]:
                continue
            def cell(name):
                index = positions[name]
                return values[index].strip() if index < len(values) else ""

            date = parse_date(cell("Time"))
            item = cell("ItemName")
            amount_text = cell("Amount")
            amount = parse_bank_amount(amount_text)
            text_index = positions["Text"]
            text_parts = values[text_index:] if text_index < len(values) else []

            # A few malformed rows contain a comma in ItemName without CSV quotes.
            # That can shift Amount into the first Text cell while leaving the final
            # piece of ItemName in the Amount column.
            if text_parts and parse_bank_amount(text_parts[0]) is not None:
                item = ", ".join(part.strip() for part in (item, amount_text) if part.strip())
                amount = parse_bank_amount(text_parts[0])
                text_parts = text_parts[1:]
            if not date or amount is None:
                continue

            description = html.unescape(re.sub(r"<[^>]*>", "", ",".join(text_parts)))
            description = re.sub(r"\s+", " ", description).strip().strip('"').replace('""', '"')
            action_match = re.search(r"\b(Deposit|Withdraw)\b", description, re.IGNORECASE)
            action = action_match.group(1).lower() if action_match else ("deposit" if amount >= 0 else "withdraw")
            category = description.split(" - ", 1)[0].strip() if " - " in description else "Other"
            category = re.sub(r"\b(Deposit|Withdraw)\b", "", category, flags=re.IGNORECASE).strip() or "Other"
            events.append({
                "date": date,
                "player": cell("Player"),
                "account": cell("Action"),
                "action": action,
                "category": category,
                "item": item,
                "amount": abs(amount),
            })
    return sorted(events, key=lambda event: event["date"], reverse=True)


def event_kind(row):
    kind, text = row.get("Type", ""), row.get("Text", "").lower()
    if kind == "3" or "has joined the guild" in text:
        return "join"
    if kind == "4" or "has left the guild" in text or "was kicked from the guild" in text:
        return "exit"
    if kind == "5" or "guild rank is now" in text:
        return "rank"
    return "other"



def normalize_snapshot_event(event):
    """Return a clean event record from an existing snapshot, or None."""
    if not isinstance(event, dict):
        return None
    date = str(event.get("date", "")).strip()
    text = re.sub(r"\s+", " ", str(event.get("text", ""))).strip()
    kind = str(event.get("kind", "other")).strip().lower()
    if not date or not text:
        return None
    if kind not in {"join", "exit", "rank", "other"}:
        kind = "other"
    return {"date": date, "kind": kind, "text": text}


def normalize_snapshot_bank_event(event):
    """Return a clean bank entry from a prior snapshot, or None."""
    if not isinstance(event, dict):
        return None
    date = str(event.get("date", "")).strip()
    action = str(event.get("action", "")).strip().lower()
    if not date or action not in {"deposit", "withdraw"}:
        return None
    try:
        amount = abs(int(event.get("amount", 0)))
    except (TypeError, ValueError):
        return None
    return {
        "date": date,
        "player": re.sub(r"\s+", " ", str(event.get("player", ""))).strip(),
        "account": str(event.get("account", "")).strip(),
        "action": action,
        "category": str(event.get("category", "Other")).strip() or "Other",
        "item": re.sub(r"\s+", " ", str(event.get("item", ""))).strip(),
        "amount": amount,
    }


def main():
    roster_rows = read_csv(ROSTER_PATH)
    activity_rows = read_csv(ACTIVITY_PATH)
    bank_events = read_bank_log(BANK_LOG_PATH)
    if roster_rows and "Name" not in roster_rows[0]:
        raise SystemExit(f"{ROSTER_PATH.name} is missing the Name column.")
    if activity_rows and "Text" not in activity_rows[0]:
        raise SystemExit(f"{ACTIVITY_PATH.name} is missing the Text column.")

    # Carry forward the first verified account join date across snapshot refreshes.
    # This keeps a brief leave/rejoin from resetting the tenure milestone.
    account_join_dates = {}
    previous_events = []
    previous_bank_events = []
    if OUTPUT_PATH.exists():
        try:
            previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            account_join_dates = {
                str(account).strip().casefold(): date
                for account, date in previous.get("accountJoinDates", {}).items()
                if str(account).strip() and date
            }
            previous_events = previous.get("events", [])
            if not isinstance(previous_events, list):
                previous_events = []
            previous_bank_events = previous.get("bankEvents", [])
            if not isinstance(previous_bank_events, list):
                previous_bank_events = []
            for member in previous.get("roster", []):
                account = str(member.get("account", "")).strip().casefold()
                date = member.get("originalJoinDate") or member.get("joinDate")
                if account and date:
                    account_join_dates.setdefault(account, date)
        except (OSError, json.JSONDecodeError, AttributeError):
            account_join_dates = {}
            previous_events = []
            previous_bank_events = []

    account_current_dates = {}
    accounts = set()
    for row in roster_rows:
        account = row.get("Account", "").strip()
        key = account.casefold()
        if account:
            accounts.add(key)
            joined = parse_date(row.get("Guild join date", ""))
            if joined and (key not in account_current_dates or joined < account_current_dates[key]):
                account_current_dates[key] = joined
    for key, date in account_current_dates.items():
        account_join_dates.setdefault(key, date)

    members = []
    for row in roster_rows:
        account = row.get("Account", "").strip()
        key = account.casefold()
        match = re.match(r"^(\d+)", row.get("Guild Rank", ""))
        rank_order = int(match.group(1)) if match else 0
        members.append({
            "name": row.get("Name", "") or "Unknown",
            "account": account,
            "rank": RANK_NAMES.get(rank_order, row.get("Guild Rank", "") or "Unranked"),
            "rankOrder": rank_order,
            "class": row.get("Class", "") or "Unknown",
            "level": row.get("Level", ""),
            "comment": re.sub(r"\\s+", " ", html.unescape(
                re.sub(r"<[^>]*>", " ", row.get("_member_comment", ""))
            )).strip(),
            "joinDate": parse_date(row.get("Guild join date", "")),
            "originalJoinDate": account_join_dates.get(key),
            "lastOnline": parse_date(row.get("Last online date", "")),
            "onlineNow": bool(row.get("Location", "").strip()
                               and row.get("Location", "").strip().casefold() != "offline"),
            "leaveOfAbsence": bool(re.search(
                r"\b(?:loa|leave of absence|on leave|leave pass|approved leave)\b",
                " ".join(
                    [row.get(field, "") for field in (
                        "Member comments", "Status comments", "Officer comments"
                    )] + row.get("_raw_values", [])[9:]
                ),
                re.IGNORECASE,
            )),
        })

    events = []
    for row in activity_rows:
        date = parse_date(row.get("Time", ""))
        if not date:
            continue
        text = re.sub(r"\s+", " ", row.get("Text", "")).strip()
        events.append({"date": date, "kind": event_kind(row), "text": text})
    previous_keys = set()
    merged_events = {}
    for event in previous_events:
        normalized = normalize_snapshot_event(event)
        if normalized:
            key = (normalized["date"], normalized["kind"], normalized["text"].casefold())
            previous_keys.add(key)
            merged_events.setdefault(key, normalized)
    current_keys = set()
    for event in events:
        normalized = normalize_snapshot_event(event)
        if normalized:
            key = (normalized["date"], normalized["kind"], normalized["text"].casefold())
            current_keys.add(key)
            merged_events.setdefault(key, normalized)
    new_event_count = len(current_keys - previous_keys)
    events = sorted(merged_events.values(), key=lambda event: event["date"], reverse=True)

    merged_bank_events = {}
    previous_bank_keys = set()
    for event in previous_bank_events:
        normalized = normalize_snapshot_bank_event(event)
        if normalized:
            key = tuple(normalized[field] for field in ("date", "player", "account", "action", "category", "item", "amount"))
            previous_bank_keys.add(key)
            merged_bank_events.setdefault(key, normalized)
    current_bank_keys = set()
    for event in bank_events:
        normalized = normalize_snapshot_bank_event(event)
        if normalized:
            key = tuple(normalized[field] for field in ("date", "player", "account", "action", "category", "item", "amount"))
            current_bank_keys.add(key)
            merged_bank_events.setdefault(key, normalized)
    new_bank_count = len(current_bank_keys - previous_bank_keys)
    bank_events = sorted(merged_bank_events.values(), key=lambda event: event["date"], reverse=True)

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accountCount": len(accounts),
        "accountJoinDates": dict(sorted(account_join_dates.items())),
        "roster": members,
        "events": events,
        "bankEvents": bank_events,
    }
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}: {len(members)} characters, "
          f"{len(accounts)} unique accounts, {len(events)} retained activity records.")
    print(f"Bank activity: {len(bank_events)} retained records, {new_bank_count} new from this export.")
    print(f"Activity history: {new_event_count} new events added from this export.")


if __name__ == "__main__":
    main()
