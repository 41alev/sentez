/**
 * Excel'den veri aktarımı.
 *
 * Aktarım "dosyayı oku, kaydet" değildir. Gerçek veri hatalıdır: eksik alan,
 * tanımsız birim, tekrarlayan kod, var olmayan tedarikçi referansı. Bu yüzden
 * aktarım iki aşamalıdır — önce doğrula ve göster, sonra kullanıcı onaylarsa yaz.
 *
 * Her aktarım bir "parti" olarak kaydedilir. Yanlış dosya yüklenirse tek bir
 * işlemle geri alınabilmelidir; aksi halde binlerce kaydı elle temizlemek gerekir.
 */
module.exports = {
  name: 'excel import',
  up(db) {
    db.exec(`
      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        batch_no TEXT NOT NULL,
        -- items | suppliers | customers | opening_stock | boms | work_centers | routings
        import_type TEXT NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        total_rows INTEGER NOT NULL DEFAULT 0,
        valid_rows INTEGER NOT NULL DEFAULT 0,
        error_rows INTEGER NOT NULL DEFAULT 0,
        imported_rows INTEGER NOT NULL DEFAULT 0,
        skipped_rows INTEGER NOT NULL DEFAULT 0,
        -- preview: doğrulandı, henüz yazılmadı · committed: yazıldı · reverted: geri alındı
        status TEXT NOT NULL DEFAULT 'preview'
          CHECK(status IN ('preview','committed','reverted','failed')),
        -- Var olan kayıtla karşılaşınca ne yapılacağı
        duplicate_mode TEXT NOT NULL DEFAULT 'skip'
          CHECK(duplicate_mode IN ('skip','update','fail')),
        error_message TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL,
        committed_at INTEGER,
        reverted_at INTEGER,
        reverted_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_impbatch_status ON import_batches(status, created_at);

      -- Her satırın akıbeti: hangi satır neden reddedildi sorusunun cevabı burada.
      CREATE TABLE import_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        row_no INTEGER NOT NULL,
        raw_data TEXT,                 -- ham satır (JSON), sorun ayıklamak için
        parsed_data TEXT,              -- normalize edilmiş hali
        is_valid INTEGER NOT NULL DEFAULT 1,
        errors TEXT,                   -- satır bazlı hata listesi (JSON)
        warnings TEXT,
        -- Yazıldıysa hangi kaydı oluşturdu/güncelledi: geri alma bunu kullanır
        target_table TEXT,
        target_id TEXT,
        action TEXT CHECK(action IN ('created','updated','skipped','failed'))
      );
      CREATE INDEX idx_improw_batch ON import_rows(batch_id, is_valid);

      -- Aktarımla oluşturulan kayıtlar işaretlenir; geri alma yalnızca bunlara dokunur.
      -- Elle girilen veya aktarım sonrası değiştirilen kayıtlar korunur.
      ALTER TABLE items ADD COLUMN import_batch_id TEXT;
      ALTER TABLE suppliers ADD COLUMN import_batch_id TEXT;
      ALTER TABLE customers ADD COLUMN import_batch_id TEXT;
      ALTER TABLE stock_lots ADD COLUMN import_batch_id TEXT;
      ALTER TABLE work_centers ADD COLUMN import_batch_id TEXT;
      CREATE INDEX idx_items_import ON items(import_batch_id);
      CREATE INDEX idx_lots_import ON stock_lots(import_batch_id);
    `);

    db.prepare('INSERT OR IGNORE INTO number_sequences (key,prefix,next_value) VALUES (?,?,?)')
      .run('import_batch', 'AKT', 1);
  }
};
