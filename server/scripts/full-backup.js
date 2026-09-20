// @ts-nocheck
/** Database plus uploaded documents. A bundle is a directory so no archive
 * dependency or extraction path traversal is needed. Keep it on the same
 * filesystem as its backup directory; copy the entire directory off-site. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
if (require.main === module) require('dotenv').config({ quiet: true });
const { acquireMaintenanceLock } = require('../lib/maintenance-lock');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'depo-takip.sqlite');
const uploadDir = process.env.UPLOAD_DIR || path.join(dataDir, 'uploads');
const backupDir = process.env.BACKUP_DIR || path.join(dataDir, 'backups');
function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
const safeName = name => /^[a-zA-Z0-9._-]+$/.test(name) && name !== '.' && name !== '..';

function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error('Uploads path must be a real directory');
  return fs.readdirSync(dir).sort().map(name => {
    const source = path.join(dir, name);
    if (!safeName(name) || !fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) {
      throw new Error(`Unsafe upload entry: ${name}`);
    }
    return name;
  });
}

function checkDatabase(file) {
  const source = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (source.pragma('integrity_check', { simple: true }) !== 'ok' || source.pragma('foreign_key_check').length) {
      throw new Error('Database integrity/foreign-key check failed');
    }
    const references = source.prepare('SELECT DISTINCT file_path FROM documents WHERE file_path IS NOT NULL').all();
    return references.map(row => row.file_path);
  } finally { source.close(); }
}

/** Only returns a bundle when every referenced upload exists and checksums agree. */
async function runFullBackup({ keep = Number(process.env.BACKUP_KEEP || 14), dir = backupDir,
  label = '' } = {}) {
  const db = require('../db');
  if (!Number.isInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP must be a positive integer');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = label ? '-' + String(label).replace(/[^a-z0-9-]/gi, '') : '';
  const target = path.join(dir, `depo-takip-${stamp}${suffix}.bundle`);
  const stage = fs.mkdtempSync(path.join(dir, '.backup-stage-'));
  try {
    const sqlite = path.join(stage, 'database.sqlite');
    await db.backup(sqlite);
    // A copied WAL-mode database opened by a reader may create -wal/-shm
    // companions. Close the snapshot as a single-file DELETE-mode database.
    const snapshot = new Database(sqlite);
    try { snapshot.pragma('journal_mode = DELETE'); } finally { snapshot.close(); }
    const references = checkDatabase(sqlite);
    const uploads = path.join(stage, 'uploads');
    fs.mkdirSync(uploads);
    const entries = [];
    for (const name of filesIn(uploadDir)) {
      const source = path.join(uploadDir, name);
      const dest = path.join(uploads, name);
      fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
      entries.push({ name, size: fs.statSync(dest).size, sha256: sha256(dest) });
    }
    for (const ref of references) {
      if (!safeName(ref) || !entries.some(entry => entry.name === ref)) {
        throw new Error(`Backup missing document upload: ${String(ref).slice(0, 100)}`);
      }
    }
    const manifest = { format: 'dream-full-backup', version: 1, createdAt: new Date().toISOString(),
      database: { size: fs.statSync(sqlite).size, sha256: sha256(sqlite) }, uploads: entries };
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const verified = verifyFullBackup(stage);
    if (!verified.ok) throw new Error(`Full backup verification failed: ${verified.error}`);
    fs.renameSync(stage, target);

    const routine = fs.readdirSync(dir).filter(name => /^depo-takip-[0-9TZ-]+\.bundle$/.test(name))
      .map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const removed = [];
    for (const { name } of routine.slice(keep)) {
      fs.rmSync(path.join(dir, name), { recursive: true });
      removed.push(name);
    }
    // Existing off-site hook takes a path, including a directory. Operators
    // must use an off-site command that copies directories recursively.
    const { runOffsiteSync } = require('./backup');
    const offsite = await runOffsiteSync(target);
    return { file: target, manifest, removed, offsite };
  } catch (e) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

function verifyFullBackup(bundle) {
  const result = { file: bundle, ok: false, error: null };
  try {
    if (!fs.existsSync(bundle) || !fs.lstatSync(bundle).isDirectory() || fs.lstatSync(bundle).isSymbolicLink()) throw new Error('Bundle directory missing');
    const root = fs.readdirSync(bundle).sort();
    if (JSON.stringify(root) !== JSON.stringify(['database.sqlite', 'manifest.json', 'uploads'])) throw new Error(`Unexpected/missing bundle entry: ${root.join(', ')}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
    if (manifest.format !== 'dream-full-backup' || manifest.version !== 1 || !Array.isArray(manifest.uploads)) throw new Error('Unsupported manifest');
    const sqlite = path.join(bundle, 'database.sqlite');
    if (!fs.lstatSync(sqlite).isFile() || fs.lstatSync(sqlite).isSymbolicLink() ||
        fs.statSync(sqlite).size !== manifest.database.size || sha256(sqlite) !== manifest.database.sha256) throw new Error('Database checksum mismatch');
    const names = filesIn(path.join(bundle, 'uploads'));
    if (names.length !== manifest.uploads.length || new Set(manifest.uploads.map(e => e.name)).size !== names.length) throw new Error('Upload list mismatch');
    for (const entry of manifest.uploads) {
      if (!safeName(entry.name) || !names.includes(entry.name)) throw new Error('Unsafe/missing upload');
      const file = path.join(bundle, 'uploads', entry.name);
      if (fs.statSync(file).size !== entry.size || sha256(file) !== entry.sha256) throw new Error(`Upload checksum mismatch: ${entry.name}`);
    }
    const references = checkDatabase(sqlite);
    if (references.some(name => !names.includes(name))) throw new Error('A referenced document is missing');
    result.ok = true;
    result.manifest = manifest;
  } catch (e) { result.error = e.message; }
  return result;
}

/** Offline operation: stage and verify first, retain both old DB and files. */
function restoreFullBackup(bundle, { destinationDb = dbPath, destinationUploads = uploadDir } = {}) {
  const release = acquireMaintenanceLock(destinationDb);
  let stage;
  try {
    const v = verifyFullBackup(bundle);
    if (!v.ok) throw new Error(`Full backup rejected: ${v.error}`);
    if (fs.existsSync(destinationDb + '-wal') && fs.statSync(destinationDb + '-wal').size) throw new Error('Nonempty WAL; stop the server and complete recovery');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbSafety = `${destinationDb}.pre-restore-${stamp}`;
    const uploadSafety = `${destinationUploads}.pre-restore-${stamp}`;
    fs.mkdirSync(path.dirname(destinationDb), { recursive: true });
    fs.mkdirSync(path.dirname(destinationUploads), { recursive: true });
    stage = fs.mkdtempSync(path.join(path.dirname(destinationDb), '.restore-stage-'));
    const stagedDb = path.join(stage, 'database.sqlite');
    const stagedUploads = path.join(stage, 'uploads');
    fs.copyFileSync(path.join(bundle, 'database.sqlite'), stagedDb);
    fs.mkdirSync(stagedUploads);
    for (const name of filesIn(path.join(bundle, 'uploads'))) {
      fs.copyFileSync(path.join(bundle, 'uploads', name), path.join(stagedUploads, name));
    }
    if (sha256(stagedDb) !== v.manifest.database.sha256 || v.manifest.uploads.some(entry =>
      sha256(path.join(stagedUploads, entry.name)) !== entry.sha256)) throw new Error('Staged copy checksum mismatch');

    let oldDb = false, oldUploads = false, newDb = false, newUploads = false;
    const sidecars = [];
    try {
      if (fs.existsSync(destinationDb)) { fs.renameSync(destinationDb, dbSafety); oldDb = true; }
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(destinationDb + ext)) {
          fs.renameSync(destinationDb + ext, dbSafety + ext);
          sidecars.push(ext);
        }
      }
      if (fs.existsSync(destinationUploads)) { fs.renameSync(destinationUploads, uploadSafety); oldUploads = true; }
      fs.renameSync(stagedDb, destinationDb); newDb = true;
      fs.renameSync(stagedUploads, destinationUploads); newUploads = true;
      if (sha256(destinationDb) !== v.manifest.database.sha256) throw new Error('Restored database checksum mismatch');
    } catch (e) {
      if (newUploads) fs.renameSync(destinationUploads, stagedUploads);
      if (newDb) fs.renameSync(destinationDb, stagedDb);
      if (oldUploads) fs.renameSync(uploadSafety, destinationUploads);
      if (oldDb) fs.renameSync(dbSafety, destinationDb);
      for (const ext of sidecars) fs.renameSync(dbSafety + ext, destinationDb + ext);
      throw e;
    }
    return { restored: bundle, safetyCopy: oldDb ? dbSafety : null,
      uploadSafetyCopy: oldUploads ? uploadSafety : null, verification: v };
  } finally {
    if (stage && fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    release();
  }
}

if (require.main === module) {
  const [mode, file] = process.argv.slice(2);
  (async () => {
    if (mode === '--verify') {
      const result = verifyFullBackup(file);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } else if (mode === '--restore') {
      console.log(JSON.stringify(restoreFullBackup(file), null, 2));
    } else if (!mode) {
      console.log(JSON.stringify(await runFullBackup(), null, 2));
    } else throw new Error('Usage: full-backup.js [--verify bundle | --restore bundle]');
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { runFullBackup, verifyFullBackup, restoreFullBackup };
