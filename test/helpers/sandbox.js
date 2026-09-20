const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Each run owns one temporary directory; caller paths are never deleted. */
function createSandbox() {
  const parent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, 'dream-plus-test-'));
  const token = crypto.randomUUID();
  const marker = path.join(dir, '.test-owner');
  fs.writeFileSync(marker, token, { flag: 'wx' });
  const env = {
    ...process.env, NODE_ENV: 'test', DATA_DIR: dir,
    DB_PATH: path.join(dir, 'test.sqlite'), UPLOAD_DIR: path.join(dir, 'uploads'),
    BACKUP_DIR: path.join(dir, 'backups'), JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    DEMO_DATA: '1', DISABLE_JOBS: '1', LICENSE_FILE: '', BACKUP_OFFSITE_CMD: '',
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', PORT: '0'
  };
  function cleanup() {
    if (!fs.existsSync(dir)) return;
    const resolved = fs.realpathSync(dir);
    if (resolved !== dir || path.dirname(resolved) !== parent ||
        !path.basename(resolved).startsWith('dream-plus-test-') ||
        fs.lstatSync(marker).isSymbolicLink() || fs.readFileSync(marker, 'utf8') !== token) {
      throw new Error('Refusing to remove an unowned test directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
  return { dir, env, cleanup };
}

module.exports = { createSandbox };
