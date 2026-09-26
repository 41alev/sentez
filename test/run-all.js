#!/usr/bin/env node
// @ts-nocheck
/**
 * Tüm test paketlerini, her biri kendi taze veritabanıyla, tek tek çalıştırır.
 *
 * Paketler durum değiştiren gerçek işlemler yapar (bkz. README). Art arda
 * aynı veritabanı üzerinde zincirlenirlerse birbirini kirletirler — ör.
 * import.js'nin bıraktığı 1000 test satırı, data-health.js'nin "tohum veri
 * temiz" beklentisini bozar; e2e.js'nin tükettiği tek muayene kaydı,
 * ui-smoke.js'nin açmayı beklediği diyaloğu bulamaz hale getirir. Bu script,
 * sunucu gerektiren her paket için ayrı OS geçici dizini oluşturur, taze
 * migration+seed ile sunucuyu ayağa kaldırır, YALNIZCA o paketi çalıştırır,
 * sonra kapatır — CI'da ve yerelde her zaman aynı, güvenilir sonucu verir.
 *
 *   node test/run-all.js
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const { createSandbox } = require('./helpers/sandbox');

const ROOT = path.join(__dirname, '..');

// Sunucu gerektiren paketler (README: "Sunucu ayaktayken").
const SERVER_SUITES = [
  'e2e', 'contract', 'import', 'templates',
  'data-health', 'planning', 'ui-smoke', 'security', 'load',
  'multitenancy', 'accounting-export', 'labels', 'webhooks', 'openapi', 'crm', 'pivot', 'support', 'visits', 'kvkk',
  'approval-limit', 'concurrency-races', 'search', 'release-hardening', 'stock-integrity', 'finance-integrity', 'invoice-settlement', 'planning-integrity', 'pilot-flow'
];
// Sunucu gerektirmez — kendi geçici durumunu kendi kurar/söker.
const STANDALONE_SUITES = ['visual-audit', 'backup-restore', 'email', 'barcode', 'dates', 'sandbox-safety', 'maintenance-safety', 'proxy-rate-limit', 'release-package'];
// Kendi izole geçici dizinlerini kullanır (execFileSync ile alt süreç açar),
// ana data/ klasörüne hiç dokunmaz.
const CHILD_ISOLATED_SUITES = ['setup-upgrade', 'license', 'faz0-verify'];

function waitForServer(proc, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timed out')), timeoutMs);
    proc.once('error', err => { clearTimeout(timer); reject(err); });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
    proc.on('message', msg => {
      if (msg.type === 'listening' && Number.isInteger(msg.port)) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${msg.port}`);
      }
    });
  });
}

// load.js kasıtlı olarak binlerce istek/sn üretir (eşzamanlı doğruluk testi
// içindir, hız sınırlayıcıyı test etmek için değil — o ayrı bir alt teste
// aittir: "başarısız giriş denemeleri sınırlanıyor"). Varsayılan
// API_RATE_LIMIT (300/dk) ile çalıştırılırsa okuma/yazma testlerinin
// neredeyse tamamı 429 alır ve paket anlamsızlaşır.
const SUITE_ENV_OVERRIDES = {
  load: { API_RATE_LIMIT: '200000' },
  // webhooks.js otomatik yeniden deneme kuyruğunun GERÇEKTEN çalıştığını
  // kanıtlamak için process-retry-queue'yu tetikliyor — varsayılan 60sn'lik
  // ilk gecikmeyle test dakikalarca beklerdi.
  webhooks: { WEBHOOK_RETRY_BASE_MS: '50', WEBHOOK_ALLOW_PRIVATE: '1' }
};

function startServer(name, env) {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, ...(SUITE_ENV_OVERRIDES[name] || {}) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
}

function stopServer(proc) {
  return new Promise((resolve, reject) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('Test server did not stop; temporary data retained')), 15000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill();
  });
}

async function runServerSuite(name) {
  const sandbox = createSandbox();
  const proc = startServer(name, sandbox.env);
  let serverOutput = '';
  proc.stdout.on('data', d => { serverOutput += d; });
  proc.stderr.on('data', d => { serverOutput += d; });

  let base;
  try {
    base = await waitForServer(proc);
  } catch (e) {
    await stopServer(proc);
    sandbox.cleanup();
    return { name, ok: false, error: `sunucu ayağa kalkmadı: ${e.message}\n${serverOutput.slice(-500)}` };
  }

  let ok = true, error = null;
  try {
    execFileSync(process.execPath, [`test/${name}.js`], { cwd: ROOT, stdio: 'inherit', env: { ...sandbox.env, BASE: base } });
  } catch (e) {
    ok = false;
    error = `çıkış kodu ${e.status}`;
  }
  await stopServer(proc);
  sandbox.cleanup();
  return { name, ok, error };
}

function runStandaloneSuite(name) {
  let ok = true, error = null;
  try {
    execFileSync(process.execPath, [`test/${name}.js`], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    ok = false;
    error = `çıkış kodu ${e.status}`;
  }
  return { name, ok, error };
}

(async () => {
  const results = [];
  const selected = process.argv.slice(2);
  const all = [...SERVER_SUITES, ...STANDALONE_SUITES, ...CHILD_ISOLATED_SUITES];
  if (selected.some(name => !all.includes(name))) throw new Error('Unknown test suite');
  const include = name => !selected.length || selected.includes(name);

  for (const name of SERVER_SUITES.filter(include)) {
    console.log(`\n\n########## ${name} (izole, taze veritabanı) ##########`);
    results.push(await runServerSuite(name));
  }
  for (const name of [...STANDALONE_SUITES, ...CHILD_ISOLATED_SUITES].filter(include)) {
    console.log(`\n\n########## ${name} ##########`);
    results.push(runStandaloneSuite(name));
  }

  console.log('\n\n==================== ÖZET / SUMMARY ====================');
  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.error ? ' — ' + r.error : ''}`);
    if (!r.ok) allOk = false;
  }
  console.log('==========================================================');
  process.exit(allOk ? 0 : 1);
})().catch(err => { console.error(err); process.exitCode = 1; });
