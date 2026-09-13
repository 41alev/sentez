// @ts-nocheck
const express = require('express');
const net = require('net');
const db = require('../db');
const { AppError, getSetting } = require('../lib/core');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { buildLabelZpl } = require('../lib/zpl');

const router = express.Router();
router.use(requireAuth);

const WRITE = requirePermission('stock.write');

function itemLabelData(id) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!row) throw new AppError('Ürün bulunamadı / Item not found', 404);
  const lines = [{ label: 'Birim', value: row.unit || '—' }];
  if (row.category) lines.push({ label: 'Kategori', value: row.category });
  return {
    title: row.name,
    code: row.code || '',
    barcodeData: row.barcode || row.code || row.id,
    lines
  };
}

function lotLabelData(id) {
  const row = db.prepare(`SELECT sl.*, i.name AS item_name, i.code AS item_code, i.unit AS unit
    FROM stock_lots sl JOIN items i ON i.id = sl.item_id WHERE sl.id = ?`).get(id);
  if (!row) throw new AppError('Parti bulunamadı / Lot not found', 404);
  const lines = [{ label: 'Miktar', value: `${row.qty} ${row.unit || ''}`.trim() }];
  if (row.lot_no) lines.unshift({ label: 'Parti No', value: row.lot_no });
  if (row.expiry_date) lines.push({ label: 'SKT', value: row.expiry_date });
  return {
    title: row.item_name,
    code: row.item_code || '',
    barcodeData: row.lot_no || row.id,
    lines
  };
}

function labelDataFor(type, id) {
  return type === 'lot' ? lotLabelData(id) : itemLabelData(id);
}

/* ============================ ZPL ÖNİZLEME / İNDİRME ============================ */
// Görüntüleme/indirme herkese açık (herhangi bir yetkili oturuma), gerçek yazdırma
// (ağ yazıcısına gönderim, tüketim malzemesi harcar) stock.write gerektirir.

router.get('/item/:id/zpl', (req, res) => {
  const zpl = buildLabelZpl(itemLabelData(req.params.id));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="etiket-${req.params.id}.zpl"`);
  res.send(zpl);
});

router.get('/lot/:id/zpl', (req, res) => {
  const zpl = buildLabelZpl(lotLabelData(req.params.id));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="etiket-${req.params.id}.zpl"`);
  res.send(zpl);
});

/* ============================ AĞ YAZICISINA GÖNDERİM ============================ */

/**
 * Ağdaki bir Zebra yazıcıya ham ZPL gönderir (fabrika ayarı "raw port" 9100).
 * Tarayıcı ham TCP soketi açamadığı için gönderim sunucu tarafında yapılır.
 * Bağlantı kurulamazsa/zaman aşımına uğrarsa AÇIKÇA hata verir — "gönderildi"
 * sanıp aslında hiçbir şey basılmamış olması, depo operatörünü yanıltır.
 */
function sendToPrinter(ip, port, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(reject, new AppError('Yazıcıya bağlanılamadı (zaman aşımı) / Printer connection timed out', 502));
    }, 4000);
    socket.connect(port, ip, () => {
      socket.end(data, 'utf8');
    });
    socket.on('close', () => finish(resolve));
    socket.on('error', (e) => finish(reject, new AppError(`Yazıcıya bağlanılamadı: ${e.message} / Printer connection failed`, 502)));
  });
}

const printSchema = z.object({
  type: z.enum(['item', 'lot']),
  id: z.string().min(1).max(200),
  copies: z.coerce.number().int().min(1).max(50).default(1)
});

router.post('/print', WRITE, validate(printSchema), async (req, res, next) => {
  try {
    const { type, id, copies } = req.valid;
    const ip = (getSetting('labelPrinterIp') || '').trim();
    if (!ip) throw new AppError('Etiket yazıcısı ayarlanmamış (Yönetim > Ayarlar) / Label printer not configured (Admin > Settings)', 400);
    const port = Number(getSetting('labelPrinterPort')) || 9100;

    const zpl = buildLabelZpl({ ...labelDataFor(type, id), copies });
    await sendToPrinter(ip, port, zpl);
    res.json({ ok: true, copies });
  } catch (e) { next(e); }
});

module.exports = router;
