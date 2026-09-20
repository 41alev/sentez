// Diagnostic only: records actual behavior in disposable synthetic data.
const path = require('node:path');
const fs = require('node:fs');
const { start, api, state } = require('../../../test/faz0-verify/lib');

(async () => {
  const findings = {};
  try {
    await start({ LOGIN_RATE_LIMIT: '10', API_RATE_LIMIT: '1000' });
    const db = state.db;
    const warehouse = db.prepare('SELECT id FROM warehouses WHERE is_active=1 LIMIT 1').get().id;
    db.prepare('INSERT INTO items(id,name,unit,created_at) VALUES(?,?,?,?)').run('audit-ncr-item', 'Synthetic NCR item', 'adet', 0);
    const lot = db.prepare('INSERT INTO stock_lots(id,item_id,warehouse_id,qty,status,unit_cost,received_at) VALUES(?,?,?,?,?,?,?)');
    lot.run('audit-bad', 'audit-ncr-item', warehouse, 5, 'rejected', 10, 1);
    lot.run('audit-good', 'audit-ncr-item', warehouse, 10, 'available', 10, 2);
    db.prepare('UPDATE items SET qty_cache=10 WHERE id=?').run('audit-ncr-item');
    db.prepare(`INSERT INTO ncrs(id,ncr_no,source,item_id,item_name,lot_id,qty_affected,severity,description,disposition,status,opened_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('audit-ncr', 'AUDIT-NCR', 'incoming', 'audit-ncr-item', 'Synthetic NCR item', 'audit-bad', 5, 'major', 'Synthetic diagnostic', 'pending', 'open', 0);
    const response = await api('POST', '/quality/ncrs/audit-ncr/disposition', { disposition: 'scrap' });
    findings.ncrScrap = { httpStatus: response.status,
      lots: db.prepare('SELECT id,qty,status FROM stock_lots WHERE item_id=? ORDER BY id').all('audit-ncr-item'),
      movements: db.prepare('SELECT lot_id,qty FROM movements WHERE item_id=?').all('audit-ncr-item') };

    const login = async (ip) => {
      const r = await fetch(state.base + '/api/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
        body: JSON.stringify({ username: 'synthetic-nonexistent-user', password: 'SyntheticWrongPassword123!' }) });
      return r.status;
    };
    const direct = [];
    for (let i = 0; i < 12; i++) direct.push(await login());
    const spoofed = [];
    for (let i = 1; i <= 4; i++) spoofed.push(await login('192.0.2.' + i));
    findings.directNodeRateLimit = { direct, spoofed, condition: 'Direct Node port; no nginx proxy. Production login limit 10.' };

    const uploads = path.join(state.sandbox.dir, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, 'synthetic-proof.txt'), 'synthetic document');
    const backup = await require('../../../server/scripts/backup').runBackup();
    findings.backup = { artifactType: path.extname(backup.file), entries: fs.readdirSync(path.dirname(backup.file)), uploadsIncluded: false,
      note: 'Directory inspection plus source inspection: only SQLite artifact produced.' };
    fs.writeFileSync(path.join(__dirname, 'reproduce-new.json'), JSON.stringify(findings, null, 2));
    console.log(JSON.stringify(findings, null, 2));
  } finally {
    if (state.db) state.db.close();
    if (state.proc && state.proc.exitCode === null) {
      await new Promise(resolve => { state.proc.once('exit', resolve); state.proc.kill(); });
    }
    if (state.sandbox) state.sandbox.cleanup();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
