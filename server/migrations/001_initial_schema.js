/**
 * 001 — Core ERP schema.
 *
 * Design notes:
 *  - Stock is tracked in `stock_lots`, not on `items`. Each lot carries its own
 *    warehouse, status (available/quarantine/blocked/rejected), expiry, and cost.
 *    `items.qty_cache` is a denormalised convenience total, recalculated by the
 *    stock service; never treat it as the source of truth.
 *  - Every stock change writes a row to `movements` referencing the lot, so full
 *    traceability (which lot went where) is always reconstructable.
 */
exports.up = (db) => {
  db.exec(`

  -- ============ COMPANIES / ORG ============
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tax_no TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    base_currency TEXT NOT NULL DEFAULT 'TRY',
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    username TEXT UNIQUE NOT NULL,
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
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    jti TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    user_agent TEXT
  );

  CREATE TABLE warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    code TEXT,
    name TEXT NOT NULL,
    address TEXT,
    is_quarantine INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(company_id, name)
  );

  -- ============ PARTNERS ============
  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    code TEXT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    country TEXT,
    tax_no TEXT,
    currency TEXT NOT NULL DEFAULT 'TRY',
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    incoterm TEXT,
    bank_info TEXT,
    is_approved INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    code TEXT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    country TEXT,
    tax_no TEXT,
    currency TEXT NOT NULL DEFAULT 'TRY',
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    credit_limit REAL NOT NULL DEFAULT 0,
    incoterm TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  -- ============ ITEMS ============
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id),
    name TEXT NOT NULL,
    code TEXT,
    barcode TEXT,
    category TEXT,
    item_type TEXT NOT NULL DEFAULT 'raw' CHECK(item_type IN ('raw','semi','finished','consumable')),
    origin TEXT NOT NULL DEFAULT 'Yurt İçi',
    default_warehouse_id INTEGER REFERENCES warehouses(id),
    location TEXT,
    unit TEXT NOT NULL DEFAULT 'adet',
    min_stock REAL NOT NULL DEFAULT 0,
    reorder_qty REAL NOT NULL DEFAULT 0,
    costing_method TEXT NOT NULL DEFAULT 'moving_average' CHECK(costing_method IN ('moving_average','fifo')),
    avg_cost REAL NOT NULL DEFAULT 0,           -- always in company base currency (TRY)
    standard_cost REAL NOT NULL DEFAULT 0,
    sale_price REAL NOT NULL DEFAULT 0,
    sale_currency TEXT NOT NULL DEFAULT 'TRY',
    is_lot_tracked INTEGER NOT NULL DEFAULT 1,
    is_serial_tracked INTEGER NOT NULL DEFAULT 0,
    shelf_life_days INTEGER,
    requires_incoming_inspection INTEGER NOT NULL DEFAULT 0,
    hs_code TEXT,
    default_supplier_id INTEGER REFERENCES suppliers(id),
    image_path TEXT,
    supplier TEXT,
    description TEXT,
    qty_cache REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE item_bom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    component_item_id TEXT NOT NULL REFERENCES items(id),
    qty_per_unit REAL NOT NULL DEFAULT 0,
    scrap_pct REAL NOT NULL DEFAULT 0,
    unit TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    notes TEXT
  );

  -- Free-text costing notes kept from v1 (informational only, not stock-consuming)
  CREATE TABLE raw_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 0,
    unit TEXT,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY'
  );

  -- ============ STOCK (LOT LEVEL) ============
  CREATE TABLE stock_lots (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    lot_no TEXT,
    serial_no TEXT,
    qty REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'available'
      CHECK(status IN ('available','quarantine','blocked','rejected','consumed')),
    expiry_date TEXT,
    unit_cost REAL NOT NULL DEFAULT 0,          -- base currency (TRY), landed
    received_at INTEGER,
    source_type TEXT,                            -- 'purchase' | 'production' | 'adjustment' | 'opening'
    source_id TEXT,
    supplier_id INTEGER REFERENCES suppliers(id),
    coa_document_id INTEGER,
    notes TEXT
  );

  CREATE TABLE movements (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    lot_no TEXT,
    warehouse_id INTEGER REFERENCES warehouses(id),
    type TEXT NOT NULL CHECK(type IN ('in','out','transfer','adjust','status_change')),
    qty REAL NOT NULL,
    unit_cost REAL,
    from_status TEXT,
    to_status TEXT,
    note TEXT,
    ref_type TEXT,                               -- 'purchase_receipt' | 'production' | 'shipment' | 'count' | 'manual'
    ref_id TEXT,
    ts INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id)
  );

  -- ============ PHYSICAL COUNT ============
  CREATE TABLE stock_counts (
    id TEXT PRIMARY KEY,
    count_no TEXT NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','counted','approved','cancelled')),
    started_at INTEGER,
    approved_at INTEGER,
    approved_by INTEGER REFERENCES users(id),
    created_by INTEGER REFERENCES users(id),
    notes TEXT
  );

  CREATE TABLE stock_count_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    lot_id TEXT REFERENCES stock_lots(id),
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    lot_no TEXT,
    system_qty REAL NOT NULL DEFAULT 0,
    counted_qty REAL,
    difference REAL,
    reason TEXT
  );

  -- ============ PURCHASING ============
  CREATE TABLE purchase_requests (
    id TEXT PRIMARY KEY,
    request_no TEXT NOT NULL,
    requested_by INTEGER REFERENCES users(id),
    department TEXT,
    needed_by TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','submitted','approved','rejected','converted','cancelled')),
    approved_by INTEGER REFERENCES users(id),
    approved_at INTEGER,
    reject_reason TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE purchase_request_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    qty REAL NOT NULL,
    unit TEXT,
    notes TEXT
  );

  CREATE TABLE rfqs (
    id TEXT PRIMARY KEY,
    rfq_no TEXT NOT NULL,
    request_id TEXT REFERENCES purchase_requests(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','awarded','cancelled')),
    due_date TEXT,
    awarded_supplier_id INTEGER REFERENCES suppliers(id),
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE rfq_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    qty REAL NOT NULL
  );

  CREATE TABLE rfq_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    item_id TEXT REFERENCES items(id),
    unit_price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    lead_time_days INTEGER,
    valid_until TEXT,
    notes TEXT
  );

  CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    po_no TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    supplier_name TEXT,
    request_id TEXT REFERENCES purchase_requests(id),
    rfq_id TEXT REFERENCES rfqs(id),
    date TEXT,
    expected TEXT,
    warehouse_id INTEGER REFERENCES warehouses(id),
    currency TEXT NOT NULL DEFAULT 'TRY',
    fx_rate REAL NOT NULL DEFAULT 1,             -- rate locked at order date
    incoterm TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','pending_approval','approved','rejected','partially_received','received','closed','cancelled')),
    approval_status TEXT NOT NULL DEFAULT 'not_required'
      CHECK(approval_status IN ('not_required','pending','approved','rejected')),
    approved_by INTEGER REFERENCES users(id),
    approved_at INTEGER,
    reject_reason TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    total_base REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    qty REAL NOT NULL,
    received_qty REAL NOT NULL DEFAULT 0,
    rejected_qty REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    over_delivery_tolerance_pct REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE po_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    changed_by INTEGER REFERENCES users(id),
    changed_at INTEGER NOT NULL,
    change_summary TEXT,
    snapshot TEXT
  );

  CREATE TABLE po_receipts (
    id TEXT PRIMARY KEY,
    receipt_no TEXT NOT NULL,
    po_id TEXT NOT NULL REFERENCES purchase_orders(id),
    warehouse_id INTEGER REFERENCES warehouses(id),
    received_at INTEGER NOT NULL,
    received_by INTEGER REFERENCES users(id),
    waybill_no TEXT,
    customs_decl_no TEXT,
    notes TEXT
  );

  CREATE TABLE po_receipt_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id TEXT NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
    po_item_id INTEGER REFERENCES po_items(id),
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    qty REAL NOT NULL,
    lot_no TEXT,
    expiry_date TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    to_quarantine INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE landed_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id TEXT REFERENCES po_receipts(id) ON DELETE CASCADE,
    po_id TEXT REFERENCES purchase_orders(id),
    cost_type TEXT NOT NULL,                     -- freight | customs | insurance | handling | other
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    fx_rate REAL NOT NULL DEFAULT 1,
    allocation_method TEXT NOT NULL DEFAULT 'value' CHECK(allocation_method IN ('value','qty')),
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE supplier_invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    po_id TEXT REFERENCES purchase_orders(id),
    receipt_id TEXT REFERENCES po_receipts(id),
    invoice_date TEXT,
    due_date TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    fx_rate REAL NOT NULL DEFAULT 1,
    match_status TEXT NOT NULL DEFAULT 'unmatched'
      CHECK(match_status IN ('unmatched','matched','discrepancy','approved','paid')),
    discrepancy_note TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE supplier_returns (
    id TEXT PRIMARY KEY,
    return_no TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    lot_id TEXT REFERENCES stock_lots(id),
    item_id TEXT REFERENCES items(id),
    qty REAL NOT NULL,
    reason TEXT,
    ncr_id TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','shipped','credited','closed')),
    created_at INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE supplier_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id),
    item_id TEXT REFERENCES items(id),
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TRY',
    source TEXT,                                 -- 'po' | 'rfq'
    source_id TEXT,
    recorded_at INTEGER NOT NULL
  );

  -- ============ SALES ============
  CREATE TABLE sales_orders (
    id TEXT PRIMARY KEY,
    so_no TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT,
    date TEXT,
    promised_date TEXT,
    currency TEXT NOT NULL DEFAULT 'TRY',
    fx_rate REAL NOT NULL DEFAULT 1,
    incoterm TEXT,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK(status IN ('draft','open','partially_shipped','shipped','invoiced','closed','cancelled')),
    total_base REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sales_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    qty REAL NOT NULL,
    shipped_qty REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    cogs_base REAL NOT NULL DEFAULT 0            -- accumulated cost of goods shipped
  );

  CREATE TABLE shipments (
    id TEXT PRIMARY KEY,
    shipment_no TEXT NOT NULL,
    so_id TEXT REFERENCES sales_orders(id),
    customer_id INTEGER REFERENCES customers(id),
    type TEXT NOT NULL DEFAULT 'Yurt İçi',
    carrier TEXT,
    destination TEXT,
    status TEXT NOT NULL DEFAULT 'Hazırlanıyor',
    date TEXT,
    incoterm TEXT,
    tracking_no TEXT,
    created_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE shipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    item_id TEXT,
    item_name TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    lot_no TEXT,
    qty REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE shipment_crates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    crate_no TEXT, w REAL, h REAL, d REAL, weight REAL
  );

  CREATE TABLE customer_invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    so_id TEXT REFERENCES sales_orders(id),
    shipment_id TEXT REFERENCES shipments(id),
    invoice_date TEXT,
    due_date TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'TRY',
    fx_rate REAL NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('draft','issued','paid','cancelled')),
    created_at INTEGER NOT NULL
  );

  -- ============ PRODUCTION ============
  CREATE TABLE production_orders (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL,
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    warehouse_id INTEGER REFERENCES warehouses(id),
    qty REAL NOT NULL,
    produced_qty REAL NOT NULL DEFAULT 0,
    scrap_qty REAL NOT NULL DEFAULT 0,
    rework_qty REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Planlandı'
      CHECK(status IN ('Planlandı','Devam Ediyor','Tamamlandı','İptal Edildi')),
    date TEXT,
    lot_no TEXT,
    output_lot_id TEXT REFERENCES stock_lots(id),
    labor_cost REAL NOT NULL DEFAULT 0,
    overhead_cost REAL NOT NULL DEFAULT 0,
    material_cost REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    note TEXT,
    completed_at INTEGER,
    created_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE production_order_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    component_item_id TEXT REFERENCES items(id),
    component_name TEXT,
    qty_used REAL NOT NULL
  );

  -- Genealogy: exactly which lots were consumed into which production order
  CREATE TABLE production_consumption (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    component_item_id TEXT REFERENCES items(id),
    component_name TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    lot_no TEXT,
    qty REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0
  );

  -- ============ QUALITY ============
  CREATE TABLE inspections (
    id TEXT PRIMARY KEY,
    inspection_no TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('incoming','in_process','final')),
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    lot_no TEXT,
    receipt_id TEXT REFERENCES po_receipts(id),
    production_order_id TEXT REFERENCES production_orders(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    sample_size REAL,
    inspected_qty REAL,
    accepted_qty REAL NOT NULL DEFAULT 0,
    rejected_qty REAL NOT NULL DEFAULT 0,
    aql TEXT,
    result TEXT NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','accepted','rejected','conditional')),
    inspected_by INTEGER REFERENCES users(id),
    inspected_at INTEGER,
    signed_by INTEGER REFERENCES users(id),
    signed_at INTEGER,
    signature_hash TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE inspection_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    characteristic TEXT NOT NULL,
    spec_min REAL,
    spec_max REAL,
    spec_text TEXT,
    measured_value REAL,
    measured_text TEXT,
    result TEXT CHECK(result IN ('pass','fail','na')),
    notes TEXT
  );

  CREATE TABLE inspection_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('incoming','in_process','final')),
    characteristic TEXT NOT NULL,
    spec_min REAL, spec_max REAL, spec_text TEXT,
    aql TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE ncrs (
    id TEXT PRIMARY KEY,
    ncr_no TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('incoming','in_process','final','customer','internal')),
    item_id TEXT REFERENCES items(id),
    item_name TEXT,
    lot_id TEXT REFERENCES stock_lots(id),
    lot_no TEXT,
    supplier_id INTEGER REFERENCES suppliers(id),
    customer_id INTEGER REFERENCES customers(id),
    inspection_id TEXT REFERENCES inspections(id),
    qty_affected REAL,
    severity TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','major','critical')),
    description TEXT,
    disposition TEXT CHECK(disposition IN ('use_as_is','rework','return_to_supplier','scrap','pending')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','closed','cancelled')),
    opened_by INTEGER REFERENCES users(id),
    opened_at INTEGER NOT NULL,
    closed_by INTEGER REFERENCES users(id),
    closed_at INTEGER
  );

  CREATE TABLE capas (
    id TEXT PRIMARY KEY,
    capa_no TEXT NOT NULL,
    ncr_id TEXT REFERENCES ncrs(id),
    type TEXT NOT NULL DEFAULT 'corrective' CHECK(type IN ('corrective','preventive')),
    root_cause TEXT,
    action_plan TEXT,
    responsible_user_id INTEGER REFERENCES users(id),
    due_date TEXT,
    effectiveness_check TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','verifying','closed')),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_no TEXT,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other'
      CHECK(doc_type IN ('coa','sds','drawing','procedure','certificate','photo','other')),
    revision TEXT NOT NULL DEFAULT '1',
    file_path TEXT,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    ref_type TEXT,                               -- 'item' | 'lot' | 'ncr' | 'supplier' | 'inspection'
    ref_id TEXT,
    is_controlled INTEGER NOT NULL DEFAULT 0,
    effective_date TEXT,
    review_date TEXT,
    superseded_by INTEGER REFERENCES documents(id),
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at INTEGER NOT NULL
  );

  CREATE TABLE equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    name TEXT NOT NULL,
    serial_no TEXT,
    location TEXT,
    calibration_interval_days INTEGER NOT NULL DEFAULT 365,
    last_calibration_date TEXT,
    next_calibration_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','out_of_service','retired')),
    notes TEXT
  );

  CREATE TABLE calibrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    calibration_date TEXT NOT NULL,
    next_due_date TEXT,
    performed_by TEXT,
    certificate_no TEXT,
    result TEXT CHECK(result IN ('pass','fail','adjusted')),
    document_id INTEGER REFERENCES documents(id),
    notes TEXT,
    recorded_at INTEGER NOT NULL
  );

  -- ============ SYSTEM ============
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id),
    username TEXT,
    role TEXT,
    action_key TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    ip TEXT,
    detail TEXT
  );

  CREATE TABLE approval_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,                      -- 'purchase_order' | 'purchase_request'
    threshold_base REAL NOT NULL DEFAULT 0,
    required_role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE notification_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type TEXT NOT NULL,                     -- low_stock | expiry | overdue_po | ncr_open | calibration_due
    channel TEXT NOT NULL DEFAULT 'inapp' CHECK(channel IN ('inapp','email')),
    threshold_days INTEGER,
    recipients TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    rule_type TEXT,
    severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
    title TEXT NOT NULL,
    body TEXT,
    ref_type TEXT,
    ref_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    emailed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency TEXT NOT NULL,
    rate REAL NOT NULL,
    rate_date TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    UNIQUE(currency, rate_date)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE number_sequences (
    key TEXT PRIMARY KEY,
    prefix TEXT,
    next_value INTEGER NOT NULL DEFAULT 1
  );

  -- ============ INDEXES ============
  CREATE INDEX idx_items_barcode ON items(barcode);
  CREATE INDEX idx_items_code ON items(code);
  CREATE INDEX idx_items_category ON items(category);
  CREATE INDEX idx_items_active ON items(is_active, deleted_at);
  CREATE INDEX idx_items_type ON items(item_type);

  CREATE INDEX idx_lots_item ON stock_lots(item_id);
  CREATE INDEX idx_lots_wh ON stock_lots(warehouse_id);
  CREATE INDEX idx_lots_status ON stock_lots(status);
  CREATE INDEX idx_lots_expiry ON stock_lots(expiry_date);
  CREATE INDEX idx_lots_lotno ON stock_lots(lot_no);
  CREATE INDEX idx_lots_item_status_wh ON stock_lots(item_id, status, warehouse_id);

  CREATE INDEX idx_mov_item ON movements(item_id);
  CREATE INDEX idx_mov_ts ON movements(ts DESC);
  CREATE INDEX idx_mov_lot ON movements(lot_id);
  CREATE INDEX idx_mov_ref ON movements(ref_type, ref_id);

  CREATE INDEX idx_bom_item ON item_bom(item_id);
  CREATE INDEX idx_bom_comp ON item_bom(component_item_id);

  CREATE INDEX idx_po_status ON purchase_orders(status);
  CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
  CREATE INDEX idx_poitems_po ON po_items(po_id);
  CREATE INDEX idx_receipt_po ON po_receipts(po_id);
  CREATE INDEX idx_receiptlines_receipt ON po_receipt_lines(receipt_id);

  CREATE INDEX idx_so_customer ON sales_orders(customer_id);
  CREATE INDEX idx_so_status ON sales_orders(status);
  CREATE INDEX idx_solines_so ON sales_order_lines(so_id);
  CREATE INDEX idx_shipitems_ship ON shipment_items(shipment_id);
  CREATE INDEX idx_shipments_so ON shipments(so_id);

  CREATE INDEX idx_prod_status ON production_orders(status);
  CREATE INDEX idx_prodcons_po ON production_consumption(production_order_id);
  CREATE INDEX idx_prodcons_lot ON production_consumption(lot_id);

  CREATE INDEX idx_insp_lot ON inspections(lot_id);
  CREATE INDEX idx_insp_result ON inspections(result);
  CREATE INDEX idx_ncr_status ON ncrs(status);
  CREATE INDEX idx_ncr_supplier ON ncrs(supplier_id);
  CREATE INDEX idx_docs_ref ON documents(ref_type, ref_id);

  CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
  CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
  CREATE INDEX idx_notif_read ON notifications(is_read, created_at DESC);
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_fx_currency_date ON exchange_rates(currency, rate_date DESC);
  `);
};
