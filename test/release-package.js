#!/usr/bin/env node
// T17: the customer package contains the runtime and install docs only —
// never secrets, customer data, tests or development notes — and its
// checksum manifest detects tampering. Standalone: node test/run-all.js release-package
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packageRelease, verifyRelease } = require('../scripts/package-release');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-plus-release-'));
try {
  const r = packageRelease({ out });
  const list = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name), sub = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) walk(abs, sub); else list.push(sub);
    }
  })(r.target, '');
  for (const required of ['server/index.js', 'public/index.html', 'package.json', '.env.example',
    'docs/KURULUM.md', 'docs/SAHA-KURULUM-KARTI.md', 'RELEASE.json', 'SHA256SUMS.txt']) {
    assert(list.includes(required), 'missing ' + required);
  }
  assert(list.some(f => f.startsWith('public/dist/')), 'built frontend missing');
  const leaked = list.filter(f => /(^|\/)\.env$|\.pem$|\.sqlite|license-signing-key|^data\/|^test\/|node_modules|PROJECT_STATUS|CLAUDE\.md|AGENTS\.md|satis-denetimi|analiz-2026/i.test(f));
  assert.deepEqual(leaked, [], 'package leaks: ' + leaked.join(', '));
  assert.deepEqual(verifyRelease(r.target), []);
  console.log(`✓ package has ${r.fileCount} files; no secrets, data, tests or internal notes; manifest verifies`);

  fs.appendFileSync(path.join(r.target, 'server', 'index.js'), '\n// tampered\n');
  assert.deepEqual(verifyRelease(r.target), ['server/index.js']);
  assert.throws(() => packageRelease({ out }), /Target exists/);
  console.log('✓ tampering is detected; an existing package is never overwritten');

  // A private key dropped into an included folder blocks packaging.
  const trap = path.join(__dirname, '..', 'server', 'lib', 'zz-release-test-key.txt');
  fs.writeFileSync(trap, '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI\n-----END PRIVATE KEY-----\n');
  try {
    assert.throws(() => packageRelease({ out: path.join(out, 'second') }), /private key/);
  } finally {
    fs.rmSync(trap, { force: true });
  }
  console.log('✓ a private key inside the package inputs stops packaging');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
console.log('release-package: all checks passed');
