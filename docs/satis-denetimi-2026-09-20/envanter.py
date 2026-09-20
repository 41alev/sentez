"""Read-only inventory; never reads secrets, customer data or dependencies."""
from pathlib import Path
import csv
import hashlib
import json
import re
from collections import Counter

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SKIP_DIRS = {'.git', 'node_modules', 'data', 'dist', 'test-results', 'playwright-report', 'results', '__pycache__'}
TEXT = {'.js', '.jsx', '.ts', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.conf', '.py', '.xml', '.csv', '.txt', '.webmanifest', '.log'}
rows = []
excluded = []

def visit(folder):
    for p in sorted(folder.iterdir()):
        rel = p.relative_to(ROOT).as_posix()
        if p.is_symlink():
            excluded.append({'path': rel, 'reason': 'symlink not followed'})
            continue
        if p.is_dir():
            if p.name in SKIP_DIRS or p == OUT:
                excluded.append({'path': rel, 'reason': 'generated/dependency/private data/audit output'})
            else:
                visit(p)
            continue
        secret = (p.name == '.npmrc' or (p.name.startswith('.env') and p.name != '.env.example')
                  or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.db'})
        row = {'path': rel, 'bytes': p.stat().st_size, 'lines': '', 'sha256': '', 'scope': '', 'ts_nocheck': '', 'route_definitions': '', 'transactions': '', 'innerHTML': '', 'legacy_path_mentions': ''}
        if secret:
            row['scope'] = 'private: metadata only; contents not read'
        elif p.suffix.lower() in TEXT or p.name in {'LICENSE', 'Dockerfile', '.gitignore', '.dockerignore', '.env.example'}:
            raw = p.read_bytes()
            content = raw.decode('utf-8-sig', errors='replace')
            row.update(lines=len(content.splitlines()), sha256=hashlib.sha256(raw).hexdigest(),
                       scope='full-file inventory/static scan; not a line-by-line correctness proof',
                       ts_nocheck=content.count('@ts-nocheck'),
                       route_definitions=len(re.findall(r'router\.(?:get|post|put|patch|delete)\(', content)),
                       transactions=len(re.findall(r'\b(?:txImmediate|transaction)\(', content)),
                       innerHTML=content.count('innerHTML'),
                       legacy_path_mentions=content.count('C:\\Erp'))
        else:
            row['scope'] = 'binary/other: metadata only'
        rows.append(row)

visit(ROOT)
with (OUT / 'DOSYA-ENVANTERI.csv').open('w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
summary = {'project': str(ROOT), 'files': len(rows), 'text_files_scanned': sum(bool(r['sha256']) for r in rows),
           'lines_scanned': sum(r['lines'] or 0 for r in rows),
           'ts_nocheck_occurrences': sum(r['ts_nocheck'] or 0 for r in rows),
           'scope_counts': dict(Counter(r['scope'] for r in rows)), 'excluded_directories': excluded}
(OUT / 'kanitlar' / 'envanter-ozeti.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in summary.items() if k != 'excluded_directories'}, ensure_ascii=False, indent=2))
