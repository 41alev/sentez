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
  const invoicePageRef = useRef(1);
  // T08: each list keeps its own page; the pager used to always reload page 1.
  const pagesRef = useRef({});

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
    const fns = { orders: renderOrders, suppliers: renderSuppliers, requests: renderRequests, rfqs: renderRfqs, invoices: renderInvoices, returns: renderReturns };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.errorState(body, e, reload); }
    })();
  }, [ready, tab, reloadToken]);

  /* ================= ORDERS ================= */
  async function renderOrders(body, actions) {
    let res;
    try { res = await Api.purchaseOrders({ page: pagesRef.current.orders || 1, pageSize: 25 }); } catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
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
    ], rows)}${res.totalPages ? pager(res, p => { pagesRef.current.orders = p; reload(); }) : ''}</div>`;

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
          ${field(t('supplierName'), select('poSup', suppliers.map(s => ({ v: s.id, l: s.name })), prefill?.supplierId, { search: 'suppliers' }))}
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
              <select data-i="${i}" data-f="itemId" data-search="items" style="flex:1;min-width:150px">
                ${UI.missingOption(items, l.itemId)}${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
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
    try { po = await Api.purchaseOrder(id); } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
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
            { key: 'state', label: t('status'), render: r => r.reversedAt
              ? `<span class="badge plain">${UI.getLang() === 'tr' ? 'Ters kayıt' : 'Reversed'}</span>`
              : `<span class="badge ok">${UI.getLang() === 'tr' ? 'Geçerli' : 'Posted'}</span>` },
            { key: 'act', label: '', render: r => r.reversedAt ? '' : `<div class="row-actions">
                ${can('write') ? `<button class="btn btn-ghost btn-sm" data-landed="${esc(r.id)}">${t('addLandedCost')}</button>` : ''}
                ${can('approve') ? `<button class="btn btn-ghost btn-sm" data-reverse-receipt="${esc(r.id)}">${UI.getLang() === 'tr' ? 'Ters kayıt' : 'Reverse'}</button>` : ''}
              </div>` }
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
               ${['draft', 'pending_approval', 'approved', 'rejected'].includes(po.status) && can('approve') ? `<button class="btn btn-ghost" id="poCancel">${UI.getLang() === 'tr' ? 'Siparişi iptal et' : 'Cancel order'}</button>` : ''}
               ${['partially_received', 'received'].includes(po.status) && can('approve') ? `<button class="btn btn-ghost" id="poClose">${UI.getLang() === 'tr' ? 'Siparişi kapat' : 'Close order'}</button>` : ''}
               ${['approved', 'partially_received'].includes(po.status) && can('write') ? `<button class="btn btn-primary" id="poRec">${t('receive')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#poPrint').onclick = () => printPO(po);
        box.querySelector('#poCancel')?.addEventListener('click', () => { closeModal(); poLifecycleDialog(po, 'cancel'); });
        box.querySelector('#poClose')?.addEventListener('click', () => { closeModal(); poLifecycleDialog(po, 'close'); });
        box.querySelector('#poRec')?.addEventListener('click', () => { closeModal(); receiveDialog(po.id); });
        box.querySelectorAll('[data-landed]').forEach(b => b.onclick = () => { closeModal(); landedDialog(b.dataset.landed); });
        box.querySelectorAll('[data-reverse-receipt]').forEach(b => b.onclick = () => { closeModal(); reverseReceiptDialog(b.dataset.reverseReceipt); });
      }
    });
  }

  function poLifecycleDialog(po, action) {
    const tr = UI.getLang() === 'tr';
    const isCancel = action === 'cancel';
    modal({
      title: `${isCancel ? (tr ? 'Siparişi iptal et' : 'Cancel order') : (tr ? 'Siparişi kapat' : 'Close order')} — ${po.poNo}`,
      body: `${isCancel ? '' : `<div class="alert warn">${tr ? 'Kalan teslim miktarı kapatılır ve yeni mal kabul engellenir.' : 'Remaining quantities are closed and further receipts are blocked.'}</div>`}
        ${field(tr ? 'Gerekçe (zorunlu)' : 'Reason (required)', textarea('poLifecycleReason'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="poLifecycleGo">${t('confirm')}</button>`,
      onOpen: box => guardedSubmit(box.querySelector('#poLifecycleGo'), async () => {
        const reason = val('poLifecycleReason').trim();
        if (reason.length < 5) throw new Error(tr ? 'En az 5 karakter gerekçe girin.' : 'Enter a reason of at least 5 characters.');
        if (isCancel) await Api.cancelPO(po.id, reason); else await Api.closePO(po.id, reason);
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }

  function reverseReceiptDialog(receiptId) {
    const tr = UI.getLang() === 'tr';
    const requestKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    modal({
      title: tr ? 'Mal kabulü ters kaydet' : 'Reverse goods receipt',
      body: `<div class="alert warn">${tr
        ? 'Yalnız henüz kullanılmamış, faturalanmamış ve ek maliyet uygulanmamış teslimatlar ters kaydedilebilir. Asıl kayıt ve denetim izi korunur.'
        : 'Only untouched, uninvoiced receipts without landed costs can be reversed. The original record and audit trail remain.'}</div>
        ${field(tr ? 'Gerekçe (zorunlu)' : 'Reason (required)', textarea('receiptRevReason'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="receiptRevGo">${tr ? 'Ters kaydet' : 'Reverse'}</button>`,
      onOpen: box => {
        const button = box.querySelector('#receiptRevGo');
        button.onclick = async () => {
          if (button.disabled) return;
          const reason = val('receiptRevReason');
          if (reason.trim().length < 5) return UI.toast(tr ? 'En az 5 karakter gerekçe girin.' : 'Enter a reason of at least 5 characters.');
          button.disabled = true;
          try {
            await Api.reverseReceipt(receiptId, { reason, requestKey });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); } finally { button.disabled = false; }
        };
      }
    });
  }

  async function receiveDialog(poId) {
    const warehouses = warehousesRef.current;
    let po;
    try { po = await Api.purchaseOrder(poId); } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
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
    try { res = await Api.suppliers({ page: pagesRef.current.suppliers || 1, pageSize: 50 }); } catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
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
    ], rows)}${pager(res, p => { pagesRef.current.suppliers = p; reload(); })}</div>`;

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
    try { s = await Api.supplier(id); } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
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
    try { res = await Api.requests({ page: pagesRef.current.requests || 1, pageSize: 50 }); } catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
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
    ], rows)}${pager(res, p => { pagesRef.current.requests = p; reload(); })}</div>`;

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
              <select data-i="${i}" data-f="itemId" data-search="items" style="flex:1">${UI.missingOption(items, l.itemId)}${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
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
    try { res = await Api.rfqs({ page: pagesRef.current.rfqs || 1, pageSize: 50 }); } catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="rfqNew">${UI.icon(UI.ICONS.plus)}${t('newRfq')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'rfqNo', label: t('rfqNo'), render: r => `<span class="mono">${esc(r.rfqNo || r.rfq_no)}</span>` },
      { key: 'dueDate', label: t('dueDate'), render: r => dt(r.dueDate || r.due_date) },
      { key: 'quoteCount', label: UI.getLang() === 'tr' ? 'Teklif' : 'Quotes', num: true, render: r => num(r.quoteCount ?? (r.quotes || []).length) },
      { key: 'status', label: t('status'), render: r => rfqStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-cmp="${esc(r.id)}">${t('compareQuotes')}</button>
          ${r.status === 'open' && can('write') ? `<button class="btn btn-ghost btn-sm" data-q="${esc(r.id)}">${t('addQuote')}</button>` : ''}
          ${r.status === 'open' && (r.quotes || []).length && can('approve') ? `<button class="btn btn-primary btn-sm" data-award="${esc(r.id)}">${UI.getLang() === 'tr' ? 'Sonuçlandır' : 'Award'}</button>` : ''}</div>` }
    ], rows)}${pager(res, p => { pagesRef.current.rfqs = p; reload(); })}</div>`;

    document.getElementById('rfqNew')?.addEventListener('click', () => rfqForm());
    body.querySelectorAll('[data-cmp]').forEach(b => b.onclick = () => compareDialog(b.dataset.cmp));
    body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => quoteForm(rows.find(x => x.id === b.dataset.q)));
    body.querySelectorAll('[data-award]').forEach(b => b.onclick = () => awardRfqDialog(rows.find(x => x.id === b.dataset.award)));
  }

  function awardRfqDialog(rfq) {
    const tr = UI.getLang() === 'tr';
    const supplierIds = [...new Set((rfq.quotes || []).map(q => Number(q.supplierId)))];
    const suppliers = suppliersRef.current.filter(s => supplierIds.includes(Number(s.id)));
    const warehouses = warehousesRef.current;
    modal({
      title: `${tr ? 'Teklif talebini sonuçlandır' : 'Award RFQ'} — ${rfq.rfqNo}`,
      body: `<div class="alert info">${tr
        ? 'Seçilen tedarikçinin tüm kalemler için en son geçerli teklifleri tek bir satın alma siparişine dönüştürülür.'
        : 'The selected supplier’s latest valid quotes for every line become one purchase order.'}</div>
        ${field(t('supplierName'), select('awardSupplier', suppliers.map(s => ({ v: s.id, l: s.name }))))}
        ${field(t('warehouse'), select('awardWarehouse', warehouses.map(w => ({ v: w.id, l: w.name }))))}
        ${field(t('notes'), textarea('awardNotes'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="awardGo">${tr ? 'Sipariş oluştur' : 'Create order'}</button>`,
      onOpen: box => guardedSubmit(box.querySelector('#awardGo'), async () => {
        if (!suppliers.length) throw new Error(tr ? 'Geçerli tedarikçi teklifi yok.' : 'No valid supplier quote.');
        await Api.awardRfq(rfq.id, { supplierId: intVal('awardSupplier'), warehouseId: intVal('awardWarehouse'), notes: val('awardNotes') });
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
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
              <select data-i="${i}" data-f="itemId" data-search="items" style="flex:1">${UI.missingOption(items, l.itemId)}${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
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
        ${field(t('supplierName'), select('qSup', suppliers.map(s => ({ v: s.id, l: s.name })), undefined, { search: 'suppliers' }))}
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
    try { cmp = await Api.compareQuotes(rfqId); } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
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
    const tr = UI.getLang() === 'tr';
    let res;
    try { res = await Api.supplierInvoices({ page: invoicePageRef.current, pageSize: 50 }); } catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
    const rows = res.data || res;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="invNew">${UI.icon(UI.ICONS.plus)}${t('newInvoice')}</button>` : '';
    const byId = new Map(rows.map(r => [r.id, r]));
    const stateBadge = r => {
      if (r.allocationState === 'legacy') return `<span class="badge warn">${tr ? 'Mutabakat bekliyor' : 'Needs reconciliation'}</span>`;
      const s = r.matchStatus;
      const m = { matched: ['ok', t('matchOk')], discrepancy: ['crit', t('matchDiscrepancy')], unmatched: ['warn', t('matchUnmatched')],
        approved: ['ok', tr ? 'Ödemeye onaylı' : 'Approved'], paid: ['ok', tr ? 'Ödendi' : 'Paid'] };
      const [c, l] = m[s] || ['plain', s];
      return `<span class="badge ${c}">${esc(l)}</span>`;
    };

    body.innerHTML = `
      <div class="alert info">${tr
        ? '3\'lü eşleştirme: fatura tutarı, sipariş ve teslim alınan miktarla karşılaştırılır. Eski (eşleştirilmemiş) faturalar mutabakat yapılmadan onaylanamaz ve ödenemez.'
        : '3-way match: invoice amount is compared against the order and received quantity. Legacy (unmatched) invoices cannot be approved or paid before reconciliation.'}</div>
      <div class="card">${table([
        { key: 'invoiceNo', label: t('invoiceNo'), render: r => `<span class="mono">${esc(r.invoiceNo)}</span><div class="sub-line">${esc(r.poNo || '')}</div>` },
        { key: 'supplier', label: t('supplierName'), render: r => esc(r.supplier || '—') },
        { key: 'invoiceDate', label: t('date'), render: r => dt(r.invoiceDate), cls: 'nowrap' },
        { key: 'amount', label: tr ? 'Net tutar' : 'Net amount', num: true, render: r => `${num(r.amount, 2)} ${cur(r.currency)}` },
        { key: 'gross', label: tr ? 'KDV dahil / kalan' : 'Gross / open', num: true, render: r => r.grossAmount == null ? '—'
            : `${num(r.grossAmount, 2)}<div class="sub-line">${tr ? 'Kalan' : 'Open'}: ${num(r.openAmount, 2)}</div>` },
        { key: 'matchStatus', label: t('threeWayMatch'), render: stateBadge },
        { key: 'note', label: '', render: r => esc(r.discrepancyNote || '') },
        { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
            ${r.allocationState === 'legacy' && can('approve') ? `<button class="btn btn-ghost btn-sm" data-reconcile="${esc(r.id)}">${tr ? 'Mutabakat' : 'Reconcile'}</button>` : ''}
            ${r.allocationState !== 'legacy' && ['matched', 'discrepancy', 'unmatched'].includes(r.matchStatus) && can('approve')
              ? `<button class="btn btn-ghost btn-sm" data-inv-approve="${esc(r.id)}">${t('approve')}</button>` : ''}
            ${r.matchStatus === 'approved' && can('approve') ? `<button class="btn btn-ghost btn-sm" data-inv-pay="${esc(r.id)}">${tr ? 'Ödeme' : 'Pay'}</button>` : ''}
            ${(r.paidAmount || 0) > 0 ? `<button class="btn btn-ghost btn-sm" data-inv-payments="${esc(r.id)}">${tr ? 'Hareketler' : 'Payments'}</button>` : ''}
          </div>` }
      ], rows)}${pager(res, page => { invoicePageRef.current = page; reload(); })}</div>`;

    body.querySelectorAll('[data-reconcile]').forEach(b => b.onclick = () => reconcileDialog(byId.get(b.dataset.reconcile)));
    body.querySelectorAll('[data-inv-approve]').forEach(b => b.onclick = () => approveInvoiceDialog(byId.get(b.dataset.invApprove)));
    body.querySelectorAll('[data-inv-pay]').forEach(b => b.onclick = () => payInvoiceDialog(byId.get(b.dataset.invPay)));
    body.querySelectorAll('[data-inv-payments]').forEach(b => b.onclick = () => supplierPaymentHistory(b.dataset.invPayments));

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
          ${field(t('date'), input('ivDate', { type: 'date', value: UI.today() }))}
          ${field(UI.getLang() === 'tr' ? 'Faturadaki KDV tutarı (boşsa satır oranlarından hesaplanır)' : 'VAT amount on invoice (blank = from line rates)',
            input('ivVat', { type: 'number', min: 0, step: '0.01' }))}
          <div id="ivReceiptLines" aria-live="polite"></div>`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="ivGo">${t('save')}</button>`,
        onOpen: (box) => {
          let availableLines = [];
          let loadVersion = 0;
          const loadLines = async () => {
            const version = ++loadVersion;
            const host = box.querySelector('#ivReceiptLines');
            const save = box.querySelector('#ivGo');
            availableLines = [];
            save.disabled = true;
            host.textContent = UI.getLang() === 'tr' ? 'Teslim satırları yükleniyor…' : 'Loading receipt lines…';
            try {
              const result = await Api.supplierInvoiceReceivableLines(val('ivPo'));
              if (version !== loadVersion) return;
              availableLines = result.lines.filter(line => line.availableQty > 0);
              if (result.legacy) {
                host.textContent = UI.getLang() === 'tr'
                  ? 'Bu siparişte eski eşleştirilmemiş faturalar var; yeni fatura öncesi mutabakat gerekir.'
                  : 'Legacy invoices on this order require reconciliation before new billing.';
                availableLines = [];
                return;
              }
              if (!availableLines.length) {
                host.textContent = UI.getLang() === 'tr'
                  ? 'Faturalanmamış teslim satırı yok. Fatura fark olarak kaydedilir.'
                  : 'No uninvoiced receipt lines. Invoice will be recorded as a discrepancy.';
                save.disabled = false;
                return;
              }
              host.innerHTML = `<p>${UI.getLang() === 'tr' ? 'Faturalandırılacak teslim miktarı' : 'Receipt quantity to invoice'}</p>
                ${availableLines.map(line => `<label class="field" style="display:block">
                  <span>${esc(line.receiptNo)} · ${esc(line.itemName)} (${num(line.availableQty, 3)} ${UI.getLang() === 'tr' ? 'kalan' : 'available'})</span>
                  <input type="number" class="iv-line-qty" data-line-id="${line.receiptLineId}"
                    min="0" max="${line.availableQty}" step="any" value="${line.availableQty}">
                  <span>${UI.getLang() === 'tr' ? 'KDV oranı (%)' : 'VAT rate (%)'}</span>
                  <input type="number" class="iv-line-vat" data-line-id="${line.receiptLineId}"
                    min="0" max="100" step="any" value="${line.vatRate ?? ''}">
                </label>`).join('')}`;
              save.disabled = false;
            } catch (e) { if (version === loadVersion) { availableLines = []; host.textContent = e.message; } }
          };
          box.querySelector('#ivPo').addEventListener('change', loadLines);
          loadLines();
          box.querySelector('#ivGo').onclick = async () => {
            try {
              const lines = availableLines.map(line => {
                const qty = Number(box.querySelector(`.iv-line-qty[data-line-id="${line.receiptLineId}"]`)?.value || 0);
                const vatInput = box.querySelector(`.iv-line-vat[data-line-id="${line.receiptLineId}"]`)?.value;
                if (qty > 0 && (vatInput === '' || !Number.isFinite(Number(vatInput)) || Number(vatInput) < 0 || Number(vatInput) > 100)) {
                  throw new Error(UI.getLang() === 'tr' ? 'Her satıra 0–100 arası KDV oranı girin.' : 'Enter a VAT rate from 0 to 100 for each line.');
                }
                return { receiptLineId: line.receiptLineId, qty, vatRate: Number(vatInput) };
              })
                .filter(line => line.qty > 0);
              if (availableLines.length && !lines.length) throw new Error(UI.getLang() === 'tr'
                ? 'En az bir teslim satırı miktarı girin.' : 'Enter a quantity for at least one receipt line.');
              const vatText = val('ivVat');
              if (vatText !== '' && !(Number(vatText) >= 0)) throw new Error(UI.getLang() === 'tr' ? 'KDV tutarı geçersiz.' : 'Invalid VAT amount.');
              await Api.createSupplierInvoice({ poId: val('ivPo'), invoiceNo: val('ivNo'), amount: numVal('ivAmt'),
                currency: val('ivCur'), invoiceDate: val('ivDate'), ...(vatText !== '' ? { vatAmount: Number(vatText) } : {}),
                ...(lines.length ? { lines } : {}) });
              closeModal(); UI.ok(t('saved')); reload();
            } catch (e) { UI.err(e); }
          };
        }
      });
    });
  }


  /* ================= SUPPLIER RETURNS ================= */
  async function renderReturns(body, actions) {
    const tr = UI.getLang() === 'tr';
    const res = await Api.supplierReturns({ page: pagesRef.current.returns || 1, pageSize: 25 });
    const rows = res.data || res;
    const labels = {
      open: tr ? 'Açık' : 'Open', shipped: tr ? 'Gönderildi' : 'Shipped',
      credited: tr ? 'Alacak dekontu alındı' : 'Credited', closed: tr ? 'Kapalı' : 'Closed'
    };
    const next = { open: 'shipped', shipped: 'credited', credited: 'closed' };
    const badge = value => `<span class="badge ${value === 'closed' ? 'ok' : value === 'open' ? 'warn' : 'plain'}">${esc(labels[value] || value)}</span>`;
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="returnNew">${UI.icon(UI.ICONS.plus)}${tr ? 'Yeni iade' : 'New return'}</button>` : '';
    body.innerHTML = `<div class="card">${table([
      { key: 'returnNo', label: tr ? 'İade no' : 'Return no', render: r => `<span class="mono">${esc(r.returnNo)}</span>` },
      { key: 'supplier', label: t('supplierName'), render: r => esc(r.supplier || '—') },
      { key: 'itemName', label: t('itemName'), render: r => `${esc(r.itemName || '—')}<div class="sub-line">${esc(r.lotNo || '—')}</div>` },
      { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty) },
      { key: 'reason', label: tr ? 'Gerekçe' : 'Reason', render: r => esc(r.reason || '—') },
      { key: 'status', label: t('status'), render: r => badge(r.status) },
      { key: 'act', label: t('actions'), render: r => next[r.status] && can('approve')
        ? `<button class="btn btn-ghost btn-sm" data-return-next="${esc(r.id)}" data-current="${esc(r.status)}">${esc(labels[next[r.status]])}</button>` : '' }
    ], rows)}${pager(res, page => { pagesRef.current.returns = page; reload(); })}</div>`;
    document.getElementById('returnNew')?.addEventListener('click', createReturnDialog);
    body.querySelectorAll('[data-return-next]').forEach(button => {
      button.onclick = () => advanceReturnDialog(button.dataset.returnNext, button.dataset.current, next[button.dataset.current], labels);
    });
  }

  async function createReturnDialog() {
    const tr = UI.getLang() === 'tr';
    let lots;
    try {
      const result = await Api.lots({ pageSize: 500 });
      lots = (result.data || result).filter(lot => lot.supplierId != null && lot.qty > 0);
    } catch (e) { UI.err(e); return; }
    if (!lots.length) return UI.toast(tr ? 'Tedarikçiye bağlı, iade edilebilir stok partisi yok.' : 'No returnable stock lot linked to a supplier.');
    const supplierName = id => suppliersRef.current.find(supplier => supplier.id === id)?.name || `#${id}`;
    modal({
      title: tr ? 'Yeni tedarikçi iadesi' : 'New supplier return',
      body: `${field(tr ? 'Parti ve tedarikçi' : 'Lot and supplier', select('returnLot', lots.map(lot => ({
          v: lot.id, l: `${lot.itemName} · ${lot.lotNo || lot.id} · ${supplierName(lot.supplierId)} · ${num(lot.qty)}`
        }))))}
        ${field(t('qty'), input('returnQty', { type: 'number', min: 0.0001, step: 'any' }))}
        ${field(tr ? 'İade gerekçesi (zorunlu)' : 'Return reason (required)', textarea('returnReason'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="returnGo">${t('save')}</button>`,
      onOpen: box => guardedSubmit(box.querySelector('#returnGo'), async () => {
        const lot = lots.find(row => row.id === val('returnLot'));
        const qty = numVal('returnQty');
        const reason = val('returnReason').trim();
        if (!lot) throw new Error(tr ? 'Parti seçin.' : 'Select a lot.');
        if (!(qty > 0) || qty > lot.qty) throw new Error(tr ? 'Miktar sıfırdan büyük ve parti miktarını aşmamalı.' : 'Quantity must be positive and not exceed the lot.');
        if (reason.length < 3) throw new Error(tr ? 'En az 3 karakter gerekçe girin.' : 'Enter a reason of at least 3 characters.');
        await Api.createSupplierReturn({ supplierId: lot.supplierId, lotId: lot.id, qty, reason });
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }

  function advanceReturnDialog(id, current, target, labels) {
    const tr = UI.getLang() === 'tr';
    modal({
      title: `${tr ? 'İade durumunu ilerlet' : 'Advance return'} — ${labels[current]} → ${labels[target]}`,
      body: field(tr ? 'İşlem notu (zorunlu)' : 'Action note (required)', textarea('returnStatusNote')),
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="returnStatusGo">${t('confirm')}</button>`,
      onOpen: box => guardedSubmit(box.querySelector('#returnStatusGo'), async () => {
        const note = val('returnStatusNote').trim();
        if (note.length < 3) throw new Error(tr ? 'En az 3 karakter işlem notu girin.' : 'Enter an action note of at least 3 characters.');
        await Api.setSupplierReturnStatus(id, { status: target, note });
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }


  /** Runs one submit at a time for a modal button; prevents double posting. */
  function guardedSubmit(button, work) {
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try { await work(); } catch (e) { UI.err(e); } finally { button.disabled = false; }
    };
  }

  async function reconcileDialog(inv) {
    const tr = UI.getLang() === 'tr';
    let lines = [];
    try { lines = (await Api.supplierInvoiceReceivableLines(inv.poId)).lines.filter(l => l.availableQty > 0); }
    catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
    modal({
      title: `${tr ? 'Fatura mutabakatı' : 'Invoice reconciliation'} — ${inv.invoiceNo}`, size: 'wide',
      body: `
        <div class="alert warn">${tr
          ? 'Bu fatura teslim satırı eşleştirmesi olmadan kaydedilmiş. Faturada gerçekten yer alan teslim miktarlarını girin. Mutabakat bir kez yapılır ve denetim kaydına yazılır.'
          : 'This invoice was recorded without receipt-line matching. Enter the receipt quantities it really bills. Reconciliation happens once and is audited.'}</div>
        <p>${tr ? 'Fatura net tutarı' : 'Invoice net amount'}: <strong>${num(inv.amount, 2)} ${cur(inv.currency)}</strong></p>
        ${lines.length ? lines.map(line => `<div class="field-row three">
            <div class="field"><label>${esc(line.receiptNo)} · ${esc(line.itemName)}</label>
              <div class="sub-line">${num(line.availableQty, 3)} ${tr ? 'faturalanmamış' : 'uninvoiced'} · ${num(line.price, 4)} ${cur(line.currency)}</div></div>
            <div class="field"><label for="rcQ${line.receiptLineId}">${tr ? 'Miktar' : 'Qty'}</label>
              <input id="rcQ${line.receiptLineId}" type="number" min="0" max="${line.availableQty}" step="any" value="0"></div>
            <div class="field"><label for="rcV${line.receiptLineId}">${tr ? 'KDV %' : 'VAT %'}</label>
              <input id="rcV${line.receiptLineId}" type="number" min="0" max="100" step="any" value="${line.vatRate ?? ''}"></div>
          </div>`).join('')
          : `<div class="empty">${tr ? 'Faturalanmamış teslim satırı yok; fatura teslimatsız (hizmet/masraf) olarak kaydedilir.' : 'No uninvoiced receipt lines; the invoice is recorded as not tied to receipts.'}</div>`}
        ${field(tr ? 'Faturadaki KDV tutarı (boşsa satır oranlarından hesaplanır)' : 'VAT amount on invoice (blank = from line rates)',
          input('rcVat', { type: 'number', min: 0, step: '0.01' }))}
        ${field(tr ? 'Mutabakat gerekçesi (zorunlu)' : 'Reconciliation note (required)', textarea('rcNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="rcGo">${t('save')}</button>`,
      onOpen: (box) => guardedSubmit(box.querySelector('#rcGo'), async () => {
        const chosen = [];
        for (const line of lines) {
          const qty = Number(box.querySelector(`#rcQ${line.receiptLineId}`).value || 0);
          if (!(qty > 0)) continue;
          const vatRaw = box.querySelector(`#rcV${line.receiptLineId}`).value;
          const vatRate = Number(vatRaw);
          if (vatRaw === '' || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
            throw new Error(tr ? 'Her satıra 0–100 arası KDV oranı girin.' : 'Enter a VAT rate from 0 to 100 for each line.');
          }
          if (qty > line.availableQty + 1e-9) throw new Error(tr ? 'Miktar faturalanmamış teslimi aşıyor.' : 'Quantity exceeds uninvoiced receipt.');
          chosen.push({ receiptLineId: line.receiptLineId, qty, vatRate });
        }
        const note = val('rcNote');
        if (note.length < 5) throw new Error(tr ? 'Mutabakat gerekçesi en az 5 karakter olmalı.' : 'Reconciliation note must be at least 5 characters.');
        const vatText = val('rcVat');
        await Api.reconcileSupplierInvoice(inv.id, { lines: chosen, note, ...(vatText !== '' ? { vatAmount: Number(vatText) } : {}) });
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }

  function approveInvoiceDialog(inv) {
    const tr = UI.getLang() === 'tr';
    const needsVat = inv.vatAmount == null;
    modal({
      title: `${t('approve')} — ${inv.invoiceNo}`,
      body: `
        ${inv.matchStatus === 'discrepancy' ? `<div class="alert warn">${esc(inv.discrepancyNote || '')}<br>${tr
          ? 'Uyuşmazlıklı fatura için onay gerekçesi zorunludur.' : 'An approval note is required for a discrepancy.'}</div>` : ''}
        <p>${tr ? 'Net' : 'Net'}: <strong>${num(inv.amount, 2)} ${cur(inv.currency)}</strong>${inv.vatAmount != null
          ? ` · ${tr ? 'KDV' : 'VAT'}: <strong>${num(inv.vatAmount, 2)}</strong>` : ''}</p>
        ${needsVat ? field(tr ? 'Faturadaki KDV tutarı (zorunlu)' : 'VAT amount on invoice (required)', input('apVat', { type: 'number', min: 0, step: '0.01' })) : ''}
        ${field(tr ? 'Onay notu' : 'Approval note', textarea('apNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="apGo">${t('approve')}</button>`,
      onOpen: (box) => guardedSubmit(box.querySelector('#apGo'), async () => {
        const note = val('apNote');
        const payload = note ? { note } : {};
        if (needsVat) {
          const raw = val('apVat');
          if (raw === '' || !(Number(raw) >= 0)) throw new Error(tr ? 'KDV tutarı girin.' : 'Enter the VAT amount.');
          payload.vatAmount = Number(raw);
        }
        await Api.approveSupplierInvoice(inv.id, payload);
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }

  function payInvoiceDialog(inv) {
    const tr = UI.getLang() === 'tr';
    const requestKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    modal({
      title: `${tr ? 'Ödeme' : 'Payment'} — ${inv.invoiceNo}`,
      body: `
        <p>${tr ? 'Kalan' : 'Open'}: <strong>${num(inv.openAmount, 2)} ${cur(inv.currency)}</strong></p>
        <div class="field-row">
          ${field(tr ? 'Tutar' : 'Amount', input('pyAmt', { type: 'number', min: 0, step: '0.01', value: inv.openAmount }))}
          ${field(t('date'), input('pyDate', { type: 'date', value: UI.today() }))}
        </div>
        ${field(tr ? 'Yöntem' : 'Method', select('pyMethod', [{ v: 'bank', l: tr ? 'Banka' : 'Bank' }, { v: 'cash', l: tr ? 'Nakit' : 'Cash' },
          { v: 'check', l: tr ? 'Çek' : 'Check' }, { v: 'card', l: tr ? 'Kart' : 'Card' }, { v: 'other', l: tr ? 'Diğer' : 'Other' }], 'bank'))}
        ${field(tr ? 'Referans (dekont no)' : 'Reference', input('pyRef'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="pyGo">${t('save')}</button>`,
      onOpen: (box) => guardedSubmit(box.querySelector('#pyGo'), async () => {
        const amount = Number(val('pyAmt'));
        if (!(amount > 0)) throw new Error(tr ? 'Pozitif bir tutar girin.' : 'Enter a positive amount.');
        if (amount > inv.openAmount + 0.005) throw new Error(tr ? 'Tutar kalan borcu aşıyor.' : 'Amount exceeds the open balance.');
        await Api.paySupplierInvoice(inv.id, { amount, paidOn: val('pyDate'), method: val('pyMethod'),
          ...(val('pyRef') ? { reference: val('pyRef') } : {}), requestKey });
        closeModal(); UI.ok(t('saved')); reload();
      })
    });
  }

  async function supplierPaymentHistory(invoiceId) {
    const tr = UI.getLang() === 'tr';
    let inv;
    try { inv = await Api.supplierInvoice(invoiceId); } catch (e) { UI.err(e); return; }
    modal({
      title: `${tr ? 'Ödeme hareketleri' : 'Payment history'} — ${inv.invoiceNo}`,
      body: (inv.payments || []).length ? table([
        { key: 'paidOn', label: t('date'), render: r => dt(r.paidOn) },
        { key: 'amount', label: tr ? 'Tutar' : 'Amount', num: true, render: r => `${num(r.amount, 2)} ${cur(inv.currency)}` },
        { key: 'method', label: tr ? 'Yöntem' : 'Method', render: r => esc(r.method || '—') },
        { key: 'reference', label: tr ? 'Referans' : 'Reference', render: r => esc(r.reference || '—') },
        { key: 'state', label: t('status'), render: r => r.reversed
          ? `<span class="badge plain">${tr ? 'Ters kayıt' : 'Reversed'}</span><div class="sub-line">${esc(r.reversal?.reason || '')}</div>`
          : `<span class="badge ok">${tr ? 'Geçerli' : 'Posted'}</span>` },
        { key: 'act', label: '', render: r => !r.reversed && can('approve')
          ? `<button class="btn btn-ghost btn-sm" data-reverse-supplier-payment="${esc(r.id)}">${tr ? 'Ters kayıt' : 'Reverse'}</button>` : '' }
      ], inv.payments) : `<div class="empty">${t('noData')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`,
      onOpen: box => box.querySelectorAll('[data-reverse-supplier-payment]').forEach(button => {
        button.onclick = () => { closeModal(); reverseSupplierPaymentDialog(inv, button.dataset.reverseSupplierPayment); };
      })
    });
  }

  function reverseSupplierPaymentDialog(inv, paymentId) {
    const tr = UI.getLang() === 'tr';
    const requestKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    modal({
      title: `${tr ? 'Ödemeyi ters kaydet' : 'Reverse payment'} — ${inv.invoiceNo}`,
      body: `<div class="alert warn">${tr ? 'Asıl ödeme silinmez; bağlantılı bir ters kayıt eklenir.' : 'The original payment remains and a linked reversal is recorded.'}</div>
        ${field(tr ? 'Gerekçe (zorunlu)' : 'Reason (required)', textarea('supplierPayRevReason'))}
        ${field(t('date'), input('supplierPayRevDate', { type: 'date', value: UI.today() }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="supplierPayRevGo">${tr ? 'Ters kaydet' : 'Reverse'}</button>`,
      onOpen: box => {
        const button = box.querySelector('#supplierPayRevGo');
        button.onclick = async () => {
          if (button.disabled) return;
          const reason = val('supplierPayRevReason');
          if (reason.trim().length < 3) return UI.toast(tr ? 'En az 3 karakter gerekçe girin.' : 'Enter a reason of at least 3 characters.');
          button.disabled = true;
          try {
            await Api.reverseSupplierPayment(inv.id, paymentId, { reason, reversedOn: val('supplierPayRevDate'), requestKey });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); } finally { button.disabled = false; }
        };
      }
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
      { k: 'requests', l: t('tabRequests') }, { k: 'rfqs', l: t('tabRfqs') }, { k: 'invoices', l: t('tabInvoices') },
      { k: 'returns', l: UI.getLang() === 'tr' ? 'İadeler' : 'Returns' }
    ], tab, k => setTab(k))}
    <div id="purchBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
