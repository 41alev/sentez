// @ts-nocheck
/**
 * CRM / satış hunisi — rakiplerin çoğunda (Logo/Netsis/Mikro) olmayan,
 * "sipariş oluşmadan ÖNCEKİ" süreç: bir satış fırsatı (opportunity) doğar,
 * aşamalardan geçer (yeni → iletişimde → teklif verildi → kazanıldı/
 * kaybedildi), kazanılırsa gerçek bir satış siparişine dönüşür.
 *
 * Bilinçli kapsam sınırı: sürükle-bırak kanban yok, aktivite/görüşme geçmişi
 * ayrı bir tablo değil (mevcut audit_log zaten her stage/alan değişikliğini
 * eski/yeni değerle tutuyor — bkz. server/routes/crm.js). Bu, ayrı bir CRM
 * ürünü değil, ERP'nin satış öncesi ucunu kapatan minimal bir modül.
 */
module.exports = {
  name: 'crm',
  up(db) {
    db.exec(`
      CREATE TABLE opportunities (
        id TEXT PRIMARY KEY,
        opp_no TEXT NOT NULL,
        company_id INTEGER NOT NULL DEFAULT 1,
        customer_id INTEGER REFERENCES customers(id),   -- mevcut müşteriyse dolu
        customer_name TEXT NOT NULL,                     -- yeni adaylar için de her zaman zorunlu
        contact_person TEXT, phone TEXT, email TEXT,
        source TEXT NOT NULL DEFAULT 'diger'
          CHECK(source IN ('referans','web','fuar','soguk_arama','diger')),
        stage TEXT NOT NULL DEFAULT 'new'
          CHECK(stage IN ('new','contacted','quoted','won','lost')),
        estimated_value REAL NOT NULL DEFAULT 0,
        estimated_close_date TEXT,
        probability INTEGER NOT NULL DEFAULT 20 CHECK(probability BETWEEN 0 AND 100),
        lost_reason TEXT,
        assigned_to INTEGER REFERENCES users(id),
        notes TEXT,
        converted_so_id TEXT REFERENCES sales_orders(id),
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL,
        closed_at INTEGER
      );
      CREATE INDEX idx_opportunities_company ON opportunities(company_id);
      CREATE INDEX idx_opportunities_stage ON opportunities(stage);
      CREATE INDEX idx_opportunities_customer ON opportunities(customer_id);

      CREATE TABLE opportunity_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES items(id),
        item_name TEXT NOT NULL,
        qty REAL NOT NULL,
        unit_price REAL NOT NULL DEFAULT 0
      );

      -- Kazanılan bir fırsat gerçek bir satış siparişine dönüştüğünde geriye
      -- izlenebilirlik için (hangi sipariş hangi fırsattan geldi).
      ALTER TABLE sales_orders ADD COLUMN opportunity_id TEXT REFERENCES opportunities(id);
    `);
  }
};
