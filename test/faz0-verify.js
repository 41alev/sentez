#!/usr/bin/env node
// Runs the Faz 0 bad-scenario suites (test/faz0-verify/*.js) as one regression
// package. Each file starts its own sandboxed server and exits non-zero on any
// FAIL/ERROR. Added to run-all on 26 Sep 2026 once every check was green, so
// the critical negative scenarios run in CI (T18).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const FILES = ['b1a-sales', 'b1b-stock', 'b2-purch-auth', 'b3-sweep', 'b4a-misc', 'b4b-crm', 'b4c-ops'];
let failed = 0;
for (const name of FILES) {
  console.log(`\n--- faz0-verify/${name} ---`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'faz0-verify', `${name}.js`)], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (e) {
    failed++;
    console.error(`✗ faz0-verify/${name} (exit ${e.status})`);
  }
}
if (failed) {
  console.error(`faz0-verify: ${failed} suite(s) failed`);
  process.exit(1);
}
console.log('faz0-verify: all suites passed');
