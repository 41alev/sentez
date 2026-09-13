// @ts-nocheck
/**
 * Satın Alma (Purchasing) — React'e kademeli geçişin bir sonraki ekranı.
 * Planning/Reports ile aynı sekmeli desen + Items/Production gibi bir
 * ön-koşul veri çekimi (items/suppliers/warehouses, tüm sekmelerde
 * paylaşılıyor). Bu ekranda `fullReload()`'a gerek yok — orijinalde tüm
 * kaydetme işlemleri yalnızca aktif sekmeyi yeniden çekiyordu (`load(el)`),
 * paylaşılan ön-koşul veriyi değil.
 */
import { useEffect, useState, useRef } from 'react';

export default function PurchasingView() {
  const { t, esc, num, money, cur, dt, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  const [tab, setTab] = useState('orders');
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const itemsRef = useRef([]);
  const suppliersRef = useRef([]);
  const warehousesRef = useRef([]);

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [it, sp, wh] = await Promise.all([
          Api.items({ pageSize: 300 }), Api.suppliers({ pageSize: 200 }), Api.warehouses()
        ]);
        if (cancelled) return;
        itemsRef.current = it.data; suppliersRef.current = sp.data || sp; warehousesRef.current = wh;
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('purchBody');
    const actions = document.getElementById('purchActions');
    if (!body || !actions) return;
    const fns = { orders: renderOrders, suppliers: renderSuppliers, requests: renderRequests, rfqs: renderRfqs, invoices: renderInvoices };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [ready, tab, reloadToken]);

  /* ================= ORDERS ================= */
  async function renderOrders(body, actions) {
    let res;
    try { res = await Api.purchaseOrders({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;

    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="poNew">${UI.icon(UI.ICONS.plus)}${t('newPO')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'poNo', label: t('poNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.poNo)}</button>
          <div class="sub-line">${esc(r.supplier || r.supplierName || '—')}</div>` },
      { key: 'date', label: t('date'), render: r => dt(r.date), cls: 'nowrap' },
      { key: 'expected', label: t('expectedDate'), render: r => {
          if (!r.expected) return '—';
          const overdue = new Date(r.expected) < new Date() && ['approved', 'partially_received'].includes(r.status);
          return overdue ? `<span class="badge crit">${dt(r.expected)}</span>` : dt(r.expected);
        }, cls: 'nowrap' },
      { key: 'progress', label: UI.getLang() === 'tr' ? 'Teslim' : 'Received', render: r => {
          const ordered = (r.items || []).reduce((s, i) => s + i.qty, 0);
          const rec = (r.items || []).reduce((s, i) => s + (i.receivedQty || 0), 0);
          const pct = ordered > 0 ? Math.round((rec / ordered) * 100) : 0;
          return `<div style="min-width:90px">${num(rec)}/${num(ordered)}
            <div class="progress"><div class="bar ${pct >= 100 ? 'ok' : ''}" style="width:${Math.min(100, pct)}%"></div></div></div>`;
        } },
      { key: 'totalBase', label: t('total'), num: true, render: r => {
          const inCur = (r.items || []).reduce((s2, i) => s2 + i.qty * i.price, 0);
          return `₺${money(r.totalBase)}` + (r.currency !== 'TRY'
            ? `<div class="sub-line">${num(inCur, 2)} ${cur(r.currency)}</div>` : '');
        } },
      { key: 'status', label: t('status'), render: r => UI.poStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${r.approvalStatus === 'pending' && can('approve') ? `<button class="icon-btn ok" data-approve="${esc(r.id)}" title="${t('approve')}">${UI.icon(UI.ICONS.check)}</button>
             <button class="icon-btn danger" data-reject="${esc(r.id)}" title="${t('reject')}">${UI.icon(UI.ICONS.x)}</button>` : ''}
          ${['approved', 'partially_received'].includes(r.status) && can('write') ? `<button class="btn btn-ghost btn-sm" data-receive="${esc(r.id)}">${t('receive')}</button>` : ''}
          <button class="icon-btn" data-print="${esc(r.id)}" title="${t('print')}">${UI.icon(UI.ICONS.print)}</button>
        </div>` }
    ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    document.getElementById('poNew')?.addEventListener('click', () => poForm());
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPO(b.dataset.open));
    body.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
      try { await Api.approvePO(b.dataset.approve); UI.ok(t('saved')); reload(); App.refreshBadges(); } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => {
      modal({
        title: t('reject'), body: field(t('rejectReason'), textarea('rjR')),
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-danger" id="rjGo">${t('reject')}</button>`,
        onOpen: (bx) => bx.querySelector('#rjGo').onclick = async () => {
          try { await Api.rejectPO(b.dataset.reject, val('rjR')); closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges(); } catch (e) { UI.err(e); }
        }
      });
    });
    body.querySelectorAll('[data-receive]').forEach(b => b.onclick = () => receiveDialog(b.dataset.receive));
    body.querySelectorAll('[data-print]').forEach(b => b.onclick = async () => printPO(await Api.purchaseOrder(b.dataset.print)));
  }

  function poForm(prefill) {
    const items = itemsRef.current, suppliers = suppliersRef.current, warehouses = warehousesRef.current;
    let lines = prefill?.lines || [{ itemId: items[0]?.id || '', qty: 1, price: 0 }];
    modal({
      title: t('newPO'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('supplierName'), select('poSup', suppliers.map(s => ({ v: s.id, l: s.name })), prefill?.supplierId))}
          ${field(t('warehouse'), select('poWh', warehouses.map(w => ({ v: w.id, l: w.name }))))}
        </div>
        <div class="field-row three">
          ${field(t('date'), input('poDate', { type: 'date', value: UI.today() }))}
          ${field(t('expectedDate'), input('poExp', { type: 'date' }))}
          ${field(t('currency'), select('poCur', [{ v: 'TRY', l: 'TRY ₺' }, { v: 'USD', l: 'USD $' }, { v: 'EUR', l: 'EUR €' }], 'TRY'))}
        </div>
        ${field(t('incoterm'), input('poInco'))}
        ${field(t('notes'), input('poNote'))}
        <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
        <div class="dyn-list" id="poLines"></div>
        <button class="btn btn-ghost btn-sm" id="poAddLine" type="button">+ ${t('add')}</button>
        <div class="totals-row" id="poTotals"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="poGo">${t('save')}</button>`,
      onOpen: (box) => {
        const draw = () => {
          box.querySelector('#poLines').innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1;min-width:150px">
                ${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
              </select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:84px" title="${t('qty')}">
              <input type="number" min="0" step="0.0001" value="${l.price}" data-i="${i}" data-f="price" style="width:96px" title="${t('price')}">
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#poLines select,#poLines input').forEach(inp => inp.oninput = () => {
            lines[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'itemId' ? inp.value : Number(inp.value);
            totals();
          });
          box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
          totals();
        };
        const totals = () => {
          const c = val('poCur');
          const sum = lines.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0);
          box.querySelector('#poTotals').innerHTML = `<span class="total-chip">${t('total')}: ${num(sum, 2)} ${cur(c)}</span>`;
        };
        box.querySelector('#poAddLine').onclick = () => { lines.push({ itemId: items[0]?.id || '', qty: 1, price: 0 }); draw(); };
        box.querySelector('#poCur').onchange = totals;
        draw();

        box.querySelector('#poGo').onclick = async () => {
          try {
            await Api.createPO({
              supplierId: intVal('poSup'), warehouseId: intVal('poWh'), date: val('poDate'),
              expected: val('poExp') || undefined, currency: val('poCur'), incoterm: val('poInco'),
              notes: val('poNote'), items: lines.filter(l => l.itemId && l.qty > 0)
            });
            closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openPO(id) {
    let po;
    try { po = await Api.purchaseOrder(id); } catch (e) { UI.err(e); return; }
    modal({
      title: po.poNo, sub: `${po.supplier || po.supplierName || ''} · ${dt(po.date)}`, size: 'xwide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${UI.poStatusBadge(po.status)}
          ${po.approvalStatus === 'pending' ? `<span class="badge warn">${t('approvalRequired')}</span>` : ''}
          ${po.incoterm ? `<span class="badge plain">${esc(po.incoterm)}</span>` : ''}
          <span class="badge plain">${esc(po.currency)} @ ${num(po.fxRate, 4)}</span>
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('expectedDate')}</div><div class="v">${dt(po.expected)}</div></div>
          <div class="kv"><div class="k">${t('warehouse')}</div><div class="v">${esc(po.warehouse || '—')}</div></div>
          <div class="kv"><div class="k">${t('total')}</div><div class="v">₺${money(po.totalBase)}</div></div>
          <div class="kv"><div class="k">${t('approvedBy')}</div><div class="v">${esc(po.approvedBy || '—')}</div></div>
        </div>
        <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
        ${table([
          { key: 'itemName', label: t('itemName') },
          { key: 'qty', label: t('orderedQty'), num: true, render: r => num(r.qty) },
          { key: 'receivedQty', label: t('receivedQty'), num: true, render: r => num(r.receivedQty || 0) },
          { key: 'remaining', label: t('remainingQty'), num: true, render: r => `<b>${num(r.qty - (r.receivedQty || 0))}</b>` },
          { key: 'price', label: t('price'), num: true, render: r => `${num(r.price, 4)} ${cur(r.currency)}` },
          { key: 'lineTotal', label: t('total'), num: true, render: r => `${num(r.qty * r.price, 2)} ${cur(r.currency)}` }
        ], po.items || [])}

        ${po.receipts && po.receipts.length ? `
          <div class="section-title">${UI.getLang() === 'tr' ? 'Teslim alma kayıtları' : 'Receipts'}</div>
          ${table([
            { key: 'receiptNo', label: t('receiptNo'), render: r => `<span class="mono">${esc(r.receiptNo)}</span>` },
            { key: 'receivedAt', label: t('date'), render: r => ts(r.receivedAt) },
            { key: 'waybillNo', label: t('waybillNo'), render: r => esc(r.waybillNo || '—') },
            { key: 'lines', label: UI.getLang() === 'tr' ? 'Kalem' : 'Lines', num: true, render: r => num((r.lines || []).length) },
            { key: 'act', label: '', render: r => can('write') ? `<button class="btn btn-ghost btn-sm" data-landed="${esc(r.id)}">${t('addLandedCost')}</button>` : '' }
          ], po.receipts)}` : ''}

        ${po.landedCosts && po.landedCosts.length ? `
          <div class="section-title">${t('landedCost')}</div>
          ${table([
            { key: 'costType', label: t('costType'), render: r => esc(t(r.costType) || r.costType) },
            { key: 'amount', label: UI.getLang() === 'tr' ? 'Tutar' : 'Amount', num: true, render: r => `${num(r.amount, 2)} ${cur(r.currency)}` },
            { key: 'allocationMethod', label: t('allocationMethod'), render: r => r.allocationMethod === 'qty' ? t('byQty') : t('byValue') }
          ], po.landedCosts)}` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               <button class="btn btn-ghost" id="poPrint">${UI.icon(UI.ICONS.print)}${t('print')}</button>
               ${['approved', 'partially_received'].includes(po.status) && can('write') ? `<button class="btn btn-primary" id="poRec">${t('receive')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#poPrint').onclick = () => printPO(po);
        box.querySelector('#poRec')?.addEventListener('click', () => { closeModal(); receiveDialog(po.id); });
        box.querySelectorAll('[data-landed]').forEach(b => b.onclick = () => { closeModal(); landedDialog(b.dataset.landed); });
      }
    });
  }

  async function receiveDialog(poId) {
    const warehouses = warehousesRef.current;
    let po;
    try { po = await Api.purchaseOrder(poId); } catch (e) { UI.err(e); return; }
    const open = (po.items || []).filter(i => i.qty - (i.receivedQty || 0) > 1e-9);
    if (!open.length) return UI.toast(UI.getLang() === 'tr' ? 'Tüm kalemler teslim alınmış.' : 'All lines already received.');

    modal({
      title: t('receive'), sub: `${po.poNo} · ${po.supplier || ''}`, size: 'xwide',
      body: `
        <div class="field-row three">
          ${field(t('warehouse'), select('rcWh', warehouses.map(w => ({ v: w.id, l: w.name })), po.warehouseId))}
          ${field(t('waybillNo'), input('rcWaybill'))}
          ${field(t('customsNo'), input('rcCustoms'))}
        </div>
        <div class="section-title">${t('partialReceipt')}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>${t('itemName')}</th><th class="num">${t('remainingQty')}</th><th class="num">${t('receivedQty')}</th>
            <th>${t('lotNo')}</th><th>${t('expiryDate')}</th><th>${t('toQuarantine')}</th></tr></thead>
          <tbody>${open.map(l => `
            <tr>
              <td>${esc(l.itemName)}</td>
              <td class="num">${num(l.qty - (l.receivedQty || 0))}</td>
              <td class="num"><input type="number" min="0" step="0.0001" class="rc-q" data-id="${l.id}" value="${l.qty - (l.receivedQty || 0)}" style="width:96px;text-align:right;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)"></td>
              <td><input type="text" class="rc-lot" data-id="${l.id}" placeholder="${UI.getLang() === 'tr' ? 'ops.' : 'opt.'}" style="width:120px;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)"></td>
              <td><input type="date" class="rc-exp" data-id="${l.id}" style="background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)"></td>
              <td style="text-align:center"><input type="checkbox" class="rc-q2" data-id="${l.id}" ${l.requiresIncomingInspection ? 'checked' : ''}></td>
            </tr>`).join('')}</tbody>
        </table></div>
        ${field(t('notes'), input('rcNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="rcGo">${t('confirm')}</button>`,
      onOpen: (box) => {
        box.querySelector('#rcGo').onclick = async () => {
          const lines = [];
          box.querySelectorAll('.rc-q').forEach(inp => {
            const q = Number(inp.value);
            if (!(q > 0)) return;
            lines.push({
              poItemId: Number(inp.dataset.id), qty: q,
              lotNo: box.querySelector(`.rc-lot[data-id="${inp.dataset.id}"]`)?.value || undefined,
              expiryDate: box.querySelector(`.rc-exp[data-id="${inp.dataset.id}"]`)?.value || undefined,
              toQuarantine: box.querySelector(`.rc-q2[data-id="${inp.dataset.id}"]`)?.checked || false
            });
          });
          if (!lines.length) return UI.toast(UI.getLang() === 'tr' ? 'En az bir kalem girin.' : 'Enter at least one line.');
          try {
            await Api.receivePO(poId, {
              warehouseId: intVal('rcWh'), waybillNo: val('rcWaybill'),
              customsDeclNo: val('rcCustoms'), notes: val('rcNote'), lines
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function landedDialog(receiptId) {
    modal({
      title: t('addLandedCost'),
      body: `
        <div class="field-row">
          ${field(t('costType'), select('lcType', [
            { v: 'freight', l: t('freight') }, { v: 'customs', l: t('customs') },
            { v: 'insurance', l: t('insurance') }, { v: 'handling', l: t('handling') }, { v: 'other', l: t('other') }]))}
          ${field(t('allocationMethod'), select('lcAlloc', [{ v: 'value', l: t('byValue') }, { v: 'qty', l: t('byQty') }]))}
        </div>
        <div class="field-row">
          ${field(UI.getLang() === 'tr' ? 'Tutar' : 'Amount', input('lcAmt', { type: 'number', min: 0, step: '0.01', value: 0 }))}
          ${field(t('currency'), select('lcCur', [{ v: 'TRY', l: 'TRY ₺' }, { v: 'USD', l: 'USD $' }, { v: 'EUR', l: 'EUR €' }], 'TRY'))}
        </div>
        ${field(t('notes'), input('lcNote'))}
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Varış maliyetleri, o irsaliyeyle gelen partilerin birim maliyetine dağıtılır.'
          : 'Landed costs are allocated across the lots created by this receipt.'}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="lcGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#lcGo').onclick = async () => {
          try {
            await Api.addLandedCost(receiptId, {
              costType: val('lcType'), amount: numVal('lcAmt'), currency: val('lcCur'),
              allocationMethod: val('lcAlloc'), notes: val('lcNote')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function printPO(po) {
    UI.printDoc('purchase_order', UI.getLang() === 'tr' ? 'SATIN ALMA SİPARİŞ FORMU' : 'PURCHASE ORDER', `
      <div class="g">
        <div><b>${t('poNo')}:</b> ${esc(po.poNo)}</div><div><b>${t('date')}:</b> ${dt(po.date)}</div>
        <div><b>${t('supplierName')}:</b> ${esc(po.supplier || '')}</div><div><b>${t('expectedDate')}:</b> ${dt(po.expected)}</div>
        <div><b>${t('warehouse')}:</b> ${esc(po.warehouse || '')}</div><div><b>${t('incoterm')}:</b> ${esc(po.incoterm || '—')}</div>
      </div>
      <table><tr><th>${t('itemName')}</th><th class="r">${t('qty')}</th><th class="r">${t('price')}</th><th class="r">${t('total')}</th></tr>
      ${(po.items || []).map(i => `<tr><td>${esc(i.itemName)}</td><td class="r">${num(i.qty)}</td>
        <td class="r">${num(i.price, 4)} ${cur(i.currency)}</td><td class="r">${num(i.qty * i.price, 2)} ${cur(i.currency)}</td></tr>`).join('')}
      <tr><td colspan="3" class="r"><b>${t('total')}</b></td><td class="r"><b>₺${money(po.totalBase)}</b></td></tr></table>`);
  }

  /* ================= SUPPLIERS ================= */
  async function renderSuppliers(body, actions) {
    let res;
    try { res = await Api.suppliers({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="supNew">${UI.icon(UI.ICONS.plus)}${t('newSupplier')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'name', label: t('supplierName'), render: r => `<button class="link-btn" data-open="${r.id}">${esc(r.name)}</button>
          <div class="sub-line">${esc(r.code || '')}${r.country ? ' · ' + esc(r.country) : ''}</div>` },
      { key: 'contactPerson', label: t('contactPerson'), render: r => esc(r.contactPerson || '—') },
      { key: 'currency', label: t('currency'), render: r => `<span class="badge plain">${esc(r.currency)}</span>` },
      { key: 'leadTimeDays', label: t('leadTime'), num: true, render: r => num(r.leadTimeDays ?? 0) },
      { key: 'paymentTermsDays', label: t('paymentTerms'), num: true, render: r => num(r.paymentTermsDays ?? 0) },
      { key: 'incoterm', label: t('incoterm'), render: r => esc(r.incoterm || '—') },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${can('write') ? `<button class="icon-btn" data-edit="${r.id}">${UI.icon(UI.ICONS.edit)}</button>` : ''}
          ${can('delete') ? `<button class="icon-btn danger" data-del="${r.id}">${UI.icon(UI.ICONS.trash)}</button>` : ''}</div>` }
    ], rows)}</div>`;

    document.getElementById('supNew')?.addEventListener('click', () => supForm(null));
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openSupplier(b.dataset.open));
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => supForm(rows.find(x => String(x.id) === b.dataset.edit)));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deleteSupplier(b.dataset.del); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
    }, { danger: true }));
  }

  function supForm(s) {
    modal({
      title: s ? t('edit') : t('newSupplier'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('supplierName'), input('spName', { value: s?.name || '' }))}
          ${field(UI.getLang() === 'tr' ? 'Kod' : 'Code', input('spCode', { value: s?.code || '' }))}
        </div>
        <div class="field-row">
          ${field(t('contactPerson'), input('spContact', { value: s?.contactPerson || '' }))}
          ${field(t('phone'), input('spPhone', { value: s?.phone || '' }))}
        </div>
        <div class="field-row">
          ${field(t('email'), input('spEmail', { type: 'email', value: s?.email || '' }))}
          ${field(t('country'), input('spCountry', { value: s?.country || '' }))}
        </div>
        ${field(t('address'), textarea('spAddr', { value: s?.address || '' }))}
        <div class="field-row three">
          ${field(t('taxNo'), input('spTax', { value: s?.taxNo || '' }))}
          ${field(t('currency'), select('spCur', [{ v: 'TRY', l: 'TRY' }, { v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }], s?.currency || 'TRY'))}
          ${field(t('incoterm'), input('spInco', { value: s?.incoterm || '' }))}
        </div>
        <div class="field-row">
          ${field(t('paymentTerms'), input('spPay', { type: 'number', min: 0, value: s?.paymentTermsDays ?? 30 }))}
          ${field(t('leadTime'), input('spLead', { type: 'number', min: 0, value: s?.leadTimeDays ?? 7 }))}
        </div>
        ${field(t('bankInfo'), input('spBank', { value: s?.bankInfo || '' }))}
        ${field(t('notes'), textarea('spNote', { value: s?.notes || '' }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="spGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#spGo').onclick = async () => {
          const p = {
            name: val('spName'), code: val('spCode'), contactPerson: val('spContact'), phone: val('spPhone'),
            email: val('spEmail'), country: val('spCountry'), address: val('spAddr'), taxNo: val('spTax'),
            currency: val('spCur'), incoterm: val('spInco'), paymentTermsDays: intVal('spPay'),
            leadTimeDays: intVal('spLead'), bankInfo: val('spBank'), notes: val('spNote')
          };
          try {
            if (s) await Api.updateSupplier(s.id, p); else await Api.createSupplier(p);
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openSupplier(id) {
    let s;
    try { s = await Api.supplier(id); } catch (e) { UI.err(e); return; }
    const perf = s.performance || {};
    modal({
      title: s.name, sub: `${s.code || ''} · ${s.country || ''}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${s.isApproved ? `<span class="badge ok">${t('approvedSupplier')}</span>` : `<span class="badge warn">${UI.getLang() === 'tr' ? 'Onaysız' : 'Not approved'}</span>`}
          <span class="badge plain">${esc(s.currency || '')}</span>
          ${s.incoterm ? `<span class="badge plain">${esc(s.incoterm)}</span>` : ''}
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('contactPerson')}</div><div class="v">${esc(s.contactPerson || '—')}</div></div>
          <div class="kv"><div class="k">${t('phone')}</div><div class="v">${esc(s.phone || '—')}</div></div>
          <div class="kv"><div class="k">${t('email')}</div><div class="v">${esc(s.email || '—')}</div></div>
          <div class="kv"><div class="k">${t('taxNo')}</div><div class="v">${esc(s.taxNo || '—')}</div></div>
          <div class="kv"><div class="k">${t('paymentTerms')}</div><div class="v">${num(s.paymentTermsDays || 0)} ${UI.getLang() === 'tr' ? 'gün' : 'days'}</div></div>
          <div class="kv"><div class="k">${t('leadTime')}</div><div class="v">${num(s.leadTimeDays || 0)} ${UI.getLang() === 'tr' ? 'gün' : 'days'}</div></div>
        </div>
        ${s.address ? `<div style="font-size:12.5px;color:var(--text-muted);line-height:1.6;margin-bottom:14px">${esc(s.address)}</div>` : ''}

        ${Object.keys(perf).length ? `<div class="section-title">${t('tabSupplierPerf')}</div>
          <div class="totals-row">
            ${perf.onTimePct != null ? `<span class="total-chip ${perf.onTimePct >= 90 ? 'ok' : 'crit'}">${t('onTimePct')}: ${num(perf.onTimePct, 1)}%</span>` : ''}
            ${perf.deliveries != null ? `<span class="total-chip">${t('deliveries')}: ${num(perf.deliveries)}</span>` : ''}
            ${perf.rejectPct != null ? `<span class="total-chip ${perf.rejectPct > 2 ? 'crit' : 'ok'}">${t('rejectPct')}: ${num(perf.rejectPct, 2)}%</span>` : ''}
            ${perf.totalSpendBase != null ? `<span class="total-chip">${t('totalSpend')}: ₺${money(perf.totalSpendBase)}</span>` : ''}
          </div>` : ''}

        ${s.priceHistory && s.priceHistory.length ? `<div class="section-title">${t('priceHistory')}</div>
          ${table([
            { key: 'itemName', label: t('itemName'), render: r => esc(r.itemName || '—') },
            { key: 'price', label: t('price'), num: true, render: r => `${num(r.price, 4)} ${cur(r.currency)}` },
            { key: 'source', label: UI.getLang() === 'tr' ? 'Kaynak' : 'Source', render: r => esc(r.source || '—') },
            { key: 'recordedAt', label: t('date'), render: r => ts(r.recordedAt) }
          ], s.priceHistory.slice(0, 15))}` : ''}

        ${s.notes ? `<div class="section-title">${t('notes')}</div>
          <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6">${esc(s.notes)}</div>` : ''}`,
      footer: `${can('admin') ? `
               <button class="btn btn-ghost btn-sm" id="suExport">${t('kvkkExport')}</button>
               ${!s.anonymizedAt ? `<button class="btn btn-danger" id="suAnon">${t('kvkkAnonymize')}</button>` : `<span class="badge plain">${t('kvkkAlreadyAnonymized')}</span>`}` : ''}
               <button class="btn btn-ghost" data-close>${t('close')}</button>`,
      onOpen: (box) => {
        box.querySelector('#suExport')?.addEventListener('click', async () => {
          try {
            const data = await Api.exportSupplierData(s.id);
            UI.downloadJson(`tedarikci-${s.id}-kvkk-veri.json`, data);
            UI.ok(t('kvkkExportDone'));
          } catch (e) { UI.err(e); }
        });
        box.querySelector('#suAnon')?.addEventListener('click', () => UI.confirmDialog(t('kvkkAnonymizeConfirm'), async () => {
          try { await Api.anonymizeSupplier(s.id); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
        }, { danger: true }));
      }
    });
  }

  /* ================= REQUESTS ================= */
  const reqStatusBadge = (s) => {
    const m = {
      draft: ['plain', UI.getLang() === 'tr' ? 'Taslak' : 'Draft'],
      submitted: ['warn', UI.getLang() === 'tr' ? 'Onay bekliyor' : 'Awaiting approval'],
      approved: ['ok', UI.getLang() === 'tr' ? 'Onaylandı' : 'Approved'],
      rejected: ['crit', UI.getLang() === 'tr' ? 'Reddedildi' : 'Rejected'],
      converted: ['ok', UI.getLang() === 'tr' ? 'Siparişe dönüştürüldü' : 'Converted to order'],
      cancelled: ['plain', UI.getLang() === 'tr' ? 'İptal' : 'Cancelled']
    };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  async function renderRequests(body, actions) {
    let res;
    try { res = await Api.requests({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="reqNew">${UI.icon(UI.ICONS.plus)}${t('newRequest')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'requestNo', label: t('requestNo'), render: r => `<span class="mono">${esc(r.requestNo || r.request_no)}</span>` },
      { key: 'department', label: t('department'), render: r => esc(r.department || '—') },
      { key: 'neededBy', label: t('neededBy'), render: r => dt(r.neededBy || r.needed_by) },
      { key: 'lines', label: UI.getLang() === 'tr' ? 'Kalem' : 'Lines', num: true, render: r => num((r.lines || []).length) },
      { key: 'status', label: t('status'), render: r => reqStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${r.status === 'submitted' && can('approve') ? `<button class="icon-btn ok" data-ap="${esc(r.id)}">${UI.icon(UI.ICONS.check)}</button>
             <button class="icon-btn danger" data-rj="${esc(r.id)}">${UI.icon(UI.ICONS.x)}</button>` : ''}
        </div>` }
    ], rows)}</div>`;

    document.getElementById('reqNew')?.addEventListener('click', () => reqForm());
    body.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => {
      try { await Api.approveRequest(b.dataset.ap); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-rj]').forEach(b => b.onclick = async () => {
      try { await Api.rejectRequest(b.dataset.rj, ''); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
    });
  }

  function reqForm() {
    const items = itemsRef.current;
    let lines = [{ itemId: items[0]?.id || '', qty: 1 }];
    modal({
      title: t('newRequest'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('department'), input('rqDept'))}
          ${field(t('neededBy'), input('rqNeed', { type: 'date' }))}
        </div>
        ${field(t('notes'), input('rqNote'))}
        <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
        <div class="dyn-list" id="rqLines"></div>
        <button class="btn btn-ghost btn-sm" id="rqAdd" type="button">+ ${t('add')}</button>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="rqGo">${t('save')}</button>`,
      onOpen: (box) => {
        const draw = () => {
          box.querySelector('#rqLines').innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1">${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:96px">
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#rqLines select,#rqLines input').forEach(inp => inp.oninput = () => {
            lines[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'itemId' ? inp.value : Number(inp.value);
          });
          box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
        };
        box.querySelector('#rqAdd').onclick = () => { lines.push({ itemId: items[0]?.id || '', qty: 1 }); draw(); };
        draw();
        box.querySelector('#rqGo').onclick = async () => {
          try {
            await Api.createRequest({ department: val('rqDept'), neededBy: val('rqNeed') || undefined, notes: val('rqNote'), lines });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= RFQ ================= */
  const rfqStatusBadge = (s) => {
    const m = {
      open: ['info', UI.getLang() === 'tr' ? 'Açık' : 'Open'],
      closed: ['plain', UI.getLang() === 'tr' ? 'Kapalı' : 'Closed'],
      awarded: ['ok', UI.getLang() === 'tr' ? 'Verildi' : 'Awarded'],
      cancelled: ['plain', UI.getLang() === 'tr' ? 'İptal' : 'Cancelled']
    };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  async function renderRfqs(body, actions) {
    let res;
    try { res = await Api.rfqs({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="rfqNew">${UI.icon(UI.ICONS.plus)}${t('newRfq')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'rfqNo', label: t('rfqNo'), render: r => `<span class="mono">${esc(r.rfqNo || r.rfq_no)}</span>` },
      { key: 'dueDate', label: t('dueDate'), render: r => dt(r.dueDate || r.due_date) },
      { key: 'quoteCount', label: UI.getLang() === 'tr' ? 'Teklif' : 'Quotes', num: true, render: r => num(r.quoteCount ?? (r.quotes || []).length) },
      { key: 'status', label: t('status'), render: r => rfqStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-cmp="${esc(r.id)}">${t('compareQuotes')}</button>
          ${can('write') ? `<button class="btn btn-ghost btn-sm" data-q="${esc(r.id)}">${t('addQuote')}</button>` : ''}</div>` }
    ], rows)}</div>`;

    document.getElementById('rfqNew')?.addEventListener('click', () => rfqForm());
    body.querySelectorAll('[data-cmp]').forEach(b => b.onclick = () => compareDialog(b.dataset.cmp));
    body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => quoteForm(rows.find(x => x.id === b.dataset.q)));
  }

  function rfqForm() {
    const items = itemsRef.current;
    let lines = [{ itemId: items[0]?.id || '', qty: 1 }];
    modal({
      title: t('newRfq'), size: 'wide',
      body: `${field(t('dueDate'), input('rfDue', { type: 'date' }))}
             ${field(t('notes'), input('rfNote'))}
             <div class="section-title">${UI.getLang() === 'tr' ? 'Kalemler' : 'Lines'}</div>
             <div class="dyn-list" id="rfLines"></div>
             <button class="btn btn-ghost btn-sm" id="rfAdd" type="button">+ ${t('add')}</button>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="rfGo">${t('save')}</button>`,
      onOpen: (box) => {
        const draw = () => {
          box.querySelector('#rfLines').innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1">${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:96px">
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#rfLines select,#rfLines input').forEach(inp => inp.oninput = () => {
            lines[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'itemId' ? inp.value : Number(inp.value);
          });
          box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
        };
        box.querySelector('#rfAdd').onclick = () => { lines.push({ itemId: items[0]?.id || '', qty: 1 }); draw(); };
        draw();
        box.querySelector('#rfGo').onclick = async () => {
          try { await Api.createRfq({ dueDate: val('rfDue') || undefined, notes: val('rfNote'), lines }); closeModal(); UI.ok(t('saved')); reload(); }
          catch (e) { UI.err(e); }
        };
      }
    });
  }

  function quoteForm(rfq) {
    const suppliers = suppliersRef.current;
    modal({
      title: t('addQuote'), sub: rfq.rfqNo || rfq.rfq_no,
      body: `
        ${field(t('supplierName'), select('qSup', suppliers.map(s => ({ v: s.id, l: s.name }))))}
        ${field(t('itemName'), select('qItem', (rfq.lines || []).map(l => ({ v: l.itemId || l.item_id, l: l.itemName || l.item_name }))))}
        <div class="field-row">
          ${field(t('price'), input('qPrice', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
          ${field(t('currency'), select('qCur', [{ v: 'TRY', l: 'TRY' }, { v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }], 'TRY'))}
        </div>
        ${field(t('leadTime'), input('qLead', { type: 'number', min: 0, value: 7 }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="qGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#qGo').onclick = async () => {
          try {
            await Api.addQuote(rfq.id, { supplierId: intVal('qSup'), itemId: val('qItem'), unitPrice: numVal('qPrice'), currency: val('qCur'), leadTimeDays: intVal('qLead') });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function compareDialog(rfqId) {
    let cmp;
    try { cmp = await Api.compareQuotes(rfqId); } catch (e) { UI.err(e); return; }
    // Api.compareQuotes() satır bazlı iç içe bir yapı döner:
    // { rfqNo, lines: [{ itemName, quotes: [{supplier, unitPrice, ...}], best }] }
    // düz bir "comparison"/"quotes"/"data" alanı hiç yok — önceki kod bunları
    // okumaya çalıştığı için tablo her zaman boş görünüyordu (bkz. PROJECT_STATUS.md).
    const lines = cmp.lines || [];
    const rows = lines.flatMap(line => (line.quotes || []).map(q => ({
      itemName: line.itemName,
      supplierName: q.supplier,
      unitPrice: q.unitPrice,
      currency: q.currency,
      priceBase: q.unitPriceBase,
      leadTimeDays: q.leadTimeDays,
      isBest: !!(line.best && q.supplierId === line.best.supplierId)
    })));
    modal({
      title: t('compareQuotes'), size: 'wide',
      body: rows.length ? table([
        { key: 'itemName', label: t('itemName'), render: r => esc(r.itemName || '—') },
        { key: 'supplierName', label: t('supplierName'), render: r => esc(r.supplierName || '—') },
        { key: 'unitPrice', label: t('price'), num: true, render: r => `${num(r.unitPrice, 4)} ${cur(r.currency)}` },
        { key: 'priceBase', label: '₺', num: true, render: r => '₺' + num(r.priceBase, 2) },
        { key: 'leadTimeDays', label: t('leadTime'), num: true, render: r => num(r.leadTimeDays) },
        { key: 'best', label: '', render: r => r.isBest ? `<span class="badge ok">${t('bestPrice')}</span>` : '' }
      ], rows) : `<div class="empty">${t('noData')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
    });
  }

  /* ================= INVOICES (3-way match) ================= */
  async function renderInvoices(body, actions) {
    let res;
    try { res = await Api.supplierInvoices({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="invNew">${UI.icon(UI.ICONS.plus)}${t('newInvoice')}</button>` : '';

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? '3\'lü eşleştirme: fatura tutarı, sipariş ve teslim alınan miktarla otomatik karşılaştırılır.'
        : '3-way match: invoice amount is compared against the order and the received quantity.'}</div>
      <div class="card">${table([
        { key: 'invoice_no', label: t('invoiceNo'), render: r => `<span class="mono">${esc(r.invoice_no || r.invoiceNo)}</span>` },
        { key: 'supplier', label: t('supplierName'), render: r => esc(r.supplier_name || r.supplierName || '—') },
        { key: 'invoice_date', label: t('date'), render: r => dt(r.invoice_date || r.invoiceDate) },
        { key: 'amount', label: UI.getLang() === 'tr' ? 'Tutar' : 'Amount', num: true, render: r => `${num(r.amount, 2)} ${cur(r.currency)}` },
        { key: 'match_status', label: t('threeWayMatch'), render: r => {
            const s = r.match_status || r.matchStatus;
            const m = { matched: ['ok', t('matchOk')], discrepancy: ['crit', t('matchDiscrepancy')], unmatched: ['warn', t('matchUnmatched')], approved: ['ok', t('approve')], paid: ['ok', 'OK'] };
            const [c, l] = m[s] || ['plain', s];
            return `<span class="badge ${c}">${esc(l)}</span>`;
          } },
        { key: 'note', label: '', render: r => esc(r.discrepancy_note || '') }
      ], rows)}</div>`;

    document.getElementById('invNew')?.addEventListener('click', async () => {
      const pos = await Api.purchaseOrders({ pageSize: 100 }).then(r => r.data || r);
      modal({
        title: t('newInvoice'),
        body: `
          ${field(t('poNo'), select('ivPo', pos.map(p => ({ v: p.id, l: `${p.poNo} — ${p.supplier || ''}` }))))}
          ${field(t('invoiceNo'), input('ivNo'))}
          <div class="field-row">
            ${field(t('invoiceAmount'), input('ivAmt', { type: 'number', min: 0, step: '0.01' }))}
            ${field(t('currency'), select('ivCur', [{ v: 'TRY', l: 'TRY' }, { v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }], 'TRY'))}
          </div>
          ${field(t('date'), input('ivDate', { type: 'date', value: UI.today() }))}`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="ivGo">${t('save')}</button>`,
        onOpen: (box) => {
          box.querySelector('#ivGo').onclick = async () => {
            try {
              await Api.createSupplierInvoice({ poId: val('ivPo'), invoiceNo: val('ivNo'), amount: numVal('ivAmt'), currency: val('ivCur'), invoiceDate: val('ivDate') });
              closeModal(); UI.ok(t('saved')); reload();
            } catch (e) { UI.err(e); }
          };
        }
      });
    });
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('purchTitle')}</h2><div class="sub">${t('purchSub')}</div></div>
      <div class="topbar-actions" id="purchActions"></div>
    </div>
    ${UI.tabs([
      { k: 'orders', l: t('tabOrders') }, { k: 'suppliers', l: t('tabSuppliers') },
      { k: 'requests', l: t('tabRequests') }, { k: 'rfqs', l: t('tabRfqs') }, { k: 'invoices', l: t('tabInvoices') }
    ], tab, k => setTab(k))}
    <div id="purchBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
