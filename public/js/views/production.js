// @ts-nocheck
const ViewProduction = (() => {
  const { t, esc, num, dt, ts, card, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  let state = { page: 1, status: '' };
  let items = [], warehouses = [], settings = {};

  async function render(el) {
    el.innerHTML = loading();
    try {
      const [it, wh, st] = await Promise.all([
        Api.items({ pageSize: 300 }), Api.warehouses(), Api.settings().catch(() => ({}))
      ]);
      items = it.data; warehouses = wh; settings = st;
    } catch (e) { UI.err(e); }
    await load(el);
  }

  async function load(el) {
    let res;
    try { res = await Api.production({ ...state, pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;

    el.innerHTML = `
      <div class="topbar">
        <div><h2>${t('prodTitle')}</h2><div class="sub">${t('prodSub')}</div></div>
        <div class="topbar-actions">
          ${can('write') ? `<button class="btn btn-primary btn-sm" id="pNew">${UI.icon(UI.ICONS.plus)}${t('newProd')}</button>` : ''}
        </div>
      </div>

      <div class="filters">
        ${select('pStatus', [{ v: '', l: t('all') },
          { v: 'Planlandı', l: t('prodPlanned') }, { v: 'Devam Ediyor', l: t('prodInProgress') },
          { v: 'Tamamlandı', l: t('prodDone') }, { v: 'İptal Edildi', l: t('prodCancelled') }], state.status)}
      </div>

      <div class="card">
        ${table([
          { key: 'orderNo', label: t('prodOrderNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.orderNo)}</button>
              <div class="sub-line">${esc(r.itemName)}</div>` },
          { key: 'qty', label: t('prodQty'), num: true, render: r => num(r.qty) },
          { key: 'producedQty', label: t('producedQty'), num: true, render: r => r.producedQty ? num(r.producedQty) : '—' },
          { key: 'scrapQty', label: t('scrapQty'), num: true, render: r => r.scrapQty ? `<span style="color:var(--danger)">${num(r.scrapQty)}</span>` : '—' },
          { key: 'yield', label: t('yieldPct'), num: true, render: r => {
              const tot = (r.producedQty || 0) + (r.scrapQty || 0);
              return tot > 0 ? num((r.producedQty / tot) * 100, 1) + '%' : '—';
            } },
          { key: 'lotNo', label: t('prodLot'), render: r => r.lotNo ? `<span class="mono">${esc(r.lotNo)}</span>` : '—' },
          { key: 'unitCost', label: t('unitCostLabel'), num: true, render: r => r.unitCost ? '₺' + num(r.unitCost, 2) : '—' },
          { key: 'status', label: t('status'), render: r => UI.prodStatusBadge(r.status) },
          { key: 'date', label: t('date'), render: r => dt(r.date), cls: 'nowrap' },
          { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
              ${r.status === 'Planlandı' && can('write') ? `<button class="btn btn-primary btn-sm" data-complete="${esc(r.id)}">${t('complete')}</button>` : ''}
              ${r.status !== 'Tamamlandı' && can('delete') ? `<button class="icon-btn danger" data-del="${esc(r.id)}">${UI.icon(UI.ICONS.trash)}</button>` : ''}
            </div>` }
        ], rows)}
        ${res.totalPages ? pager(res, p => { state.page = p; load(el); }) : ''}
      </div>`;

    document.getElementById('pStatus').onchange = e => { state.status = e.target.value; state.page = 1; load(el); };
    document.getElementById('pNew')?.addEventListener('click', () => newProd(el));
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openProd(el, b.dataset.open));
    el.querySelectorAll('[data-complete]').forEach(b => b.onclick = () => completeDialog(el, b.dataset.complete));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      UI.confirmDialog(t('confirmDelete'), async () => {
        try { await Api.deleteProduction(b.dataset.del); UI.ok(t('deleted')); load(el); } catch (e) { UI.err(e); }
      }, { danger: true, confirmLabel: t('del') });
    });
  }

  function newProd(el) {
    const producible = items.filter(i => i.bom && i.bom.length);
    if (!producible.length) {
      return UI.toast(t('noBomWarn'), 'err');
    }
    modal({
      title: t('newProd'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('prodItem'), select('prItem', producible.map(i => ({ v: i.id, l: `${i.name} (${i.unit})` }))))}
          ${field(t('prodQty'), input('prQty', { type: 'number', min: 0.0001, step: '0.0001', value: 1 }))}
        </div>
        <div class="field-row three">
          ${field(t('warehouse'), select('prWh', warehouses.map(w => ({ v: w.id, l: w.name }))))}
          ${field(t('prodLot'), input('prLot'))}
          ${field(t('date'), input('prDate', { type: 'date', value: UI.today() }))}
        </div>
        <div class="field-row">
          ${field(t('laborCost') + ' (₺)', input('prLabor', { type: 'number', min: 0, step: '0.01', value: 0 }))}
          ${field(t('overheadCost') + ' %', input('prOh', { type: 'number', min: 0, step: '0.1', value: settings.defaultOverheadPct || 0 }))}
        </div>
        ${field(t('notes'), input('prNote'))}
        <div class="section-title">${t('requirements')}</div>
        <div id="prReq">${loading()}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="prGo">${t('save')}</button>`,
      onOpen: (box) => {
        const refresh = UI.debounce(async () => {
          const target = box.querySelector('#prReq');
          target.innerHTML = loading();
          try {
            const r = await Api.requirementsPreview(val('prItem'), numVal('prQty'));
            target.innerHTML = reqTable(r.requirements || r);
          } catch (e) { target.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
        }, 250);
        box.querySelector('#prItem').onchange = refresh;
        box.querySelector('#prQty').oninput = refresh;
        refresh();

        box.querySelector('#prGo').onclick = async () => {
          try {
            await Api.createProduction({
              itemId: val('prItem'), qty: numVal('prQty'), warehouseId: intVal('prWh'),
              lotNo: val('prLot') || undefined, date: val('prDate'),
              laborCost: numVal('prLabor'), overheadPct: numVal('prOh'), note: val('prNote')
            });
            closeModal(); UI.ok(t('saved')); load(el);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  const reqTable = (reqs) => {
    if (!reqs || !reqs.length) return `<div class="empty" style="padding:16px">${t('noBom')}</div>`;
    return table([
      { key: 'componentName', label: t('bomComponent'), render: r => esc(r.componentName || r.name) },
      { key: 'needed', label: t('needed'), num: true, render: r => `${num(r.needed || r.qtyNeeded, 4)} ${esc(r.unit || '')}` },
      { key: 'available', label: t('available'), num: true, render: r => num(r.available, 4) },
      { key: 'ok', label: t('status'), render: r => (r.available >= (r.needed || r.qtyNeeded))
          ? `<span class="badge ok">${t('enough')}</span>` : `<span class="badge crit">${t('short')}</span>` }
    ], reqs);
  };

  async function openProd(el, id) {
    let p;
    try { p = await Api.productionOrder(id); } catch (e) { UI.err(e); return; }
    modal({
      title: p.orderNo, sub: `${p.itemName} · ${num(p.qty)}`,
      size: 'wide',
      body: `
        <div style="margin-bottom:12px">${UI.prodStatusBadge(p.status)} ${p.lotNo ? `<span class="badge plain mono">${esc(p.lotNo)}</span>` : ''}</div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('producedQty')}</div><div class="v">${num(p.producedQty || 0)}</div></div>
          <div class="kv"><div class="k">${t('scrapQty')}</div><div class="v">${num(p.scrapQty || 0)}</div></div>
          <div class="kv"><div class="k">${t('materialCost')}</div><div class="v">₺${num(p.materialCost || 0, 0)}</div></div>
          <div class="kv"><div class="k">${t('laborCost')}</div><div class="v">₺${num(p.laborCost || 0, 0)}</div></div>
          <div class="kv"><div class="k">${t('overheadCost')}</div><div class="v">₺${num(p.overheadCost || 0, 0)}</div></div>
          <div class="kv"><div class="k">${t('totalCost')}</div><div class="v">₺${num(p.totalCost || 0, 0)}</div></div>
          <div class="kv"><div class="k">${t('unitCostLabel')}</div><div class="v">₺${num(p.unitCost || 0, 2)}</div></div>
          <div class="kv"><div class="k">${t('date')}</div><div class="v">${dt(p.date)}</div></div>
        </div>
        ${p.note ? `<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px">${esc(p.note)}</div>` : ''}

        <div class="section-title">${t('requirements')}</div>
        ${table([
          { key: 'componentName', label: t('bomComponent') },
          { key: 'qtyUsed', label: t('needed'), num: true, render: r => num(r.qtyUsed, 4) }
        ], p.components || [])}

        ${p.consumption && p.consumption.length ? `
          <div class="section-title">${t('consumedLots')}</div>
          ${table([
            { key: 'componentName', label: t('bomComponent') },
            { key: 'lotNo', label: t('lotNo'), render: r => `<span class="mono">${esc(r.lotNo || '—')}</span>` },
            { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty, 4) },
            { key: 'unitCost', label: t('unitCost'), num: true, render: r => '₺' + num(r.unitCost, 2) }
          ], p.consumption)}` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${p.status === 'Planlandı' && can('write') ? `<button class="btn btn-primary" id="pComp">${t('completeProd')}</button>` : ''}
               ${p.outputLotId ? `<button class="btn btn-ghost" id="pTrace">${t('traceability')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#pComp')?.addEventListener('click', () => { closeModal(); completeDialog(el, p.id); });
        box.querySelector('#pTrace')?.addEventListener('click', () => { closeModal(); ViewLots.traceDialog(p.outputLotId); });
      }
    });
  }

  async function completeDialog(el, id) {
    let p, reqs = [];
    try {
      p = await Api.productionOrder(id);
      reqs = await Api.productionRequirements(id).then(r => r.requirements || r).catch(() => []);
    } catch (e) { UI.err(e); return; }

    const short = reqs.filter(r => r.available < (r.needed ?? r.qtyNeeded));

    modal({
      title: t('completeProd'), sub: `${p.orderNo} · ${p.itemName}`,
      size: 'wide',
      body: `
        ${short.length ? `<div class="alert crit">${UI.getLang() === 'tr' ? 'Yetersiz hammadde — üretim tamamlanamaz:' : 'Insufficient materials — cannot complete:'}<br>
          ${short.map(s => `${esc(s.componentName)}: ${t('needed')} ${num(s.needed ?? s.qtyNeeded, 4)}, ${t('available')} ${num(s.available, 4)}`).join('<br>')}</div>` : ''}
        <div class="field-row three">
          ${field(t('producedQty'), input('coProd', { type: 'number', min: 0, step: '0.0001', value: p.qty }))}
          ${field(t('scrapQty'), input('coScrap', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
          ${field(t('reworkQty'), input('coRework', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
        </div>
        <div class="field-row">
          ${field(t('prodLot'), input('coLot', { value: p.lotNo || '' }))}
          ${field(t('laborCost') + ' (₺)', input('coLabor', { type: 'number', min: 0, step: '0.01', value: p.laborCost || 0 }))}
        </div>
        ${field(t('overheadCost') + ' %', input('coOh', { type: 'number', min: 0, step: '0.1', value: settings.defaultOverheadPct || 0 }))}
        <div class="section-title">${t('requirements')}</div>
        ${reqTable(reqs)}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="coGo" ${short.length ? 'disabled' : ''}>${t('completeProd')}</button>`,
      onOpen: (box) => {
        box.querySelector('#coGo').onclick = async () => {
          try {
            await Api.completeProduction(id, {
              producedQty: numVal('coProd'), scrapQty: numVal('coScrap'), reworkQty: numVal('coRework'),
              lotNo: val('coLot') || undefined, laborCost: numVal('coLabor'), overheadPct: numVal('coOh')
            });
            closeModal(); UI.ok(t('saved')); load(el);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  return { render };
})();
