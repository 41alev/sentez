// @ts-nocheck
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const pino = require('pino');

const { runMigrations } = require('./migrate');
const db = require('./db');
const { AppError } = require('./lib/core');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined
});

// Schema is brought up to date before anything serves traffic.
runMigrations({ silent: false });

/**
 * Demo verisi ASLA kendiliğinden yüklenmez.
 *
 * Eskiden boş bir veritabanıyla başlayan her kurulum örnek firmayı, sahte
 * müşterileri ve şifresi belgelerde yazan beş demo kullanıcıyı alıyordu.
 * Bir fabrikada bu hem anlamsız veri hem de açık bir güvenlik deliğidir.
 *
 * Artık: demo verisi yalnızca DEMO_DATA=1 ile gelir. Üretimde boş veritabanı
 * bulunursa sunucu başlamaz ve kurulum scriptine yönlendirir — sessizce
 * çalışmaya başlayıp kimsenin giremediği bir sistem bırakmaktansa açıkça durur.
 */
const userCount = require('./db').prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  if (process.env.DEMO_DATA === '1') {
    require('./seed').seedIfEmpty();
  } else {
    console.error('\n  Veritabanı boş — henüz kurulum yapılmamış.');
    console.error('  Database is empty — setup has not been run.\n');
    console.error('  Kurulum / Setup:   npm run setup');
    console.error('  Demo verisi / Demo data:   DEMO_DATA=1 npm start\n');
    process.exit(1);
  }
}

const app = express();
// Sunucu teknolojisini duyurmak saldırgana bedava bilgi verir.
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// CORS: locked to configured origins in production, permissive in development.
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(
  allowedOrigins.length
    ? { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true }
    : {}
));

// Baseline security headers (no external dependency needed for these).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  // İçerik Güvenliği Politikası: yazı tipleri ve Chart.js CDN'den geldiği için
  // o kaynaklara izin verilir, geri kalan her şey kapalıdır. CDN'leri kendi
  // sunucunuzdan servis ederseniz bu listeyi 'self' ile daraltabilirsiniz.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "media-src 'self' blob:",           // barkod okuma için kamera akışı
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  if (process.env.FORCE_HTTPS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Correlation ID: bir isteği tüm loglar boyunca uçtan uca izleyebilmek için.
// Yukarı akış (ör. bir ters vekil) zaten bir kimlik koymuşsa onu korur;
// yoksa üretir. Yanıt header'ına da yazılır ki istemci hata bildirirken
// paylaşabilsin.
app.use((req, res, next) => {
  req.id = req.get('X-Request-Id') || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Request logging with duration, so slow endpoints are visible in production.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = { requestId: req.id, method: req.method, url: req.originalUrl, status: res.statusCode, ms, user: req.user?.username };
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.debug(line);
  });
  next();
});

// Kaba kuvvete karşı koruma: yalnızca BAŞARISIZ denemeler sayılır.
// Tüm girişleri saymak, tek bir internet çıkışı arkasındaki bir fabrikada sabah
// mesai başlangıcında herkesi dışarıda bırakır — saldırgan değil, çalışanlar engellenir.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT || 10),
  skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Çok fazla başarısız giriş denemesi, lütfen bekleyin / Too many failed login attempts, please wait' }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT || 300),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Çok fazla istek / Too many requests' }
});

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

// ---------- Routes ----------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/production', require('./routes/production'));
app.use('/api/purchasing', require('./routes/purchasing'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/quality', require('./routes/quality'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/edocs', require('./routes/edocs'));
app.use('/api/planning', require('./routes/planning'));
app.use('/api/import', require('./routes/import'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/mobile', require('./routes/mobile'));
app.use('/api/data-health', require('./routes/data-health'));
app.use('/api/accounting', require('./routes/accounting'));
app.use('/api/labels', require('./routes/labels'));
app.use('/api', require('./routes/admin'));   // users, warehouses, settings, fx, rules, audit

// ---------- Health ----------
app.get('/health', (req, res) => {
  try {
    const r = db.prepare('SELECT COUNT(*) c FROM users').get();
    const pending = require('./migrate').pendingMigrations().length;
    res.json({
      status: 'ok', uptimeSec: Math.round(process.uptime()),
      db: 'connected', users: r.c, pendingMigrations: pending,
      version: require('../package.json').version, ts: Date.now()
    });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'unavailable', message: e.message });
  }
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------- 404 for unknown API routes ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Uç nokta bulunamadı / Endpoint not found' }));

// ---------- Central error handler ----------
app.use((err, req, res, next) => {
  if (err instanceof AppError || err.status) {
    const body = { error: err.message, requestId: req.id };
    // Domain errors can carry structured detail (e.g. which material is short)
    ['shortfall', 'shortfalls', 'details', 'creditLimit', 'outstanding', 'orderTotal'].forEach(k => {
      if (err[k] !== undefined) body[k] = err[k];
    });
    return res.status(err.status || 400).json(body);
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Dosya çok büyük (maks 20MB) / File too large (max 20MB)', requestId: req.id });
  }
  logger.error({ requestId: req.id, err: err.message, stack: err.stack, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: 'Sunucu hatası / Server error', requestId: req.id });
});

// ---------- Background jobs ----------
if (process.env.DISABLE_JOBS !== '1') {
  require('./services/notifications').startScheduler();
  require('./scripts/backup').startBackupScheduler();
}

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Depo Takip ERP çalışıyor / running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  logger.info(`${signal} alındı, kapatılıyor / shutting down`);
  server.close(() => { try { db.close(); } catch (e) {} process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
