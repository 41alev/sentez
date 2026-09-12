#!/usr/bin/env node
/**
 * Tüm test paketlerini, her biri kendi taze veritabanıyla, tek tek çalıştırır.
 *
 * Paketler durum değiştiren gerçek işlemler yapar (bkz. README). Art arda
 * aynı veritabanı üzerinde zincirlenirlerse birbirini kirletirler — ör.
 * import.js'nin bıraktığı 1000 test satırı, data-health.js'nin "tohum veri
 * temiz" beklentisini bozar; e2e.js'nin tükettiği tek muayene kaydı,
 * ui-smoke.js'nin açmayı beklediği diyaloğu bulamaz hale getirir. Bu script,
 * sunucu gerektiren her paket için data/ klasörünü sıfırlar, taze
 * migration+seed ile sunucuyu ayağa kaldırır, YALNIZCA o paketi çalıştırır,
 * sonra kapatır — CI'da ve yerelde her zaman aynı, güvenilir sonucu verir.
 *
 *   node test/run-all.js
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const HEALTH_URL = 'http://localhost:3000/health';

// Sunucu gerektiren paketler (README: "Sunucu ayaktayken").
const SERVER_SUITES = [
  'e2e', 'contract', 'import', 'templates', 'mobile',
  'data-health', 'einvoice', 'planning', 'ui-smoke', 'security', 'load'
];
// Sunucu gerektirmez — kendi geçici durumunu kendi kurar/söker.
const STANDALONE_SUITES = ['visual-audit', 'backup-restore', 'email', 'barcode'];
// Kendi izole geçici dizinlerini kullanır (execFileSync ile alt süreç açar),
// ana data/ klasörüne hiç dokunmaz.
const CHILD_ISOLATED_SUITES = ['setup-upgrade'];

function wipeData() {
  // Windows: az önce durdurulan sunucunun dosya tanıtıcısı bazen bir iki
  // taramadan (AV) dolayı hemen serbest kalmayabilir; kısa bir yeniden
  // deneme bunu tolere eder.
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      const until = Date.now() + 250 * (i + 1);
      while (Date.now() < until) { /* kısa bekleme */ }
    }
  }
}

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(HEALTH_URL).then(r => {
        if (r.ok) resolve(); else scheduleRetry();
      }).catch(scheduleRetry);
    };
    const scheduleRetry = () => {
      if (Date.now() > deadline) { reject(new Error('sunucu zaman aşımında ayağa kalkmadı')); return; }
      setTimeout(tick, 300);
    };
    tick();
  });
}

// load.js kasıtlı olarak binlerce istek/sn üretir (eşzamanlı doğruluk testi
// içindir, hız sınırlayıcıyı test etmek için değil — o ayrı bir alt teste
// aittir: "başarısız giriş denemeleri sınırlanıyor"). Varsayılan
// API_RATE_LIMIT (300/dk) ile çalıştırılırsa okuma/yazma testlerinin
// neredeyse tamamı 429 alır ve paket anlamsızlaşır.
const SUITE_ENV_OVERRIDES = {
  load: { API_RATE_LIMIT: '200000' }
};

function startServer(name) {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, DEMO_DATA: '1', ...(SUITE_ENV_OVERRIDES[name] || {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function stopServer(proc) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    proc.kill();
    setTimeout(finish, 3000); // güvenlik: kapanmazsa yine de devam et
  });
}

async function runServerSuite(name) {
  wipeData();
  const proc = startServer(name);
  let serverOutput = '';
  proc.stdout.on('data', d => { serverOutput += d; });
  proc.stderr.on('data', d => { serverOutput += d; });

  try {
    await waitForHealth();
  } catch (e) {
    await stopServer(proc);
    return { name, ok: false, error: `sunucu ayağa kalkmadı: ${e.message}\n${serverOutput.slice(-500)}` };
  }

  let ok = true, error = null;
  try {
    execFileSync(process.execPath, [`test/${name}.js`], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    ok = false;
    error = `çıkış kodu ${e.status}`;
  }
  await stopServer(proc);
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

  for (const name of SERVER_SUITES) {
    console.log(`\n\n########## ${name} (izole, taze veritabanı) ##########`);
    results.push(await runServerSuite(name));
  }
  for (const name of [...STANDALONE_SUITES, ...CHILD_ISOLATED_SUITES]) {
    console.log(`\n\n########## ${name} ##########`);
    results.push(runStandaloneSuite(name));
  }

  wipeData(); // son çalıştırmanın kalıntısını bırakma

  console.log('\n\n==================== ÖZET / SUMMARY ====================');
  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.error ? ' — ' + r.error : ''}`);
    if (!r.ok) allOk = false;
  }
  console.log('==========================================================');
  process.exit(allOk ? 0 : 1);
})();
