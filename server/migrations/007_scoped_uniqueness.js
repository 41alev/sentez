// @ts-nocheck
/**
 * Çok şirketlilik altyapı hazırlığı — Aşama B: şirket bazlı benzersizlik.
 *
 * Aşama A (006) tüm tablolara `company_id` ekledi ama üç tablo hâlâ GLOBAL
 * (şirketler arası) benzersizlik dayatıyordu: `users.username`,
 * `work_centers.code`, `shifts.code`. Gerçek çoklu şirket senaryosunda iki
 * farklı müşteri "admin" veya "IM-01" gibi ortak bir kod/kullanıcı adı
 * kullanamazdı — bu, izolasyonun önündeki yapısal bir engeldi.
 *
 * SQLite `ALTER TABLE` ile bir UNIQUE kısıtını değiştirmeyi desteklemez;
 * SQLite'ın kendi belgelediği yöntem izlenir: yeni şemayla tablo oluştur →
 * veriyi kopyala → eskisini sil → yeniden adlandır → indeksleri yeniden
 * oluştur → `PRAGMA foreign_key_check` ile bütünlüğü doğrula. Üç tablo da
 * INTEGER PRIMARY KEY (rowid) kullandığı için id değerleri birebir
 * korunur; diğer tablolardaki yabancı anahtarlar (ör. `sessions.user_id`,
 * `work_center_shifts.shift_id`) bu id'lere göre çalışmaya devam eder.
 *
 * Davranış değişmedi: tek şirket (id=1) bugün olduğu gibi çalışmaya devam
 * eder — `UNIQUE(company_id, username)` tek bir company_id değeri için
 * `UNIQUE(username)` ile birebir aynı sonucu verir.
 */
module.exports = {
  name: 'multitenancy prep - scoped uniqueness (users, work_centers, shifts)',
  // Tablo yeniden oluşturma (DROP TABLE users) başka tabloların ona olan
  // yabancı anahtarı yüzünden foreign_keys=ON iken reddedilir. migrate.js
  // bu bayrağı görünce PRAGMA foreign_keys=OFF'u transaction'ın DIŞINDA
  // uygulayıp migration bitince geri açar.
  disableForeignKeys: true,
  up(db) {
    db.exec(`
      -- ============ USERS ============
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        username TEXT NOT NULL,
        full_name TEXT,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','operator','quality','viewer')),
        approval_limit REAL NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        last_login_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(company_id, username)
      );
      INSERT INTO users_new SELECT
        id, COALESCE(company_id, 1), username, full_name, email, password_hash, role,
        approval_limit, must_change_password, is_active, failed_attempts, locked_until,
        last_login_at, created_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      -- ============ WORK CENTERS ============
      CREATE TABLE work_centers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        warehouse_id INTEGER REFERENCES warehouses(id),
        capacity_units INTEGER NOT NULL DEFAULT 1,
        hourly_rate REAL NOT NULL DEFAULT 0,
        efficiency_pct REAL NOT NULL DEFAULT 100,
        downtime_pct REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT 0,
        import_batch_id TEXT,
        UNIQUE(company_id, code)
      );
      INSERT INTO work_centers_new SELECT
        id, COALESCE(company_id, 1), code, name, description, warehouse_id, capacity_units,
        hourly_rate, efficiency_pct, downtime_pct, is_active, created_at, import_batch_id
      FROM work_centers;
      DROP TABLE work_centers;
      ALTER TABLE work_centers_new RENAME TO work_centers;
      CREATE INDEX idx_wc_active ON work_centers(is_active);
      CREATE INDEX idx_workcenters_company_id ON work_centers(company_id);

      -- ============ SHIFTS ============
      CREATE TABLE shifts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        break_minutes INTEGER NOT NULL DEFAULT 0,
        weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(company_id, code)
      );
      INSERT INTO shifts_new SELECT
        id, COALESCE(company_id, 1), code, name, start_time, end_time, break_minutes,
        weekdays, is_active
      FROM shifts;
      DROP TABLE shifts;
      ALTER TABLE shifts_new RENAME TO shifts;
      CREATE INDEX idx_shifts_company_id ON shifts(company_id);
    `);

    const fkErrors = db.pragma('foreign_key_check');
    if (fkErrors.length) {
      throw new Error('007_scoped_uniqueness: foreign_key_check başarısız — ' + JSON.stringify(fkErrors));
    }
  }
};
