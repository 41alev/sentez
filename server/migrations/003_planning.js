// @ts-nocheck
/**
 * Üretim planlama: iş merkezleri, rotalar, vardiyalar, kapasite ve MRP.
 *
 * Şimdiye kadar sistem "üretim emri" biliyordu ama üretimin nerede, ne zaman ve
 * hangi kapasiteyle yapılacağını bilmiyordu. Bu geçiş o boşluğu kapatır:
 *
 *  - İş merkezi: üretimin yapıldığı fiziksel yer/makine. Kapasitesi vardiyadan gelir.
 *  - Rota: bir mamulün hangi iş merkezlerinden hangi sürelerle geçeceği.
 *  - Vardiya takvimi: hangi gün hangi saatlerde çalışıldığı — kapasitenin kaynağı.
 *  - MRP: sipariş + emniyet stoğu − eldeki − yoldaki = net ihtiyaç, reçete
 *    üzerinden alt seviyelere yayılır.
 */
module.exports = {
  name: 'production planning',
  up(db) {
    db.exec(`
      -- ============ İŞ MERKEZLERİ ============
      CREATE TABLE work_centers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER DEFAULT 1 REFERENCES companies(id),
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        warehouse_id INTEGER REFERENCES warehouses(id),
        -- Aynı anda kaç iş yürütülebilir (paralel tezgâh sayısı)
        capacity_units INTEGER NOT NULL DEFAULT 1,
        -- Saatlik maliyet: üretim maliyetine işçilik+makine olarak yansır
        hourly_rate REAL NOT NULL DEFAULT 0,
        -- Gerçekleşen verim: planlanan sürenin ne kadarının üretime dönüştüğü
        efficiency_pct REAL NOT NULL DEFAULT 100,
        -- Planlanan duruş payı (bakım, ayar): kapasiteden düşülür
        downtime_pct REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_wc_active ON work_centers(is_active);

      -- ============ VARDİYA TANIMLARI ============
      CREATE TABLE shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL,          -- 'HH:MM'
        end_time TEXT NOT NULL,            -- gece vardiyasında ertesi güne sarkabilir
        break_minutes INTEGER NOT NULL DEFAULT 0,
        -- Hangi günler çalışılır: 1=Pazartesi … 7=Pazar, ör. '1,2,3,4,5'
        weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      -- Hangi iş merkezi hangi vardiyada çalışır
      CREATE TABLE work_center_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_center_id INTEGER NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
        shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        UNIQUE(work_center_id, shift_id)
      );

      -- Tatil ve planlı duruşlar: kapasiteden tamamen düşülür
      CREATE TABLE calendar_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_center_id INTEGER REFERENCES work_centers(id) ON DELETE CASCADE,  -- NULL = tüm fabrika
        date TEXT NOT NULL,
        reason TEXT,
        -- 'holiday' tüm günü kapatır, 'partial' saat düşer
        exception_type TEXT NOT NULL DEFAULT 'holiday',
        available_hours REAL
      );
      CREATE INDEX idx_calexc_date ON calendar_exceptions(date);

      -- ============ ROTALAR ============
      -- Bir mamulün üretim adımları. Reçete NE gerektiğini, rota NASIL yapıldığını söyler.
      CREATE TABLE routings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        operation_no INTEGER NOT NULL,
        operation_name TEXT NOT NULL,
        work_center_id INTEGER NOT NULL REFERENCES work_centers(id),
        -- Hazırlık süresi parti başına, işlem süresi birim başına harcanır
        setup_minutes REAL NOT NULL DEFAULT 0,
        run_minutes_per_unit REAL NOT NULL DEFAULT 0,
        -- Bekleme/taşıma süresi: kapasite tüketmez ama termini uzatır
        queue_minutes REAL NOT NULL DEFAULT 0,
        scrap_pct REAL NOT NULL DEFAULT 0,
        notes TEXT,
        UNIQUE(item_id, operation_no)
      );
      CREATE INDEX idx_routing_item ON routings(item_id);
      CREATE INDEX idx_routing_wc ON routings(work_center_id);

      -- ============ ÜRETİM EMRİ OPERASYONLARI ============
      -- Emir açıldığında rota buraya kopyalanır: rota sonradan değişse bile
      -- geçmiş emirlerin planı ve gerçekleşeni bozulmaz.
      CREATE TABLE production_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        operation_no INTEGER NOT NULL,
        operation_name TEXT NOT NULL,
        work_center_id INTEGER REFERENCES work_centers(id),
        work_center_name TEXT,
        planned_setup_minutes REAL NOT NULL DEFAULT 0,
        planned_run_minutes REAL NOT NULL DEFAULT 0,
        planned_start INTEGER,
        planned_end INTEGER,
        actual_start INTEGER,
        actual_end INTEGER,
        actual_minutes REAL,
        completed_qty REAL NOT NULL DEFAULT 0,
        scrap_qty REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK(status IN ('planned','released','in_progress','completed','cancelled')),
        operator_id INTEGER REFERENCES users(id),
        shift_id INTEGER REFERENCES shifts(id),
        notes TEXT
      );
      CREATE INDEX idx_prodop_order ON production_operations(production_order_id);
      CREATE INDEX idx_prodop_wc ON production_operations(work_center_id, planned_start);
      CREATE INDEX idx_prodop_status ON production_operations(status);

      -- ============ ÜRETİM EMRİ PLANLAMA ALANLARI ============
      ALTER TABLE production_orders ADD COLUMN planned_start INTEGER;
      ALTER TABLE production_orders ADD COLUMN planned_end INTEGER;
      ALTER TABLE production_orders ADD COLUMN due_date TEXT;
      ALTER TABLE production_orders ADD COLUMN priority INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE production_orders ADD COLUMN so_id TEXT REFERENCES sales_orders(id);
      -- MRP tarafından önerildiyse hangi çalıştırmadan geldiği
      ALTER TABLE production_orders ADD COLUMN mrp_run_id TEXT;

      -- ============ ÜRÜN PLANLAMA PARAMETRELERİ ============
      ALTER TABLE items ADD COLUMN safety_stock REAL NOT NULL DEFAULT 0;
      ALTER TABLE items ADD COLUMN lot_size REAL NOT NULL DEFAULT 0;   -- 0 = tam ihtiyaç kadar
      ALTER TABLE items ADD COLUMN min_lot_size REAL NOT NULL DEFAULT 0;
      -- Üretim süresi (gün): satın alınanlarda tedarikçi lead time kullanılır
      ALTER TABLE items ADD COLUMN manufacturing_lead_days INTEGER NOT NULL DEFAULT 0;
      -- 'make' üretilir, 'buy' satın alınır: MRP'nin öneri tipini belirler
      ALTER TABLE items ADD COLUMN procurement_type TEXT NOT NULL DEFAULT 'buy'
        CHECK(procurement_type IN ('make','buy'));

      -- ============ MRP ÇALIŞTIRMALARI ============
      CREATE TABLE mrp_runs (
        id TEXT PRIMARY KEY,
        run_no TEXT NOT NULL,
        horizon_days INTEGER NOT NULL DEFAULT 90,
        status TEXT NOT NULL DEFAULT 'completed',
        item_count INTEGER NOT NULL DEFAULT 0,
        suggestion_count INTEGER NOT NULL DEFAULT 0,
        shortage_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE mrp_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES mrp_runs(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id),
        item_name TEXT NOT NULL,
        bom_level INTEGER NOT NULL DEFAULT 0,
        -- 'make' üretim emri önerisi, 'buy' satın alma önerisi
        suggestion_type TEXT NOT NULL CHECK(suggestion_type IN ('make','buy')),
        gross_requirement REAL NOT NULL DEFAULT 0,
        on_hand REAL NOT NULL DEFAULT 0,
        on_order REAL NOT NULL DEFAULT 0,
        allocated REAL NOT NULL DEFAULT 0,
        safety_stock REAL NOT NULL DEFAULT 0,
        net_requirement REAL NOT NULL DEFAULT 0,
        suggested_qty REAL NOT NULL DEFAULT 0,
        need_date TEXT,
        release_date TEXT,             -- ihtiyaç tarihi − tedarik süresi
        -- Serbest bırakma tarihi geçmişse sipariş zaten gecikmiştir
        is_late INTEGER NOT NULL DEFAULT 0,
        supplier_id INTEGER REFERENCES suppliers(id),
        estimated_cost REAL NOT NULL DEFAULT 0,
        source_demand TEXT,            -- ihtiyacın nereden geldiği (okunabilir açıklama)
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open','converted','dismissed')),
        converted_to TEXT
      );
      CREATE INDEX idx_mrpsug_run ON mrp_suggestions(run_id, bom_level);
      CREATE INDEX idx_mrpsug_status ON mrp_suggestions(status);

      -- ============ VARDİYA ÜRETİM KAYDI ============
      -- Vardiya bazında ne üretildi, ne kadar duruş oldu: OEE'nin girdisi.
      CREATE TABLE shift_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        shift_id INTEGER NOT NULL REFERENCES shifts(id),
        work_center_id INTEGER NOT NULL REFERENCES work_centers(id),
        planned_minutes REAL NOT NULL DEFAULT 0,
        worked_minutes REAL NOT NULL DEFAULT 0,
        downtime_minutes REAL NOT NULL DEFAULT 0,
        downtime_reason TEXT,
        produced_qty REAL NOT NULL DEFAULT 0,
        scrap_qty REAL NOT NULL DEFAULT 0,
        operator_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        recorded_by INTEGER REFERENCES users(id),
        recorded_at INTEGER NOT NULL,
        UNIQUE(date, shift_id, work_center_id)
      );
      CREATE INDEX idx_shiftlog_date ON shift_logs(date);
    `);

    // Varsayılan vardiyalar: çoğu fabrikada bu üçlü kullanılır.
    const insShift = db.prepare(`INSERT INTO shifts (code,name,start_time,end_time,break_minutes,weekdays)
      VALUES (?,?,?,?,?,?)`);
    insShift.run('V1', 'Gündüz Vardiyası', '08:00', '16:00', 45, '1,2,3,4,5');
    insShift.run('V2', 'Akşam Vardiyası', '16:00', '24:00', 30, '1,2,3,4,5');
    insShift.run('V3', 'Gece Vardiyası', '00:00', '08:00', 30, '1,2,3,4,5');

    const setS = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    setS.run('mrpHorizonDays', '90');
    setS.run('mrpIncludeForecast', '0');
  }
};
