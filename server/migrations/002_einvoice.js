// @ts-nocheck
/**
 * e-Fatura / e-Arşiv / e-İrsaliye desteği.
 *
 * Türkiye'de belirli ciro eşiğinin üzerindeki mükellefler için e-Fatura ve e-İrsaliye
 * zorunludur. Bu geçiş, belgeleri UBL-TR 1.2 formatında üretip bir entegratöre
 * göndermek için gereken alanları ekler.
 *
 * Tasarım kararı: belge gönderimi entegratörden bağımsız tutulur. `e_documents`
 * tablosu belgenin kendisini (XML) ve yaşam döngüsünü saklar; hangi entegratörün
 * kullanıldığı yalnızca `provider` alanında görünür. Entegratör değişirse veri kalır.
 */
module.exports = {
  name: 'e-invoice support',
  up(db) {
    db.exec(`
      -- ============ FİRMA e-BELGE AYARLARI ============
      -- Gönderici bilgileri faturanın üzerinde yer alır; yanlışsa belge GİB'den döner.
      ALTER TABLE companies ADD COLUMN tax_office TEXT;
      ALTER TABLE companies ADD COLUMN district TEXT;
      ALTER TABLE companies ADD COLUMN city TEXT;
      ALTER TABLE companies ADD COLUMN country_code TEXT NOT NULL DEFAULT 'TR';
      ALTER TABLE companies ADD COLUMN postal_code TEXT;
      ALTER TABLE companies ADD COLUMN mersis_no TEXT;
      ALTER TABLE companies ADD COLUMN trade_registry_no TEXT;
      -- GİB'de tanımlı gönderici birim etiketi (ör. urn:mail:defaultgb@firma.com)
      ALTER TABLE companies ADD COLUMN einvoice_sender_alias TEXT;
      ALTER TABLE companies ADD COLUMN edespatch_sender_alias TEXT;

      -- ============ MÜŞTERİ e-BELGE ALANLARI ============
      -- Alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv düzenlenir. Bu ayrım
      -- GİB mükellef listesinden gelir; burada son bilinen durumu saklarız.
      ALTER TABLE customers ADD COLUMN tax_office TEXT;
      ALTER TABLE customers ADD COLUMN district TEXT;
      ALTER TABLE customers ADD COLUMN city TEXT;
      ALTER TABLE customers ADD COLUMN postal_code TEXT;
      ALTER TABLE customers ADD COLUMN country_code TEXT NOT NULL DEFAULT 'TR';
      -- Gerçek kişi ise 11 haneli TCKN, tüzel kişi ise 10 haneli VKN
      ALTER TABLE customers ADD COLUMN identity_no TEXT;
      ALTER TABLE customers ADD COLUMN is_einvoice_user INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN einvoice_alias TEXT;
      ALTER TABLE customers ADD COLUMN edespatch_alias TEXT;
      ALTER TABLE customers ADD COLUMN einvoice_checked_at INTEGER;

      -- ============ KDV ORANLARI ============
      -- Her kalem kendi KDV oranını taşır; tek oran varsaymak yanlış sonuç üretir.
      ALTER TABLE items ADD COLUMN vat_rate REAL NOT NULL DEFAULT 20;
      ALTER TABLE sales_order_lines ADD COLUMN vat_rate REAL NOT NULL DEFAULT 20;
      ALTER TABLE customer_invoices ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;
      ALTER TABLE customer_invoices ADD COLUMN vat_total REAL NOT NULL DEFAULT 0;
      ALTER TABLE customer_invoices ADD COLUMN discount_total REAL NOT NULL DEFAULT 0;
      -- 'satis' | 'iade' | 'tevkifat' | 'istisna' | 'ihrackayitli'
      ALTER TABLE customer_invoices ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'satis';
      ALTER TABLE customer_invoices ADD COLUMN e_document_id TEXT;

      -- Faturanın kalemleri: e-Belge XML'i satır satır üretilir, toplam yetmez.
      CREATE TABLE customer_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES items(id),
        item_name TEXT NOT NULL,
        item_code TEXT,
        qty REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'adet',
        unit_price REAL NOT NULL DEFAULT 0,
        discount_rate REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL DEFAULT 20,
        vat_amount REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL DEFAULT 0,
        line_no INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_cil_invoice ON customer_invoice_lines(invoice_id);

      -- ============ e-BELGELER ============
      CREATE TABLE e_documents (
        id TEXT PRIMARY KEY,
        -- einvoice: e-Fatura (alıcı mükellef) · earchive: e-Arşiv (alıcı mükellef değil)
        -- edespatch: e-İrsaliye
        doc_type TEXT NOT NULL CHECK(doc_type IN ('einvoice','earchive','edespatch')),
        -- GİB'in beklediği tekil belge kimliği (ETTN)
        ettn TEXT NOT NULL UNIQUE,
        -- 3 harf + 4 hane yıl + 9 hane sıra, ör. ABC2026000000001
        document_no TEXT NOT NULL UNIQUE,
        issue_date TEXT NOT NULL,
        issue_time TEXT,
        -- Kaynak belge: müşteri faturası veya sevkiyat
        source_type TEXT NOT NULL CHECK(source_type IN ('customer_invoice','shipment')),
        source_id TEXT NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        receiver_alias TEXT,
        profile_id TEXT,                  -- TICARIFATURA / TEMELFATURA / EARSIVFATURA / TEMELIRSALIYE
        currency TEXT NOT NULL DEFAULT 'TRY',
        subtotal REAL NOT NULL DEFAULT 0,
        vat_total REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        xml TEXT,                          -- üretilen UBL-TR belgesi
        xml_hash TEXT,
        -- draft: üretildi · queued: gönderime alındı · sent: entegratöre iletildi
        -- accepted/rejected: GİB veya alıcı yanıtı · error: gönderim hatası · cancelled: iptal
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft','queued','sent','accepted','rejected','error','cancelled')),
        provider TEXT,                     -- kullanılan entegratör adı
        provider_ref TEXT,                 -- entegratörün kendi takip numarası
        gib_status_code TEXT,
        gib_status_text TEXT,
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at INTEGER,
        responded_at INTEGER,
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_edoc_source ON e_documents(source_type, source_id);
      CREATE INDEX idx_edoc_status ON e_documents(status);
      CREATE INDEX idx_edoc_type_date ON e_documents(doc_type, issue_date);

      -- Gönderim denemelerinin izi: bir belge neden reddedildi sorusunun cevabı burada kalır.
      CREATE TABLE e_document_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        e_document_id TEXT NOT NULL REFERENCES e_documents(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        action TEXT NOT NULL,
        status TEXT,
        message TEXT,
        payload TEXT,
        user_id INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_edoclog_doc ON e_document_log(e_document_id);

      -- Belge numarası serileri: GİB 3 harfli seri + yıl + 9 hane sıra bekler ve
      -- sıranın boşluksuz artması gerekir.
      CREATE TABLE e_document_series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type TEXT NOT NULL,
        prefix TEXT NOT NULL,
        year INTEGER NOT NULL,
        next_value INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(doc_type, prefix, year)
      );
    `);

    const year = new Date().getFullYear();
    const insSeries = db.prepare('INSERT INTO e_document_series (doc_type,prefix,year,next_value) VALUES (?,?,?,1)');
    insSeries.run('einvoice', 'DPT', year);
    insSeries.run('earchive', 'DPA', year);
    insSeries.run('edespatch', 'DPI', year);

    const setS = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    setS.run('einvoiceEnabled', '0');
    setS.run('einvoiceProvider', 'local');       // local = dosyaya yaz, entegratöre gönderme
    setS.run('einvoiceTestMode', '1');
    setS.run('defaultVatRate', '20');
  }
};
