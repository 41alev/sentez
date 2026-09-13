/**
 * Excel aktarım motoru.
 *
 * Tasarım kararları:
 *
 * 1. **İki aşama.** Önce doğrula ve sakla (`preview`), kullanıcı gördükten sonra
 *    yaz (`commit`). Doğrulamadan yazmak, binlerce hatalı kaydı temizlemek demektir.
 *
 * 2. **Satır bazlı hata.** Tek bir hatalı satır tüm dosyayı reddetmez; hangi satırda
 *    ne olduğu ayrı ayrı bildirilir. Gerçek dosyalarda her zaman birkaç bozuk satır olur.
 *
 * 3. **Esnek sütun eşleştirme.** Kullanıcının başlıkları "Ürün Adı", "urun adi",
 *    "ITEM NAME" olabilir. Büyük/küçük harf, Türkçe karakter ve boşluk farkı
 *    yüzünden dosya reddedilmemeli.
 *
 * 4. **Geri alınabilirlik.** Aktarılan kayıtlar parti kimliğiyle işaretlenir;
 *    yanlış dosya tek işlemle geri alınabilir.
 */
const ExcelJS = require('exceljs');
const db = require('../db');
const { AppError, uuid, nextNumber } = require('../lib/core');

/* ============================ BAŞLIK ETİKETLERİ ============================ */

/**
 * Şablonda kullanılan Türkçe başlıklar. Eşleştirme bunları da tanımak zorundadır:
 * aksi halde sistemin kendi ürettiği şablon geri yüklenemez.
 */
const HEADERS = {
  name: 'Ad', code: 'Kod', barcode: 'Barkod', category: 'Kategori', unit: 'Birim',
  itemType: 'Ürün Tipi', origin: 'Menşei', minStock: 'Kritik Stok', reorderQty: 'Sipariş Miktarı',
  salePrice: 'Satış Fiyatı', vatRate: 'KDV %', location: 'Raf/Konum', shelfLife: 'Raf Ömrü (gün)',
  description: 'Açıklama', supplierCode: 'Tedarikçi Kodu', procurementType: 'Tedarik Şekli',
  safetyStock: 'Emniyet Stoğu',
  contactPerson: 'İlgili Kişi', phone: 'Telefon', email: 'E-posta', address: 'Adres',
  country: 'Ülke', taxNo: 'Vergi No', currency: 'Para Birimi',
  paymentTermsDays: 'Ödeme Vadesi (gün)', leadTimeDays: 'Tedarik Süresi (gün)',
  incoterm: 'Incoterm', creditLimit: 'Kredi Limiti',
  itemCode: 'Ürün Kodu', warehouse: 'Depo', qty: 'Miktar', unitCost: 'Birim Maliyet',
  lotNo: 'Parti No', expiryDate: 'Son Kullanma Tarihi',
  componentCode: 'Bileşen Kodu', qtyPerUnit: 'Birim Başına Miktar', scrapPct: 'Fire %',
  capacityUnits: 'Paralel İstasyon', hourlyRate: 'Saatlik Maliyet',
  efficiencyPct: 'Verimlilik %', downtimePct: 'Planlı Duruş %',
  operationNo: 'Operasyon No', operationName: 'Operasyon Adı', workCenterCode: 'İş Merkezi Kodu',
  setupMinutes: 'Hazırlık (dk)', runMinutesPerUnit: 'Birim Süre (dk)', queueMinutes: 'Bekleme (dk)'
};

/* ============================ SÜTUN EŞLEŞTİRME ============================ */

/** Başlıkları karşılaştırılabilir hale getirir: Türkçe karakter, boşluk, noktalama. */
function normalizeHeader(h) {
  return String(h || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Aktarım tipleri. Her alan için kabul edilen başlık adları listelenir —
 * kullanıcı hangi dilde veya yazımda yazarsa yazsın bulunur.
 */
const SCHEMAS = {
  items: {
    label: 'Ürünler',
    fields: {
      name:        { aliases: ['urunadi', 'ad', 'urun', 'itemname', 'name', 'malzemeadi'], required: true, max: 200 },
      code:        { aliases: ['urunkodu', 'kod', 'code', 'itemcode', 'stokkodu'], max: 60 },
      barcode:     { aliases: ['barkod', 'barcode', 'ean'], max: 60 },
      category:    { aliases: ['kategori', 'category', 'grup'], max: 100 },
      unit:        { aliases: ['birim', 'unit', 'olcubirimi'], required: true, max: 20, default: 'adet' },
      itemType:    { aliases: ['urunt ipi', 'uruntipi', 'tip', 'itemtype', 'type'], enum: ['raw', 'semi', 'finished', 'consumable'], default: 'raw' },
      origin:      { aliases: ['mensei', 'menseii', 'origin', 'kaynak'], default: 'Yurt İçi' },
      minStock:    { aliases: ['kritikstok', 'minstok', 'minimumstok', 'minstock', 'kritikseviye'], type: 'number', default: 0 },
      reorderQty:  { aliases: ['siparismiktari', 'reorderqty', 'siparisnoktasi'], type: 'number', default: 0 },
      salePrice:   { aliases: ['satisfiyati', 'saleprice', 'fiyat'], type: 'number', default: 0 },
      vatRate:     { aliases: ['kdv', 'kdvorani', 'vat', 'vatrate'], type: 'number', default: 20 },
      location:    { aliases: ['raf', 'konum', 'location', 'rafkonum'], max: 60 },
      shelfLife:   { aliases: ['rafomru', 'shelflife', 'rafomrugun'], type: 'number' },
      description: { aliases: ['aciklama', 'description', 'not'], max: 5000 },
      supplierCode:{ aliases: ['tedarikcikodu', 'tedarikci', 'suppliercode', 'supplier'], max: 60 },
      procurementType: { aliases: ['tedariksekli', 'procurement', 'uretilirsatinalinir'], enum: ['make', 'buy'], default: 'buy' },
      safetyStock: { aliases: ['emniyetstogu', 'safetystock'], type: 'number', default: 0 }
    },
    unique: ['code', 'barcode']
  },

  suppliers: {
    label: 'Tedarikçiler',
    fields: {
      name:            { aliases: ['tedarikciadi', 'unvan', 'ad', 'name', 'suppliername', 'firma'], required: true, max: 200 },
      code:            { aliases: ['tedarikcikodu', 'kod', 'code'], max: 60 },
      contactPerson:   { aliases: ['ilgilikisi', 'yetkili', 'contact', 'contactperson'], max: 120 },
      phone:           { aliases: ['telefon', 'phone', 'tel'], max: 40 },
      email:           { aliases: ['eposta', 'email', 'mail'], max: 120 },
      address:         { aliases: ['adres', 'address'], max: 500 },
      country:         { aliases: ['ulke', 'country'], max: 60, default: 'TR' },
      taxNo:           { aliases: ['vergino', 'vkn', 'taxno', 'verginumarasi'], max: 20 },
      currency:        { aliases: ['parabirimi', 'currency', 'dovizcinsi'], enum: ['TRY', 'USD', 'EUR'], default: 'TRY' },
      paymentTermsDays:{ aliases: ['odemevadesi', 'vade', 'paymentterms'], type: 'number', default: 30 },
      leadTimeDays:    { aliases: ['tedariksuresi', 'teslimsuresi', 'leadtime'], type: 'number', default: 7 },
      incoterm:        { aliases: ['incoterm', 'teslimsekli'], max: 20 }
    },
    unique: ['code', 'name']
  },

  customers: {
    label: 'Müşteriler',
    fields: {
      name:            { aliases: ['musteriadi', 'unvan', 'ad', 'name', 'customername', 'firma'], required: true, max: 200 },
      code:            { aliases: ['musterikodu', 'kod', 'code'], max: 60 },
      contactPerson:   { aliases: ['ilgilikisi', 'yetkili', 'contact'], max: 120 },
      phone:           { aliases: ['telefon', 'phone', 'tel'], max: 40 },
      email:           { aliases: ['eposta', 'email', 'mail'], max: 120 },
      address:         { aliases: ['adres', 'address'], max: 500 },
      country:         { aliases: ['ulke', 'country'], max: 60, default: 'TR' },
      taxNo:           { aliases: ['vergino', 'vkn', 'taxno'], max: 20 },
      currency:        { aliases: ['parabirimi', 'currency'], enum: ['TRY', 'USD', 'EUR'], default: 'TRY' },
      paymentTermsDays:{ aliases: ['odemevadesi', 'vade'], type: 'number', default: 30 },
      creditLimit:     { aliases: ['kredilimiti', 'limit', 'creditlimit'], type: 'number', default: 0 }
    },
    unique: ['code', 'name']
  },

  opening_stock: {
    label: 'Açılış Stoğu',
    fields: {
      itemCode:   { aliases: ['urunkodu', 'kod', 'stokkodu', 'itemcode'], required: true, max: 60 },
      warehouse:  { aliases: ['depo', 'warehouse', 'depoadi'], max: 100 },
      qty:        { aliases: ['miktar', 'qty', 'quantity', 'stokmiktari'], type: 'number', required: true },
      unitCost:   { aliases: ['birimmaliyet', 'maliyet', 'unitcost', 'alisfiyati'], type: 'number', default: 0 },
      lotNo:      { aliases: ['partino', 'lotno', 'parti', 'lot'], max: 60 },
      expiryDate: { aliases: ['skt', 'sonkullanma', 'expiry', 'expirydate', 'miat'], type: 'date' },
      location:   { aliases: ['raf', 'konum', 'location'], max: 60 }
    },
    unique: []
  },

  boms: {
    label: 'Reçeteler',
    fields: {
      itemCode:      { aliases: ['mamulkodu', 'urunkodu', 'itemcode', 'kod'], required: true, max: 60 },
      componentCode: { aliases: ['bilesenkodu', 'hammaddekodu', 'componentcode', 'bilesen'], required: true, max: 60 },
      qtyPerUnit:    { aliases: ['miktar', 'birimbasina', 'qty', 'qtyperunit'], type: 'number', required: true },
      scrapPct:      { aliases: ['fire', 'fireyuzdesi', 'scrap', 'scrappct'], type: 'number', default: 0 }
    },
    unique: []
  },

  work_centers: {
    label: 'İş Merkezleri',
    fields: {
      code:          { aliases: ['kod', 'code', 'ismerkezikodu'], required: true, max: 40 },
      name:          { aliases: ['ad', 'name', 'ismerkezi', 'ismerkeziadi'], required: true, max: 200 },
      description:   { aliases: ['aciklama', 'description'], max: 500 },
      capacityUnits: { aliases: ['istasyon', 'paralelistasyon', 'kapasite', 'capacityunits'], type: 'number', default: 1 },
      hourlyRate:    { aliases: ['saatlikmaliyet', 'saatucreti', 'hourlyrate'], type: 'number', default: 0 },
      efficiencyPct: { aliases: ['verimlilik', 'verim', 'efficiency'], type: 'number', default: 100 },
      downtimePct:   { aliases: ['durus', 'planlidurus', 'downtime'], type: 'number', default: 0 }
    },
    unique: ['code']
  },

  routings: {
    label: 'Rotalar',
    fields: {
      itemCode:         { aliases: ['mamulkodu', 'urunkodu', 'itemcode', 'kod'], required: true, max: 60 },
      operationNo:      { aliases: ['operasyonno', 'opno', 'sira', 'operationno'], type: 'number', required: true },
      operationName:    { aliases: ['operasyon', 'operasyonadi', 'operationname', 'islem'], required: true, max: 200 },
      workCenterCode:   { aliases: ['ismerkezi', 'ismerkezikodu', 'workcenter', 'tezgah'], required: true, max: 40 },
      setupMinutes:     { aliases: ['hazirliksuresi', 'setup', 'setupminutes', 'hazirlik'], type: 'number', default: 0 },
      runMinutesPerUnit:{ aliases: ['birimsuresi', 'islemsuresi', 'runminutes', 'birimsure'], type: 'number', default: 0 },
      queueMinutes:     { aliases: ['beklemesuresi', 'queue', 'bekleme'], type: 'number', default: 0 },
      scrapPct:         { aliases: ['fire', 'scrap'], type: 'number', default: 0 }
    },
    unique: []
  }
};

/* ============================ DEĞER DÖNÜŞÜMÜ ============================ */

/** Excel hücresi metin, sayı, tarih veya formül sonucu olabilir. */
function cellValue(cell) {
  if (cell === null || cell === undefined) return null;
  const v = cell.value !== undefined ? cell.value : cell;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;        // formül
    if (v.text !== undefined) return v.text;            // zengin metin / köprü
    if (v.richText) return v.richText.map(r => r.text).join('');
    return null;
  }
  return v;
}

/**
 * Sayı ayrıştırma. Türkiye'de "1.234,56" yazılır, İngilizce'de "1,234.56".
 * İkisini de doğru okumak gerekir; yanlış okunan bir maliyet sessizce yanlış
 * stok değeri üretir.
 */
function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(/\s/g, '').replace(/[₺$€£]/g, '');
  if (!s) return null;

  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Son görülen ayraç ondalık ayracıdır
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    // Tek virgül: "1,5" ondalık; "1,234" binlik olabilir — 3 hane kuralı
    const parts = s.split(',');
    s = (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)
      ? s.replace(',', '')      // 1,234 = 1234
      : s.replace(',', '.');    // 1,5 = 1.5
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Tarih: Excel serisi, Date nesnesi veya GG.AA.YYYY / YYYY-AA-GG metni. */
function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') {
    // Excel tarih serisi: 1899-12-30 başlangıçlı
    const ms = (raw - 25569) * 86400000;
    const d = new Date(Math.round(ms));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

/** "Yurt Dışı", "ithal", "import" → Yurt Dışı */
function parseOrigin(raw) {
  const s = String(raw || '').toLocaleLowerCase('tr');
  if (/dis|ithal|import|foreign|yurtdisi/.test(s.replace(/\s/g, ''))) return 'Yurt Dışı';
  return 'Yurt İçi';
}

/** "üretilir"/"make" → make, "satın alınır"/"buy" → buy */
function parseProcurement(raw) {
  const s = String(raw || '').toLocaleLowerCase('tr').replace(/\s/g, '');
  if (/uret|imal|make|manufact/.test(s)) return 'make';
  return 'buy';
}

const ITEM_TYPE_MAP = {
  hammadde: 'raw', raw: 'raw', ham: 'raw',
  yarimamul: 'semi', yarımamul: 'semi', semi: 'semi', yarimamül: 'semi',
  mamul: 'finished', bitmisurun: 'finished', finished: 'finished', urun: 'finished',
  sarf: 'consumable', consumable: 'consumable', sarfmalzeme: 'consumable'
};

/* ============================ OKUMA VE DOĞRULAMA ============================ */

/** Başlık satırını alan adlarına eşler. Bulunamayan alanlar rapor edilir. */
function mapColumns(headerRow, schema) {
  const map = {};          // fieldName -> column index
  const unmatched = [];
  const headers = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const text = String(cellValue(cell) || '').trim();
    if (!text) return;
    headers.push({ col, text, norm: normalizeHeader(text) });
  });

  for (const [field, def] of Object.entries(schema.fields)) {
    // Alan adı, şablon başlığı ve tanımlı eşanlamlılar — üçü de kabul edilir.
    const wanted = [
      normalizeHeader(field),
      normalizeHeader(HEADERS[field] || ''),
      ...(def.aliases || [])
    ].filter(Boolean);

    let hit = headers.find(h => wanted.includes(h.norm));
    // Tam eşleşme yoksa, başlığın bir eşanlamlıyı içermesi yeterlidir:
    // "Miktar (kg)" gibi kullanıcı eklemeleri dosyayı reddettirmemeli.
    if (!hit) {
      hit = headers.find(h => wanted.some(w => w.length >= 4 && (h.norm.includes(w) || w.includes(h.norm))));
    }
    if (hit) map[field] = hit.col;
  }

  headers.forEach(h => {
    if (!Object.values(map).includes(h.col)) unmatched.push(h.text);
  });

  const missingRequired = Object.entries(schema.fields)
    .filter(([f, d]) => d.required && map[f] === undefined)
    .map(([f]) => f);

  return { map, unmatched, missingRequired, headers: headers.map(h => h.text) };
}

/** Tek bir satırı ayrıştırır ve doğrular. */
function parseRow(row, colMap, schema) {
  const data = {};
  const errors = [];
  const warnings = [];

  for (const [field, def] of Object.entries(schema.fields)) {
    const col = colMap[field];
    let raw = col ? cellValue(row.getCell(col)) : null;

    if (raw === null || raw === undefined || String(raw).trim() === '') {
      if (def.required) { errors.push(`${field}: zorunlu alan boş`); continue; }
      if (def.default !== undefined) data[field] = def.default;
      continue;
    }

    if (def.type === 'number') {
      const n = parseNumber(raw);
      if (n === null) { errors.push(`${field}: sayı okunamadı ("${String(raw).slice(0, 20)}")`); continue; }
      if (n < 0 && !['salePrice'].includes(field)) warnings.push(`${field}: negatif değer (${n})`);
      data[field] = n;
    } else if (def.type === 'date') {
      const d = parseDate(raw);
      if (d === null) { errors.push(`${field}: tarih okunamadı ("${String(raw).slice(0, 20)}")`); continue; }
      data[field] = d;
    } else {
      let s = String(raw).trim();
      if (def.max && s.length > def.max) {
        warnings.push(`${field}: ${def.max} karaktere kısaltıldı`);
        s = s.slice(0, def.max);
      }
      if (def.enum) {
        const original = s;
        // Serbest yazımı bilinen değerlere çevir
        if (field === 'itemType') {
          const mapped = ITEM_TYPE_MAP[normalizeHeader(s)];
          if (!mapped) {
            warnings.push(`${field}: "${original}" tanınmadı, varsayılan kullanıldı (${def.default})`);
            s = def.default;
          } else s = mapped;
        } else if (field === 'procurementType') {
          s = parseProcurement(s);
        } else if (field === 'currency') {
          s = s.toUpperCase();
        }
        if (!def.enum.includes(s)) {
          warnings.push(`${field}: "${original}" tanınmadı, varsayılan kullanıldı (${def.default})`);
          s = def.default;
        }
      }
      if (field === 'origin') s = parseOrigin(s);
      data[field] = s;
    }
  }

  return { data, errors, warnings };
}

/**
 * Dosyayı okur, doğrular ve önizleme partisi olarak kaydeder.
 * Hiçbir iş kaydı yazılmaz — yalnızca import_* tabloları.
 */
async function preview({ buffer, fileName, importType, duplicateMode = 'skip', userId }) {
  const schema = SCHEMAS[importType];
  if (!schema) throw new AppError(`Bilinmeyen aktarım tipi / Unknown import type: ${importType}`, 400);

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); }
  catch (e) { throw new AppError('Excel dosyası okunamadı / Cannot read the Excel file: ' + e.message, 400); }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new AppError('Sayfa boş veya yalnızca başlık içeriyor / Sheet is empty', 400);
  // Üst sınır yoksa çok satırlı/yoğun bir dosya belleği ve işlem süresini
  // makul olmayan şekilde tüketebilir (bkz. dosya boyutu sınırı .xlsx'in
  // sıkıştırılmış hâli için, bu ise açılmış içerik için bir güvenlik ağı).
  const MAX_IMPORT_ROWS = 50000;
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) {
    throw new AppError(
      `Dosya çok fazla satır içeriyor (${ws.rowCount - 1}) / Too many rows — üst sınır ${MAX_IMPORT_ROWS}. Dosyayı bölüp ayrı ayrı yükleyin.`, 413);
  }

  const headerRow = ws.getRow(1);
  const { map, unmatched, missingRequired, headers } = mapColumns(headerRow, schema);
  if (missingRequired.length) {
    throw new AppError(
      `Zorunlu sütunlar bulunamadı / Required columns missing: ${missingRequired.join(', ')}`, 400,
      { details: missingRequired.map(f => ({ field: f, message: 'sütun bulunamadı' })), headers });
  }

  const batchId = uuid();
  const batchNo = nextNumber('import_batch', 'AKT');
  const rows = [];
  const seen = new Set();     // dosya içi tekrar kontrolü

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Tamamen boş satırlar sessizce atlanır; Excel dosyalarının sonunda sık görülür
    const anyValue = Object.values(map).some(c => {
      const v = cellValue(row.getCell(c));
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
    if (!anyValue) continue;

    const { data, errors, warnings } = parseRow(row, map, schema);

    // Dosya içinde aynı anahtarın tekrarı
    for (const key of schema.unique) {
      if (!data[key]) continue;
      const sig = `${key}:${String(data[key]).toLocaleLowerCase('tr')}`;
      if (seen.has(sig)) errors.push(`${key}: bu değer dosyada birden fazla satırda var ("${data[key]}")`);
      else seen.add(sig);
    }

    rows.push({
      rowNo: r,
      raw: JSON.stringify(Object.fromEntries(Object.entries(map).map(([f, c]) => [f, cellValue(row.getCell(c))]))),
      data, errors, warnings
    });
  }

  // Referans kontrolü: var olmayan ürün/tedarikçi/iş merkezi kodları
  validateReferences(importType, rows);

  const valid = rows.filter(r => r.errors.length === 0).length;

  db.tx(() => {
    db.prepare(`INSERT INTO import_batches (id,batch_no,import_type,file_name,file_size,total_rows,
        valid_rows,error_rows,status,duplicate_mode,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'preview',?,?,?)`)
      .run(batchId, batchNo, importType, fileName || null, buffer.length, rows.length,
           valid, rows.length - valid, duplicateMode, userId || null, Date.now());

    const ins = db.prepare(`INSERT INTO import_rows (batch_id,row_no,raw_data,parsed_data,is_valid,errors,warnings)
      VALUES (?,?,?,?,?,?,?)`);
    rows.forEach(r => ins.run(batchId, r.rowNo, r.raw, JSON.stringify(r.data),
      r.errors.length ? 0 : 1,
      r.errors.length ? JSON.stringify(r.errors) : null,
      r.warnings.length ? JSON.stringify(r.warnings) : null));
  });

  return {
    batchId, batchNo, importType, label: schema.label,
    totalRows: rows.length, validRows: valid, errorRows: rows.length - valid,
    unmatchedColumns: unmatched, detectedHeaders: headers,
    sample: rows.slice(0, 20).map(r => ({
      rowNo: r.rowNo, data: r.data, errors: r.errors, warnings: r.warnings
    })),
    errorSample: rows.filter(r => r.errors.length).slice(0, 50).map(r => ({
      rowNo: r.rowNo, errors: r.errors, data: r.data
    }))
  };
}

/** Kod referanslarının sistemde karşılığı var mı? Yoksa satır yazılamaz. */
function validateReferences(importType, rows) {
  const codeExists = (table, code) => {
    if (!code) return false;
    const q = table === 'items'
      ? db.prepare('SELECT 1 FROM items WHERE (code = ? OR barcode = ?) AND deleted_at IS NULL').get(code, code)
      : table === 'work_centers'
        ? db.prepare('SELECT 1 FROM work_centers WHERE code = ? AND is_active = 1').get(code)
        : null;
    return !!q;
  };

  if (importType === 'opening_stock') {
    rows.forEach(r => {
      if (r.data.itemCode && !codeExists('items', r.data.itemCode)) {
        r.errors.push(`itemCode: "${r.data.itemCode}" kodlu ürün sistemde yok — önce ürünleri aktarın`);
      }
      if (r.data.warehouse) {
        const w = db.prepare('SELECT 1 FROM warehouses WHERE name = ? OR code = ?').get(r.data.warehouse, r.data.warehouse);
        if (!w) r.warnings.push(`warehouse: "${r.data.warehouse}" bulunamadı, varsayılan depo kullanılacak`);
      }
    });
  }

  if (importType === 'boms') {
    rows.forEach(r => {
      if (r.data.itemCode && !codeExists('items', r.data.itemCode)) {
        r.errors.push(`itemCode: "${r.data.itemCode}" kodlu mamul sistemde yok`);
      }
      if (r.data.componentCode && !codeExists('items', r.data.componentCode)) {
        r.errors.push(`componentCode: "${r.data.componentCode}" kodlu bileşen sistemde yok`);
      }
      if (r.data.itemCode && r.data.itemCode === r.data.componentCode) {
        r.errors.push('Bir ürün kendi bileşeni olamaz');
      }
    });
  }

  if (importType === 'routings') {
    rows.forEach(r => {
      if (r.data.itemCode && !codeExists('items', r.data.itemCode)) {
        r.errors.push(`itemCode: "${r.data.itemCode}" kodlu mamul sistemde yok`);
      }
      if (r.data.workCenterCode && !codeExists('work_centers', r.data.workCenterCode)) {
        r.errors.push(`workCenterCode: "${r.data.workCenterCode}" kodlu iş merkezi sistemde yok`);
      }
    });
  }

  if (importType === 'items') {
    rows.forEach(r => {
      if (r.data.supplierCode) {
        const s = db.prepare('SELECT 1 FROM suppliers WHERE code = ? OR name = ?')
          .get(r.data.supplierCode, r.data.supplierCode);
        if (!s) r.warnings.push(`supplierCode: "${r.data.supplierCode}" bulunamadı, boş bırakılacak`);
      }
    });
  }
}

module.exports = {
  SCHEMAS, HEADERS, preview, normalizeHeader, parseNumber, parseDate, parseOrigin,
  parseProcurement, mapColumns, cellValue
};
