// @ts-nocheck
const bcrypt = require('bcryptjs');
const db = require('./db');
const { uuid } = require('./lib/core');

const DAY = 86400000;
const dstr = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

function seedIfEmpty() {
  const already = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (already > 0) return false;
  seed();
  return true;
}

function seed() {
  const insSeqPlanning = () => {};   // seri kayıtları aşağıda topluca ekleniyor
  db.transaction(() => {
    // ---------- Company & users ----------
    db.prepare(`INSERT INTO companies (name, tax_no, address, phone, email, base_currency,
        tax_office, district, city, postal_code, mersis_no, einvoice_sender_alias, edespatch_sender_alias)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('Örnek Metal Sanayi A.Ş.', '1234567890', 'Tuzla OSB 3. Cadde No:12', '+90 216 555 0000',
           'muhasebe@ornekmetal.com', 'TRY', 'Tuzla', 'Tuzla', 'İstanbul', '34953', '0123456789012345',
           'urn:mail:defaultgb@ornekmetal.com', 'urn:mail:irsaliyepk@ornekmetal.com');

    const insUser = db.prepare(`INSERT INTO users (company_id,username,full_name,email,password_hash,role,approval_limit,must_change_password,is_active,created_at)
      VALUES (1,?,?,?,?,?,?,?,1,?)`);
    const hash = (p) => bcrypt.hashSync(p, 10);
    insUser.run('admin', 'Sistem Yöneticisi', 'admin@ornek.com', hash('Admin123!'), 'admin', 1000000, 0, Date.now());
    insUser.run('mudur', 'Fabrika Müdürü', 'mudur@ornek.com', hash('Mudur123!'), 'manager', 250000, 0, Date.now());
    insUser.run('operator', 'Depo Operatörü', 'depo@ornek.com', hash('Operator123!'), 'operator', 0, 0, Date.now());
    insUser.run('kalite', 'Kalite Sorumlusu', 'kalite@ornek.com', hash('Kalite123!'), 'quality', 0, 0, Date.now());
    insUser.run('viewer', 'Görüntüleyici', 'goruntule@ornek.com', hash('Viewer123!'), 'viewer', 0, 0, Date.now());

    // ---------- Settings & FX ----------
    const setS = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    setS.run('companyName', 'Örnek Metal Sanayi A.Ş.');
    setS.run('baseCurrency', 'TRY');
    setS.run('defaultLaborRate', '250');       // TRY per hour
    setS.run('defaultOverheadPct', '15');
    setS.run('expiryWarningDays', '30');
    setS.run('lowStockCheckEnabled', '1');
    // e-Belge kapsam dışı: modül kodda duruyor ama varsayılan olarak KAPALI.
    // İstenirse Yönetim > e-Belge Ayarları'ndan açılabilir; adaptör katmanı hazırdır.
    setS.run('einvoiceEnabled', '0');
    setS.run('einvoiceProvider', 'local');
    setS.run('einvoiceTestMode', '1');
    setS.run('defaultVatRate', '20');

    const insFx = db.prepare('INSERT INTO exchange_rates (currency,rate,rate_date,source,created_at) VALUES (?,?,?,?,?)');
    // A short history so historical valuation genuinely differs from today's rate
    [[-180, 32.10, 35.00], [-90, 33.20, 36.10], [-30, 34.00, 36.80], [0, 34.50, 37.20]]
      .forEach(([off, usd, eur]) => {
        insFx.run('USD', usd, dstr(off), 'seed', Date.now());
        insFx.run('EUR', eur, dstr(off), 'seed', Date.now());
      });

    // ---------- Warehouses ----------
    const insWh = db.prepare('INSERT INTO warehouses (company_id,code,name,address,is_quarantine) VALUES (1,?,?,?,?)');
    const whMain = insWh.run('MRK', 'Merkez Depo (İstanbul)', 'Tuzla OSB, İstanbul', 0).lastInsertRowid;
    const whIzmir = insWh.run('IZM', 'İzmir Depo', 'Kemalpaşa, İzmir', 0).lastInsertRowid;
    const whIntl = insWh.run('HAM', 'Yurt Dışı Depo (Hamburg)', 'Hamburg, Germany', 0).lastInsertRowid;
    const whQuar = insWh.run('KRT', 'Karantina Deposu', 'Tuzla OSB, İstanbul', 1).lastInsertRowid;

    // ---------- Suppliers ----------
    const insSup = db.prepare(`INSERT INTO suppliers (company_id,code,name,contact_person,phone,email,address,country,tax_no,currency,payment_terms_days,lead_time_days,incoterm,is_approved,created_at)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
    const supAkim = insSup.run('TED-001', 'Akım Bağlantı San. Ltd.', 'Mehmet Yılmaz', '+90 216 555 1010', 'satis@akimbaglanti.com', 'Tuzla, İstanbul', 'TR', '1112223334', 'TRY', 45, 5, 'EXW', Date.now()).lastInsertRowid;
    const supElek = insSup.run('TED-002', 'Akım Elektrik Ltd.', 'Ayşe Demir', '+90 232 555 2020', 'info@akimelektrik.com', 'Bornova, İzmir', 'TR', '2223334445', 'TRY', 30, 7, 'EXW', Date.now()).lastInsertRowid;
    const supSafe = insSup.run('TED-003', 'SafeGuard GmbH', 'Hans Müller', '+49 40 555 3030', 'sales@safeguard.de', 'Hamburg, Germany', 'DE', 'DE123456789', 'EUR', 60, 21, 'FOB', Date.now()).lastInsertRowid;
    const supLub = insSup.run('TED-004', 'Lubritech AG', 'Klaus Weber', '+41 44 555 4040', 'order@lubritech.ch', 'Zürich, Switzerland', 'CH', 'CHE987654', 'USD', 45, 28, 'CIF', Date.now()).lastInsertRowid;
    const supPalet = insSup.run('TED-005', 'Palet Dünyası', 'Ali Kaya', '+90 216 555 5050', 'siparis@paletdunyasi.com', 'Gebze, Kocaeli', 'TR', '3334445556', 'TRY', 15, 3, 'DAP', Date.now()).lastInsertRowid;

    // ---------- Customers ----------
    const insCus = db.prepare(`INSERT INTO customers (company_id,code,name,contact_person,phone,email,address,country,tax_no,currency,payment_terms_days,credit_limit,incoterm,created_at,
        identity_no,tax_office,district,city,is_einvoice_user,einvoice_alias)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const cusAnadolu = insCus.run('MUS-001', 'Anadolu Makine A.Ş.', 'Fatih Şahin', '+90 312 555 6060', 'satinalma@anadolumakine.com', 'OSTİM, Ankara', 'TR', '4445556667', 'TRY', 60, 2000000, 'DAP', Date.now(),
      '4445556667', 'Ostim', 'Yenimahalle', 'Ankara', 1, 'urn:mail:defaultpk@anadolumakine.com').lastInsertRowid;
    const cusNordic = insCus.run('MUS-002', 'Nordic Industrial AB', 'Erik Lindqvist', '+46 8 555 7070', 'purchasing@nordicind.se', 'Göteborg, Sweden', 'SE', 'SE556677', 'EUR', 45, 500000, 'FOB', Date.now(),
      'SE556677', null, null, 'Göteborg', 0, null).lastInsertRowid;
    const cusEge = insCus.run('MUS-003', 'Ege Otomotiv Ltd.', 'Zeynep Arslan', '+90 232 555 8080', 'tedarik@egeotomotiv.com', 'Torbalı, İzmir', 'TR', '5556667778', 'TRY', 30, 750000, 'EXW', Date.now(),
      '5556667778', 'Torbalı', 'Torbalı', 'İzmir', 0, null).lastInsertRowid;

    // ---------- Items ----------
    const insItem = db.prepare(`INSERT INTO items (company_id,id,name,code,barcode,category,item_type,origin,default_warehouse_id,location,unit,
      min_stock,reorder_qty,costing_method,avg_cost,sale_price,sale_currency,is_lot_tracked,shelf_life_days,requires_incoming_inspection,
      hs_code,default_supplier_id,supplier,description,qty_cache,created_at)
      VALUES (1,@id,@name,@code,@barcode,@category,@item_type,@origin,@wh,@location,@unit,@min_stock,@reorder_qty,@costing,@avg_cost,
      @sale_price,@sale_currency,@lot,@shelf,@insp,@hs,@sup,@sup_name,@desc,0,@now)`);

    const I = {};
    const mk = (key, o) => {
      const id = uuid(); I[key] = id;
      insItem.run({
        id, name: o.name, code: o.code, barcode: o.barcode || null, category: o.category,
        item_type: o.type || 'raw', origin: o.origin || 'Yurt İçi', wh: o.wh || whMain,
        location: o.location || null, unit: o.unit, min_stock: o.min || 0, reorder_qty: o.reorder || 0,
        costing: o.costing || 'moving_average', avg_cost: 0, sale_price: o.salePrice || 0,
        sale_currency: o.saleCur || 'TRY', lot: o.lot === false ? 0 : 1, shelf: o.shelf || null,
        insp: o.insp ? 1 : 0, hs: o.hs || null, sup: o.supplier || null, sup_name: o.supName || null,
        desc: o.desc || null, now: Date.now()
      });
      return id;
    };

    mk('somun', { name: 'Altıgen Somun M8', code: 'SM-108', barcode: '8690123456781', category: 'Bağlantı Elemanı', unit: 'adet', min: 100, reorder: 1000, location: 'A-12', supplier: supAkim, supName: 'Akım Bağlantı San. Ltd.', hs: '7318.16', desc: 'M8 paslanmaz çelik altıgen somun, DIN 934.' });
    mk('kablo', { name: 'Kablo Rulosu 2.5mm', code: 'KB-225', barcode: '8690123456798', category: 'Elektrik', unit: 'rulo', min: 10, reorder: 40, location: 'B-04', supplier: supElek, supName: 'Akım Elektrik Ltd.', hs: '8544.49', desc: '100m NYA 2.5mm² tek damarlı kablo.' });
    mk('eldiven', { name: 'Endüstriyel Eldiven (L)', code: 'PP-311', barcode: '4006381333931', category: 'Kişisel Koruma', unit: 'çift', min: 20, reorder: 200, origin: 'Yurt Dışı', wh: whIntl, location: 'C-01', supplier: supSafe, supName: 'SafeGuard GmbH', insp: true, hs: '6116.10', desc: 'Kesilmeye dayanıklı L beden iş eldiveni, EN388.' });
    mk('vida', { name: 'Paslanmaz Vida 4x30', code: 'VD-430', barcode: '8690123456804', category: 'Bağlantı Elemanı', unit: 'kutu', min: 15, reorder: 100, location: 'A-14', supplier: supAkim, supName: 'Akım Bağlantı San. Ltd.', hs: '7318.15', desc: '100 adetlik kutu, 4x30mm paslanmaz vida.' });
    mk('palet', { name: 'Ahşap Palet 120x80', code: 'PL-120', barcode: '8690123456811', category: 'Ambalaj', unit: 'adet', min: 5, reorder: 50, wh: whIzmir, location: 'D-02', supplier: supPalet, supName: 'Palet Dünyası', lot: false, desc: 'Standart europalet.' });
    mk('yag', { name: 'Hidrolik Yağ 15L', code: 'HY-015', barcode: '4008832012345', category: 'Bakım', unit: 'bidon', min: 4, reorder: 20, origin: 'Yurt Dışı', wh: whIntl, location: 'B-09', supplier: supLub, supName: 'Lubritech AG', shelf: 540, insp: true, hs: '2710.19', desc: 'ISO VG46 hidrolik sistem yağı.' });
    mk('sac', { name: 'Paslanmaz Sac 2mm', code: 'SC-200', barcode: '8690123456835', category: 'Hammadde', unit: 'kg', min: 200, reorder: 1000, location: 'A-01', supplier: supAkim, supName: 'Akım Bağlantı San. Ltd.', insp: true, hs: '7219.34', desc: '304 kalite paslanmaz sac, 2mm.' });
    mk('set', { name: 'Elektrik Bağlantı Seti', code: 'SET-001', barcode: '8690123456828', category: 'Bitmiş Ürün', type: 'finished', unit: 'set', min: 10, location: 'E-01', salePrice: 450, desc: 'Kablo, somun ve vidadan oluşan hazır bağlantı seti.' });
    mk('panel', { name: 'Montaj Paneli MP-500', code: 'MP-500', barcode: '8690123456842', category: 'Bitmiş Ürün', type: 'finished', unit: 'adet', min: 5, location: 'E-02', salePrice: 1250, desc: 'Sacdan üretilen montaj paneli, elektrik seti entegre.' });

    // ---------- BOM ----------
    const insBom = db.prepare('INSERT INTO item_bom (item_id,component_item_id,qty_per_unit,scrap_pct,unit) VALUES (?,?,?,?,?)');
    insBom.run(I.set, I.kablo, 0.05, 2, 'rulo');
    insBom.run(I.set, I.somun, 2, 1, 'adet');
    insBom.run(I.set, I.vida, 0.1, 1, 'kutu');
    // Multi-level BOM: panel consumes the set, demonstrating full genealogy
    insBom.run(I.panel, I.sac, 3.5, 5, 'kg');
    insBom.run(I.panel, I.set, 1, 0, 'set');
    insBom.run(I.panel, I.somun, 8, 1, 'adet');

    // ---------- Inspection plans ----------
    const insPlan = db.prepare('INSERT INTO inspection_plans (item_id,type,characteristic,spec_min,spec_max,spec_text,aql) VALUES (?,?,?,?,?,?,?)');
    insPlan.run(I.sac, 'incoming', 'Kalınlık (mm)', 1.9, 2.1, null, '2.5');
    insPlan.run(I.sac, 'incoming', 'Yüzey kalitesi', null, null, 'Çizik ve pas olmamalı', '2.5');
    insPlan.run(I.eldiven, 'incoming', 'Kesilme direnci (EN388)', 3, 5, null, '1.0');
    insPlan.run(I.yag, 'incoming', 'Viskozite (cSt @40°C)', 41.4, 50.6, null, '1.0');
    insPlan.run(I.panel, 'final', 'Delik merkez mesafesi (mm)', 99.5, 100.5, null, '1.0');
    insPlan.run(I.panel, 'final', 'Kaplama görünümü', null, null, 'Homojen, kabarcıksız', '1.0');

    // ---------- Opening stock lots ----------
    const insLot = db.prepare(`INSERT INTO stock_lots (id,item_id,warehouse_id,lot_no,qty,status,expiry_date,unit_cost,received_at,source_type,supplier_id)
      VALUES (?,?,?,?,?,?,?,?,?,'opening',?)`);
    const insMov = db.prepare(`INSERT INTO movements (id,item_id,item_name,lot_id,lot_no,warehouse_id,type,qty,unit_cost,to_status,note,ref_type,ts,user_id)
      VALUES (?,?,?,?,?,?,'in',?,?,?,?,'opening',?,1)`);

    const openLot = (itemKey, itemName, wh, lotNo, qty, cost, ageDays, opts = {}) => {
      const lotId = uuid();
      insLot.run(lotId, I[itemKey], wh, lotNo, qty, opts.status || 'available', opts.expiry || null, cost,
        Date.now() - ageDays * DAY, opts.supplier || null);
      insMov.run(uuid(), I[itemKey], itemName, lotId, lotNo, wh, qty, cost, opts.status || 'available',
        'Açılış stoğu', Date.now() - ageDays * DAY);
      return lotId;
    };

    const lotSomun1 = openLot('somun', 'Altıgen Somun M8', whMain, 'LOT-SM-2401', 250, 2.05, 200, { supplier: supAkim });
    const lotSomun2 = openLot('somun', 'Altıgen Somun M8', whMain, 'LOT-SM-2402', 400, 2.18, 45, { supplier: supAkim });
    const lotKablo1 = openLot('kablo', 'Kablo Rulosu 2.5mm', whMain, 'LOT-KB-2405', 22, 1735.00, 60, { supplier: supElek });
    const lotVida1 = openLot('vida', 'Paslanmaz Vida 4x30', whMain, 'LOT-VD-2403', 60, 22.50, 90, { supplier: supAkim });
    const lotSac1 = openLot('sac', 'Paslanmaz Sac 2mm', whMain, 'LOT-SC-2404', 850, 148.00, 70, { supplier: supAkim });
    const lotEldiven = openLot('eldiven', 'Endüstriyel Eldiven (L)', whIntl, 'LOT-PP-2312', 6, 122.40, 210, { supplier: supSafe });
    const lotYag = openLot('yag', 'Hidrolik Yağ 15L', whIntl, 'LOT-HY-2402', 9, 1414.50, 160, { expiry: dstr(21), supplier: supLub });
    openLot('palet', 'Ahşap Palet 120x80', whIzmir, null, 0, 85.00, 300, { supplier: supPalet });
    // A quarantined lot awaiting incoming inspection
    const lotSacQ = openLot('sac', 'Paslanmaz Sac 2mm', whQuar, 'LOT-SC-2501', 300, 152.00, 3, { status: 'quarantine', supplier: supAkim });
    // Dead stock: old, untouched
    openLot('vida', 'Paslanmaz Vida 4x30', whIzmir, 'LOT-VD-2201', 18, 19.80, 420, { supplier: supAkim });

    // Set avg_cost + qty_cache from the opening lots
    db.prepare(`UPDATE items SET qty_cache = COALESCE((SELECT SUM(qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)`).run();
    db.prepare(`UPDATE items SET avg_cost = COALESCE((
      SELECT SUM(sl.qty * sl.unit_cost) / NULLIF(SUM(sl.qty),0) FROM stock_lots sl
      WHERE sl.item_id = items.id AND sl.status='available'),0)`).run();

    // ---------- Purchase requests / RFQ ----------
    const prId = uuid();
    db.prepare(`INSERT INTO purchase_requests (id,request_no,requested_by,department,needed_by,status,notes,created_at)
      VALUES (?,?,?,?,?,'submitted',?,?)`).run(prId, 'TAL-2026-001', 3, 'Üretim', dstr(20), 'Üretim planı için sac ihtiyacı', Date.now() - 5 * DAY);
    db.prepare('INSERT INTO purchase_request_lines (request_id,item_id,item_name,qty,unit) VALUES (?,?,?,?,?)')
      .run(prId, I.sac, 'Paslanmaz Sac 2mm', 1000, 'kg');

    const rfqId = uuid();
    db.prepare(`INSERT INTO rfqs (id,rfq_no,request_id,status,due_date,notes,created_by,created_at)
      VALUES (?,?,?,'open',?,?,2,?)`).run(rfqId, 'TKL-2026-001', prId, dstr(7), '1000 kg paslanmaz sac için teklif', Date.now() - 4 * DAY);
    db.prepare('INSERT INTO rfq_lines (rfq_id,item_id,item_name,qty) VALUES (?,?,?,?)').run(rfqId, I.sac, 'Paslanmaz Sac 2mm', 1000);
    const insQuote = db.prepare('INSERT INTO rfq_quotes (rfq_id,supplier_id,item_id,unit_price,currency,lead_time_days,valid_until) VALUES (?,?,?,?,?,?,?)');
    insQuote.run(rfqId, supAkim, I.sac, 151.00, 'TRY', 5, dstr(30));
    insQuote.run(rfqId, supElek, I.sac, 149.50, 'TRY', 12, dstr(30));
    insQuote.run(rfqId, supSafe, I.sac, 4.35, 'EUR', 21, dstr(30));

    // ---------- Purchase orders ----------
    const insPO = db.prepare(`INSERT INTO purchase_orders (id,po_no,supplier_id,supplier_name,date,expected,warehouse_id,currency,fx_rate,incoterm,status,approval_status,approved_by,approved_at,total_base,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insPOItem = db.prepare('INSERT INTO po_items (po_id,item_id,item_name,qty,received_qty,price,currency) VALUES (?,?,?,?,?,?,?)');

    // Open, approved, partially received (demonstrates partial receipt)
    const po1 = uuid();
    insPO.run(po1, 'SA-2026-001', supAkim, 'Akım Bağlantı San. Ltd.', dstr(-12), dstr(-2), whMain, 'TRY', 1, 'EXW',
      'partially_received', 'approved', 1, Date.now() - 11 * DAY, 302000, 'Sac ve somun siparişi', 2, Date.now() - 12 * DAY);
    insPOItem.run(po1, I.sac, 'Paslanmaz Sac 2mm', 2000, 300, 151.00, 'TRY');
    insPOItem.run(po1, I.somun, 'Altıgen Somun M8', 5000, 0, 2.20, 'TRY');

    // International order pending approval (high value → needs approval)
    const po2 = uuid();
    insPO.run(po2, 'SA-2026-002', supSafe, 'SafeGuard GmbH', dstr(-3), dstr(18), whIntl, 'EUR', 37.20, 'FOB',
      'pending_approval', 'pending', null, null, 111600, 'Eldiven ithalatı', 3, Date.now() - 3 * DAY);
    insPOItem.run(po2, I.eldiven, 'Endüstriyel Eldiven (L)', 1000, 0, 3.00, 'EUR');

    // Overdue order (demonstrates supplier delay tracking)
    const po3 = uuid();
    insPO.run(po3, 'SA-2026-003', supLub, 'Lubritech AG', dstr(-40), dstr(-8), whIntl, 'USD', 34.00, 'CIF',
      'approved', 'approved', 1, Date.now() - 39 * DAY, 41400, 'Hidrolik yağ siparişi (gecikmiş)', 2, Date.now() - 40 * DAY);
    insPOItem.run(po3, I.yag, 'Hidrolik Yağ 15L', 30, 0, 40.60, 'USD');

    const insPH = db.prepare('INSERT INTO supplier_price_history (supplier_id,item_id,price,currency,source,source_id,recorded_at) VALUES (?,?,?,?,?,?,?)');
    insPH.run(supAkim, I.sac, 148.00, 'TRY', 'po', po1, Date.now() - 90 * DAY);
    insPH.run(supAkim, I.sac, 151.00, 'TRY', 'po', po1, Date.now() - 12 * DAY);
    insPH.run(supAkim, I.somun, 2.05, 'TRY', 'po', po1, Date.now() - 200 * DAY);
    insPH.run(supAkim, I.somun, 2.20, 'TRY', 'po', po1, Date.now() - 12 * DAY);
    insPH.run(supSafe, I.eldiven, 3.30, 'EUR', 'po', po2, Date.now() - 210 * DAY);
    insPH.run(supSafe, I.eldiven, 3.00, 'EUR', 'po', po2, Date.now() - 3 * DAY);

    // Receipt for the partially received order, with landed cost
    const rcpt1 = uuid();
    db.prepare(`INSERT INTO po_receipts (id,receipt_no,po_id,warehouse_id,received_at,received_by,waybill_no,notes)
      VALUES (?,?,?,?,?,?,?,?)`).run(rcpt1, 'IRS-2026-001', po1, whQuar, Date.now() - 3 * DAY, 3, 'IRS-889321', 'Kısmi teslimat - 300 kg');
    db.prepare(`INSERT INTO po_receipt_lines (receipt_id,po_item_id,item_id,item_name,qty,lot_no,lot_id,to_quarantine)
      VALUES (?,(SELECT id FROM po_items WHERE po_id=? AND item_id=?),?,?,?,?,?,1)`)
      .run(rcpt1, po1, I.sac, I.sac, 'Paslanmaz Sac 2mm', 300, 'LOT-SC-2501', lotSacQ);
    db.prepare(`INSERT INTO landed_costs (receipt_id,po_id,cost_type,amount,currency,fx_rate,allocation_method,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(rcpt1, po1, 'freight', 1500, 'TRY', 1, 'value', 'Nakliye bedeli', Date.now() - 3 * DAY);

    // ---------- Incoming inspection on the quarantined lot ----------
    const inspId = uuid();
    db.prepare(`INSERT INTO inspections (id,inspection_no,type,item_id,item_name,lot_id,lot_no,receipt_id,supplier_id,
      sample_size,inspected_qty,accepted_qty,rejected_qty,aql,result,created_at)
      VALUES (?,?,'incoming',?,?,?,?,?,?,?,?,0,0,?, 'pending',?)`)
      .run(inspId, 'MUA-2026-001', I.sac, 'Paslanmaz Sac 2mm', lotSacQ, 'LOT-SC-2501', rcpt1, supAkim, 8, 300, '2.5', Date.now() - 2 * DAY);
    const insIL = db.prepare('INSERT INTO inspection_lines (inspection_id,characteristic,spec_min,spec_max,spec_text) VALUES (?,?,?,?,?)');
    insIL.run(inspId, 'Kalınlık (mm)', 1.9, 2.1, null);
    insIL.run(inspId, 'Yüzey kalitesi', null, null, 'Çizik ve pas olmamalı');

    // ---------- A closed NCR + CAPA (supplier quality history) ----------
    const ncrId = uuid();
    db.prepare(`INSERT INTO ncrs (id,ncr_no,source,item_id,item_name,lot_id,lot_no,supplier_id,qty_affected,severity,description,disposition,status,opened_by,opened_at,closed_by,closed_at)
      VALUES (?,?,'incoming',?,?,?,?,?,?,'major',?,'return_to_supplier','closed',4,?,4,?)`)
      .run(ncrId, 'UYG-2026-001', I.eldiven, 'Endüstriyel Eldiven (L)', lotEldiven, 'LOT-PP-2312', supSafe, 24,
        'Partide 24 çift eldivenin dikişleri açık geldi, EN388 kesilme direnci sağlanmıyor.',
        Date.now() - 150 * DAY, Date.now() - 120 * DAY);
    db.prepare(`INSERT INTO capas (id,capa_no,ncr_id,type,root_cause,action_plan,responsible_user_id,due_date,effectiveness_check,status,opened_at,closed_at)
      VALUES (?,?,?,'corrective',?,?,4,?,?,'closed',?,?)`)
      .run(uuid(), 'DOF-2026-001', ncrId,
        'Tedarikçinin dikiş hattında kalite kontrol adımı atlanmış.',
        'Tedarikçiden düzeltici faaliyet raporu talep edildi; sonraki 3 sevkiyat %100 muayeneye alınacak.',
        dstr(-100), 'Sonraki 3 sevkiyatta uygunsuzluk görülmedi.', Date.now() - 150 * DAY, Date.now() - 95 * DAY);

    // ---------- Equipment & calibration ----------
    const insEq = db.prepare(`INSERT INTO equipment (code,name,serial_no,location,calibration_interval_days,last_calibration_date,next_calibration_date,status)
      VALUES (?,?,?,?,?,?,?, 'active')`);
    const eq1 = insEq.run('OLC-001', 'Dijital Kumpas 0-150mm', 'MIT-889231', 'Kalite Laboratuvarı', 365, dstr(-340), dstr(25)).lastInsertRowid;
    const eq2 = insEq.run('OLC-002', 'Terazi 0-30kg', 'SRT-114509', 'Depo Girişi', 365, dstr(-200), dstr(165)).lastInsertRowid;
    insEq.run('OLC-003', 'Yüzey Pürüzlülük Cihazı', 'MHR-77120', 'Kalite Laboratuvarı', 730, dstr(-700), dstr(30));
    const insCal = db.prepare(`INSERT INTO calibrations (equipment_id,calibration_date,next_due_date,performed_by,certificate_no,result,recorded_at)
      VALUES (?,?,?,?,?,?,?)`);
    insCal.run(eq1, dstr(-340), dstr(25), 'TÜRKAK Akredite Lab.', 'CAL-2025-4471', 'pass', Date.now() - 340 * DAY);
    insCal.run(eq2, dstr(-200), dstr(165), 'TÜRKAK Akredite Lab.', 'CAL-2025-5580', 'pass', Date.now() - 200 * DAY);

    // ---------- Completed production (with genealogy + real costing) ----------
    const prodId = uuid();
    const outLotId = uuid();
    const compCost = (0.5 * 1735.00) + (40 * 2.05) + (2 * 22.50);   // kablo + somun + vida consumed
    const labor = 250 * 6;      // 6 hours
    const overhead = compCost * 0.15;
    const totalCost = compCost + labor + overhead;
    const produced = 20;

    // The output lot must exist before the production order can reference it (FK).
    insLot.run(outLotId, I.set, whMain, 'PARTI-SET-0901', produced, 'available', null, totalCost / produced,
      Date.now() - 8 * DAY, null);

    db.prepare(`INSERT INTO production_orders (id,order_no,item_id,item_name,warehouse_id,qty,produced_qty,scrap_qty,rework_qty,status,date,lot_no,output_lot_id,
      labor_cost,overhead_cost,material_cost,total_cost,unit_cost,note,completed_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,'Tamamlandı',?,?,?,?,?,?,?,?,?,?,2)`)
      .run(prodId, 'URT-2026-001', I.set, 'Elektrik Bağlantı Seti', whMain, 21, produced, 1, 0,
        dstr(-8), 'PARTI-SET-0901', outLotId, labor, overhead, compCost, totalCost, totalCost / produced,
        'İlk seri üretim, 1 adet fire', Date.now() - 8 * DAY);

    db.prepare(`UPDATE stock_lots SET source_type='production', source_id=? WHERE id=?`).run(prodId, outLotId);
    insMov.run(uuid(), I.set, 'Elektrik Bağlantı Seti', outLotId, 'PARTI-SET-0901', whMain, produced, totalCost / produced,
      'available', 'Üretim emri URT-2026-001', Date.now() - 8 * DAY);

    const insComp = db.prepare('INSERT INTO production_order_components (production_order_id,component_item_id,component_name,qty_used) VALUES (?,?,?,?)');
    const insCons = db.prepare('INSERT INTO production_consumption (production_order_id,component_item_id,component_name,lot_id,lot_no,qty,unit_cost) VALUES (?,?,?,?,?,?,?)');
    insComp.run(prodId, I.kablo, 'Kablo Rulosu 2.5mm', 0.5);
    insComp.run(prodId, I.somun, 'Altıgen Somun M8', 40);
    insComp.run(prodId, I.vida, 'Paslanmaz Vida 4x30', 2);
    insCons.run(prodId, I.kablo, 'Kablo Rulosu 2.5mm', lotKablo1, 'LOT-KB-2405', 0.5, 1735.00);
    insCons.run(prodId, I.somun, 'Altıgen Somun M8', lotSomun1, 'LOT-SM-2401', 40, 2.05);
    insCons.run(prodId, I.vida, 'Paslanmaz Vida 4x30', lotVida1, 'LOT-VD-2403', 2, 22.50);
    // Reflect the consumption on the source lots
    db.prepare('UPDATE stock_lots SET qty = qty - 0.5 WHERE id = ?').run(lotKablo1);
    db.prepare('UPDATE stock_lots SET qty = qty - 40 WHERE id = ?').run(lotSomun1);
    db.prepare('UPDATE stock_lots SET qty = qty - 2 WHERE id = ?').run(lotVida1);
    [[I.kablo, 'Kablo Rulosu 2.5mm', lotKablo1, 'LOT-KB-2405', 0.5, 1735.00],
     [I.somun, 'Altıgen Somun M8', lotSomun1, 'LOT-SM-2401', 40, 2.05],
     [I.vida, 'Paslanmaz Vida 4x30', lotVida1, 'LOT-VD-2403', 2, 22.50]].forEach(([it, nm, lot, lno, q, c]) => {
      db.prepare(`INSERT INTO movements (id,item_id,item_name,lot_id,lot_no,warehouse_id,type,qty,unit_cost,note,ref_type,ref_id,ts,user_id)
        VALUES (?,?,?,?,?,?,'out',?,?,?,'production',?,?,2)`)
        .run(uuid(), it, nm, lot, lno, whMain, q, c, 'Üretim emri URT-2026-001', prodId, Date.now() - 8 * DAY);
    });

    // Planned production order awaiting completion
    const prod2 = uuid();
    db.prepare(`INSERT INTO production_orders (id,order_no,item_id,item_name,warehouse_id,qty,status,date,note,created_by)
      VALUES (?,?,?,?,?,?, 'Planlandı',?,?,2)`)
      .run(prod2, 'URT-2026-002', I.panel, 'Montaj Paneli MP-500', whMain, 10, dstr(2), 'Anadolu Makine siparişi için');
    insComp.run(prod2, I.sac, 'Paslanmaz Sac 2mm', 36.75);
    insComp.run(prod2, I.set, 'Elektrik Bağlantı Seti', 10);
    insComp.run(prod2, I.somun, 'Altıgen Somun M8', 80.8);

    // ---------- Sales orders & shipment (with COGS from real lots) ----------
    const so1 = uuid();
    db.prepare(`INSERT INTO sales_orders (id,so_no,customer_id,customer_name,date,promised_date,currency,fx_rate,incoterm,status,total_base,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?,'TRY',1,'DAP','partially_shipped',?,?,2,?)`)
      .run(so1, 'SAT-2026-001', cusAnadolu, 'Anadolu Makine A.Ş.', dstr(-6), dstr(10), 6750, 'İlk parti sipariş', Date.now() - 6 * DAY);
    db.prepare('INSERT INTO sales_order_lines (so_id,item_id,item_name,qty,shipped_qty,price,currency,cogs_base) VALUES (?,?,?,?,?,?,?,?)')
      .run(so1, I.set, 'Elektrik Bağlantı Seti', 15, 8, 450, 'TRY', 8 * (totalCost / produced));

    const ship1 = uuid();
    db.prepare(`INSERT INTO shipments (id,shipment_no,so_id,customer_id,type,carrier,destination,status,date,incoterm,tracking_no,created_by)
      VALUES (?,?,?,?, 'Yurt İçi','Aras Kargo','OSTİM, Ankara','Yolda',?,'DAP',?,3)`)
      .run(ship1, 'SVK-2026-001', so1, cusAnadolu, dstr(-4), 'ARS-99120345');
    db.prepare('INSERT INTO shipment_items (shipment_id,item_id,item_name,lot_id,lot_no,qty,unit_cost) VALUES (?,?,?,?,?,?,?)')
      .run(ship1, I.set, 'Elektrik Bağlantı Seti', outLotId, 'PARTI-SET-0901', 8, totalCost / produced);
    db.prepare('UPDATE stock_lots SET qty = qty - 8 WHERE id = ?').run(outLotId);
    db.prepare(`INSERT INTO movements (id,item_id,item_name,lot_id,lot_no,warehouse_id,type,qty,unit_cost,note,ref_type,ref_id,ts,user_id)
      VALUES (?,?,?,?,?,?,'out',?,?,?,'shipment',?,?,3)`)
      .run(uuid(), I.set, 'Elektrik Bağlantı Seti', outLotId, 'PARTI-SET-0901', whMain, 8, totalCost / produced,
        'Sevkiyat SVK-2026-001', ship1, Date.now() - 4 * DAY);
    db.prepare('INSERT INTO shipment_crates (shipment_id,crate_no,w,h,d,weight) VALUES (?,?,?,?,?,?)')
      .run(ship1, 'KSA-2026-001', 60, 40, 40, 24.5);

    const so2 = uuid();
    db.prepare(`INSERT INTO sales_orders (id,so_no,customer_id,customer_name,date,promised_date,currency,fx_rate,incoterm,status,total_base,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?, 'EUR',37.20,'FOB','open',?,?,2,?)`)
      .run(so2, 'SAT-2026-002', cusNordic, 'Nordic Industrial AB', dstr(-2), dstr(25), 186000, 'İhracat siparişi', Date.now() - 2 * DAY);
    db.prepare('INSERT INTO sales_order_lines (so_id,item_id,item_name,qty,shipped_qty,price,currency) VALUES (?,?,?,?,0,?,?)')
      .run(so2, I.panel, 'Montaj Paneli MP-500', 100, 50, 'EUR');

    // ---------- Üretim planlama: iş merkezleri, vardiyalar, rotalar ----------
    const insWc = db.prepare(`INSERT INTO work_centers (code,name,description,warehouse_id,capacity_units,
        hourly_rate,efficiency_pct,downtime_pct,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    const wcKesim = insWc.run('IM-01', 'Sac Kesim', 'CNC lazer kesim tezgâhı', whMain, 1, 420, 92, 8, Date.now()).lastInsertRowid;
    const wcBukum = insWc.run('IM-02', 'Büküm / Abkant', 'Abkant pres', whMain, 2, 310, 95, 5, Date.now()).lastInsertRowid;
    const wcMontaj = insWc.run('IM-03', 'Montaj Hattı', 'Elle montaj istasyonları', whMain, 4, 260, 88, 6, Date.now()).lastInsertRowid;
    const wcKaplama = insWc.run('IM-04', 'Toz Boya', 'Elektrostatik toz boya kabini', whMain, 1, 380, 90, 12, Date.now()).lastInsertRowid;

    // Kesim ve büküm iki vardiya, montaj tek vardiya, boya üç vardiya çalışır
    const insWcs = db.prepare('INSERT INTO work_center_shifts (work_center_id,shift_id) VALUES (?,?)');
    [[wcKesim,1],[wcKesim,2],[wcBukum,1],[wcBukum,2],[wcMontaj,1],
     [wcKaplama,1],[wcKaplama,2],[wcKaplama,3]].forEach(([w,sh]) => insWcs.run(w,sh));

    const insRoute = db.prepare(`INSERT INTO routings (item_id,operation_no,operation_name,work_center_id,
      setup_minutes,run_minutes_per_unit,queue_minutes,scrap_pct,notes) VALUES (?,?,?,?,?,?,?,?,?)`);
    // Elektrik seti: sadece montaj
    insRoute.run(I.set, 10, 'Montaj', wcMontaj, 15, 6, 0, 1, 'Kablo, somun ve vida montajı');
    // Montaj paneli: kesim → büküm → montaj → boya
    insRoute.run(I.panel, 10, 'Sac Kesim', wcKesim, 30, 8, 60, 3, 'Lazer kesim, 2mm paslanmaz');
    insRoute.run(I.panel, 20, 'Büküm', wcBukum, 20, 5, 30, 2, null);
    insRoute.run(I.panel, 30, 'Montaj', wcMontaj, 15, 12, 0, 1, 'Elektrik seti entegrasyonu');
    insRoute.run(I.panel, 40, 'Toz Boya', wcKaplama, 45, 4, 120, 2, 'RAL 7035, fırın kürleme');

    // Planlama parametreleri: neyin üretildiği, neyin satın alındığı
    const setProc = db.prepare('UPDATE items SET procurement_type=?, safety_stock=?, lot_size=?, min_lot_size=?, manufacturing_lead_days=? WHERE id=?');
    setProc.run('make', 5, 0, 5, 2, I.set);
    setProc.run('make', 3, 0, 1, 5, I.panel);
    setProc.run('buy', 200, 500, 0, 0, I.somun);
    setProc.run('buy', 5, 10, 0, 0, I.kablo);
    setProc.run('buy', 10, 25, 0, 0, I.vida);
    setProc.run('buy', 300, 500, 0, 0, I.sac);
    setProc.run('buy', 20, 100, 0, 0, I.eldiven);
    setProc.run('buy', 4, 10, 0, 0, I.yag);
    setProc.run('buy', 5, 25, 0, 0, I.palet);

    // Tatil örneği: kapasite hesabının tatili düştüğü görülsün
    db.prepare('INSERT INTO calendar_exceptions (work_center_id,date,reason,exception_type) VALUES (NULL,?,?,?)')
      .run(dstr(14), 'Resmî tatil', 'holiday');

    // Geçmiş vardiya kayıtları: OEE'nin hesaplanabilmesi için
    const insLog = db.prepare(`INSERT INTO shift_logs (date,shift_id,work_center_id,planned_minutes,worked_minutes,
      downtime_minutes,downtime_reason,produced_qty,scrap_qty,operator_count,recorded_by,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,3,?)`);
    for (let d = 1; d <= 10; d++) {
      const day = dstr(-d);
      const wd = new Date(day + 'T12:00:00').getDay();
      if (wd === 0 || wd === 6) continue;                 // hafta sonu çalışılmıyor
      insLog.run(day, 1, wcMontaj, 435, 420 - (d % 3) * 10, 15 + (d % 4) * 8,
        d % 3 === 0 ? 'Malzeme bekleme' : 'Ayar', 38 - (d % 5), (d % 4), 4, Date.now());
      insLog.run(day, 1, wcKesim, 435, 400 - (d % 4) * 12, 25 + (d % 3) * 10,
        'Tezgâh ayarı', 62 - (d % 6) * 2, 1 + (d % 3), 1, Date.now());
    }

    insSeqPlanning();

    // ---------- Approval & notification rules ----------
    const insAR = db.prepare('INSERT INTO approval_rules (doc_type,threshold_base,required_role) VALUES (?,?,?)');
    insAR.run('purchase_order', 100000, 'manager');
    insAR.run('purchase_order', 500000, 'admin');
    insAR.run('purchase_request', 50000, 'manager');

    const insNR = db.prepare('INSERT INTO notification_rules (rule_type,channel,threshold_days,recipients) VALUES (?,?,?,?)');
    insNR.run('low_stock', 'inapp', null, null);
    insNR.run('expiry', 'inapp', 30, null);
    insNR.run('overdue_po', 'inapp', 0, null);
    insNR.run('ncr_open', 'inapp', 7, null);
    insNR.run('calibration_due', 'inapp', 30, null);

    // ---------- Number sequences continue from seeded documents ----------
    const insSeq = db.prepare('INSERT INTO number_sequences (key,prefix,next_value) VALUES (?,?,?)');
    insSeq.run('purchase_order', 'SA', 4);
    insSeq.run('purchase_request', 'TAL', 2);
    insSeq.run('rfq', 'TKL', 2);
    insSeq.run('po_receipt', 'IRS', 2);
    insSeq.run('production_order', 'URT', 3);
    insSeq.run('sales_order', 'SAT', 3);
    insSeq.run('shipment', 'SVK', 2);
    insSeq.run('customer_invoice', 'FAT', 1);
    insSeq.run('supplier_invoice', 'TFA', 1);
    insSeq.run('inspection', 'MUA', 2);
    insSeq.run('ncr', 'UYG', 2);
    insSeq.run('capa', 'DOF', 2);
    insSeq.run('stock_count', 'SAY', 1);
    insSeq.run('supplier_return', 'IAD', 1);
    insSeq.run('mrp_run', 'MRP', 1);

    // Final cache/cost refresh after all seeded movements
    db.prepare(`UPDATE items SET qty_cache = COALESCE((SELECT SUM(qty) FROM stock_lots sl WHERE sl.item_id = items.id AND sl.status='available'),0)`).run();
    db.prepare(`UPDATE items SET avg_cost = COALESCE((
      SELECT SUM(sl.qty * sl.unit_cost) / NULLIF(SUM(sl.qty),0) FROM stock_lots sl
      WHERE sl.item_id = items.id AND sl.status='available'), avg_cost)`).run();
  })();

  console.log('Örnek veriler yüklendi / Seed data loaded.');
  console.log('Kullanıcılar / Users: admin/Admin123!  mudur/Mudur123!  operator/Operator123!  kalite/Kalite123!  viewer/Viewer123!');
}

if (require.main === module) {
  const created = seedIfEmpty();
  if (!created) console.log('Veritabanında zaten veri var / Database already seeded — nothing to do.');
}

module.exports = { seed, seedIfEmpty };
