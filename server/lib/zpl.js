// @ts-nocheck
/**
 * ZPL (Zebra Programming Language) etiket üreticisi.
 *
 * Bu modül yalnızca ZPL komut metnini üretir; yazıcıya gönderimi
 * server/routes/labels.js yapar (ham TCP soket, port 9100 — ZPL
 * yazıcılarının fabrika ayarı "raw port" dinleme yöntemi, ayrı bir
 * sürücü/ajan gerektirmez).
 *
 * 203 dpi (8 nokta/mm), masaüstü Zebra yazıcılarının (GK420, ZD420 vb.)
 * en yaygın çözünürlüğüdür ve mevcut belge şablonu sistemindeki 100×70mm
 * "label" kağıt boyutuyla eşleşecek şekilde varsayılan seçildi
 * (bkz. server/migrations/005_templates.js).
 */

const DPI = 203;
const mmToDots = (mm) => Math.round(mm * DPI / 25.4);

/** ZPL alan verisinde `^`, `~`, `\` kontrol karakterleri kaçışlanmalı, aksi halde komut sanılırlar. */
function escZpl(s) {
  return String(s ?? '').replace(/\\/g, '\\5C').replace(/\^/g, '\\5E').replace(/~/g, '\\7E');
}

/**
 * Bir ürün/parti etiketi için ZPL komut metni üretir.
 *
 * @param {object} p
 * @param {string} p.title        Üst satır (ürün adı)
 * @param {string} [p.code]       Ürün kodu (varsa, başlığın altında)
 * @param {string} p.barcodeData  Barkod alanına kodlanacak veri (barkod veya parti no)
 * @param {{label:string, value:string}[]} [p.lines]  Ek satırlar (parti no, miktar, SKT, vb.)
 * @param {number} [p.widthMm]    Etiket genişliği (mm), varsayılan 100
 * @param {number} [p.heightMm]   Etiket yüksekliği (mm), varsayılan 70
 * @param {number} [p.copies]     Kaç kopya basılacağı (^PQ), varsayılan 1
 */
function buildLabelZpl({ title, code, barcodeData, lines = [], widthMm = 100, heightMm = 70, copies = 1 }) {
  if (!barcodeData) throw new Error('barcodeData gerekli / barcodeData is required');
  const w = mmToDots(widthMm);
  const h = mmToDots(heightMm);
  const margin = mmToDots(3);
  const out = [];
  let y = margin;

  out.push('^XA');
  out.push('^CI28'); // UTF-8 — Türkçe karakterler (ı ş ğ ü ö ç) doğru basılsın
  out.push(`^PW${w}`);
  out.push(`^LL${h}`);

  out.push(`^FO${margin},${y}^A0N,32,32^FB${w - 2 * margin},2,0,L,0^FD${escZpl(title)}^FS`);
  y += mmToDots(11);

  if (code) {
    out.push(`^FO${margin},${y}^A0N,20,20^FD${escZpl(code)}^FS`);
    y += mmToDots(6.5);
  }

  for (const line of lines) {
    out.push(`^FO${margin},${y}^A0N,20,20^FD${escZpl(line.label)}: ${escZpl(line.value)}^FS`);
    y += mmToDots(6.5);
  }

  // Barkod: kalan alanın altına; en az 12mm yükseklik, taşarsa etiket sonuna kadar
  const barHeight = Math.max(mmToDots(12), h - y - mmToDots(4) - margin);
  out.push(`^FO${margin},${y}^BY2,2,${barHeight}`);
  out.push(`^BCN,${barHeight},Y,N,N`);
  out.push(`^FD${escZpl(barcodeData)}^FS`);

  out.push(`^PQ${Math.max(1, Math.min(999, Math.round(copies) || 1))}`);
  out.push('^XZ');
  return out.join('\n');
}

module.exports = { buildLabelZpl, escZpl, mmToDots, DPI };
