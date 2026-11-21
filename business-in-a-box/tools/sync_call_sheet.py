# Sync the Doorkeep Call Sheet (a private Claude artifact) with leads/leads.csv.
# Creates new leads, and on existing leads changes only contact fields, readiness, priority and generated drafts.
# It never touches stage, touches, log, myNotes or next, which the user edits on their phone.
# Usage: python3 sync_call_sheet.py <db_snapshot_dir> <out_dir>
#   <db_snapshot_dir>/leads/<id>.json  from an ArtifactData list with out_dir; versions.json maps id -> version
# Then apply <out_dir>/writes.json with one ArtifactData batch (updates are pinned with if_version).
import csv, json, re, sys
from pathlib import Path

LEADS_CSV = Path(__file__).resolve().parent.parent / "leads" / "leads.csv"
TZ = {'TX': 'America/Chicago', 'IL': 'America/Chicago', 'LA': 'America/Chicago', 'MO': 'America/Chicago', 'TN': 'America/Chicago',
      'MN': 'America/Chicago', 'CO': 'America/Denver', 'OH': 'America/New_York', 'VA': 'America/New_York', 'NC': 'America/New_York', 'OR': 'America/Los_Angeles'}
SIG = "\n\n[your name], Doorkeep\n[postal address]\nReply \u201cno thanks\u201d and I won\u2019t email again."
PITCH_A = ("I set up branded box offices for independent venues: your domain, your Stripe account, one all-in price that\u2019s still lower for your fans. "
           "You\u2019d keep about $1.05 a ticket. No monthly fee: I earn 75\u00a2 only when you sell, and it\u2019s live in 7 days.")

snap_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
versions = json.loads((snap_dir / 'versions.json').read_text()) if (snap_dir / 'versions.json').exists() else {}
current = {}
for f in (snap_dir / 'leads').glob('*.json'):
    j = json.loads(f.read_text())
    doc_id = j.get('id') or f.stem
    current[doc_id] = {'data': j.get('data', j), 'version': j.get('version') or versions.get(doc_id)}

def first(name):
    return (name or '').split()[0] if (name or '').strip() else ''

def a_draft(r):
    who = first(r['decision_maker_name']) or 'there'
    v = r['name']
    return {'subject': f'your Eventbrite fees at {v}',
            'body': f"Hi {who}, fans buying tickets to your shows at {v} pay Eventbrite’s fees on top. On a $25 ticket that’s about $3.50, and none of it reaches {v}.\n\n" + PITCH_A + "\n\nWant me to run the numbers on your last month of shows? Takes 10 minutes." + SIG,
            'check': 'Swap in a real upcoming show and check the ticket price before sending.'}

def d_draft(r):
    who = first(r['decision_maker_name']) or 'there'
    return {'subject': f"tickets at {r['name']}",
            'body': f"Hi {who}, I saw you sell tickets on your own site. That’s great. I help independent venues add the tools a basic checkout lacks: phone check-in at the door, waitlists and presales that run themselves, and ad pixels that can see ticket sales. You can also add a small booking fee that stays with the house.\n\nIt’s live in 7 days with no monthly fee. Worth 10 minutes?" + SIG}

writes, summary = [], []
for r in csv.DictReader(open(LEADS_CSV, newline='')):
    lid = r['lead_id']
    m = re.search(r'\b([A-Z]{2})\b', r['metro'] or '')
    fields = {'email': r['email'], 'emailType': r['email_type'], 'contactName': r['decision_maker_name'],
              'contactTitle': r['decision_maker_title'], 'readiness': r['status'], 'priority': int(r['priority'])}
    if lid not in current:                                   # new lead: full document
        doc = {'name': r['name'], 'metro': re.sub(r'\s*\(.*\)$', '', r['metro'] or ''), 'list': r['list'], 'type': r['type'],
               'stage': 'new', 'phone': r['phone'], 'website': r['website'], 'evidenceUrl': r['evidence_url'],
               'platform': r['ticketing_platform'], 'volume': r['volume_signal'], 'notes': r['notes'], 'pitch': r['pitch'],
               'tz': TZ.get(m.group(1), 'America/Chicago') if m else 'America/Chicago', 'touches': {}, 'log': [],
               'createdAt': '2026-11-21T09:30:00Z', **fields}
        if r['status'] == 'ready':
            doc['draft'] = d_draft(r) if r['list'] == 'D' else a_draft(r)
        p = out_dir / f'{lid}.json'; p.write_text(json.dumps(doc, ensure_ascii=False))
        writes.append({'op': 'set', 'collection': 'leads', 'doc_id': lid, 'file_path': str(p)})
        summary.append(f'NEW {lid} {r["name"]} ({r["status"]}, {r["email_type"]})')
        continue
    cur = current[lid]['data']
    patch = {k: v for k, v in fields.items() if cur.get(k) != v}
    # Drafts are generated text, not user fields: add or personalise one when a lead gained an email or a name.
    d = dict(cur.get('draft') or {})
    who = first(r['decision_maker_name'])
    if r['email'] and not d.get('body') and r['status'] == 'ready':
        nd = d_draft(r) if r['list'] == 'D' else a_draft(r)
        d.update({'subject': nd['subject'], 'body': nd['body']}); patch['draft'] = d
    elif who and d.get('body') and re.match(r'^Hi (there|\[first name\]),', d['body']):
        d['body'] = re.sub(r'^Hi (there|\[first name\]),', f'Hi {who},', d['body']); patch['draft'] = d
    if patch:
        if not current[lid]['version']:
            sys.exit(f'No version for {lid}: add it to versions.json before writing')
        p = out_dir / f'{lid}.patch.json'; p.write_text(json.dumps(patch, ensure_ascii=False))
        writes.append({'op': 'update', 'collection': 'leads', 'doc_id': lid, 'file_path': str(p), 'if_version': current[lid]['version']})
        summary.append(f'UPDATE {lid} {r["name"]}: ' + ', '.join(sorted(patch)))
json.dump(writes, open(out_dir / 'writes.json', 'w'))
print('\n'.join(summary) or 'no changes'); print(len(writes), 'writes')
