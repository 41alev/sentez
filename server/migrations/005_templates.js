/**
 * Yazdırılabilir belge şablonları.
 *
 * Şimdiye kadar yazdırma sabit kodluydu: logo yok, antet yok, hangi alanın
 * görüneceği seçilemiyordu. Her fabrika kendi formatını ister ve bu belgeler
 * müşteriye, tedarikçiye, denetçiye gider — kurumsal görünmesi gerekir.
 *
 * Şablon ayarları JSON olarak saklanır. Alan listesi belge tipine göre değiştiği
 * için sabit sütun açmak yerine esnek yapı seçildi; şema değişmeden yeni alan eklenebilir.
 */
module.exports = {
  name: 'document templates',
  up(db) {
    db.exec(`
      -- Firma kimliği: her belgenin üstünde çıkar
      ALTER TABLE companies ADD COLUMN logo_data TEXT;        -- base64 veri URL'i
      ALTER TABLE companies ADD COLUMN logo_mime TEXT;
      ALTER TABLE companies ADD COLUMN website TEXT;
      ALTER TABLE companies ADD COLUMN print_footer TEXT;     -- tüm belgelerde ortak dipnot

      CREATE TABLE document_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- Varsayılan şablonlar migration sırasında oluşur; o an henüz firma kaydı
        -- yoktur. NULL = tüm firmalar için geçerli varsayılan.
        company_id INTEGER REFERENCES companies(id),
        -- shipment | purchase_order | production_order | inspection
        -- | traceability | count | label | stock_card
        doc_type TEXT NOT NULL,
        name TEXT NOT NULL,
        -- Görünüm ayarları (JSON): logo, antet, kenar boşlukları, yazı boyutu, renk
        layout TEXT NOT NULL DEFAULT '{}',
        -- Alan görünürlüğü ve sırası (JSON dizi): [{key,label,visible,order}]
        fields TEXT NOT NULL DEFAULT '[]',
        -- İmza kutuları (JSON dizi): ["Hazırlayan","Teslim Alan"]
        signatures TEXT NOT NULL DEFAULT '[]',
        header_text TEXT,
        footer_text TEXT,
        -- Aynı tip için birden fazla şablon olabilir; biri varsayılandır
        is_default INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_by INTEGER REFERENCES users(id),
        updated_at INTEGER
      );
      CREATE INDEX idx_doctpl_type ON document_templates(doc_type, is_default);
    `);

    /**
     * Varsayılan şablonlar. Hiçbir ayar yapılmadan da belgeler makul görünmeli;
     * kullanıcıyı önce yapılandırmaya zorlamak, sistemin hiç kullanılmamasına yol açar.
     */
    const base = {
      paperSize: 'A4', orientation: 'portrait', marginMm: 14, fontSize: 12,
      accentColor: '#111111', showLogo: true, showCompanyInfo: true,
      showDocumentDate: true, showPageNumbers: true, showBarcode: false,
      logoHeightMm: 16, tableStriped: true
    };

    const defs = [
      { type: 'shipment', name: 'Sevk İrsaliyesi',
        fields: [
          ['shipmentNo', 'İrsaliye No'], ['date', 'Tarih'], ['customerName', 'Müşteri'],
          ['customerAddress', 'Teslim Adresi'], ['soNo', 'Sipariş No'], ['carrier', 'Nakliyeci'],
          ['plateNo', 'Plaka'], ['crateCount', 'Kasa Adedi'], ['grossWeight', 'Brüt Ağırlık'],
          ['itemLines', 'Kalemler'], ['lotNumbers', 'Parti Numaraları'], ['notes', 'Notlar']
        ],
        signatures: ['Teslim Eden', 'Teslim Alan'] },

      { type: 'purchase_order', name: 'Satın Alma Siparişi',
        fields: [
          ['poNo', 'Sipariş No'], ['date', 'Tarih'], ['supplierName', 'Tedarikçi'],
          ['supplierAddress', 'Adres'], ['expected', 'Termin'], ['incoterm', 'Teslim Şekli'],
          ['paymentTerms', 'Ödeme Vadesi'], ['itemLines', 'Kalemler'], ['totals', 'Toplamlar'],
          ['notes', 'Notlar'], ['approvedBy', 'Onaylayan']
        ],
        signatures: ['Hazırlayan', 'Onaylayan'] },

      { type: 'production_order', name: 'Üretim Emri',
        fields: [
          ['orderNo', 'Emir No'], ['date', 'Tarih'], ['itemName', 'Mamul'],
          ['qty', 'Miktar'], ['dueDate', 'Termin'], ['components', 'Bileşenler'],
          ['operations', 'Operasyonlar'], ['notes', 'Notlar']
        ],
        signatures: ['Üretim Sorumlusu', 'Vardiya Amiri'] },

      { type: 'inspection', name: 'Muayene Raporu',
        fields: [
          ['inspectionNo', 'Muayene No'], ['date', 'Tarih'], ['itemName', 'Ürün'],
          ['lotNo', 'Parti No'], ['supplierName', 'Tedarikçi'], ['planName', 'Muayene Planı'],
          ['measurements', 'Ölçümler'], ['result', 'Sonuç'], ['acceptedQty', 'Kabul Miktarı'],
          ['rejectedQty', 'Red Miktarı'], ['inspector', 'Muayene Eden'], ['notes', 'Notlar']
        ],
        signatures: ['Muayene Eden', 'Kalite Sorumlusu'] },

      { type: 'traceability', name: 'İzlenebilirlik Raporu',
        fields: [
          ['itemName', 'Ürün'], ['lotNo', 'Parti No'], ['backward', 'Geriye İzleme'],
          ['forward', 'İleriye İzleme'], ['affectedCustomers', 'Etkilenen Müşteriler'],
          ['generatedAt', 'Rapor Tarihi']
        ],
        signatures: ['Hazırlayan', 'Kalite Sorumlusu'] },

      { type: 'count', name: 'Sayım Listesi',
        fields: [
          ['countNo', 'Sayım No'], ['date', 'Tarih'], ['warehouseName', 'Depo'],
          ['lines', 'Satırlar'], ['differences', 'Farklar'], ['countedBy', 'Sayan']
        ],
        signatures: ['Sayan', 'Kontrol Eden'] },

      { type: 'label', name: 'Parti Etiketi',
        fields: [
          ['itemName', 'Ürün Adı'], ['itemCode', 'Ürün Kodu'], ['lotNo', 'Parti No'],
          ['qty', 'Miktar'], ['expiryDate', 'Son Kullanma'], ['warehouseName', 'Depo'],
          ['location', 'Raf'], ['receivedAt', 'Giriş Tarihi'], ['barcode', 'Barkod']
        ],
        signatures: [] },

      { type: 'stock_card', name: 'Stok Kartı',
        fields: [
          ['itemName', 'Ürün'], ['itemCode', 'Kod'], ['category', 'Kategori'],
          ['unit', 'Birim'], ['qty', 'Mevcut Stok'], ['lots', 'Partiler'],
          ['movements', 'Son Hareketler'], ['bom', 'Reçete']
        ],
        signatures: [] }
    ];

    const ins = db.prepare(`INSERT INTO document_templates
      (doc_type,name,layout,fields,signatures,is_default,updated_at) VALUES (?,?,?,?,?,1,?)`);

    defs.forEach(d => {
      // Etiket küçük kâğıda basılır; varsayılanı buna göre ayarlanır
      const layout = d.type === 'label'
        ? { ...base, paperSize: 'label', marginMm: 4, fontSize: 10, logoHeightMm: 8, showBarcode: true, showPageNumbers: false }
        : base;
      ins.run(d.type, d.name, JSON.stringify(layout),
        JSON.stringify(d.fields.map(([key, label], i) => ({ key, label, visible: true, order: i }))),
        JSON.stringify(d.signatures), Date.now());
    });
  }
};
