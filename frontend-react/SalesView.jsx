// @ts-nocheck
/**
 * Satış (Sales) — React'e kademeli geçişin bir sonraki ekranı.
 * Planning/Purchasing/Quality ile aynı sekmeli desen (6 sekme) + ön-koşul
 * veri çekimi (items/customers/warehouses). fullReload()'a gerek yok.
 */
import { useEffect, useState, useRef } from 'react';

export default function SalesView() {
  const { t, esc, num, money, cur, dt, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  const [tab, setTab] = useState('orders');
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const itemsRef = useRef([]);
  const customersRef = useRef([]);
  const warehousesRef = useRef([]);
  const profitGroupRef = useRef('item');

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [it, cs, wh] = await Promise.all([
          Api.items({ pageSize: 300 }), Api.customers({ pageSize: 200 }), Api.warehouses()
        ]);
        if (cancelled) return;
        itemsRef.current = it.data; customersRef.current = cs.data || cs; warehousesRef.current = wh;
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('salesBody');
    const actions = document.getElementById('salesActions');
    if (!body || !actions) return;
    const fns = { orders: renderOrders, shipments: renderShipments, customers: renderCustomers, invoices: renderInvoices, edocs: renderEdocs, profit: renderProfit };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [ready, tab, reloadToken]);

  /* ================= SALES ORDERS ================= */
  async function renderOrders(body, actions) {
    let res;
    try { res = await Api.salesOrders({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="soNew">${UI.icon(UI.ICONS.plus)}${t('newSO')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'soNo', label: t('soNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.soNo)}</button>
          <div class="sub-line">${esc(r.customerName || '—')}</div>` },
      { key: 'date', label: t('date'), render: r => dt(r.date), cls: 'nowrap' },
      { key: 'promisedDate', label: t('promisedDate'), render: r => {
          if (!r.promisedDate) return '—';
          const late = new Date(r.promisedDate) < new Date() && !['shipped', 'invoiced', 'cancelled'].includes(r.status);
          return late ? `<span class="badge crit">${dt(r.promisedDate)}</span>` : dt(r.promisedDate);
        }, cls: 'nowrap' },
      { key: 'progress', label: t('shippedQty'), render: r => {
          const ord = (r.lines || []).reduce((s, l) => s + l.qty, 0);
          const shp = (r.lines || []).reduce((s, l) => s + (l.shippedQty || 0), 0);
          const pct = ord > 0 ? Math.round((shp / ord) * 100) : 0;
          return `<div style="min-width:90px">${num(shp)}/${num(ord)}
            <div class="progress"><div class="bar ${pct >= 100 ? 'ok' : ''}" style="width:${Math.min(100, pct)}%"></div></div></div>`;
        } },
      { key: 'totalBase', label: t('total'), num: true, render: r => `₺${money(r.totalBase)}
          <div class="sub-line">${cur(r.currency)}</div>` },
      { key: 'status', label: t('status'), render: r => soStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${!['shipped', 'invoiced', 'cancelled'].includes(r.status) && can('write')
            ? `<button class="btn btn-ghost btn-sm" data-ship="${esc(r.id)}">${UI.icon(UI.ICONS.truck)}${t('newShipment')}</button>` : ''}
          ${['shipped', 'partially_shipped'].includes(r.status) && can('write')
            ? `<button class="btn btn-ghost btn-sm" data-inv="${esc(r.id)}">${t('newInvoice')}</button>` : ''}
        </div>` }
    ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    document.getElementById('soNew')?.addEventListener('click', () => soForm());
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openSO(b.dataset.open));
    body.querySelectorAll('[data-ship]').forEach(b => b.onclick = () => shipmentForm(b.dataset.ship));
    body.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => invoiceForm(rows.find(x => x.id === b.dataset.inv)));
  }

  const soStatusBadge = (s) => {
    const m = {
      open: ['info', UI.getLang() === 'tr' ? 'Açık' : 'Open'],
      partially_shipped: ['warn', UI.getLang() === 'tr' ? 'Kısmi sevk' : 'Partially shipped'],
      shipped: ['ok', UI.getLang() === 'tr' ? 'Sevk edildi' : 'Shipped'],
      invoiced: ['ok', UI.getLang() === 'tr' ? 'Faturalandı' : 'Invoiced'],
      cancelled: ['plain', UI.getLang() === 'tr' ? 'İptal' : 'Cancelled']
    };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  function soForm() {
    const items = itemsRef.current, customers = customersRef.current;
    let lines = [{ itemId: items[0]?.id || '', qty: 1, price: 0 }];
    modal({
      title: t('newSO'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('customerName'), select('soCus', customers.map(c => ({ v: c.id, l: c.name }))))}
          ${field(t('currency'), select('soCur', [{ v: 'TRY', l: 'TRY ₺' }, { v: 'USD', l: 'USD $' }, { v: 'EUR', l: 'EUR €' }], 'TRY'))}
        </div>
        <div class="field-row three">
          ${field(t('date'), input('soDate', { type: 'date', value: UI.today() }))}
          ${field(t('promisedDate'), input('soProm', { type: 'date' }))}
          ${field(t('incoterm'), input('soInco'))}
        </div>
        ${field(t('notes'), input('soNote'))}
        <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
        <div class="dyn-list" id="soLines"></div>
        <button class="btn btn-ghost btn-sm" id="soAdd" type="button">+ ${t('add')}</button>
        <div class="totals-row" id="soTotals"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="soGo">${t('save')}</button>`,
      onOpen: (box) => {
        const totals = () => {
          const sum = lines.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0);
          box.querySelector('#soTotals').innerHTML = `<span class="total-chip">${t('total')}: ${num(sum, 2)} ${cur(val('soCur'))}</span>`;
        };
        const draw = () => {
          box.querySelector('#soLines').innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1;min-width:150px">
                ${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)} (${esc(o.unit)})</option>`).join('')}
              </select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:84px" title="${t('qty')}">
              <input type="number" min="0" step="0.01" value="${l.price}" data-i="${i}" data-f="price" style="width:96px" title="${t('price')}">
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#soLines select,#soLines input').forEach(inp => inp.oninput = () => {
            lines[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'itemId' ? inp.value : Number(inp.value);
            if (inp.dataset.f === 'itemId') {
              // Default to the item's list price so the user is not typing it every time
              const it = items.find(x => x.id === inp.value);
              if (it && it.salePrice) { lines[+inp.dataset.i].price = it.salePrice; draw(); }
            }
            totals();
          });
          box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
          totals();
        };
        box.querySelector('#soAdd').onclick = () => { lines.push({ itemId: items[0]?.id || '', qty: 1, price: 0 }); draw(); };
        box.querySelector('#soCur').onchange = totals;
        draw();

        box.querySelector('#soGo').onclick = async () => {
          try {
            await Api.createSalesOrder({
              customerId: intVal('soCus'), date: val('soDate'), promisedDate: val('soProm') || undefined,
              currency: val('soCur'), incoterm: val('soInco'), notes: val('soNote'),
              lines: lines.filter(l => l.itemId && l.qty > 0)
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) {
            // Credit limit rejections carry useful numbers — surface them rather than a bare message
            if (e.payload && e.payload.creditLimit !== undefined) {
              UI.toast(`${t('creditLimitExceeded')} — ${t('creditLimit')}: ₺${money(e.payload.creditLimit)}, ${t('openBalance')}: ₺${money(e.payload.outstanding)}`, 'err');
            } else UI.err(e);
          }
        };
      }
    });
  }

  async function openSO(id) {
    let so;
    try { so = await Api.salesOrder(id); } catch (e) { UI.err(e); return; }
    modal({
      title: so.soNo, sub: `${so.customerName || ''} · ${dt(so.date)}`, size: 'xwide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${soStatusBadge(so.status)}
          ${so.incoterm ? `<span class="badge plain">${esc(so.incoterm)}</span>` : ''}
          <span class="badge plain">${esc(so.currency)} @ ${num(so.fxRate, 4)}</span>
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('promisedDate')}</div><div class="v">${dt(so.promisedDate)}</div></div>
          <div class="kv"><div class="k">${t('total')}</div><div class="v">₺${money(so.totalBase)}</div></div>
        </div>
        <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
        ${table([
          { key: 'itemName', label: t('itemName') },
          { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty) },
          { key: 'shippedQty', label: t('shippedQty'), num: true, render: r => num(r.shippedQty || 0) },
          { key: 'remainingQty', label: t('remainingQty'), num: true, render: r => `<b>${num(r.remainingQty)}</b>` },
          { key: 'price', label: t('price'), num: true, render: r => `${num(r.price, 2)} ${cur(r.currency)}` },
          { key: 'cogsBase', label: t('cost'), num: true, render: r => r.cogsBase ? '₺' + num(r.cogsBase, 0) : '—' },
          { key: 'margin', label: t('margin'), num: true, render: r => {
              const rev = (r.shippedQty || 0) * r.price * so.fxRate;
              if (!rev) return '—';
              const m = ((rev - (r.cogsBase || 0)) / rev) * 100;
              return `<span style="color:${m < 0 ? 'var(--danger)' : m < 15 ? 'var(--accent)' : 'var(--success)'}">${num(m, 1)}%</span>`;
            } }
        ], so.lines || [])}

        ${so.shipments && so.shipments.length ? `
          <div class="section-title">${t('tabShipments')}</div>
          ${table([
            { key: 'shipment_no', label: t('shipmentNo'), render: r => `<span class="mono">${esc(r.shipment_no || r.shipmentNo)}</span>` },
            { key: 'date', label: t('date'), render: r => dt(r.date) },
            { key: 'destination', label: t('destination'), render: r => esc(r.destination || '—') },
            { key: 'status', label: t('status'), render: r => UI.shipStatusBadge(r.status) }
          ], so.shipments)}` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${!['shipped', 'invoiced', 'cancelled'].includes(so.status) && can('write')
                 ? `<button class="btn btn-primary" id="soShip">${t('newShipment')}</button>` : ''}
               ${!['shipped', 'invoiced', 'cancelled'].includes(so.status) && can('approve')
                 ? `<button class="btn btn-danger" id="soCancel">${UI.getLang() === 'tr' ? 'İptal Et' : 'Cancel Order'}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#soShip')?.addEventListener('click', () => { closeModal(); shipmentForm(so.id); });
        box.querySelector('#soCancel')?.addEventListener('click', () => {
          UI.confirmDialog(t('confirmDelete'), async () => {
            try { await Api.cancelSalesOrder(so.id); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
          }, { danger: true });
        });
      }
    });
  }

  /* ================= SHIPMENTS ================= */
  async function renderShipments(body, actions) {
    let res;
    try { res = await Api.shipments({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="shNew">${UI.icon(UI.ICONS.plus)}${t('newShipment')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'shipmentNo', label: t('shipmentNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.shipmentNo)}</button>
          <div class="sub-line">${esc(r.type || '')}</div>` },
      { key: 'destination', label: t('destination'), render: r => esc(r.destination || '—') },
      { key: 'carrier', label: t('carrier'), render: r => esc(r.carrier || '—') },
      { key: 'items', label: UI.getLang() === 'tr' ? 'Kalem' : 'Lines', num: true, render: r => num((r.items || []).length) },
      { key: 'crates', label: t('crates'), num: true, render: r => num((r.crates || []).length) },
      { key: 'date', label: t('date'), render: r => dt(r.date), cls: 'nowrap' },
      { key: 'status', label: t('status'), render: r => UI.shipStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${r.status !== 'Teslim Edildi' && can('write') ? `<button class="icon-btn ok" data-adv="${esc(r.id)}" title="${t('advanceStatus')}">${UI.icon(UI.ICONS.check)}</button>` : ''}
          <button class="icon-btn" data-print="${esc(r.id)}" title="${t('print')}">${UI.icon(UI.ICONS.print)}</button>
          ${can('delete') && r.status !== 'Teslim Edildi' ? `<button class="icon-btn danger" data-del="${esc(r.id)}">${UI.icon(UI.ICONS.trash)}</button>` : ''}
        </div>` }
    ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    document.getElementById('shNew')?.addEventListener('click', () => shipmentForm(null));
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openShipment(b.dataset.open));
    body.querySelectorAll('[data-adv]').forEach(b => b.onclick = async () => {
      try { await Api.advanceShipment(b.dataset.adv); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printPackingList(await Api.shipment(b.dataset.print)));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deleteShipment(b.dataset.del); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
    }, { danger: true }));
  }

  async function shipmentForm(soId) {
    const items = itemsRef.current, customers = customersRef.current, warehouses = warehousesRef.current;
    let so = null;
    if (soId) { try { so = await Api.salesOrder(soId); } catch (e) { UI.err(e); return; } }

    // Lines default to what the order still owes; a standalone shipment starts with one blank line.
    let lines = so
      ? (so.lines || []).filter(l => l.remainingQty > 1e-9).map(l => ({ itemId: l.itemId, qty: l.remainingQty, lotId: '' }))
      : [{ itemId: items[0]?.id || '', qty: 1, lotId: '' }];
    let crates = [];
    let lotCache = {};

    modal({
      title: t('newShipment'), sub: so ? `${so.soNo} · ${so.customerName}` : '',
      size: 'xwide',
      body: `
        <div class="field-row three">
          ${field(t('destination'), input('shDest', { value: so?.customerName ? '' : '' }))}
          ${field(t('carrier'), input('shCarrier'))}
          ${field(UI.getLang() === 'tr' ? 'Sevk tipi' : 'Type', select('shType', [
            { v: 'Yurt İçi', l: t('originDomestic') }, { v: 'Yurt Dışı', l: t('originIntl') }]))}
        </div>
        <div class="field-row three">
          ${field(t('date'), input('shDate', { type: 'date', value: UI.today() }))}
          ${field(t('trackingNo'), input('shTrack'))}
          ${field(t('warehouse'), select('shWh', [{ v: '', l: t('all') }, ...warehouses.map(w => ({ v: w.id, l: w.name }))]))}
        </div>
        ${!so ? field(t('customerName'), select('shCus', [{ v: '', l: t('none') }, ...customers.map(c => ({ v: c.id, l: c.name }))])) : ''}

        <div class="section-title">${UI.getLang() === 'tr' ? 'Sevk edilecek kalemler' : 'Lines to ship'}</div>
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Parti seçmezseniz sistem son kullanma tarihi en yakın partiden başlayarak (FEFO) otomatik seçer.'
          : 'If you do not pick a lot, the system allocates automatically starting from the earliest expiry (FEFO).'}</div>
        <div class="dyn-list" id="shLines"></div>
        <button class="btn btn-ghost btn-sm" id="shAdd" type="button">+ ${t('add')}</button>

        <div class="section-title">${t('crates')}</div>
        <div class="dyn-list" id="shCrates"></div>
        <button class="btn btn-ghost btn-sm" id="shAddCrate" type="button">${t('addCrate')}</button>
        <div class="totals-row" id="shTotals"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="shGo">${t('save')}</button>`,
      onOpen: (box) => {
        async function lotsFor(itemId) {
          if (lotCache[itemId]) return lotCache[itemId];
          try {
            const r = await Api.lots({ itemId, status: 'available', pageSize: 100 });
            lotCache[itemId] = r.data || [];
          } catch { lotCache[itemId] = []; }
          return lotCache[itemId];
        }

        async function drawLines() {
          const host = box.querySelector('#shLines');
          host.innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1;min-width:150px" ${so ? 'disabled' : ''}>
                ${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)} (${esc(o.unit)})</option>`).join('')}
              </select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:90px" title="${t('qty')}">
              <select data-i="${i}" data-f="lotId" class="lot-sel" style="min-width:180px"><option value="">${t('autoFefo')}</option></select>
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');

          // Populate the lot dropdowns with what is actually available for each item
          for (let i = 0; i < lines.length; i++) {
            const sel = host.querySelector(`select.lot-sel[data-i="${i}"]`);
            if (!sel) continue;
            const ls = await lotsFor(lines[i].itemId);
            ls.forEach(lot => {
              const o = document.createElement('option');
              o.value = lot.id;
              o.textContent = `${lot.lotNo || (UI.getLang() === 'tr' ? 'partisiz' : 'no lot')} · ${num(lot.qty)} ${lot.unit || ''}` +
                (lot.expiryDate ? ` · SKT ${dt(lot.expiryDate)}` : '');
              if (lot.id === lines[i].lotId) o.selected = true;
              sel.appendChild(o);
            });
          }

          host.querySelectorAll('select,input').forEach(inp => inp.onchange = inp.oninput = async () => {
            const i = +inp.dataset.i, f = inp.dataset.f;
            lines[i][f] = f === 'qty' ? Number(inp.value) : inp.value;
            if (f === 'itemId') { lines[i].lotId = ''; await drawLines(); }
          });
          host.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { lines.splice(+b.dataset.rm, 1); await drawLines(); });
        }

        const drawCrates = () => {
          box.querySelector('#shCrates').innerHTML = crates.map((c, i) => `
            <div class="dyn-row">
              <input type="text" placeholder="${t('crateNo')}" value="${esc(c.crateNo || '')}" data-ci="${i}" data-cf="crateNo" style="width:120px">
              <input type="number" min="0" placeholder="G" value="${c.w || 0}" data-ci="${i}" data-cf="w" style="width:72px">
              <input type="number" min="0" placeholder="Y" value="${c.h || 0}" data-ci="${i}" data-cf="h" style="width:72px">
              <input type="number" min="0" placeholder="D" value="${c.d || 0}" data-ci="${i}" data-cf="d" style="width:72px">
              <input type="number" min="0" step="0.1" placeholder="kg" value="${c.weight || 0}" data-ci="${i}" data-cf="weight" style="width:82px">
              <button class="rm" data-crm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#shCrates input').forEach(inp => inp.oninput = () => {
            crates[+inp.dataset.ci][inp.dataset.cf] = inp.dataset.cf === 'crateNo' ? inp.value : Number(inp.value);
            totals();
          });
          box.querySelectorAll('[data-crm]').forEach(b => b.onclick = () => { crates.splice(+b.dataset.crm, 1); drawCrates(); });
          totals();
        };

        const totals = () => {
          const w = crates.reduce((s, c) => s + (Number(c.weight) || 0), 0);
          const vol = crates.reduce((s, c) => s + ((c.w || 0) * (c.h || 0) * (c.d || 0)) / 1e6, 0);
          box.querySelector('#shTotals').innerHTML =
            `<span class="total-chip">${t('crates')}: ${crates.length}</span>
             <span class="total-chip">${t('weight')}: ${num(w, 1)} kg</span>
             <span class="total-chip">${UI.getLang() === 'tr' ? 'Hacim' : 'Volume'}: ${num(vol, 3)} m³</span>`;
        };

        box.querySelector('#shAdd').onclick = async () => { lines.push({ itemId: items[0]?.id || '', qty: 1, lotId: '' }); await drawLines(); };
        box.querySelector('#shAddCrate').onclick = () => { crates.push({ crateNo: '', w: 0, h: 0, d: 0, weight: 0 }); drawCrates(); };
        drawLines(); drawCrates();

        box.querySelector('#shGo').onclick = async () => {
          const dest = val('shDest');
          if (!dest) return UI.toast(UI.getLang() === 'tr' ? 'Varış noktası zorunlu.' : 'Destination is required.', 'err');
          try {
            await Api.createShipment({
              soId: so ? so.id : undefined,
              customerId: so ? so.customerId : (val('shCus') ? intVal('shCus') : undefined),
              type: val('shType'), carrier: val('shCarrier'), destination: dest,
              date: val('shDate'), trackingNo: val('shTrack'),
              warehouseId: val('shWh') ? intVal('shWh') : undefined,
              items: lines.filter(l => l.itemId && l.qty > 0).map(l => ({
                itemId: l.itemId, qty: l.qty, lotId: l.lotId || undefined
              })),
              crates: crates.filter(c => c.w || c.h || c.d || c.weight)
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openShipment(id) {
    let s;
    try { s = await Api.shipment(id); } catch (e) { UI.err(e); return; }
    modal({
      title: s.shipmentNo, sub: `${s.destination || ''} · ${dt(s.date)}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${UI.shipStatusBadge(s.status)}
          <span class="badge plain">${esc(s.type || '')}</span>
          ${s.incoterm ? `<span class="badge plain">${esc(s.incoterm)}</span>` : ''}
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('carrier')}</div><div class="v">${esc(s.carrier || '—')}</div></div>
          <div class="kv"><div class="k">${t('trackingNo')}</div><div class="v mono">${esc(s.trackingNo || '—')}</div></div>
        </div>
        <div class="section-title">${UI.getLang() === 'tr' ? 'Sevk edilen partiler' : 'Shipped lots'}</div>
        ${table([
          { key: 'itemName', label: t('itemName') },
          { key: 'lotNo', label: t('lotNo'), render: r => `<span class="mono">${esc(r.lotNo || '—')}</span>` },
          { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty) },
          { key: 'unitCost', label: t('unitCost'), num: true, render: r => '₺' + num(r.unitCost, 2) },
          { key: 'act', label: '', render: r => r.lotId ? `<button class="btn btn-ghost btn-sm" data-tr="${esc(r.lotId)}">${t('traceability')}</button>` : '' }
        ], s.items || [])}
        ${s.crates && s.crates.length ? `<div class="section-title">${t('crates')}</div>
          ${table([
            { key: 'crateNo', label: t('crateNo'), render: c => esc(c.crateNo || '—') },
            { key: 'dim', label: t('dimensions'), render: c => `${num(c.w)}×${num(c.h)}×${num(c.d)}` },
            { key: 'weight', label: t('weight'), num: true, render: c => num(c.weight, 1) }
          ], s.crates)}` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               <button class="btn btn-ghost" id="shPrint">${UI.icon(UI.ICONS.print)}${t('packingList')}</button>`,
      onOpen: (box) => {
        box.querySelector('#shPrint').onclick = () => printPackingList(s);
        box.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { closeModal(); ViewLots.traceDialog(b.dataset.tr); });
      }
    });
  }

  function printPackingList(s) {
    const totalW = (s.crates || []).reduce((a, c) => a + (c.weight || 0), 0);
    UI.printDoc('shipment', UI.getLang() === 'tr' ? 'SEVKİYAT İRSALİYESİ' : 'PACKING LIST', `
      <div class="g">
        <div><b>${t('shipmentNo')}:</b> ${esc(s.shipmentNo)}</div><div><b>${t('date')}:</b> ${dt(s.date)}</div>
        <div><b>${t('destination')}:</b> ${esc(s.destination || '')}</div><div><b>${t('carrier')}:</b> ${esc(s.carrier || '—')}</div>
        <div><b>${t('trackingNo')}:</b> ${esc(s.trackingNo || '—')}</div><div><b>${t('status')}:</b> ${esc(s.status)}</div>
      </div>
      <h4>${UI.getLang() === 'tr' ? 'Kalemler' : 'Items'}</h4>
      <table><tr><th>${t('itemName')}</th><th>${t('lotNo')}</th><th class="r">${t('qty')}</th></tr>
      ${(s.items || []).map(i => `<tr><td>${esc(i.itemName)}</td><td>${esc(i.lotNo || '—')}</td><td class="r">${num(i.qty)}</td></tr>`).join('')}</table>
      ${(s.crates || []).length ? `<h4>${t('crates')}</h4>
      <table><tr><th>${t('crateNo')}</th><th>${t('dimensions')}</th><th class="r">${t('weight')}</th></tr>
      ${s.crates.map(c => `<tr><td>${esc(c.crateNo || '—')}</td><td>${num(c.w)}×${num(c.h)}×${num(c.d)}</td><td class="r">${num(c.weight, 1)}</td></tr>`).join('')}
      <tr><td colspan="2" class="r"><b>${t('total')}</b></td><td class="r"><b>${num(totalW, 1)} kg</b></td></tr></table>` : ''}`);
  }

  /* ================= CUSTOMERS ================= */
  async function renderCustomers(body, actions) {
    let res;
    try { res = await Api.customers({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('approve') ? `<button class="btn btn-primary btn-sm" id="cuNew">${UI.icon(UI.ICONS.plus)}${t('newCustomer')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'name', label: t('customerName'), render: r => `<button class="link-btn" data-open="${r.id}">${esc(r.name)}</button>
          <div class="sub-line">${esc(r.code || '')}${r.country ? ' · ' + esc(r.country) : ''}</div>` },
      { key: 'contact_person', label: t('contactPerson'), render: r => esc(r.contact_person || '—') },
      { key: 'currency', label: t('currency'), render: r => `<span class="badge plain">${esc(r.currency)}</span>` },
      { key: 'payment_terms_days', label: t('paymentTerms'), num: true, render: r => num(r.payment_terms_days || 0) },
      { key: 'credit_limit', label: t('creditLimit'), num: true, render: r => r.credit_limit ? '₺' + money(r.credit_limit) : '—' },
      { key: 'incoterm', label: t('incoterm'), render: r => esc(r.incoterm || '—') },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${can('approve') ? `<button class="icon-btn" data-edit="${r.id}">${UI.icon(UI.ICONS.edit)}</button>` : ''}
          ${can('admin') ? `<button class="icon-btn danger" data-del="${r.id}">${UI.icon(UI.ICONS.trash)}</button>` : ''}</div>` }
    ], rows)}</div>`;

    document.getElementById('cuNew')?.addEventListener('click', () => customerForm(null));
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCustomer(b.dataset.open));
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => customerForm(rows.find(x => String(x.id) === b.dataset.edit)));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deleteCustomer(b.dataset.del); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
    }, { danger: true }));
  }

  function customerForm(c) {
    modal({
      title: c ? t('edit') : t('newCustomer'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('customerName'), input('cuName', { value: c?.name || '' }))}
          ${field(UI.getLang() === 'tr' ? 'Kod' : 'Code', input('cuCode', { value: c?.code || '' }))}
        </div>
        <div class="field-row">
          ${field(t('contactPerson'), input('cuContact', { value: c?.contact_person || '' }))}
          ${field(t('phone'), input('cuPhone', { value: c?.phone || '' }))}
        </div>
        <div class="field-row">
          ${field(t('email'), input('cuEmail', { type: 'email', value: c?.email || '' }))}
          ${field(t('country'), input('cuCountry', { value: c?.country || '' }))}
        </div>
        ${field(t('address'), textarea('cuAddr', { value: c?.address || '' }))}
        <div class="field-row three">
          ${field(t('taxNo'), input('cuTax', { value: c?.tax_no || '' }))}
          ${field(t('currency'), select('cuCur', [{ v: 'TRY', l: 'TRY' }, { v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }], c?.currency || 'TRY'))}
          ${field(t('incoterm'), input('cuInco', { value: c?.incoterm || '' }))}
        </div>
        <div class="field-row">
          ${field(t('paymentTerms'), input('cuPay', { type: 'number', min: 0, value: c?.payment_terms_days ?? 30 }))}
          ${field(t('creditLimit') + ' (₺)', input('cuCredit', { type: 'number', min: 0, value: c?.credit_limit ?? 0 }),
            UI.getLang() === 'tr' ? '0 = limit kontrolü yapılmaz' : '0 disables the credit check')}
        </div>
        ${field(t('notes'), textarea('cuNote', { value: c?.notes || '' }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="cuGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#cuGo').onclick = async () => {
          const p = {
            name: val('cuName'), code: val('cuCode'), contactPerson: val('cuContact'), phone: val('cuPhone'),
            email: val('cuEmail'), country: val('cuCountry'), address: val('cuAddr'), taxNo: val('cuTax'),
            currency: val('cuCur'), incoterm: val('cuInco'), paymentTermsDays: intVal('cuPay'),
            creditLimit: numVal('cuCredit'), notes: val('cuNote')
          };
          try {
            if (c) await Api.updateCustomer(c.id, p); else await Api.createCustomer(p);
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openCustomer(id) {
    let c;
    try { c = await Api.customer(id); } catch (e) { UI.err(e); return; }
    const usage = c.creditLimit > 0 ? (c.openBalanceBase / c.creditLimit) * 100 : 0;
    modal({
      title: c.name, sub: `${c.code || ''} · ${c.country || ''}`, size: 'wide',
      body: `
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('contactPerson')}</div><div class="v">${esc(c.contact_person || '—')}</div></div>
          <div class="kv"><div class="k">${t('phone')}</div><div class="v">${esc(c.phone || '—')}</div></div>
          <div class="kv"><div class="k">${t('email')}</div><div class="v">${esc(c.email || '—')}</div></div>
          <div class="kv"><div class="k">${t('paymentTerms')}</div><div class="v">${num(c.payment_terms_days)} ${UI.getLang() === 'tr' ? 'gün' : 'days'}</div></div>
        </div>
        ${c.credit_limit > 0 ? `
          <div class="section-title">${t('creditLimit')}</div>
          <div class="totals-row">
            <span class="total-chip">${t('creditLimit')}: ₺${money(c.credit_limit)}</span>
            <span class="total-chip ${usage > 90 ? 'crit' : 'ok'}">${t('openBalance')}: ₺${money(c.openBalanceBase || 0)}</span>
          </div>
          <div class="progress"><div class="bar ${usage > 90 ? '' : 'ok'}" style="width:${Math.min(100, usage)}%"></div></div>` : ''}
        ${c.recentOrders && c.recentOrders.length ? `<div class="section-title">${t('tabSalesOrders')}</div>
          ${table([
            { key: 'so_no', label: t('soNo'), render: r => esc(r.so_no) },
            { key: 'date', label: t('date'), render: r => dt(r.date) },
            { key: 'total_base', label: t('total'), num: true, render: r => '₺' + money(r.total_base) },
            { key: 'status', label: t('status'), render: r => soStatusBadge(r.status) }
          ], c.recentOrders)}` : ''}`,
      footer: `${can('admin') ? `
               <button class="btn btn-ghost btn-sm" id="cuExport">${t('kvkkExport')}</button>
               ${!c.anonymized_at ? `<button class="btn btn-danger" id="cuAnon">${t('kvkkAnonymize')}</button>` : `<span class="badge plain">${t('kvkkAlreadyAnonymized')}</span>`}` : ''}
               <button class="btn btn-ghost" data-close>${t('close')}</button>`,
      onOpen: (box) => {
        box.querySelector('#cuExport')?.addEventListener('click', async () => {
          try {
            const data = await Api.exportCustomerData(c.id);
            UI.downloadJson(`musteri-${c.id}-kvkk-veri.json`, data);
            UI.ok(t('kvkkExportDone'));
          } catch (e) { UI.err(e); }
        });
        box.querySelector('#cuAnon')?.addEventListener('click', () => UI.confirmDialog(t('kvkkAnonymizeConfirm'), async () => {
          try { await Api.anonymizeCustomer(c.id); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
        }, { danger: true }));
      }
    });
  }

  /* ================= CUSTOMER INVOICES ================= */
  async function renderInvoices(body, actions) {
    let res;
    try { res = await Api.customerInvoices({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    // One extra call fills the e-document column for every row at once.
    const edocByInvoice = {};
    try {
      const docs = await Api.edocs({ pageSize: 200 });
      (docs.data || []).forEach(d => { if (d.sourceType === 'customer_invoice') edocByInvoice[d.sourceId] = d; });
    } catch {}

    body.innerHTML = `<div class="card">${table([
      { key: 'invoice_no', label: t('invoiceNo'), render: r => `<span class="mono">${esc(r.invoice_no)}</span>` },
      { key: 'customer_name', label: t('customerName'), render: r => esc(r.customer_name || '—') },
      { key: 'invoice_date', label: t('date'), render: r => dt(r.invoice_date) },
      { key: 'due_date', label: UI.getLang() === 'tr' ? 'Vade' : 'Due', render: r => {
          if (!r.due_date) return '—';
          const overdue = new Date(r.due_date) < new Date() && r.status === 'issued';
          return overdue ? `<span class="badge crit">${dt(r.due_date)}</span>` : dt(r.due_date);
        } },
      { key: 'amount', label: UI.getLang() === 'tr' ? 'Tutar' : 'Amount', num: true, render: r => `${num(r.amount, 2)} ${cur(r.currency)}` },
      { key: 'status', label: t('status'), render: r => `<span class="badge ${r.status === 'paid' ? 'ok' : 'warn'}">${esc(r.status)}</span>` },
      { key: 'edoc', label: t('edocTitle'), render: r => {
          const d = edocByInvoice[r.id];
          if (!d) return `<span class="badge plain">—</span>`;
          return `${edocTypeBadge(d.docType)} ${edocStatusBadge(d.status)}`;
        } },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${!edocByInvoice[r.id] && can('write') ? `<button class="btn btn-ghost btn-sm" data-edoc="${esc(r.id)}">${t('createEdoc')}</button>` : ''}
          ${edocByInvoice[r.id] ? `<button class="btn btn-ghost btn-sm" data-viewdoc="${esc(edocByInvoice[r.id].id)}">${t('detail')}</button>` : ''}
          ${r.status === 'issued' && can('write') ? `<button class="btn btn-ghost btn-sm" data-pay="${esc(r.id)}">${UI.getLang() === 'tr' ? 'Tahsil Et' : 'Mark Paid'}</button>` : ''}
        </div>` }
    ], rows)}</div>`;

    body.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
      try { await Api.payInvoice(b.dataset.pay); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-edoc]').forEach(b => b.onclick = async () => {
      try {
        const d = await Api.edocFromInvoice(b.dataset.edoc);
        UI.ok(`${d.documentNo} ${UI.getLang() === 'tr' ? 'oluşturuldu' : 'created'}`);
        reload();
      } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-viewdoc]').forEach(b => b.onclick = () => openEdoc(b.dataset.viewdoc));
  }

  function invoiceForm(so) {
    const total = (so.lines || []).reduce((s, l) => s + (l.shippedQty || 0) * l.price, 0);
    modal({
      title: t('newInvoice'), sub: `${so.soNo} · ${so.customerName || ''}`,
      body: `
        <div class="field-row">
          ${field(t('invoiceAmount'), input('ciAmt', { type: 'number', min: 0, step: '0.01', value: total.toFixed(2) }),
            UI.getLang() === 'tr' ? 'Sevk edilen miktarlara göre önerildi.' : 'Suggested from shipped quantities.')}
          ${field(t('currency'), select('ciCur', [{ v: 'TRY', l: 'TRY' }, { v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }], so.currency))}
        </div>
        ${field(t('date'), input('ciDate', { type: 'date', value: UI.today() }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="ciGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#ciGo').onclick = async () => {
          try {
            await Api.createCustomerInvoice({
              customerId: so.customerId, soId: so.id, amount: numVal('ciAmt'),
              currency: val('ciCur'), invoiceDate: val('ciDate')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= PROFITABILITY ================= */
  async function renderProfit(body, actions) {
    const profitGroup = profitGroupRef.current;
    let p;
    try { p = await Api.profitability({ groupBy: profitGroup }); } catch (e) { UI.err(e); return; }

    actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="prCsv">${UI.icon(UI.ICONS.download)}CSV</button>`;

    body.innerHTML = `
      <div class="filters">
        ${select('prGroup', [
          { v: 'item', l: t('groupByItem') }, { v: 'customer', l: t('groupByCustomer') }, { v: 'order', l: t('groupByOrder') }
        ], profitGroup)}
      </div>
      <div class="stat-row">
        ${UI.stat(t('revenue'), '₺' + money(p.totals.revenueBase))}
        ${UI.stat(t('cost'), '₺' + money(p.totals.costBase), { kind: 'info' })}
        ${UI.stat(t('profit'), '₺' + money(p.totals.profitBase), { kind: p.totals.profitBase >= 0 ? 'ok' : 'crit' })}
        ${UI.stat(t('margin'), num(p.totals.marginPct, 1) + '%', { kind: p.totals.marginPct >= 15 ? 'ok' : p.totals.marginPct >= 0 ? 'warn' : 'crit' })}
      </div>
      <div class="card"><div class="card-body"><div class="chart-wrap"><canvas id="chProfit"></canvas></div></div></div>
      <div class="card">${table([
        { key: 'key', label: profitGroup === 'customer' ? t('customerName') : profitGroup === 'order' ? t('soNo') : t('itemName') },
        { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty) },
        { key: 'revenueBase', label: t('revenue'), num: true, render: r => '₺' + money(r.revenueBase) },
        { key: 'costBase', label: t('cost'), num: true, render: r => '₺' + money(r.costBase) },
        { key: 'profitBase', label: t('profit'), num: true, render: r =>
            `<span style="color:${r.profitBase >= 0 ? 'var(--success)' : 'var(--danger)'}">₺${money(r.profitBase)}</span>` },
        { key: 'marginPct', label: t('margin'), num: true, render: r =>
            `<span style="color:${r.marginPct < 0 ? 'var(--danger)' : r.marginPct < 15 ? 'var(--accent)' : 'var(--success)'}">${num(r.marginPct, 1)}%</span>` }
      ], p.data)}</div>`;

    document.getElementById('prGroup').onchange = e => { profitGroupRef.current = e.target.value; reload(); };
    document.getElementById('prCsv').onclick = () => UI.exportCsv('karlilik.csv',
      [profitGroup, t('qty'), t('revenue'), t('cost'), t('profit'), t('margin')],
      p.data.map(r => [r.key, r.qty, r.revenueBase, r.costBase, r.profitBase, r.marginPct.toFixed(1)]));

    const top = p.data.slice(0, 10);
    UI.chart('chProfit', {
      type: 'bar',
      data: {
        labels: top.map(r => r.key),
        datasets: [
          { label: t('revenue'), data: top.map(r => Math.round(r.revenueBase)), backgroundColor: UI.PALETTE[1], borderRadius: 4 },
          { label: t('cost'), data: top.map(r => Math.round(r.costBase)), backgroundColor: UI.PALETTE[3], borderRadius: 4 }
        ]
      }
    });
  }

  /* ================= e-BELGELER ================= */

  const edocTypeBadge = (t2) => {
    const m = { einvoice: ['info', t('edocEinvoice')], earchive: ['purple', t('edocEarchive')], edespatch: ['plain', t('edocEdespatch')] };
    const [c, l] = m[t2] || ['plain', t2];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const edocStatusBadge = (st) => {
    const m = {
      draft: ['plain', t('edocDraft')], queued: ['warn', t('edocQueued')], sent: ['info', t('edocSent')],
      accepted: ['ok', t('edocAccepted')], rejected: ['crit', t('edocRejected')],
      error: ['crit', t('edocError')], cancelled: ['plain', t('edocCancelled')]
    };
    const [c, l] = m[st] || ['plain', st];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  async function renderEdocs(body, actions) {
    let res, settings;
    try {
      [res, settings] = await Promise.all([
        Api.edocs({ pageSize: 50 }),
        Api.edocSettings().catch(() => ({}))
      ]);
    } catch (e) { UI.err(e); return; }
    actions.innerHTML = '';
    const rows = res.data || res;

    body.innerHTML = `
      ${settings.provider === 'local' ? `<div class="alert warn">${t('edocLocalHint')}</div>` : ''}
      <div class="alert info">${t('edocLegalWarning')}</div>
      <div class="card">${table([
        { key: 'documentNo', label: t('edocNo'), render: d => `<button class="link-btn" data-open="${esc(d.id)}">${esc(d.documentNo)}</button>
            <div class="sub-line mono" style="font-size:11px">${esc(String(d.ettn).slice(0, 18))}…</div>` },
        { key: 'docType', label: t('edocType'), render: d => edocTypeBadge(d.docType) },
        { key: 'customerName', label: t('customerName'), render: d => esc(d.customerName || '—') },
        { key: 'issueDate', label: t('date'), render: d => dt(d.issueDate), cls: 'nowrap' },
        { key: 'grandTotal', label: t('grandTotal'), num: true, render: d =>
            d.docType === 'edespatch' ? '—' : `${num(d.grandTotal, 2)} ${cur(d.currency)}` },
        { key: 'status', label: t('status'), render: d => edocStatusBadge(d.status) },
        { key: 'act', label: t('actions'), render: d => `<div class="row-actions">
            ${['draft', 'queued', 'error'].includes(d.status) && can('approve')
              ? `<button class="btn btn-primary btn-sm" data-send="${esc(d.id)}">${t('sendEdoc')}</button>` : ''}
            ${['sent', 'queued'].includes(d.status) && can('write')
              ? `<button class="btn btn-ghost btn-sm" data-refresh="${esc(d.id)}">${t('refreshEdoc')}</button>` : ''}
            <a class="icon-btn" href="/api/edocs/${esc(d.id)}/xml" title="${t('downloadXml')}" style="text-decoration:none">${UI.icon(UI.ICONS.download)}</a>
          </div>` }
      ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openEdoc(b.dataset.open));
    body.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
      UI.confirmDialog(
        UI.getLang() === 'tr'
          ? 'Belge entegratöre gönderilecek. Gönderilmiş e-Fatura tek taraflı iptal edilemez.'
          : 'The document will be transmitted. A sent e-Invoice cannot be unilaterally cancelled.',
        async () => {
          try { await Api.sendEdoc(b.dataset.send); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
        }, { confirmLabel: t('sendEdoc') });
    });
    body.querySelectorAll('[data-refresh]').forEach(b => b.onclick = async () => {
      try { const d = await Api.refreshEdoc(b.dataset.refresh); UI.ok(d.gibStatusText || t('saved')); reload(); }
      catch (e) { UI.err(e); }
    });
  }

  async function openEdoc(id) {
    let d;
    try { d = await Api.edoc(id); } catch (e) { UI.err(e); return; }
    modal({
      title: d.documentNo, sub: `${d.customerName || ''} · ${dt(d.issueDate)}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${edocTypeBadge(d.docType)} ${edocStatusBadge(d.status)}
          ${d.profileId ? `<span class="badge plain">${esc(d.profileId)}</span>` : ''}
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('ettn')}</div><div class="v mono" style="font-size:11.5px">${esc(d.ettn)}</div></div>
          <div class="kv"><div class="k">${t('einvoiceAlias')}</div><div class="v mono" style="font-size:11.5px">${esc(d.receiverAlias || '—')}</div></div>
          ${d.docType !== 'edespatch' ? `
          <div class="kv"><div class="k">${t('subtotal')}</div><div class="v">${num(d.subtotal, 2)} ${cur(d.currency)}</div></div>
          <div class="kv"><div class="k">${t('vatTotal')}</div><div class="v">${num(d.vatTotal, 2)} ${cur(d.currency)}</div></div>
          <div class="kv"><div class="k">${t('grandTotal')}</div><div class="v">${num(d.grandTotal, 2)} ${cur(d.currency)}</div></div>` : ''}
          <div class="kv"><div class="k">${t('edocProvider')}</div><div class="v">${esc(d.provider || '—')}${d.providerRef ? ` · ${esc(d.providerRef)}` : ''}</div></div>
        </div>
        ${d.errorMessage ? `<div class="alert crit">${esc(d.errorMessage)}</div>` : ''}
        ${d.gibStatusText ? `<div class="alert info">${esc(d.gibStatusText)}</div>` : ''}

        <div class="section-title">${t('edocLog')}</div>
        <div class="timeline">${(d.log || []).map(l => `
          <div class="tl-row">
            <div class="tl-main">
              <div>${esc(l.action)}${l.status ? ` · ${esc(l.status)}` : ''}</div>
              <div class="tl-meta">${esc(l.message || '')}${l.username ? ' — ' + esc(l.username) : ''}</div>
            </div>
            <div class="tl-right"><div class="tl-meta">${ts(l.ts)}</div></div>
          </div>`).join('') || `<div class="empty" style="padding:18px">${t('noData')}</div>`}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               <a class="btn btn-ghost" href="/api/edocs/${esc(d.id)}/xml">${UI.icon(UI.ICONS.download)}${t('downloadXml')}</a>
               ${['draft', 'queued', 'error'].includes(d.status) && can('approve')
                 ? `<button class="btn btn-primary" id="edSend">${t('sendEdoc')}</button>` : ''}
               ${['draft', 'error'].includes(d.status) && can('approve')
                 ? `<button class="btn btn-danger" id="edCancel">${t('cancelEdoc')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#edSend')?.addEventListener('click', async () => {
          try { await Api.sendEdoc(d.id); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
        });
        box.querySelector('#edCancel')?.addEventListener('click', () => {
          UI.confirmDialog(t('confirmDelete'), async () => {
            try { await Api.cancelEdoc(d.id, ''); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
          }, { danger: true });
        });
      }
    });
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('salesTitle')}</h2><div class="sub">${t('salesSub')}</div></div>
      <div class="topbar-actions" id="salesActions"></div>
    </div>
    ${UI.tabs([
      { k: 'orders', l: t('tabSalesOrders') }, { k: 'shipments', l: t('tabShipments') },
      { k: 'customers', l: t('tabCustomers') }, { k: 'invoices', l: t('tabSalesInvoices') },
      { k: 'edocs', l: t('tabEdocs') }, { k: 'profit', l: t('tabProfit') }
    ], tab, k => setTab(k))}
    <div id="salesBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
