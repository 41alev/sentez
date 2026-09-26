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
  // public/dist is built and tested before packaging. The customer Dockerfile
  // below consumes that output, so JSX/Vite development sources do not travel.
  'docker-compose.yml', 'nginx.conf', '.dockerignore',
  'docs/KURULUM.md', 'docs/KULLANIM-KILAVUZU.md', 'docs/SAHA-KURULUM-KARTI.md',
  'docs/SAHA-KURULUM-COK-BASIT.md', 'docs/KVKK-DEGERLENDIRME.md'
];

/** Repository files that are useful to developers/the vendor, never to a customer installation. */
const CUSTOMER_EXCLUDE = new Set([
  'server/scripts/demo.js',
  'server/scripts/license-generate.js',
  'server/seed.js',
  'server/types/better-sqlite3-shim.d.ts'
]);

const CUSTOMER_SCRIPTS = new Set([
  'start', 'migrate', 'backup', 'backup:full', 'restore', 'restore:full', 'setup', 'upgrade'
]);

const CUSTOMER_DOCKERFILE = `FROM node:22-slim AS dependencies

RUN apt-get update && apt-get install -y --no-install-recommends \\
      python3 make g++ ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY server/ ./server/
COPY public/ ./public/

RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
`;

/** Anything matching these never enters a package, even inside an included folder. */
const FORBIDDEN_NAME = [
  /^\.env(?!\.example$)(?:\..+)?$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
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
  if (CUSTOMER_EXCLUDE.has(rel)) return;
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

function writeCustomerManifests(target) {
  const packagePath = path.join(target, 'package.json');
  fs.chmodSync(packagePath, 0o644);
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!pkg.dependencies) throw new Error('package.json dependencies missing');
  pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([name]) => CUSTOMER_SCRIPTS.has(name)));
  delete pkg.devDependencies;
  // React is compiled into public/dist; customers do not need its packages at runtime.
  delete pkg.dependencies.react;
  delete pkg.dependencies['react-dom'];
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  // npm ci requires the root lockfile metadata to match package.json. Keep the
  // complete lock graph for deterministic installs but align its root entry.
  const lockPath = path.join(target, 'package-lock.json');
  fs.chmodSync(lockPath, 0o644);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const root = lock.packages && lock.packages[''];
  if (!root) throw new Error('package-lock.json root package metadata missing');
  if (!root.dependencies) throw new Error('package-lock.json root dependencies missing');
  delete root.devDependencies;
  delete root.dependencies.react;
  delete root.dependencies['react-dom'];
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

  fs.writeFileSync(path.join(target, 'Dockerfile'), CUSTOMER_DOCKERFILE);
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
  try { dirty = execFileSync('git', ['status', '--porcelain', '--', ...INCLUDE, 'scripts/package-release.js'], { cwd: ROOT, encoding: 'utf8' }).trim() !== ''; } catch { /* not a git checkout */ }

  fs.mkdirSync(target, { recursive: true });
  for (const rel of files) {
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  writeCustomerManifests(target);
  files.push('Dockerfile');

  const sums = files.sort().map(rel => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, rel))).digest('hex');
    return `${hash}  ${rel}`;
  });
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

module.exports = { packageRelease, verifyRelease, FORBIDDEN_NAME, INCLUDE, CUSTOMER_EXCLUDE, CUSTOMER_SCRIPTS };
