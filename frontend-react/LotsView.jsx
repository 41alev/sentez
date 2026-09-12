/**
 * Lotlar (Lots) — React'e kademeli geçişin bir sonraki ekranı.
 *
 * Items/Counts ile aynı desen. Tek fark: `traceDialog` (izlenebilirlik
 * penceresi) `public/js/views/{sales,production,quality}.js` (hâlâ
 * vanilla) tarafından `ViewLots.traceDialog(lotId)` olarak DIŞARIDAN
 * çağrılıyor — bu yüzden modül seviyesinde, React bileşeninden BAĞIMSIZ
 * bir fonksiyon olarak dışa aktarılıyor (kendi verisini kendi çeker,
 * herhangi bir view'ın o an mount edilmiş olmasına bağlı değil).
 */
import { useEffect, useState, useRef } from 'react';

const { t, esc, num, dt, table, loading, closeModal } = UI;

/* ---------- izlenebilirlik (dışarıdan da çağrılır) ---------- */
export async function traceDialog(lotId) {
  UI.modal({ title: t('traceability'), size: 'xwide', body: loading(), footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>` });
  let back, fwd, recall;
  try { [back, fwd, recall] = await Promise.all([Api.traceBackward(lotId), Api.traceForward(lotId), Api.recall(lotId)]); }
  catch (e) { UI.err(e); closeModal(); return; }

  const box = document.getElementById('modalBox');
  const lot = back?.lot || fwd?.lot || {};
  box.querySelector('.modal-body').innerHTML = `
    <div class="kv-grid">
      <div class="kv"><div class="k">${t('itemName')}</div><div class="v">${esc(lot.itemName || lot.item_name || '—')}</div></div>
      <div class="kv"><div class="k">${t('lotNo')}</div><div class="v mono">${esc(lot.lotNo || lot.lot_no || '—')}</div></div>
      <div class="kv"><div class="k">${t('qty')}</div><div class="v">${num(lot.qty || 0)} ${esc(lot.unit || '')}</div></div>
      <div class="kv"><div class="k">${t('status')}</div><div class="v">${UI.lotStatusBadge(lot.status)}</div></div>
    </div>

    <div class="section-title">${t('traceBackward')}</div>
    ${renderBackward(back)}

    <div class="section-title">${t('traceForward')}</div>
    ${renderForward(fwd)}

    <div class="section-title">${t('recallReport')}</div>
    ${renderRecall(recall)}`;

  box.querySelector('.modal-foot').insertAdjacentHTML('afterbegin',
    `<button class="btn btn-ghost" id="tracePrint">${UI.icon(UI.ICONS.print)}${t('print')}</button>`);
  box.querySelector('#tracePrint').onclick = () => printTrace(lot, back, fwd, recall);
}

function renderBackward(b) {
  const comps = b?.components || b?.consumedLots || [];
  if (!comps.length) return `<div class="empty" style="padding:18px">${t('noTrace')}</div>`;
  return comps.map(c => `
    <div class="trace-node comp">
      <div class="trace-title">${esc(c.componentName || c.component_name || c.itemName || '—')}
        <span class="mono" style="font-size:11.5px;color:var(--text-faint)"> · ${esc(c.lotNo || c.lot_no || '—')}</span></div>
      <div class="trace-meta">${num(c.qty || c.qty_used || 0)} ${esc(c.unit || '')}${c.supplierName ? ' · ' + esc(c.supplierName) : ''}</div>
      ${c.children && c.children.length ? c.children.map(ch => `
        <div class="trace-node comp" style="margin-top:8px">
          <div class="trace-title">${esc(ch.componentName || ch.itemName || '—')}
            <span class="mono" style="font-size:11.5px;color:var(--text-faint)"> · ${esc(ch.lotNo || '—')}</span></div>
          <div class="trace-meta">${num(ch.qty || 0)}</div>
        </div>`).join('') : ''}
    </div>`).join('');
}

function renderForward(f) {
  const used = f?.usedInProduction || [];
  const shipped = f?.shipments || f?.shippedIn || [];
  if (!used.length && !shipped.length) return `<div class="empty" style="padding:18px">${t('noTrace')}</div>`;
  return `
    ${used.map(u => `
      <div class="trace-node">
        <div class="trace-title">${esc(u.orderNo || u.order_no || '—')} → ${esc(u.producedItem || u.produced_item || '—')}</div>
        <div class="trace-meta">${num(u.qty || 0)} ${UI.getLang() === 'tr' ? 'tüketildi' : 'consumed'}</div>
      </div>`).join('')}
    ${shipped.map(s => `
      <div class="trace-node cust">
        <div class="trace-title">${esc(s.shipmentNo || s.shipment_no || '—')} → ${esc(s.customerName || s.customer_name || s.destination || '—')}</div>
        <div class="trace-meta">${num(s.qty || 0)} · ${dt(s.date)}</div>
      </div>`).join('')}`;
}

function renderRecall(r) {
  const cust = r?.affectedCustomers || [];
  if (!cust.length) return `<div class="alert ok">${UI.getLang() === 'tr' ? 'Bu parti henüz hiçbir müşteriye sevk edilmemiş.' : 'This lot has not shipped to any customer yet.'}</div>`;
  return `<div class="alert crit">${UI.getLang() === 'tr'
    ? `Bu parti ${cust.length} sevkiyatta müşteriye ulaşmış. Geri çağırma gerekirse aşağıdaki müşterilerle iletişime geçin.`
    : `This lot reached customers in ${cust.length} shipment(s). Contact them if a recall is required.`}</div>
    ${table([
      { key: 'customerName', label: UI.getLang() === 'tr' ? 'Müşteri' : 'Customer', render: c => esc(c.customerName || '—') },
      { key: 'shipmentNo', label: t('shipmentNo'), render: c => `<span class="mono">${esc(c.shipmentNo || '—')}</span>` },
      { key: 'qty', label: t('qty'), num: true, render: c => num(c.qty) },
      { key: 'date', label: t('date'), render: c => dt(c.date) },
      { key: 'destination', label: t('destination'), render: c => esc(c.destination || '—') }
    ], cust)}`;
}

function printTrace(lot, back, fwd, recall) {
  const comps = back?.components || back?.consumedLots || [];
  const cust = recall?.affectedCustomers || [];
  UI.printDoc('traceability', UI.getLang() === 'tr' ? 'İZLENEBİLİRLİK RAPORU' : 'TRACEABILITY REPORT', `
    <div class="g">
      <div><b>${t('itemName')}:</b> ${esc(lot.itemName || lot.item_name || '')}</div>
      <div><b>${t('lotNo')}:</b> ${esc(lot.lotNo || lot.lot_no || '')}</div>
      <div><b>${t('qty')}:</b> ${num(lot.qty || 0)} ${esc(lot.unit || '')}</div>
      <div><b>${t('status')}:</b> ${esc(lot.status || '')}</div>
    </div>
    <h4>${t('traceBackward')}</h4>
    <table><tr><th>${t('bomComponent')}</th><th>${t('lotNo')}</th><th class="r">${t('qty')}</th></tr>
    ${comps.map(c => `<tr><td>${esc(c.componentName || c.component_name || '')}</td><td>${esc(c.lotNo || c.lot_no || '')}</td><td class="r">${num(c.qty || c.qty_used || 0)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</table>
    <h4>${t('affectedCustomers')}</h4>
    <table><tr><th>${UI.getLang() === 'tr' ? 'Müşteri' : 'Customer'}</th><th>${t('shipmentNo')}</th><th>${t('date')}</th><th class="r">${t('qty')}</th></tr>
    ${cust.map(c => `<tr><td>${esc(c.customerName || '')}</td><td>${esc(c.shipmentNo || '')}</td><td>${dt(c.date)}</td><td class="r">${num(c.qty)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</table>`);
}

/* ---------- liste ekranı ---------- */
const DEFAULT_FILTERS = { page: 1, q: '', status: '', warehouseId: '', itemId: '', expiringDays: '' };

export default function LotsView() {
  const { card, pager, select, field, input, val, numVal, intVal, can, modal } = UI;

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [phase, setPhase] = useState({ status: 'loading', res: null, error: null });
  const warehousesRef = useRef([]);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        try { warehousesRef.current = await Api.warehouses(); } catch { warehousesRef.current = []; }
      }
      if (cancelled) return;
      let res;
      try { res = await Api.lots({ ...filters, pageSize: 25 }); } catch (e) { UI.err(e); return; }
      if (cancelled) return;
      setPhase({ status: 'ready', res, error: null });
    })();
    return () => { cancelled = true; };
  }, [filters]);

  useEffect(() => {
    if (phase.status !== 'ready') return;
    const res = phase.res;
    const s = document.getElementById('lqS');
    s.oninput = UI.debounce(() => setFilters(f => ({ ...f, q: s.value, page: 1 })), 350);
    document.getElementById('lStatus').onchange = e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }));
    document.getElementById('lWh').onchange = e => setFilters(f => ({ ...f, warehouseId: e.target.value, page: 1 }));
    document.getElementById('lExp').onchange = e => setFilters(f => ({ ...f, expiringDays: e.target.value, page: 1 }));
    document.getElementById('lCsv').onclick = () => UI.exportCsv('partiler.csv',
      [t('itemName'), t('lotNo'), t('warehouse'), t('qty'), t('unit'), t('status'), t('expiryDate'), t('unitCost')],
      res.data.map(r => [r.itemName, r.lotNo, r.warehouse, r.qty, r.unit, r.status, r.expiryDate, r.unitCost]));

    document.querySelectorAll('[data-trace]').forEach(b => b.onclick = () => traceDialog(b.dataset.trace));
    document.querySelectorAll('[data-status]').forEach(b => b.onclick = () => statusDialog(res.data.find(x => x.id === b.dataset.status)));
    document.querySelectorAll('[data-transfer]').forEach(b => b.onclick = () => transferDialog(res.data.find(x => x.id === b.dataset.transfer)));
  }, [phase]);

  function reload() { setFilters(f => ({ ...f })); }

  function statusDialog(lot) {
    modal({
      title: t('changeStatus'), sub: `${lot.itemName} · ${lot.lotNo || '—'} · ${num(lot.qty)} ${lot.unit || ''}`,
      body: `
        ${field(t('newStatus'), select('cStatus', [
          { v: 'available', l: t('available') }, { v: 'quarantine', l: t('quarantine') },
          { v: 'blocked', l: t('blocked') }, { v: 'rejected', l: t('rejected') }], lot.status === 'quarantine' ? 'available' : 'quarantine'))}
        ${field(t('qty'), input('cQty', { type: 'number', value: lot.qty, min: 0.0001, step: '0.0001' }),
          UI.getLang() === 'tr' ? 'Kısmi giderseniz lot bölünür.' : 'A partial quantity splits the lot.')}
        ${field(t('statusReason'), input('cNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="cGo">${t('confirm')}</button>`,
      onOpen: (box) => {
        box.querySelector('#cGo').onclick = async () => {
          try {
            await Api.changeLotStatus({ lotId: lot.id, toStatus: val('cStatus'), qty: numVal('cQty'), note: val('cNote') });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function transferDialog(lot) {
    const warehouses = warehousesRef.current;
    modal({
      title: t('transferLot'), sub: `${lot.itemName} · ${lot.lotNo || '—'} · ${lot.warehouse}`,
      body: `
        ${field(t('targetWarehouse'), select('tWh', warehouses.filter(w => w.id !== lot.warehouseId).map(w => ({ v: w.id, l: w.name }))))}
        ${field(t('qty'), input('tQty', { type: 'number', value: lot.qty, min: 0.0001, step: '0.0001' }))}
        ${field(t('notes'), input('tNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="tGo">${t('confirm')}</button>`,
      onOpen: (box) => {
        box.querySelector('#tGo').onclick = async () => {
          try {
            await Api.transferLot({ lotId: lot.id, targetWarehouseId: intVal('tWh'), qty: numVal('tQty'), note: val('tNote') });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  if (phase.status === 'loading') {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const { res } = phase;
  const html = `
    <div class="topbar">
      <div><h2>${t('lotsTitle')}</h2><div class="sub">${t('lotsSub')} · ${res.total}</div></div>
      <div class="topbar-actions">
        <div class="search-box">${UI.icon(UI.ICONS.search)}<input id="lqS" placeholder="${t('search')}" value="${esc(filters.q)}"></div>
        <button class="btn btn-ghost btn-sm" id="lCsv">${UI.icon(UI.ICONS.download)}CSV</button>
      </div>
    </div>

    <div class="filters">
      ${select('lStatus', [{ v: '', l: t('all') + ' — ' + t('status') },
        { v: 'available', l: t('available') }, { v: 'quarantine', l: t('quarantine') },
        { v: 'blocked', l: t('blocked') }, { v: 'rejected', l: t('rejected') }], filters.status)}
      ${select('lWh', [{ v: '', l: t('all') + ' — ' + t('warehouse') }, ...warehousesRef.current.map(w => ({ v: w.id, l: w.name }))], filters.warehouseId)}
      ${select('lExp', [{ v: '', l: t('all') },
        { v: '30', l: UI.getLang() === 'tr' ? '30 gün içinde SKT' : 'Expiring in 30 days' },
        { v: '0', l: t('expired') }], filters.expiringDays)}
    </div>

    <div class="card">
      ${table([
        { key: 'itemName', label: t('itemName'), render: r => `
            <div style="font-weight:600">${esc(r.itemName)}</div>
            <div class="sub-line mono">${esc(r.lotNo || (UI.getLang() === 'tr' ? 'partisiz' : 'no lot'))}${r.serialNo ? ' · ' + esc(r.serialNo) : ''}</div>` },
        { key: 'warehouse', label: t('warehouse'), render: r => esc(r.warehouse || '—') },
        { key: 'qty', label: t('qty'), num: true, render: r => `${num(r.qty)} <span style="color:var(--text-faint);font-size:11px">${esc(r.unit || '')}</span>` },
        { key: 'status', label: t('status'), render: r => UI.lotStatusBadge(r.status) },
        { key: 'expiryDate', label: t('expiryDate'), render: r => {
            if (!r.expiryDate) return '—';
            const d = Math.floor((new Date(r.expiryDate) - Date.now()) / 86400000);
            if (d < 0) return `<span class="badge crit">${t('expired')}</span>`;
            if (d <= 30) return `<span class="badge warn">${dt(r.expiryDate)} · ${d}g</span>`;
            return dt(r.expiryDate);
          } },
        { key: 'unitCost', label: t('unitCost'), num: true, render: r => '₺' + num(r.unitCost, 2) },
        { key: 'value', label: t('total'), num: true, render: r => '₺' + num(r.qty * r.unitCost, 0) },
        { key: 'receivedAt', label: t('receivedAt'), render: r => UI.ts(r.receivedAt), cls: 'nowrap' },
        { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
            <button class="icon-btn" data-trace="${esc(r.id)}" title="${t('traceability')}">${UI.icon(UI.ICONS.eye)}</button>
            ${can('quality') || can('write') ? `<button class="icon-btn" data-status="${esc(r.id)}" title="${t('changeStatus')}">${UI.icon(UI.ICONS.check)}</button>` : ''}
            ${can('write') ? `<button class="icon-btn" data-transfer="${esc(r.id)}" title="${t('transferLot')}">${UI.icon(UI.ICONS.truck)}</button>` : ''}
          </div>` }
      ], res.data)}
      ${pager(res, p => setFilters(f => ({ ...f, page: p })))}
    </div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
