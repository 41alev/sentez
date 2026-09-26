#!/usr/bin/env node
/**
 * T17: builds the customer installation package.
 *
 *   npm run build && node scripts/package-release.js [--out <dir>]
 *
 * Produces <out>/dream-plus-<version>/ with only what a customer installation
 * needs (server, built frontend, install docs, container/proxy templates) and
 * a SHA256SUMS.txt manifest. It refuses to finish when the package would
 * contain secrets or customer data: .env, private keys, SQLite databases,
 * backups, uploads, test fixtures or development notes. Nothing is deleted
 * outside the chosen output directory, and an existing package directory is
 * never overwritten.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** Paths (relative to the repository) copied into the package. */
const INCLUDE = [
  'server', 'public', 'package.json', 'package-lock.json', '.npmrc', '.env.example', 'LICENSE',
  // The Dockerfile builds the frontend itself, so its sources travel along.
  'Dockerfile', 'docker-compose.yml', 'nginx.conf', '.dockerignore', 'frontend-react', 'scripts/build-frontend.js',
  'docs/KURULUM.md', 'docs/KULLANIM-KILAVUZU.md', 'docs/SAHA-KURULUM-KARTI.md',
  'docs/SAHA-KURULUM-COK-BASIT.md', 'docs/KVKK-DEGERLENDIRME.md'
];

/** Anything matching these never enters a package, even inside an included folder. */
const FORBIDDEN_NAME = [
  /^\.env$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /\.sqlite(-wal|-shm|-journal)?$/i, /\.db$/i, /\.bundle$/i,
  /^license-signing-key/i, /^lisans-.*\.json$/i, /^license\.json$/i
];
const FORBIDDEN_DIR = new Set(['node_modules', 'data', 'backups', 'uploads', 'test', 'test-results', '.git', '.claude']);
const SECRET_CONTENT = [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/];

/** @param {string[]} argv @returns {{ out?: string }} */
function parseArgs(argv) {
  /** @type {{ out?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

function walk(abs, rel, files) {
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic link refused: ${rel}`);
  if (stat.isDirectory()) {
    if (FORBIDDEN_DIR.has(path.basename(abs))) return;
    for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name), path.posix.join(rel, name), files);
    return;
  }
  if (FORBIDDEN_NAME.some(re => re.test(path.basename(abs)))) return;
  files.push(rel);
}

function assertClean(files, base) {
  const problems = [];
  for (const rel of files) {
    if (FORBIDDEN_NAME.some(re => re.test(path.basename(rel)))) problems.push(`${rel}: forbidden file`);
    const size = fs.statSync(path.join(base, rel)).size;
    if (size > 5 * 1024 * 1024) continue;
    const text = fs.readFileSync(path.join(base, rel), 'latin1');
    if (SECRET_CONTENT.some(re => re.test(text))) problems.push(`${rel}: contains a private key`);
  }
  if (problems.length) throw new Error('Paket sır/müşteri verisi içeriyor / Package would leak:\n  ' + problems.join('\n  '));
}

/** @param {{ out?: string }} [options] */
function packageRelease({ out } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!fs.existsSync(path.join(ROOT, 'public', 'dist'))) {
    throw new Error('public/dist yok; önce `npm run build` çalıştırın / Run npm run build first');
  }
  const outDir = path.resolve(out || path.join(ROOT, 'release'));
  const target = path.join(outDir, `dream-plus-${pkg.version}`);
  if (fs.existsSync(target)) throw new Error(`Hedef zaten var, üzerine yazılmaz / Target exists: ${target}`);

  const files = [];
  for (const item of INCLUDE) {
    const abs = path.join(ROOT, item);
    if (!fs.existsSync(abs)) throw new Error(`Paket girdisi eksik / Missing package input: ${item}`);
    walk(abs, item, files);
  }
  assertClean(files, ROOT);

  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
  let dirty = false;
  try { dirty = execFileSync('git', ['status', '--porcelain', '--', ...INCLUDE], { cwd: ROOT, encoding: 'utf8' }).trim() !== ''; } catch { /* not a git checkout */ }

  fs.mkdirSync(target, { recursive: true });
  const sums = [];
  for (const rel of files) {
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    sums.push(`${hash}  ${rel}`);
  }
  const info = {
    product: 'Dream Plus', version: pkg.version, commit, workingTreeDirty: dirty,
    createdAt: new Date().toISOString(), node: pkg.engines && pkg.engines.node, fileCount: files.length
  };
  fs.writeFileSync(path.join(target, 'RELEASE.json'), JSON.stringify(info, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  assertClean(files, target);
  return { target, ...info };
}

/** Re-hashes a package; returns the files whose content differs from SHA256SUMS.txt. */
function verifyRelease(dir) {
  const lines = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  const bad = [];
  for (const line of lines) {
    const [hash, rel] = line.split(/\s{2}/);
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs) || crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') !== hash) bad.push(rel);
  }
  return bad;
}

if (require.main === module) {
  try {
    const r = packageRelease(parseArgs(process.argv.slice(2)));
    console.log(`✓ Paket hazır / Package ready: ${r.target}`);
    console.log(`  Sürüm ${r.version} · commit ${r.commit}${r.workingTreeDirty ? ' (commit edilmemiş değişiklik içeriyor)' : ''} · ${r.fileCount} dosya`);
    console.log('  Müşteride: npm ci --omit=dev → .env hazırla → npm run setup → servis olarak başlat (docs/SAHA-KURULUM-KARTI.md)');
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exit(1);
  }
}

module.exports = { packageRelease, verifyRelease, FORBIDDEN_NAME, INCLUDE };
