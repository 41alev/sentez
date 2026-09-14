// @ts-nocheck
/**
 * Excel aktarım testleri.
 *
 * Test dosyaları burada üretilir ve kasıtlı olarak bozuktur: eksik zorunlu alan,
 * okunamayan sayı, Türkçe/İngilizce ondalık karışımı, tekrarlayan kod, var olmayan
 * referans, boş satırlar. Gerçek müşteri dosyaları tam olarak böyledir.
 *
 *   node test/import.js   (sunucu ayakta olmalı)
 */
const ExcelJS = require('exceljs');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

/** Satır dizisinden .xlsx üretir. */
async function makeXlsx(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sayfa1');
  ws.addRow(headers);
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadPreview(token, importType, buffer, fileName = 'test.xlsx', duplicateMode = 'skip') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), fileName);
  fd.append('importType', importType);
  fd.append('duplicateMode', duplicateMode);
  const r = await fetch(BASE + '/api/import/preview', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  const login = async (u, p) => (await api('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;
  const admin = await login('admin', 'Admin123!');
  const manager = await login('mudur', 'Mudur123!');
  const operator = await login('operator', 'Operator123!');

  console.log('=== TİPLER VE ŞABLON / TYPES AND TEMPLATE ===');
  const types = await api('GET', '/api/import/types', { token: admin });
  ok('aktarım tipleri listeleniyor', types.status === 200 && types.data.length === 7, `${types.data.length} tip`);
  const itemType = types.data.find(t => t.key === 'items');
  ok('alan tanımları geliyor', itemType && itemType.fields.length > 10, `${itemType && itemType.fields.length} alan`);
  ok('zorunlu alanlar işaretli', itemType.fields.some(f => f.name === 'name' && f.required));
  ok('bağımlılık sırası bildiriliyor',
    types.data.find(t => t.key === 'opening_stock').dependsOn.includes('items'),
    'açılış stoğu önce ürünleri gerektirir');

  const tpl = await fetch(BASE + '/api/import/template/items', { headers: { Authorization: `Bearer ${admin}` } });
  const tplBuf = Buffer.from(await tpl.arrayBuffer());
  ok('şablon indirilebiliyor', tpl.status === 200 && tplBuf.length > 3000, `${tplBuf.length} bayt`);
  const tplWb = new ExcelJS.Workbook();
  await tplWb.xlsx.load(tplBuf);
  const tplWs = tplWb.worksheets[0];
  ok('şablon başlık satırı içeriyor', tplWs.getRow(1).getCell(1).value === 'Ad', String(tplWs.getRow(1).getCell(1).value));
  ok('şablon açıklama satırı içeriyor', /ZORUNLU/.test(String(tplWs.getRow(2).getCell(1).value)));
  ok('şablon örnek satır içeriyor', /Somun/.test(String(tplWs.getRow(3).getCell(1).value)));

  const opTpl = await fetch(BASE + '/api/import/template/items', { headers: { Authorization: `Bearer ${operator}` } });
  ok('operatör şablon indiremiyor (403)', opTpl.status === 403, `got ${opTpl.status}`);

  // Sistemin ürettiği şablon, sistem tarafından geri okunabilmelidir. Aksi halde
  // kullanıcıya "bu şablonu doldurun" deyip dosyasını reddetmiş oluruz.
  for (const type of Object.keys({ items: 1, suppliers: 1, customers: 1, opening_stock: 1, boms: 1, work_centers: 1, routings: 1 })) {
    const t = await fetch(BASE + `/api/import/template/${type}`, { headers: { Authorization: `Bearer ${admin}` } });
    const buf = Buffer.from(await t.arrayBuffer());
    // Şablonun 2. satırı açıklama, 3. satırı örnek — açıklama satırı hata üretir,
    // burada önemli olan sütunların TANINMASI (400 almamak).
    const p2 = await uploadPreview(manager, type, buf, `sablon-${type}.xlsx`);
    ok(`${type} şablonunun sütunları tanınıyor`, p2.status === 201,
      `got ${p2.status} ${JSON.stringify(p2.data).slice(0, 120)}`);
    if (p2.status === 201) await api('DELETE', `/api/import/batches/${p2.data.batchId}`, { token: manager });
  }

  console.log('\n=== SÜTUN EŞLEŞTİRME / COLUMN MAPPING ===');
  // Kullanıcı başlıkları farklı yazar: büyük harf, Türkçe karakter, boşluk.
  const oddHeaders = await makeXlsx(
    ['ÜRÜN ADI', 'stok kodu', 'Birim', 'Kritik Stok', 'kategori'],
    [['Test Vida M6', 'IMP-V6', 'adet', 50, 'Bağlantı']]
  );
  const oddPrev = await uploadPreview(manager, 'items', oddHeaders, 'farkli-basliklar.xlsx');
  ok('farklı yazımdaki başlıklar eşleşiyor', oddPrev.status === 201 && oddPrev.data.validRows === 1,
    JSON.stringify(oddPrev.data).slice(0, 160));
  ok('ürün adı doğru okundu', oddPrev.data.sample[0].data.name === 'Test Vida M6');
  ok('kod doğru okundu', oddPrev.data.sample[0].data.code === 'IMP-V6');

  const missingCol = await makeXlsx(['Kod', 'Kategori'], [['X-1', 'Test']]);
  const missPrev = await uploadPreview(manager, 'items', missingCol, 'eksik.xlsx');
  ok('zorunlu sütun yoksa dosya reddediliyor (400)', missPrev.status === 400, `got ${missPrev.status}`);
  ok('hangi sütunun eksik olduğu bildiriliyor',
    JSON.stringify(missPrev.data).includes('name'), JSON.stringify(missPrev.data).slice(0, 140));

  console.log('\n=== SAYI VE TARİH AYRIŞTIRMA / NUMBER AND DATE PARSING ===');
  // Türkçe "1.234,56" ve İngilizce "1,234.56" ikisi de doğru okunmalı;
  // yanlış okunan bir maliyet sessizce yanlış stok değeri üretir.
  const numbers = await makeXlsx(
    ['Ad', 'Kod', 'Birim', 'Satış Fiyatı', 'Kritik Stok'],
    [
      ['TR Ondalık', 'IMP-N1', 'adet', '1.234,56', '10'],
      ['EN Ondalık', 'IMP-N2', 'adet', '1,234.56', '20'],
      ['Basit Virgül', 'IMP-N3', 'adet', '12,5', '5'],
      ['Binlik Virgül', 'IMP-N4', 'adet', '1,234', '5'],
      ['Para Simgesi', 'IMP-N5', 'adet', '₺ 99,90', '5'],
      ['Bozuk Sayı', 'IMP-N6', 'adet', 'çok pahalı', '5']
    ]
  );
  const numPrev = await uploadPreview(manager, 'items', numbers, 'sayilar.xlsx');
  ok('sayı dosyası okundu', numPrev.status === 201, JSON.stringify(numPrev.data).slice(0, 120));
  const byCode = {};
  numPrev.data.sample.forEach(r => { byCode[r.data.code] = r; });
  ok('Türkçe ondalık doğru (1.234,56 → 1234.56)', byCode['IMP-N1'].data.salePrice === 1234.56,
    String(byCode['IMP-N1'].data.salePrice));
  ok('İngilizce ondalık doğru (1,234.56 → 1234.56)', byCode['IMP-N2'].data.salePrice === 1234.56,
    String(byCode['IMP-N2'].data.salePrice));
  ok('tek virgül ondalık sayılıyor (12,5 → 12.5)', byCode['IMP-N3'].data.salePrice === 12.5,
    String(byCode['IMP-N3'].data.salePrice));
  ok('üç haneli grup binlik sayılıyor (1,234 → 1234)', byCode['IMP-N4'].data.salePrice === 1234,
    String(byCode['IMP-N4'].data.salePrice));
  ok('para simgesi temizleniyor (₺ 99,90 → 99.9)', byCode['IMP-N5'].data.salePrice === 99.9,
    String(byCode['IMP-N5'].data.salePrice));
  ok('okunamayan sayı satırı hatalı işaretleniyor', byCode['IMP-N6'].errors.length > 0,
    JSON.stringify(byCode['IMP-N6'].errors));
  ok('tek bozuk satır dosyayı düşürmüyor', numPrev.data.validRows === 5 && numPrev.data.errorRows === 1,
    `geçerli ${numPrev.data.validRows}, hatalı ${numPrev.data.errorRows}`);

  console.log('\n=== HATALI SATIRLAR / INVALID ROWS ===');
  const messy = await makeXlsx(
    ['Ad', 'Kod', 'Birim', 'Ürün Tipi', 'Menşei', 'Kritik Stok'],
    [
      ['Geçerli Ürün A', 'IMP-A', 'adet', 'Hammadde', 'Yurt İçi', 10],
      ['', 'IMP-B', 'adet', 'Hammadde', 'Yurt İçi', 10],            // ad boş
      ['Geçerli Ürün C', 'IMP-C', 'kg', 'Mamul', 'İthal', 5],
      ['Tekrar Kod', 'IMP-A', 'adet', 'Hammadde', 'Yurt İçi', 1],   // dosya içi tekrar
      ['', '', '', '', '', ''],                                      // tamamen boş
      ['Tanımsız Tip', 'IMP-E', 'adet', 'uçan halı', 'Yurt İçi', 3] // enum tanınmaz
    ]
  );
  const messyPrev = await uploadPreview(manager, 'items', messy, 'karisik.xlsx');
  ok('boş satırlar sessizce atlanıyor', messyPrev.data.totalRows === 5,
    `${messyPrev.data.totalRows} satır sayıldı (boş hariç)`);
  const rows = (await api('GET', `/api/import/batches/${messyPrev.data.batchId}/rows?pageSize=50`, { token: admin })).data;
  const byRow = {};
  rows.data.forEach(r => { byRow[r.rowNo] = r; });
  ok('zorunlu alanı boş satır hatalı', !byRow[3].isValid && /zorunlu/.test(byRow[3].errors.join()),
    JSON.stringify(byRow[3].errors));
  ok('dosya içi tekrarlayan kod yakalanıyor',
    !byRow[5].isValid && /birden fazla/.test(byRow[5].errors.join()), JSON.stringify(byRow[5].errors));
  ok('Türkçe tip adı çevriliyor (Mamul → finished)', byRow[4].data.itemType === 'finished', byRow[4].data.itemType);
  ok('"İthal" menşei Yurt Dışı olarak okunuyor', byRow[4].data.origin === 'Yurt Dışı', byRow[4].data.origin);
  ok('tanınmayan enum uyarı üretip varsayılana düşüyor',
    byRow[7].isValid && byRow[7].warnings.length > 0 && byRow[7].data.itemType === 'raw',
    JSON.stringify(byRow[7].warnings));

  const onlyErrors = (await api('GET', `/api/import/batches/${messyPrev.data.batchId}/rows?onlyErrors=1`, { token: admin })).data;
  ok('yalnızca hatalı satırlar filtrelenebiliyor',
    onlyErrors.data.length === messyPrev.data.errorRows && onlyErrors.data.every(r => !r.isValid),
    `${onlyErrors.data.length} hatalı`);

  console.log('\n=== KAYDETME / COMMIT ===');
  const itemsBefore = (await api('GET', '/api/items?pageSize=1', { token: admin })).data.total;
  const opCommit = await api('POST', `/api/import/batches/${messyPrev.data.batchId}/commit`, { token: operator });
  ok('operatör aktarımı kaydedemiyor (403)', opCommit.status === 403, `got ${opCommit.status}`);

  const commit = await api('POST', `/api/import/batches/${messyPrev.data.batchId}/commit`, { token: manager });
  ok('aktarım kaydedildi', commit.status === 200, JSON.stringify(commit.data).slice(0, 140));
  ok('yalnızca geçerli satırlar yazıldı', commit.data.created === messyPrev.data.validRows,
    `${commit.data.created} yazıldı, ${messyPrev.data.validRows} geçerliydi`);
  const itemsAfter = (await api('GET', '/api/items?pageSize=1', { token: admin })).data.total;
  ok('ürün sayısı tam olarak arttı', itemsAfter === itemsBefore + commit.data.created,
    `${itemsBefore} → ${itemsAfter}`);
  ok('hatalı satırlar sisteme sızmadı',
    (await api('GET', '/api/items?q=IMP-B&pageSize=5', { token: admin })).data.total === 0);

  const recommit = await api('POST', `/api/import/batches/${messyPrev.data.batchId}/commit`, { token: manager });
  ok('aynı aktarım ikinci kez kaydedilemiyor (409)', recommit.status === 409, `got ${recommit.status}`);

  console.log('\n=== TEKRAR DAVRANIŞI / DUPLICATE HANDLING ===');
  const dupFile = await makeXlsx(
    ['Ad', 'Kod', 'Birim', 'Kritik Stok'],
    [['Geçerli Ürün A GÜNCEL', 'IMP-A', 'adet', 99]]
  );
  const skipPrev = await uploadPreview(manager, 'items', dupFile, 'tekrar.xlsx', 'skip');
  const skipCommit = await api('POST', `/api/import/batches/${skipPrev.data.batchId}/commit`, { token: manager });
  ok('"atla" modunda var olan kayıt korunuyor', skipCommit.data.skipped === 1 && skipCommit.data.created === 0,
    JSON.stringify(skipCommit.data));
  const stillOld = (await api('GET', '/api/items?q=IMP-A&pageSize=5', { token: admin })).data.data[0];
  ok('mevcut kaydın adı değişmedi', stillOld.name === 'Geçerli Ürün A', stillOld.name);

  const updPrev = await uploadPreview(manager, 'items', dupFile, 'tekrar2.xlsx', 'update');
  const updCommit = await api('POST', `/api/import/batches/${updPrev.data.batchId}/commit`, { token: manager });
  ok('"güncelle" modunda kayıt güncelleniyor', updCommit.data.updated === 1, JSON.stringify(updCommit.data));
  const nowNew = (await api('GET', '/api/items?q=IMP-A&pageSize=5', { token: admin })).data.data[0];
  ok('ad güncellendi', nowNew.name === 'Geçerli Ürün A GÜNCEL', nowNew.name);
  ok('kritik stok güncellendi', nowNew.minStock === 99, String(nowNew.minStock));

  // "hata ver" modu: önizleme aşamasında satır GEÇERLİ sayılır (tekrar kontrolü
  // yalnızca commit sırasında, gerçek DB durumuna göre yapılır) — asıl davranış
  // commit'te tek satırın reddedilip PARTİNİN GERİ KALANININ yazılmasıdır.
  const failFile = await makeXlsx(
    ['Ad', 'Kod', 'Birim', 'Kritik Stok'],
    [['Bu Asla Yazılmamalı', 'IMP-A', 'adet', 1]]
  );
  const failPrev = await uploadPreview(manager, 'items', failFile, 'tekrar3.xlsx', 'fail');
  ok('"hata ver" modunda önizleme kabul ediliyor', failPrev.status === 201,
    JSON.stringify(failPrev.data).slice(0, 160));
  const failCommit = await api('POST', `/api/import/batches/${failPrev.data.batchId}/commit`, { token: manager });
  ok('"hata ver" modunda tekrar eden kayıt satır bazında reddediliyor (failed:1)',
    failCommit.status === 200 && failCommit.data.failed === 1
      && failCommit.data.created === 0 && failCommit.data.updated === 0,
    JSON.stringify(failCommit.data));
  const failRows = (await api('GET', `/api/import/batches/${failPrev.data.batchId}/rows`, { token: admin })).data;
  const failedRow = failRows.data.find(r => r.action === 'failed');
  ok('hata mesajı "zaten var" içeriyor', !!failedRow && /zaten var/.test(failedRow.errors.join()),
    JSON.stringify(failedRow));
  const untouchedByFail = (await api('GET', '/api/items?q=IMP-A&pageSize=5', { token: admin })).data.data[0];
  ok('"hata ver" modunda mevcut kayıt değişmeden kalıyor',
    untouchedByFail.name === 'Geçerli Ürün A GÜNCEL', untouchedByFail.name);

  console.log('\n=== REFERANS DOĞRULAMA / REFERENCE VALIDATION ===');
  const badStock = await makeXlsx(
    ['Ürün Kodu', 'Depo', 'Miktar', 'Birim Maliyet', 'Parti No'],
    [
      ['IMP-A', 'Merkez Depo (İstanbul)', 100, '12,50', 'IMP-LOT-1'],
      ['OLMAYAN-KOD', 'Merkez Depo (İstanbul)', 50, 10, 'IMP-LOT-2'],
      ['IMP-C', 'Var Olmayan Depo', 25, 5, 'IMP-LOT-3']
    ]
  );
  const stockPrev = await uploadPreview(manager, 'opening_stock', badStock, 'acilis.xlsx');
  ok('var olmayan ürün kodu hata üretiyor', stockPrev.data.errorRows === 1, `${stockPrev.data.errorRows} hata`);
  const stockRows = (await api('GET', `/api/import/batches/${stockPrev.data.batchId}/rows`, { token: admin })).data;
  const badRef = stockRows.data.find(r => !r.isValid);
  ok('hata mesajı hangi kodun bulunamadığını söylüyor',
    /OLMAYAN-KOD/.test(badRef.errors.join()), JSON.stringify(badRef.errors));
  ok('hata mesajı ne yapılması gerektiğini söylüyor',
    /önce ürünleri aktarın/.test(badRef.errors.join()), '');
  const badWh = stockRows.data.find(r => r.rowNo === 4);
  ok('var olmayan depo uyarı üretiyor, hata değil',
    badWh.isValid && badWh.warnings.length > 0, JSON.stringify(badWh.warnings));

  console.log('\n=== AÇILIŞ STOĞU / OPENING STOCK ===');
  const stockCommit = await api('POST', `/api/import/batches/${stockPrev.data.batchId}/commit`, { token: manager });
  ok('açılış stoğu yazıldı', stockCommit.status === 200 && stockCommit.data.created === 2,
    JSON.stringify(stockCommit.data));
  const impItem = (await api('GET', '/api/items?q=IMP-A&pageSize=5', { token: admin })).data.data[0];
  ok('stok miktarı ürüne yansıdı', impItem.qty === 100, String(impItem.qty));
  ok('ortalama maliyet hesaplandı', Math.abs(impItem.avgCost - 12.5) < 0.01, String(impItem.avgCost));
  const impLots = (await api('GET', `/api/stock/lots?itemId=${impItem.id}&pageSize=10`, { token: admin })).data.data;
  ok('parti numarasıyla yazıldı', impLots.some(l => l.lotNo === 'IMP-LOT-1'),
    JSON.stringify(impLots.map(l => l.lotNo)));
  const moves = (await api('GET', `/api/stock/movements?itemId=${impItem.id}&pageSize=10`, { token: admin })).data.data;
  ok('hareket kaydı bırakıldı (miktar izlenebilir)', moves.length > 0 && moves.some(m => m.type === 'in'));

  console.log('\n=== REÇETE AKTARIMI / BOM IMPORT ===');
  const bomFile = await makeXlsx(
    ['Mamul Kodu', 'Bileşen Kodu', 'Birim Başına Miktar', 'Fire %'],
    [
      ['IMP-C', 'IMP-A', '2,5', 3],
      ['IMP-C', 'IMP-C', 1, 0],            // kendi kendinin bileşeni
      ['IMP-C', 'YOK-123', 1, 0]           // olmayan bileşen
    ]
  );
  const bomPrev = await uploadPreview(manager, 'boms', bomFile, 'recete.xlsx');
  ok('geçerli reçete satırı kabul edildi', bomPrev.data.validRows === 1, `${bomPrev.data.validRows}`);
  const bomRows = (await api('GET', `/api/import/batches/${bomPrev.data.batchId}/rows`, { token: admin })).data;
  ok('ürünün kendi bileşeni olması engelleniyor',
    bomRows.data.some(r => /kendi bileşeni/.test((r.errors || []).join())),
    JSON.stringify(bomRows.data.map(r => r.errors)));
  const bomCommit = await api('POST', `/api/import/batches/${bomPrev.data.batchId}/commit`, { token: manager });
  ok('reçete yazıldı', bomCommit.data.created === 1, JSON.stringify(bomCommit.data));
  const cItem = (await api('GET', '/api/items?q=IMP-C&pageSize=5', { token: admin })).data.data[0];
  const cDetail = (await api('GET', `/api/items/${cItem.id}`, { token: admin })).data;
  ok('reçete ürün kartında görünüyor', cDetail.bom.length === 1 && cDetail.bom[0].qtyPerUnit === 2.5,
    JSON.stringify(cDetail.bom));

  console.log('\n=== GERİ ALMA / REVERT ===');
  const beforeRevert = (await api('GET', '/api/items?pageSize=1', { token: admin })).data.total;
  // Stok hareketi görmemiş bir aktarımı geri al
  const revertTarget = bomPrev.data.batchId;
  const rev = await api('POST', `/api/import/batches/${revertTarget}/revert`, { token: manager });
  ok('aktarım geri alındı', rev.status === 200 && rev.data.deleted === 1, JSON.stringify(rev.data));
  const cAfter = (await api('GET', `/api/items/${cItem.id}`, { token: admin })).data;
  ok('reçete silindi', cAfter.bom.length === 0, JSON.stringify(cAfter.bom));
  ok('ürünler silinmedi (başka aktarımdan geldiler)',
    (await api('GET', '/api/items?pageSize=1', { token: admin })).data.total === beforeRevert);

  const revertAgain = await api('POST', `/api/import/batches/${revertTarget}/revert`, { token: manager });
  ok('aynı aktarım ikinci kez geri alınamıyor (409)', revertAgain.status === 409, `got ${revertAgain.status}`);

  // Stok hareketi görmüş partiler korunmalı
  const stockRevert = await api('POST', `/api/import/batches/${stockPrev.data.batchId}/revert`, { token: manager });
  ok('stok aktarımı geri alındı', stockRevert.status === 200, JSON.stringify(stockRevert.data).slice(0, 120));
  const impItemAfter = (await api('GET', `/api/items/${impItem.id}`, { token: admin })).data;
  ok('geri alma sonrası stok sıfırlandı', impItemAfter.qty === 0, String(impItemAfter.qty));

  console.log('\n=== GEÇMİŞ / HISTORY ===');
  const batches = (await api('GET', '/api/import/batches?pageSize=50', { token: admin })).data;
  ok('aktarım geçmişi tutuluyor', batches.total >= 6, `${batches.total} aktarım`);
  ok('durumlar doğru kaydedilmiş',
    batches.data.some(b => b.status === 'committed') && batches.data.some(b => b.status === 'reverted'),
    JSON.stringify([...new Set(batches.data.map(b => b.status))]));
  ok('aktarımı yapan kullanıcı kayıtlı', batches.data.every(b => !!b.username));
  ok('dosya adı saklanıyor', batches.data.some(b => b.fileName === 'karisik.xlsx'));

  const audit = (await api('GET', '/api/audit?entityType=import_batch&pageSize=20', { token: admin })).data;
  ok('aktarımlar denetim kaydına yazıldı', audit.data.length >= 3, `${audit.data.length} kayıt`);

  console.log('\n=== ÖNİZLEME SİLME / DISCARD PREVIEW ===');
  const discardable = await uploadPreview(manager, 'suppliers',
    await makeXlsx(['Tedarikçi Adı', 'Kod'], [['Atılacak Tedarikçi', 'DISCARD-1']]), 'atilacak.xlsx');
  const del = await api('DELETE', `/api/import/batches/${discardable.data.batchId}`, { token: manager });
  ok('kaydedilmemiş önizleme silinebiliyor', del.status === 204, `got ${del.status}`);
  ok('silinen önizleme sisteme hiç yazılmadı',
    (await api('GET', '/api/purchasing/suppliers?q=DISCARD-1', { token: admin })).data.total === 0);
  const delCommitted = await api('DELETE', `/api/import/batches/${messyPrev.data.batchId}`, { token: manager });
  ok('kaydedilmiş aktarım silinemiyor (409)', delCommitted.status === 409, `got ${delCommitted.status}`);

  console.log('\n=== DOSYA DOĞRULAMA / FILE VALIDATION ===');
  const notExcel = await uploadPreview(manager, 'items', Buffer.from('bu bir excel değil'), 'sahte.xlsx');
  ok('bozuk dosya reddediliyor', notExcel.status === 400, `got ${notExcel.status}`);
  const emptySheet = await makeXlsx(['Ad', 'Kod', 'Birim'], []);
  const emptyPrev = await uploadPreview(manager, 'items', emptySheet, 'bos.xlsx');
  ok('yalnızca başlık içeren dosya reddediliyor', emptyPrev.status === 400, `got ${emptyPrev.status}`);
  const badType = await uploadPreview(manager, 'olmayan_tip', await makeXlsx(['A'], [['b']]), 'x.xlsx');
  ok('bilinmeyen aktarım tipi reddediliyor', badType.status === 400, `got ${badType.status}`);

  console.log('\n=== BÜYÜK DOSYA / LARGE FILE ===');
  const bigRows = Array.from({ length: 1000 }, (_, i) =>
    [`Toplu Ürün ${i}`, `BULK-${i}`, 'adet', (i % 50) + 1, 'Toplu']);
  const bigFile = await makeXlsx(['Ad', 'Kod', 'Birim', 'Kritik Stok', 'Kategori'], bigRows);
  const t0 = Date.now();
  const bigPrev = await uploadPreview(manager, 'items', bigFile, '1000-satir.xlsx');
  const prevMs = Date.now() - t0;
  ok('1000 satırlık dosya doğrulandı', bigPrev.status === 201 && bigPrev.data.validRows === 1000,
    `${bigPrev.data.validRows} geçerli, ${prevMs} ms`);
  ok('doğrulama makul sürede bitiyor (<20 sn)', prevMs < 20000, `${prevMs} ms`);
  const t1 = Date.now();
  const bigCommit = await api('POST', `/api/import/batches/${bigPrev.data.batchId}/commit`, { token: manager });
  const commitMs = Date.now() - t1;
  ok('1000 satır kaydedildi', bigCommit.data.created === 1000, JSON.stringify(bigCommit.data));
  ok('kaydetme makul sürede bitiyor (<20 sn)', commitMs < 20000, `${commitMs} ms`);

  // 50.000 satır üst sınırı: üst sınır olmadan yoğun bir dosya belleği ve
  // işlem süresini makul olmayan şekilde tüketebilir (DoS riski). Gerçekten
  // 50.001 satırlık bir dosya üreterek reddedildiğini kanıtlıyoruz — yalnızca
  // kodu okuyup "olması gerekir" varsaymıyoruz.
  const tooManyRows = Array.from({ length: 50001 }, (_, i) => [`Aşırı Ürün ${i}`, `TOOMANY-${i}`, 'adet']);
  const tooManyFile = await makeXlsx(['Ad', 'Kod', 'Birim'], tooManyRows);
  const tooManyPrev = await uploadPreview(manager, 'items', tooManyFile, '50001-satir.xlsx');
  ok('50.000 satır üst sınırını aşan dosya reddediliyor (413)', tooManyPrev.status === 413,
    `got ${tooManyPrev.status} ${JSON.stringify(tooManyPrev.data).slice(0, 160)}`);
  ok('önizleme yalnızca örnek döndürüyor (yanıt şişmiyor)', bigPrev.data.sample.length === 20,
    `${bigPrev.data.sample.length} örnek satır`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`GEÇTİ / PASSED: ${pass}    KALDI / FAILED: ${fail}`);
  if (failures.length) { console.log('\nBaşarısız / Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Test çalıştırılamadı / Test run failed:', e); process.exit(1); });
