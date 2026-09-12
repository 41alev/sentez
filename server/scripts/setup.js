#!/usr/bin/env node
// @ts-nocheck
/**
 * İlk kurulum.
 *
 * Boş bir veritabanını çalışır hale getirir: firma kaydı, bir yönetici hesabı
 * ve en az bir depo. Demo verisi YÜKLEMEZ — bu kurulum gerçek kullanım içindir.
 *
 * İki şekilde çalışır:
 *   - Etkileşimli:  npm run setup
 *   - Parametreli:  npm run setup -- --company "X A.Ş." --admin-user mehmet \
 *                     --admin-pass 'Gucl3Sifre!' --warehouse "Merkez Depo"
 *
 * Parametreli mod kurulum otomasyonu içindir. Şifre parametreyle verilirse
 * kabuk geçmişine düşer; ortam değişkeni (ADMIN_PASSWORD) tercih edilmelidir.
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { runMigrations } = require('../migrate');
const { today } = require('../lib/dates');

/* ---------- Parametre ayrıştırma ---------- */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

/* ---------- Doğrulama ---------- */
/**
 * Şifre kuralı, uygulamanın kendi kuralıyla aynı olmalı. Kurulumda zayıf şifreye
 * izin verip sonra değiştirmeye zorlamak, çoğu kurulumda hiç değiştirilmeyen
 * bir yönetici şifresi bırakır.
 */
function passwordProblem(p) {
  if (!p || p.length < 8) return 'En az 8 karakter olmalı';
  if (!/[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(p)) return 'En az bir harf içermeli';
  if (!/[0-9]/.test(p)) return 'En az bir rakam içermeli';
  const weak = ['12345678', 'password', 'sifre123', 'admin123', 'qwerty123', 'Admin123!'];
  if (weak.some(w => p.toLowerCase() === w.toLowerCase())) return 'Bu şifre çok yaygın, başka bir şey seçin';
  return null;
}

function usernameProblem(u) {
  if (!u || u.trim().length < 3) return 'En az 3 karakter olmalı';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'Yalnızca harf, rakam, nokta, alt çizgi ve tire';
  return null;
}

/* ---------- Etkileşimli sorular ---------- */
function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question, { def = '', validate = null, secret = false } = {}) =>
    new Promise((resolve) => {
      const label = def ? `${question} [${def}]: ` : `${question}: `;

      const handle = (answer) => {
        const value = (answer || '').trim() || def;
        const problem = validate ? validate(value) : null;
        if (problem) {
          console.log(`  ✗ ${problem}`);
          return secret ? askSecret() : rl.question(label, handle);
        }
        resolve(value);
      };

      // Şifre yazılırken ekrana basılmamalı: omuz üstünden okunur
      const askSecret = () => {
        process.stdout.write(label);
        const onData = (char) => {
          const s = String(char);
          if (s === '\n' || s === '\r' || s === '\u0004') return;
          readline.moveCursor(process.stdout, -1, 0);
          process.stdout.write('*');
        };
        process.stdin.on('data', onData);
        rl.question('', (answer) => {
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          handle(answer);
        });
      };

      if (secret && process.stdin.isTTY) askSecret();
      else rl.question(label, handle);
    });

  return { ask, close: () => rl.close() };
}

/* ---------- Kurulum ---------- */
async function setup(args) {
  console.log('\n╭─────────────────────────────────────────╮');
  console.log('│  Depo Takip ERP — Kurulum               │');
  console.log('╰─────────────────────────────────────────╯\n');

  runMigrations({ silent: true });

  const existing = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (existing > 0 && !args.force) {
    console.error('Bu veritabanında zaten kullanıcı var — kurulum yapılmış görünüyor.');
    console.error('Yeniden kurmak isterseniz önce yedek alın ve --force kullanın.\n');
    console.error('  npm run backup');
    console.error('  npm run setup -- --force\n');
    process.exit(1);
  }

  const interactive = !args.company && process.stdin.isTTY;
  let company, adminUser, adminPass, warehouse, currency, taxNo;

  if (interactive) {
    const { ask, close } = createPrompt();
    console.log('Firma bilgileri\n');
    company = await ask('Firma unvanı', { validate: v => v.length < 2 ? 'Unvan gerekli' : null });
    taxNo = await ask('Vergi / VKN numarası (isteğe bağlı)', { def: '' });
    currency = await ask('Ana para birimi (TRY/USD/EUR)', {
      def: 'TRY',
      validate: v => ['TRY', 'USD', 'EUR'].includes(v.toUpperCase()) ? null : 'TRY, USD veya EUR'
    });
    console.log('\nYönetici hesabı\n');
    adminUser = await ask('Kullanıcı adı', { def: 'admin', validate: usernameProblem });
    adminPass = await ask('Şifre', { secret: true, validate: passwordProblem });
    const again = await ask('Şifre (tekrar)', { secret: true });
    if (again !== adminPass) { console.error('\n✗ Şifreler eşleşmedi.\n'); close(); process.exit(1); }
    console.log('\nDepo\n');
    warehouse = await ask('İlk deponun adı', { def: 'Merkez Depo' });
    close();
  } else {
    company = args.company;
    taxNo = args['tax-no'] || '';
    currency = (args.currency || 'TRY').toUpperCase();
    adminUser = args['admin-user'] || 'admin';
    // Şifreyi ortam değişkeninden almak, kabuk geçmişine düşmesini önler
    adminPass = process.env.ADMIN_PASSWORD || args['admin-pass'];
    warehouse = args.warehouse || 'Merkez Depo';

    const problems = [
      !company && 'Firma unvanı gerekli (--company)',
      usernameProblem(adminUser) && `Kullanıcı adı: ${usernameProblem(adminUser)}`,
      !adminPass && 'Şifre gerekli (ADMIN_PASSWORD ortam değişkeni veya --admin-pass)',
      adminPass && passwordProblem(adminPass) && `Şifre: ${passwordProblem(adminPass)}`
    ].filter(Boolean);

    if (problems.length) {
      console.error('Kurulum yapılamadı:\n');
      problems.forEach(p => console.error('  ✗ ' + p));
      console.error('\nÖrnek:\n  ADMIN_PASSWORD=\'Gucl3Sifre!\' npm run setup -- \\');
      console.error('    --company "Örnek Metal A.Ş." --admin-user mehmet --warehouse "Merkez Depo"\n');
      process.exit(1);
    }
  }

  /* Tek transaction: yarım kurulum, hiç kurulmamış olmaktan kötüdür */
  db.txImmediate(() => {
    db.prepare(`INSERT INTO companies (name, tax_no, base_currency, country_code)
      VALUES (?,?,?, 'TR')`).run(company, taxNo || null, currency);

    const hash = bcrypt.hashSync(adminPass, 12);
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active,
        approval_limit, created_at) VALUES (?,?,?, 'admin', 1, 0, ?)`)
      .run(adminUser, hash, adminUser, Date.now());

    db.prepare(`INSERT INTO warehouses (company_id, code, name, is_active)
      VALUES (1, 'D1', ?, 1)`).run(warehouse);

    // Kurulum günü kuru: tarihsel kur tablosu boş kalırsa dövizli işlem yapılamaz
    db.prepare(`INSERT OR IGNORE INTO exchange_rates (currency, rate, rate_date, source, created_at)
      VALUES (?,1,?, 'setup', ?)`).run(currency, today(), Date.now());

    const setS = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    setS.run('baseCurrency', currency);
    setS.run('lowStockCheckEnabled', '1');
    setS.run('defaultVatRate', '20');
    // e-Belge kapsam dışı: kapalı başlar
    setS.run('einvoiceEnabled', '0');
    setS.run('setupCompletedAt', String(Date.now()));
  });

  // WAL'ı diske indirip bağlantıyı kapat. Açık kalan WAL dosyası, sonraki
  // yükseltmeye "sunucu çalışıyor" gibi görünür ve yükseltmeyi engeller.
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}

  console.log('\n✓ Kurulum tamamlandı.\n');
  console.log(`  Firma:     ${company}`);
  console.log(`  Yönetici:  ${adminUser}`);
  console.log(`  Depo:      ${warehouse}`);
  console.log(`  Para birimi: ${currency}\n`);
  console.log('Sırada:\n');
  console.log('  1. npm start          — sunucuyu başlatın');
  console.log('  2. Giriş yapın ve Yönetim > Belge Şablonları\'ndan logonuzu yükleyin');
  console.log('  3. Yönetim > Veri Aktarımı\'ndan Excel verilerinizi aktarın');
  console.log('     (sıra: tedarikçiler → ürünler → açılış stoğu → reçeteler)');
  console.log('  4. Yönetim > Kullanıcılar\'dan diğer kullanıcıları tanımlayın\n');
  console.log('  Kurulum sonrası ilk yedeği alın:  npm run backup\n');
}

if (require.main === module) {
  setup(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch(e => { console.error('\n✗ Kurulum başarısız:', e.message, '\n'); process.exit(1); });
}

module.exports = { setup, passwordProblem, usernameProblem, parseArgs };
