// @ts-nocheck
/**
 * Müşteri destek/talep takibi (ticket) ve saha ziyaret kaydı.
 *
 * İki bilinçli olarak ayrı ama birbirine bağlanabilen modül:
 *
 * - support_tickets: müşteri şikayeti/sorusu/iade talebi. Kalite modülündeki
 *   uygunsuzluk (NCR) akışıyla AYNI kalıp değildir — burada amaç müşteriyle
 *   iletişimi ve çözüm süresini takip etmek. Ama gerçek bir ürün kusuru
 *   şikayeti geldiğinde tek tuşla bir NCR'ye dönüştürülebilir (resulting_ncr_id),
 *   böylece iki modül arasında veri tekrar girişi gerekmez.
 *
 * - customer_visits: CRM fırsatlarına (opportunity) bağlanabilen saha ziyaret
 *   kaydı. GPS enlem/boylam alanları isteğe bağlıdır — tarayıcı konum izni
 *   reddedilirse veya ofis içi bir görüşmeyse boş kalabilir.
 *
 * Bilinçli kapsam sınırı: ticket'lar için SLA süresi/otomatik eskalasyon yok
 * (mevcut notifications.js taramasına ileride bir kural eklenebilir), ziyaret
 * planlaması (gelecek tarihli randevu) yok — yalnızca GERÇEKLEŞMİŞ bir
 * ziyaretin kaydı tutuluyor. İkisi de CRM/opportunities (010_crm.js) ile aynı
 * numaralandırma ve audit_log deseni kullanıyor — ayrı bir aktivite geçmişi
 * tablosu yalnızca ticket için var (support_ticket_comments), çünkü bir
 * ticket'ta genellikle birden çok serbest metin yorum birikir; ziyaret ise
 * tek seferlik bir kayıttır, ayrı bir yorum tablosuna ihtiyaç duymaz.
 */
module.exports = {
  name: 'support_and_visits',
  up(db) {
    db.exec(`
      CREATE TABLE support_tickets (
        id TEXT PRIMARY KEY,
        ticket_no TEXT NOT NULL,
        company_id INTEGER NOT NULL DEFAULT 1,
        customer_id INTEGER REFERENCES customers(id),
        customer_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'question'
          CHECK(category IN ('complaint','question','return','warranty','other')),
        priority TEXT NOT NULL DEFAULT 'normal'
          CHECK(priority IN ('low','normal','high','urgent')),
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open','in_progress','waiting_customer','resolved','closed')),
        assigned_to INTEGER REFERENCES users(id),
        related_order_id TEXT REFERENCES sales_orders(id),
        related_shipment_id TEXT REFERENCES shipments(id),
        related_lot_id TEXT REFERENCES stock_lots(id),
        resolution TEXT,
        resulting_ncr_id TEXT REFERENCES ncrs(id),
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        closed_at INTEGER
      );
      CREATE INDEX idx_tickets_company ON support_tickets(company_id);
      CREATE INDEX idx_tickets_status ON support_tickets(status);
      CREATE INDEX idx_tickets_customer ON support_tickets(customer_id);
      CREATE INDEX idx_tickets_assigned ON support_tickets(assigned_to);

      CREATE TABLE support_ticket_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        ts INTEGER NOT NULL,
        comment TEXT NOT NULL
      );
      CREATE INDEX idx_ticket_comments_ticket ON support_ticket_comments(ticket_id);

      CREATE TABLE customer_visits (
        id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL DEFAULT 1,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        opportunity_id TEXT REFERENCES opportunities(id),
        visited_by INTEGER REFERENCES users(id),
        visit_date TEXT NOT NULL,
        purpose TEXT,
        notes TEXT,
        latitude REAL,
        longitude REAL,
        follow_up_date TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_visits_company ON customer_visits(company_id);
      CREATE INDEX idx_visits_customer ON customer_visits(customer_id);
      CREATE INDEX idx_visits_opportunity ON customer_visits(opportunity_id);
      CREATE INDEX idx_visits_visited_by ON customer_visits(visited_by);
    `);
  }
};
