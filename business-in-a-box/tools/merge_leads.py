# Merge Doorkeep lead files into one ranked call list.
# Inputs (git-ignored, in ../leads/): sample-leads.csv (first batch), batch2-*.csv (later batches).
# Output: ../leads/leads.csv, sorted by priority. Run: python3 merge_leads.py
import csv, re, sys
from pathlib import Path

LEADS = Path(__file__).resolve().parent.parent / "leads"
KEEP_FROM_SAMPLE = {"L1", "L2", "L3"}   # Speakeasy (L4) and The Maison (L5) dropped at checkpoint 2
FIELDS = ["priority", "lead_id", "list", "pitch", "name", "metro", "type", "google_rating", "google_reviews", "phone",
          "website", "ticketing_platform", "evidence_url", "volume_signal", "decision_maker_name", "decision_maker_title",
          "email", "email_type", "email_status", "linkedin_url", "maps_url", "address", "notes", "score"]
PITCH = {
    "A": "Leave Eventbrite: fans pay less, you keep ~$1.05/ticket, no monthly fee",
    "E": "Promoter on Eventbrite: same pitch, your own branded box office for every show",
    "B": "Leave your current platform: fans pay less (see research/platform-fees.md), you keep ~$1.05/ticket",
    "D": "Upgrade your own-site checkout: door check-in, waitlists, pixels, plus a booking fee you keep",
}
LIST_WEIGHT = {"A": 3, "E": 3, "B": 2, "D": 1}
EMAIL_WEIGHT = {"verified-decision-maker": 3, "verified-person": 3, "generic-from-website": 1}   # a reachable decision-maker matters most

def first_int(text):
    m = re.search(r"\d+", text or "")
    return int(m.group()) if m else 0

rows = []
sample = LEADS / "sample-leads.csv"
if sample.exists():
    for r in csv.DictReader(sample.open(newline="")):
        if r["lead_id"] in KEEP_FROM_SAMPLE:
            rows.append({"lead_id": r["lead_id"], "list": "A", "name": r["venue"], "metro": r["metro"], "type": r["venue_type"],
                         "google_rating": r["google_rating"], "google_reviews": r["google_reviews"], "phone": r["phone"],
                         "website": r["website"], "ticketing_platform": r["ticketing_platform"],
                         "evidence_url": r["eventbrite_evidence_url"], "volume_signal": r["upcoming_events_seen"],
                         "decision_maker_name": r["decision_maker_name"], "decision_maker_title": r["decision_maker_title"],
                         "email": r["email"], "email_type": r["email_type"], "email_status": r["email_status"],
                         "linkedin_url": r["linkedin_url"], "maps_url": r["maps_url"], "address": r["address"], "notes": r["notes"]})
for f in sorted(LEADS.glob("batch2-*.csv")):
    if "screened-out" in f.name:
        continue
    for r in csv.DictReader(f.open(newline="")):
        rows.append({k: r.get(k, "") for k in FIELDS if k not in ("priority", "pitch", "score")})

seen, merged = set(), []
for r in rows:
    key = (r.get("website") or r.get("name") or "").lower().rstrip("/")
    if key in seen:
        print("duplicate skipped:", r.get("name"), file=sys.stderr)
        continue
    seen.add(key)
    lst = (r.get("list") or "").strip().upper()
    r["list"] = lst
    r["pitch"] = PITCH.get(lst, "")
    r["score"] = LIST_WEIGHT.get(lst, 0) + EMAIL_WEIGHT.get(r.get("email_type", ""), 0) + min(first_int(r.get("volume_signal")), 20) / 10   # crude: first number in the volume note
    merged.append(r)

merged.sort(key=lambda r: -r["score"])
for i, r in enumerate(merged, 1):
    r["priority"], r["score"] = i, f"{r['score']:.1f}"
out = LEADS / "leads.csv"
with out.open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(merged)
print(f"wrote {out} with {len(merged)} leads")
for r in merged:
    print(f"{r['priority']:>2}. [{r['list']}] {r['name']} ({r['metro']}) | {r['email_type'] or 'no email'} | {r['volume_signal'][:40]}")
