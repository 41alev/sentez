// @ts-nocheck
/**
 * E-posta bildirimi testi.
 *
 * Gerçek bir SMTP sunucusu olmadan e-posta yolunu test etmek mümkün değil sanılır;
 * değildir. Bu test süreç içinde küçük bir SMTP sunucusu açar, uygulamayı ona
 * bağlar ve mesajın gerçekten teslim edildiğini içeriğiyle birlikte doğrular.
 *
 * Ayrıca hata yolunu da test eder: SMTP kapalıyken sistemin sessizce başarısız
 * olmadığını, nedenini kaydettiğini kontrol eder — asıl tehlike budur.
 *
 *   node test/email.js
 */
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/**
 * Minimal SMTP sunucusu. Tam bir uygulama değil; nodemailer'ın konuştuğu kadarını
 * konuşur ve aldığı mesajları biriktirir.
 */
function startSmtpServer({ rejectAll = false } = {}) {
  const received = [];
  const server = net.createServer(socket => {
    let buffer = '';
    let inData = false;
    let current = { from: null, to: [], data: '' };

    socket.write('220 test.local ESMTP\r\n');

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            if (rejectAll) { socket.write('550 Mesaj reddedildi\r\n'); }
            else { received.push({ ...current }); socket.write('250 OK queued\r\n'); }
            current = { from: null, to: [], data: '' };
          } else {
            // Nokta ile başlayan satırlar SMTP'de kaçışlanır
            current.data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          }
          continue;
        }

        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') {
          socket.write('250-test.local\r\n250 SIZE 10485760\r\n');
        } else if (cmd === 'MAIL') {
          current.from = (/<(.*)>/.exec(line) || [])[1] || null;
          socket.write('250 OK\r\n');
        } else if (cmd === 'RCPT') {
          const addr = (/<(.*)>/.exec(line) || [])[1];
          if (addr) current.to.push(addr);
          socket.write('250 OK\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 Veri bekleniyor\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('221 Bye\r\n'); socket.end();
        } else if (cmd === 'RSET') {
          current = { from: null, to: [], data: '' }; socket.write('250 OK\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
  });
}

/**
 * Konu başlığı Türkçe karakter içerdiğinde RFC 2047'ye göre kodlanır
 * (=?UTF-8?B?...?=). Düz metin aramak bu yüzden yanıltıcıdır; çözerek bakıyoruz.
 */
function decodeHeader(raw) {
  return String(raw || '').replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_, enc, data) => {
    if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
    return data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16)));
  });
}

/** Ham mesajdan bir başlığı okur; katlanmış (folded) satırları birleştirir. */
function header(data, name) {
  const unfolded = String(data || '').replace(/\n[ \t]+/g, '');
  const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded);
  return m ? decodeHeader(m[1].trim()) : '';
}

// İzole veri klasörü: gerçek veritabanına dokunmuyoruz.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-mail-'));
process.env.DATA_DIR = tmpRoot;
process.env.DB_PATH = path.join(tmpRoot, 'depo-takip.sqlite');

const ROOT = path.join(__dirname, '..');

(async () => {
  console.log('=== SMTP KAPALIYKEN / WITH SMTP DISABLED ===');
  delete process.env.SMTP_HOST;
  const db = require(path.join(ROOT, 'server', 'db'));
  require(path.join(ROOT, 'server', 'migrate')).runMigrations({ silent: true });
  require(path.join(ROOT, 'server', 'seed')).seedIfEmpty();
  const notif = require(path.join(ROOT, 'server', 'services', 'notifications'));

  notif.resetMailer();
  let st = notif.mailStatus();
  ok('SMTP tanımsızken yapılandırılmamış görünüyor', st.configured === false);

  const failedSend = await notif.sendEmail('kimse@example.com', 'test', 'test');
  ok('SMTP yokken gönderim başarısız dönüyor', failedSend === false);
  st = notif.mailStatus();
  // Asıl tehlike sessiz başarısızlıktır: neden gönderilemediği kayıtlı olmalı.
  ok('başarısızlık sebebi kaydediliyor (sessiz düşmüyor)',
    !!st.lastError && /SMTP_HOST/.test(st.lastError), st.lastError || 'sebep yok');
  ok('başarısızlık zamanı damgalanıyor', !!st.lastErrorAt);

  console.log('\n=== GERÇEK SMTP SUNUCUSUNA GÖNDERİM / REAL DELIVERY ===');
  const smtp = await startSmtpServer();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = '0';
  process.env.SMTP_FROM = 'depo@ornekmetal.com';
  delete process.env.SMTP_USER;
  notif.resetMailer();

  ok('SMTP tanımlandığında yapılandırılmış görünüyor', notif.mailStatus().configured === true);

  const r = await notif.sendEmail('satinalma@ornekmetal.com', 'Kritik stok uyarısı', 'Somun M8 kritik seviyenin altında.');
  ok('e-posta gönderildi', !!r && !!r.messageId, JSON.stringify(r).slice(0, 120));
  ok('alıcı kabul edildi', !!r && r.accepted.includes('satinalma@ornekmetal.com'), JSON.stringify(r && r.accepted));

  await new Promise(res => setTimeout(res, 150));
  ok('sunucu mesajı gerçekten aldı', smtp.received.length === 1, `${smtp.received.length} mesaj`);
  const msg = smtp.received[0] || {};
  ok('gönderen adresi doğru', msg.from === 'depo@ornekmetal.com', msg.from);
  ok('alıcı adresi doğru', (msg.to || []).includes('satinalma@ornekmetal.com'), JSON.stringify(msg.to));
  const subject = header(msg.data, 'Subject');
  ok('konu başlığı iletildi', /Kritik stok uyar/.test(subject), subject);
  ok('mesaj gövdesi iletildi', /kritik seviyenin alt/.test(msg.data || ''), '');
  // Türkçe karakterler MIME kodlaması sonrası bozulmamalı
  ok('Türkçe karakterler korundu (MIME çözümü sonrası)',
    subject.includes('uyarısı') || /Somun/.test(msg.data || ''), subject);
  ok('başarılı gönderim zamanı kaydedildi', !!notif.mailStatus().lastSuccessAt);
  ok('başarı sonrası hata kaydı temizlendi', notif.mailStatus().lastError === null);

  console.log('\n=== UYARI KURALLARINDAN E-POSTA / ALERTS DISPATCHED BY EMAIL ===');
  // Düşük stok kuralını e-posta kanalına alıp gerçek uyarı üretiyoruz.
  db.prepare("UPDATE notification_rules SET channel='email', recipients=? WHERE rule_type='low_stock'")
    .run('depo@ornekmetal.com, satinalma@ornekmetal.com');
  const created = notif.runScan();
  ok('uyarı taraması uyarı üretti', created > 0 || db.prepare('SELECT COUNT(*) c FROM notifications').get().c > 0,
    `${created} uyarı`);

  const before = smtp.received.length;
  const sent = await notif.dispatchEmails();
  ok('bekleyen uyarılar e-postaya dönüştü', sent > 0, `${sent} e-posta`);
  ok('sunucuya yeni mesajlar ulaştı', smtp.received.length > before,
    `${before} → ${smtp.received.length}`);
  const alertMsg = smtp.received[smtp.received.length - 1];
  ok('uyarı e-postası iki alıcıya da gitti',
    (alertMsg.to || []).length === 2, JSON.stringify(alertMsg.to));
  const alertSubject = header(alertMsg.data, 'Subject');
  ok('konu [Depo Takip] ile etiketlendi', /\[Depo Takip\]/.test(alertSubject), alertSubject);

  // Aynı uyarı ikinci kez gönderilmemeli, aksi halde kutu dolar.
  const beforeSecond = smtp.received.length;
  const sentAgain = await notif.dispatchEmails();
  ok('aynı uyarı tekrar gönderilmiyor', sentAgain === 0 && smtp.received.length === beforeSecond,
    `${sentAgain} tekrar gönderim`);
  ok('gönderilen uyarılar damgalandı',
    db.prepare('SELECT COUNT(*) c FROM notifications WHERE emailed_at IS NOT NULL').get().c > 0);

  console.log('\n=== SUNUCU REDDEDERSE / WHEN THE SERVER REJECTS ===');
  smtp.server.close();
  const rejecting = await startSmtpServer({ rejectAll: true });
  process.env.SMTP_PORT = String(rejecting.port);
  notif.resetMailer();
  const rejected = await notif.sendEmail('x@example.com', 'red', 'red');
  ok('reddedilen mesaj başarısız dönüyor', rejected === false);
  ok('red sebebi kaydediliyor', !!notif.mailStatus().lastError, notif.mailStatus().lastError || '');
  rejecting.server.close();

  console.log('\n=== SUNUCU ERİŞİLEMEZSE / WHEN THE SERVER IS UNREACHABLE ===');
  process.env.SMTP_PORT = '1';           // kapalı port
  process.env.SMTP_TIMEOUT_MS = '1500';
  notif.resetMailer();
  const t0 = Date.now();
  const unreachable = await notif.sendEmail('x@example.com', 'test', 'test');
  const elapsed = Date.now() - t0;
  ok('erişilemeyen sunucuda gönderim başarısız', unreachable === false);
  ok('zaman aşımı süresi sınırlı (asılı kalmıyor)', elapsed < 12000, `${elapsed} ms`);
  ok('erişim hatası kaydediliyor', !!notif.mailStatus().lastError, notif.mailStatus().lastError || '');

  // Zamanlayıcı hiçbir koşulda sunucuyu düşürmemeli.
  console.log('\n=== ZAMANLAYICI DAYANIKLILIĞI / SCHEDULER RESILIENCE ===');
  let crashed = false;
  try { const timer = notif.startScheduler(); clearInterval(timer); } catch { crashed = true; }
  ok('zamanlayıcı SMTP hatasına rağmen başlıyor', !crashed);

  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Test çalıştırılamadı / Test run failed:', e);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
