// @ts-nocheck
/**
 * Planlama (Planning) — React'e kademeli geçişin bir sonraki ekranı.
 *
 * Reports'la aynı sekmeli yapı (dış kabuk sabit, her sekme kendi
 * body/actions konteynerini dolduran ayrı fonksiyon) + Items/Production
 * gibi bir ön-koşul veri çekimi (workCenters/shifts/items/warehouses,
 * tüm sekmelerde paylaşılıyor). İki tür yenileme var:
 *  - `reload()`  : yalnızca o an aktif sekmeyi yeniden çeker.
 *  - `fullReload()`: paylaşılan ön-koşul verisini (iş merkezleri, vardiyalar
 *    vb.) YENİDEN çeker + sekmeyi yeniler — orijinaldeki `render(el)`
 *    çağrılarının karşılığı (iş merkezi/vardiya ekle-düzenle-sil sonrası).
 */
import { useEffect, useState, useRef } from 'react';

export default function PlanningView() {
  const { t, esc, num, money, dt, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  const [tab, setTab] = useState('mrp');
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const workCentersRef = useRef([]);
  const shiftsRef = useRef([]);
  const itemsRef = useRef([]);
  const warehousesRef = useRef([]);
  const capFromRef = useRef(UI.today());
  const capToRef = useRef(UI.addDays(capFromRef.current, 30));
  const routingItemIdRef = useRef('');

  function reload() { setReloadToken(x => x + 1); }
  async function fullReload() {
    try {
      const [wc, sh, it, wh] = await Promise.all([
        Api.workCenters(), Api.shifts(), Api.items({ pageSize: 300 }), Api.warehouses()
      ]);
      workCentersRef.current = wc; shiftsRef.current = sh; itemsRef.current = it.data; warehousesRef.current = wh;
    } catch (e) { UI.err(e); }
    reload();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wc, sh, it, wh] = await Promise.all([
          Api.workCenters(), Api.shifts(), Api.items({ pageSize: 300 }), Api.warehouses()
        ]);
        if (cancelled) return;
        workCentersRef.current = wc; shiftsRef.current = sh; itemsRef.current = it.data; warehousesRef.current = wh;
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('planBody');
    const actions = document.getElementById('planActions');
    if (!body || !actions) return;
    const fns = { mrp: mrpTab, capacity: capacityTab, workcenters: wcTab, routings: routingTab, shifts: shiftTab };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [ready, tab, reloadToken]);

  /* ================= MRP ================= */
  async function mrpTab(body, actions) {
    const [runs, sugg] = await Promise.all([
      Api.mrpRuns().catch(() => []),
      Api.mrpSuggestions({ status: 'open' }).catch(() => ({ data: [] }))
    ]);
    const latest = runs[0];

    if (can('approve')) {
      actions.innerHTML = `<button class="btn btn-primary btn-sm" id="mrpRun">${UI.icon(UI.ICONS.check)}${t('runMrp')}</button>`;
    } else {
      actions.innerHTML = '';
    }

    const rows = sugg.data || [];
    const lateCount = rows.filter(r => r.isLate).length;
    const totalCost = rows.reduce((s, r) => s + (r.estimatedCost || 0), 0);

    body.innerHTML = `
      <div class="alert info">${t('mrpHint')}</div>
      ${latest ? `<div class="stat-row">
        ${UI.stat(t('mrpRunNo'), esc(latest.runNo), { sub: ts(latest.createdAt) })}
        ${UI.stat(t('suggestions'), latest.suggestionCount, { kind: latest.suggestionCount ? 'info' : 'ok' })}
        ${UI.stat(t('isLate'), lateCount, { kind: lateCount ? 'crit' : 'ok' })}
        ${UI.stat(UI.getLang() === 'tr' ? 'Tahmini tutar' : 'Estimated cost', '₺' + money(totalCost))}
      </div>` : ''}

      ${rows.length ? `
        <div class="filters">
          <button class="chip" id="fAll">${t('all')}</button>
          <button class="chip" id="fMake">${t('suggestionMake')}</button>
          <button class="chip" id="fBuy">${t('suggestionBuy')}</button>
          <button class="chip" id="fLate">${t('isLate')}</button>
        </div>
        <div class="card">${table([
          { key: 'itemName', label: t('itemName'), render: r => `${esc(r.itemName)}
              <div class="sub-line">${UI.getLang() === 'tr' ? 'seviye' : 'level'} ${r.bomLevel} · ${esc(r.sourceDemand || '—')}</div>` },
          { key: 'type', label: t('procurementType'), render: r => r.type === 'make'
              ? `<span class="badge purple">${t('suggestionMake')}</span>`
              : `<span class="badge info">${t('suggestionBuy')}</span>` },
          { key: 'grossRequirement', label: t('grossRequirement'), num: true, render: r => num(r.grossRequirement, 2) },
          { key: 'onHand', label: t('onHand'), num: true, render: r => num(r.onHand, 2) },
          { key: 'onOrder', label: t('onOrder'), num: true, render: r => num(r.onOrder, 2) },
          { key: 'safetyStock', label: t('safetyStock'), num: true, render: r => num(r.safetyStock, 2) },
          { key: 'netRequirement', label: t('netRequirement'), num: true, render: r => `<b>${num(r.netRequirement, 2)}</b>` },
          { key: 'suggestedQty', label: t('suggestedQty'), num: true, render: r => `<b>${num(r.suggestedQty, 2)}</b>` },
          { key: 'releaseDate', label: t('releaseDate'), render: r => r.isLate
              ? `<span class="badge crit" title="${t('lateSuggestion')}">${dt(r.releaseDate)}</span>`
              : dt(r.releaseDate), cls: 'nowrap' },
          { key: 'needDate', label: t('needDate'), render: r => dt(r.needDate), cls: 'nowrap' },
          { key: 'act', label: t('actions'), render: r => can('approve') ? `<div class="row-actions">
              <button class="btn btn-primary btn-sm" data-conv="${r.id}">${t('convertSuggestion')}</button>
              <button class="icon-btn danger" data-dis="${r.id}" title="${t('dismissSuggestion')}">${UI.icon(UI.ICONS.x)}</button>
            </div>` : '' }
        ], rows, { rowAttrs: r => `data-type="${esc(r.type)}" data-late="${r.isLate ? '1' : '0'}"` })}</div>`
        : `<div class="empty">${t('noSuggestions')}</div>`}

      ${runs.length ? `<div class="card"><div class="card-head"><h3>${UI.getLang() === 'tr' ? 'Çalıştırma geçmişi' : 'Run history'}</h3></div>
        ${table([
          { key: 'runNo', label: t('mrpRunNo'), render: r => `<span class="mono">${esc(r.runNo)}</span>` },
          { key: 'createdAt', label: t('date'), render: r => ts(r.createdAt) },
          { key: 'horizonDays', label: t('mrpHorizon'), num: true, render: r => num(r.horizonDays) },
          { key: 'suggestionCount', label: t('suggestions'), num: true, render: r => num(r.suggestionCount) },
          { key: 'shortageCount', label: t('isLate'), num: true, render: r => r.shortageCount
              ? `<span style="color:var(--danger)">${num(r.shortageCount)}</span>` : '0' },
          { key: 'username', label: t('auditUser'), render: r => esc(r.username || '—') }
        ], runs.slice(0, 10))}</div>` : ''}`;

    document.getElementById('mrpRun')?.addEventListener('click', () => {
      modal({
        title: t('runMrp'),
        body: `${field(t('mrpHorizon'), input('mrpDays', { type: 'number', min: 1, max: 730, value: 90 }),
          UI.getLang() === 'tr' ? 'Bu süre içindeki ihtiyaçlar planlanır.' : 'Only demand inside this window is planned.')}
          ${field(t('notes'), input('mrpNote'))}
          <div class="alert info">${t('mrpHint')}</div>`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                 <button class="btn btn-primary" id="mrpGo">${t('runMrp')}</button>`,
        onOpen: (box) => {
          box.querySelector('#mrpGo').onclick = async () => {
            try {
              const r = await Api.runMrp({ horizonDays: intVal('mrpDays'), notes: val('mrpNote') });
              closeModal();
              UI.ok(`${r.suggestionCount} ${UI.getLang() === 'tr' ? 'öneri üretildi' : 'suggestions'}`);
              if (r.cycles && r.cycles.length) {
                UI.toast(UI.getLang() === 'tr'
                  ? 'Uyarı: döngüsel reçete tespit edildi, o dallar atlandı.'
                  : 'Warning: circular BOM detected; those branches were skipped.', 'err');
              }
              reload();
            } catch (e) { UI.err(e); }
          };
        }
      });
    });

    // İstemci tarafı filtre: liste küçük, sunucuya gitmeye değmez
    const applyFilter = (fn, activeId) => {
      body.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.id === activeId));
      body.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = fn(tr.dataset) ? '' : 'none'; });
    };
    document.getElementById('fAll')?.addEventListener('click', () => applyFilter(() => true, 'fAll'));
    document.getElementById('fMake')?.addEventListener('click', () => applyFilter(d => d.type === 'make', 'fMake'));
    document.getElementById('fBuy')?.addEventListener('click', () => applyFilter(d => d.type === 'buy', 'fBuy'));
    document.getElementById('fLate')?.addEventListener('click', () => applyFilter(d => d.late === '1', 'fLate'));

    body.querySelectorAll('[data-conv]').forEach(b => b.onclick = async () => {
      try {
        const r = await Api.convertSuggestion(b.dataset.conv);
        UI.ok(`${r.number} ${UI.getLang() === 'tr' ? 'oluşturuldu' : 'created'}`);
        reload();
      } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-dis]').forEach(b => b.onclick = async () => {
      try { await Api.dismissSuggestion(b.dataset.dis); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
    });
  }

  /* ================= KAPASİTE ================= */
  async function capacityTab(body, actions) {
    const capFrom = capFromRef.current, capTo = capToRef.current;
    const cap = await Api.capacity({ from: capFrom, to: capTo });
    actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="capCsv">${UI.icon(UI.ICONS.download)}CSV</button>`;

    body.innerHTML = `
      <div class="filters">
        ${field('', input('capFrom', { type: 'date', value: capFrom }))}
        ${field('', input('capTo', { type: 'date', value: capTo }))}
      </div>
      <div class="card"><div class="card-body"><div class="chart-wrap"><canvas id="chCap"></canvas></div></div></div>
      <div class="card">${table([
        { key: 'code', label: t('workCenterCode'), render: c => `<span class="mono">${esc(c.code)}</span>
            <div class="sub-line">${esc(c.name)}</div>` },
        { key: 'capacityUnits', label: t('capacityUnits'), num: true, render: c => num(c.capacityUnits) },
        { key: 'totalCapacityMinutes', label: t('capacityMinutes'), num: true, render: c => num(Math.round(c.totalCapacityMinutes / 60)) + ' sa' },
        { key: 'totalLoadMinutes', label: t('loadMinutes'), num: true, render: c => num(Math.round(c.totalLoadMinutes / 60)) + ' sa' },
        { key: 'utilizationPct', label: t('utilizationPct'), num: true, render: c => {
            const col = c.utilizationPct > 100 ? 'var(--danger)' : c.utilizationPct > 85 ? 'var(--accent)' : 'var(--success)';
            return `<span style="color:${col}">${num(c.utilizationPct, 1)}%</span>
              <div class="progress"><div class="bar ${c.utilizationPct > 100 ? '' : 'ok'}" style="width:${Math.min(100, c.utilizationPct)}%"></div></div>`;
          } },
        { key: 'overloadedDays', label: t('overloadDays'), num: true, render: c => c.overloadedDays
            ? `<span class="badge crit">${num(c.overloadedDays)}</span>` : '0' },
        { key: 'act', label: '', render: c => `<button class="btn btn-ghost btn-sm" data-days="${c.workCenterId}">${t('detail')}</button>` }
      ], cap.data)}</div>`;

    document.getElementById('capFrom').onchange = e => { capFromRef.current = e.target.value; reload(); };
    document.getElementById('capTo').onchange = e => { capToRef.current = e.target.value; reload(); };
    document.getElementById('capCsv').onclick = () => UI.exportCsv('kapasite.csv',
      [t('workCenterCode'), t('workCenter'), t('capacityMinutes'), t('loadMinutes'), t('utilizationPct'), t('overloadDays')],
      cap.data.map(c => [c.code, c.name, c.totalCapacityMinutes, c.totalLoadMinutes, c.utilizationPct, c.overloadedDays]));

    body.querySelectorAll('[data-days]').forEach(b => b.onclick = () => {
      const c = cap.data.find(x => String(x.workCenterId) === b.dataset.days);
      modal({
        title: `${c.code} — ${c.name}`, size: 'wide',
        body: table([
          { key: 'date', label: t('date'), render: d => dt(d.date), cls: 'nowrap' },
          { key: 'capacityMinutes', label: t('capacityMinutes'), num: true, render: d => num(d.capacityMinutes) },
          { key: 'loadMinutes', label: t('loadMinutes'), num: true, render: d => num(d.loadMinutes) },
          { key: 'utilizationPct', label: t('utilizationPct'), num: true, render: d => d.capacityMinutes === 0
              ? `<span class="badge plain">${UI.getLang() === 'tr' ? 'kapalı' : 'closed'}</span>`
              : `${num(d.utilizationPct, 1)}%` },
          { key: 'overloadMinutes', label: t('overloaded'), num: true, render: d => d.overloadMinutes
              ? `<span style="color:var(--danger)">+${num(d.overloadMinutes)}</span>` : '—' }
        ], c.days),
        footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
      });
    });

    UI.chart('chCap', {
      type: 'bar',
      data: {
        labels: cap.data.map(c => c.code),
        datasets: [
          { label: t('capacityMinutes'), data: cap.data.map(c => Math.round(c.totalCapacityMinutes / 60)), backgroundColor: UI.PALETTE[1], borderRadius: 4 },
          { label: t('loadMinutes'), data: cap.data.map(c => Math.round(c.totalLoadMinutes / 60)), backgroundColor: UI.PALETTE[0], borderRadius: 4 }
        ]
      },
      options: { scales: { y: { title: { display: true, text: 'saat / hours', color: '#9199A0' } } } }
    });
  }

  /* ================= İŞ MERKEZLERİ ================= */
  async function wcTab(body, actions) {
    const workCenters = workCentersRef.current, shifts = shiftsRef.current;
    const exceptions = await Api.calendarExceptions().catch(() => []);
    if (can('approve')) {
      actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="shNew2">${UI.icon(UI.ICONS.plus)}${t('newShift')}</button>
        <button class="btn btn-primary btn-sm" id="wcNew">${UI.icon(UI.ICONS.plus)}${t('newWorkCenter')}</button>`;
    } else {
      actions.innerHTML = '';
    }

    body.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('tabWorkCenters')}</h3></div>
        ${table([
          { key: 'code', label: t('workCenterCode'), render: w => `<span class="mono">${esc(w.code)}</span>` },
          { key: 'name', label: t('workCenter'), render: w => `${esc(w.name)}
              <div class="sub-line">${esc(w.description || '')}</div>` },
          { key: 'capacityUnits', label: t('capacityUnits'), num: true, render: w => num(w.capacityUnits) },
          { key: 'shiftCodes', label: t('assignedShifts'), render: w => w.shiftCodes.length
              ? w.shiftCodes.map(c => `<span class="badge plain">${esc(c)}</span>`).join(' ')
              : `<span class="badge crit">${UI.getLang() === 'tr' ? 'vardiya yok' : 'no shift'}</span>` },
          { key: 'efficiencyPct', label: t('efficiencyPct'), num: true, render: w => num(w.efficiencyPct, 0) + '%' },
          { key: 'downtimePct', label: t('downtimePct'), num: true, render: w => num(w.downtimePct, 0) + '%' },
          { key: 'hourlyRate', label: t('hourlyRate'), num: true, render: w => '₺' + num(w.hourlyRate, 0) },
          { key: 'act', label: t('actions'), render: w => can('approve') ? `<div class="row-actions">
              <button class="icon-btn" data-edit="${w.id}">${UI.icon(UI.ICONS.edit)}</button>
              <button class="icon-btn danger" data-del="${w.id}">${UI.icon(UI.ICONS.trash)}</button></div>` : '' }
        ], workCenters)}</div>

      <div class="card"><div class="card-head"><h3>${t('shift')}</h3></div>
        ${table([
          { key: 'code', label: t('workCenterCode'), render: s => `<span class="mono">${esc(s.code)}</span>` },
          { key: 'name', label: t('shift'), render: s => esc(s.name) },
          { key: 'time', label: `${t('startTime')} – ${t('endTime')}`, render: s => `${esc(s.startTime)} – ${esc(s.endTime)}` },
          { key: 'breakMinutes', label: t('breakMinutes'), num: true, render: s => num(s.breakMinutes) },
          { key: 'netMinutes', label: t('netMinutes'), num: true, render: s => `<b>${num(s.netMinutes)}</b>` },
          { key: 'weekdays', label: t('weekdays'), render: s => s.weekdays.map(d =>
              `<span class="badge plain">${t(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][d - 1])}</span>`).join(' ') }
        ], shifts)}</div>

      <div class="card"><div class="card-head"><h3>${t('holidays')}</h3>
        ${can('approve') ? `<button class="btn btn-ghost btn-sm" id="holNew">${UI.icon(UI.ICONS.plus)}${t('addHoliday')}</button>` : ''}</div>
        <div class="card-body" style="padding-top:0">
          <div class="alert info" style="margin-top:14px">${UI.getLang() === 'tr'
            ? 'Tatil günlerinde kapasite sıfırdır; çizelgeleme bu günleri atlar.'
            : 'Capacity is zero on holidays; the scheduler skips those days.'}</div>
          ${table([
            { key: 'date', label: t('date'), render: e2 => dt(e2.date), cls: 'nowrap' },
            { key: 'work_center_name', label: t('workCenter'), render: e2 => esc(e2.work_center_name ||
                (UI.getLang() === 'tr' ? 'Tüm fabrika' : 'Whole plant')) },
            { key: 'reason', label: t('holidayReason'), render: e2 => esc(e2.reason || '—') },
            { key: 'exception_type', label: t('status'), render: e2 => {
                const l = e2.exception_type === 'holiday' ? (UI.getLang() === 'tr' ? 'Tatil' : 'Holiday')
                  : (UI.getLang() === 'tr' ? 'Kısmi' : 'Partial');
                return `<span class="badge ${e2.exception_type === 'holiday' ? 'crit' : 'warn'}">${esc(l)}</span>`;
              } },
            { key: 'act', label: '', render: e2 => can('approve')
                ? `<div class="row-actions"><button class="icon-btn danger" data-delex="${e2.id}">${UI.icon(UI.ICONS.trash)}</button></div>` : '' }
          ], exceptions)}
        </div></div>`;

    document.getElementById('wcNew')?.addEventListener('click', () => wcForm(null));
    document.getElementById('shNew2')?.addEventListener('click', () => shiftForm());
    document.getElementById('holNew')?.addEventListener('click', () => holidayForm());
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
      wcForm(workCenters.find(w => String(w.id) === b.dataset.edit)));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(
      UI.getLang() === 'tr' ? 'İş merkezi pasifleştirilecek. Rotalarda kullanılıyorsa plan etkilenir.'
                            : 'The work centre will be deactivated. Plans using it will be affected.',
      async () => { try { await Api.deleteWorkCenter(b.dataset.del); UI.ok(t('saved')); fullReload(); } catch (e) { UI.err(e); } },
      { danger: true }));
    body.querySelectorAll('[data-delex]').forEach(b => b.onclick = async () => {
      try { await Api.deleteCalendarException(b.dataset.delex); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
    });
  }

  function wcForm(w) {
    const warehouses = warehousesRef.current, shifts = shiftsRef.current;
    modal({
      title: w ? `${t('edit')} — ${w.name}` : t('newWorkCenter'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('workCenterCode'), input('wcCode', { value: w?.code || '', attrs: w ? 'disabled' : '' }))}
          ${field(t('workCenter'), input('wcName', { value: w?.name || '' }))}
        </div>
        ${field(t('description'), input('wcDesc', { value: w?.description || '' }))}
        <div class="field-row">
          ${field(t('warehouse'), select('wcWh', [{ v: '', l: t('none') },
            ...warehouses.map(x => ({ v: x.id, l: x.name }))], w?.warehouseId || ''))}
          ${field(t('capacityUnits'), input('wcUnits', { type: 'number', min: 1, value: w?.capacityUnits ?? 1 }),
            UI.getLang() === 'tr' ? 'Aynı anda kaç iş yürütülebilir.' : 'How many jobs can run at once.')}
        </div>
        <div class="field-row three">
          ${field(t('hourlyRate'), input('wcRate', { type: 'number', min: 0, step: '0.01', value: w?.hourlyRate ?? 0 }))}
          ${field(t('efficiencyPct'), input('wcEff', { type: 'number', min: 1, max: 200, value: w?.efficiencyPct ?? 100 }))}
          ${field(t('downtimePct'), input('wcDown', { type: 'number', min: 0, max: 90, value: w?.downtimePct ?? 0 }))}
        </div>
        <div class="section-title">${t('assignedShifts')}</div>
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Kapasite buradan gelir. Vardiya atanmazsa iş merkezi hiç çalışmıyor sayılır.'
          : 'Capacity comes from here. With no shift assigned the centre is treated as never running.'}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${shifts.map(s => `<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer">
            <input type="checkbox" class="wc-shift" value="${s.id}" ${(w?.shiftCodes || []).includes(s.code) ? 'checked' : ''} style="width:auto">
            ${esc(s.code)} — ${esc(s.name)} (${s.netMinutes} dk)</label>`).join('')}
        </div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="wcGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#wcGo').onclick = async () => {
          const shiftIds = [...box.querySelectorAll('.wc-shift:checked')].map(i => Number(i.value));
          const p = {
            code: val('wcCode'), name: val('wcName'), description: val('wcDesc'),
            warehouseId: val('wcWh') ? intVal('wcWh') : undefined,
            capacityUnits: intVal('wcUnits'), hourlyRate: numVal('wcRate'),
            efficiencyPct: numVal('wcEff'), downtimePct: numVal('wcDown'), shiftIds
          };
          try {
            if (w) await Api.updateWorkCenter(w.id, p); else await Api.createWorkCenter(p);
            closeModal(); UI.ok(t('saved')); fullReload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function shiftForm() {
    const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    modal({
      title: t('newShift'),
      body: `
        <div class="field-row">
          ${field(t('workCenterCode'), input('sfCode'))}
          ${field(t('shift'), input('sfName'))}
        </div>
        <div class="field-row three">
          ${field(t('startTime'), input('sfStart', { type: 'time', value: '08:00' }))}
          ${field(t('endTime'), input('sfEnd', { type: 'time', value: '16:00' }))}
          ${field(t('breakMinutes'), input('sfBreak', { type: 'number', min: 0, value: 45 }))}
        </div>
        <div class="field"><label>${t('weekdays')}</label>
          <div style="display:flex;gap:9px;flex-wrap:wrap">
            ${dayKeys.map((k, i) => `<label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
              <input type="checkbox" class="sf-day" value="${i + 1}" ${i < 5 ? 'checked' : ''} style="width:auto"> ${t(k)}</label>`).join('')}
          </div></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="sfGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#sfGo').onclick = async () => {
          const weekdays = [...box.querySelectorAll('.sf-day:checked')].map(i => Number(i.value));
          if (!weekdays.length) return UI.toast(UI.getLang() === 'tr' ? 'En az bir gün seçin.' : 'Pick at least one day.', 'err');
          try {
            await Api.createShift({
              code: val('sfCode'), name: val('sfName'), startTime: val('sfStart'),
              endTime: val('sfEnd'), breakMinutes: intVal('sfBreak'), weekdays
            });
            closeModal(); UI.ok(t('saved')); fullReload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function holidayForm() {
    const workCenters = workCentersRef.current;
    modal({
      title: t('addHoliday'),
      body: `
        ${field(t('date'), input('hoDate', { type: 'date', value: UI.today() }))}
        ${field(t('workCenter'), select('hoWc', [{ v: '', l: UI.getLang() === 'tr' ? 'Tüm fabrika' : 'Whole plant' },
          ...workCenters.map(w => ({ v: w.id, l: `${w.code} — ${w.name}` }))]))}
        ${field(t('holidayReason'), input('hoReason'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="hoGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#hoGo').onclick = async () => {
          try {
            await Api.createCalendarException({
              date: val('hoDate'), workCenterId: val('hoWc') ? intVal('hoWc') : undefined,
              reason: val('hoReason'), exceptionType: 'holiday'
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= ROTALAR ================= */
  async function routingTab(body, actions) {
    const items = itemsRef.current, workCenters = workCentersRef.current;
    actions.innerHTML = '';
    const producible = items.filter(i => i.itemType === 'finished' || i.itemType === 'semi');
    if (!routingItemIdRef.current && producible.length) routingItemIdRef.current = producible[0].id;
    const routingItemId = routingItemIdRef.current;
    const ops = routingItemId ? await Api.routings(routingItemId).catch(() => []) : [];

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Reçete NE gerektiğini söyler, rota NASIL yapıldığını. Çizelgeleme rotasız çalışmaz.'
        : 'The BOM says what is needed; the routing says how it is made. Scheduling needs a routing.'}</div>
      <div class="filters">
        ${select('rtItem', producible.map(i => ({ v: i.id, l: `${i.name} (${i.code || ''})` })), routingItemId)}
      </div>
      <div class="card">
        <div class="card-head"><h3>${t('routing')}</h3>
          ${can('approve') ? `<button class="btn btn-ghost btn-sm" id="rtAdd">${t('addOperation')}</button>` : ''}</div>
        <div class="card-body">
          <div id="rtList" class="dyn-list"></div>
          ${can('approve') ? `<button class="btn btn-primary" id="rtSave" style="margin-top:10px">${t('saveRouting')}</button>` : ''}
        </div>
      </div>`;

    let rows = ops.map(o => ({ ...o }));
    const draw = () => {
      const host = document.getElementById('rtList');
      if (!rows.length) { host.innerHTML = `<div class="empty" style="padding:18px">${t('noRouting')}</div>`; return; }
      host.innerHTML = rows.map((o, i) => `
        <div class="dyn-row" style="align-items:flex-end">
          <div><label style="font-size:11px;color:var(--text-faint)">${t('operationNo')}</label><br>
            <input type="number" min="1" step="10" value="${o.operationNo}" data-i="${i}" data-f="operationNo" style="width:74px"></div>
          <div style="flex:1;min-width:130px"><label style="font-size:11px;color:var(--text-faint)">${t('operationName')}</label><br>
            <input type="text" value="${esc(o.operationName || '')}" data-i="${i}" data-f="operationName" style="width:100%"></div>
          <div><label style="font-size:11px;color:var(--text-faint)">${t('workCenter')}</label><br>
            <select data-i="${i}" data-f="workCenterId">${workCenters.map(w =>
              `<option value="${w.id}" ${w.id === o.workCenterId ? 'selected' : ''}>${esc(w.code)}</option>`).join('')}</select></div>
          <div><label style="font-size:11px;color:var(--text-faint)">${t('setupMinutes')}</label><br>
            <input type="number" min="0" step="0.5" value="${o.setupMinutes ?? 0}" data-i="${i}" data-f="setupMinutes" style="width:78px"></div>
          <div><label style="font-size:11px;color:var(--text-faint)">${t('runMinutes')}</label><br>
            <input type="number" min="0" step="0.1" value="${o.runMinutesPerUnit ?? 0}" data-i="${i}" data-f="runMinutesPerUnit" style="width:78px"></div>
          <div><label style="font-size:11px;color:var(--text-faint)">${t('queueMinutes')}</label><br>
            <input type="number" min="0" step="1" value="${o.queueMinutes ?? 0}" data-i="${i}" data-f="queueMinutes" style="width:78px"></div>
          <div><label style="font-size:11px;color:var(--text-faint)">${t('bomScrapPct')}</label><br>
            <input type="number" min="0" max="100" step="0.1" value="${o.scrapPct ?? 0}" data-i="${i}" data-f="scrapPct" style="width:70px"></div>
          <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
        </div>`).join('');
      host.querySelectorAll('input,select').forEach(inp => inp.oninput = () => {
        const f = inp.dataset.f;
        rows[+inp.dataset.i][f] = (f === 'operationName') ? inp.value : Number(inp.value);
      });
      host.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { rows.splice(+b.dataset.rm, 1); draw(); });
    };
    draw();

    document.getElementById('rtItem').onchange = e => { routingItemIdRef.current = e.target.value; reload(); };
    document.getElementById('rtAdd')?.addEventListener('click', () => {
      const nextNo = rows.length ? Math.max(...rows.map(r => r.operationNo)) + 10 : 10;
      rows.push({ operationNo: nextNo, operationName: '', workCenterId: workCenters[0]?.id,
                  setupMinutes: 0, runMinutesPerUnit: 0, queueMinutes: 0, scrapPct: 0 });
      draw();
    });
    document.getElementById('rtSave')?.addEventListener('click', async () => {
      try {
        await Api.saveRouting(routingItemId, rows.map(r => ({
          operationNo: r.operationNo, operationName: r.operationName, workCenterId: r.workCenterId,
          setupMinutes: r.setupMinutes, runMinutesPerUnit: r.runMinutesPerUnit,
          queueMinutes: r.queueMinutes, scrapPct: r.scrapPct
        })));
        UI.ok(t('saved')); reload();
      } catch (e) { UI.err(e); }
    });
  }

  /* ================= VARDİYA & OEE ================= */
  async function shiftTab(body, actions) {
    const to = UI.today();
    const from = UI.addDays(to, -30);
    const [logs, oee] = await Promise.all([
      Api.shiftLogs({ from, to, pageSize: 50 }),
      Api.oee({ from, to })
    ]);
    if (can('write')) actions.innerHTML = `<button class="btn btn-primary btn-sm" id="slNew">${UI.icon(UI.ICONS.plus)}${t('newShiftLog')}</button>`;
    else actions.innerHTML = '';

    body.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('oeeTitle')}</h3></div><div class="card-body">
        <div class="alert info">${t('oeeHint')}</div>
        ${table([
          { key: 'code', label: t('workCenter'), render: o => `<span class="mono">${esc(o.code)}</span>
              <div class="sub-line">${esc(o.name)}</div>` },
          { key: 'shifts', label: UI.getLang() === 'tr' ? 'Vardiya' : 'Shifts', num: true, render: o => num(o.shifts) },
          { key: 'availabilityPct', label: t('availability'), num: true, render: o => pctCell(o.availabilityPct, 90) },
          { key: 'performancePct', label: t('performance'), num: true, render: o => pctCell(o.performancePct, 90) },
          { key: 'qualityPct', label: t('quality'), num: true, render: o => pctCell(o.qualityPct, 98) },
          { key: 'oeePct', label: 'OEE', num: true, render: o => `<b>${pctCell(o.oeePct, 65)}</b>` },
          { key: 'produced', label: t('producedQty'), num: true, render: o => num(o.produced) },
          { key: 'scrap', label: t('scrapQty'), num: true, render: o => o.scrap
              ? `<span style="color:var(--danger)">${num(o.scrap)}</span>` : '0' }
        ], oee.data)}
        <div class="chart-wrap" style="margin-top:14px"><canvas id="chOee"></canvas></div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${t('shiftLog')}</h3></div>
        ${table([
          { key: 'date', label: t('date'), render: l => dt(l.date), cls: 'nowrap' },
          { key: 'shiftName', label: t('shift'), render: l => esc(l.shiftName) },
          { key: 'workCenterName', label: t('workCenter'), render: l => esc(l.workCenterName) },
          { key: 'plannedMinutes', label: UI.getLang() === 'tr' ? 'Planlanan' : 'Planned', num: true, render: l => num(l.plannedMinutes) },
          { key: 'workedMinutes', label: t('workedMinutes'), num: true, render: l => num(l.workedMinutes) },
          { key: 'downtimeMinutes', label: t('downtimeMinutes'), num: true, render: l => l.downtimeMinutes
              ? `<span style="color:var(--accent)">${num(l.downtimeMinutes)}</span>` : '0' },
          { key: 'downtimeReason', label: t('downtimeReason'), render: l => esc(l.downtimeReason || '—') },
          { key: 'producedQty', label: t('producedQty'), num: true, render: l => num(l.producedQty) },
          { key: 'scrapQty', label: t('scrapQty'), num: true, render: l => num(l.scrapQty) }
        ], logs.data)}
        ${logs.totalPages ? pager(logs, () => reload()) : ''}</div>`;

    document.getElementById('slNew')?.addEventListener('click', () => shiftLogForm());

    UI.chart('chOee', {
      type: 'bar',
      data: {
        labels: oee.data.map(o => o.code),
        datasets: [
          { label: t('availability'), data: oee.data.map(o => o.availabilityPct), backgroundColor: UI.PALETTE[1], borderRadius: 3 },
          { label: t('performance'), data: oee.data.map(o => o.performancePct), backgroundColor: UI.PALETTE[0], borderRadius: 3 },
          { label: t('quality'), data: oee.data.map(o => o.qualityPct), backgroundColor: UI.PALETTE[2], borderRadius: 3 },
          { label: 'OEE', data: oee.data.map(o => o.oeePct), backgroundColor: UI.PALETTE[4], borderRadius: 3 }
        ]
      },
      options: { scales: { y: { max: 100 } } }
    });
  }

  const pctCell = (v, good) => {
    const col = v >= good ? 'var(--success)' : v >= good * 0.8 ? 'var(--accent)' : 'var(--danger)';
    return `<span style="color:${col}">${num(v, 1)}%</span>`;
  };

  function shiftLogForm() {
    const shifts = shiftsRef.current, workCenters = workCentersRef.current;
    modal({
      title: t('newShiftLog'), size: 'wide',
      body: `
        <div class="field-row three">
          ${field(t('date'), input('slDate', { type: 'date', value: UI.today() }))}
          ${field(t('shift'), select('slShift', shifts.map(s => ({ v: s.id, l: `${s.code} — ${s.name}` }))))}
          ${field(t('workCenter'), select('slWc', workCenters.map(w => ({ v: w.id, l: `${w.code} — ${w.name}` }))))}
        </div>
        <div class="field-row three">
          ${field(t('workedMinutes'), input('slWorked', { type: 'number', min: 0, value: 435 }))}
          ${field(t('downtimeMinutes'), input('slDown', { type: 'number', min: 0, value: 0 }))}
          ${field(t('operatorCount'), input('slOps', { type: 'number', min: 0, value: 1 }))}
        </div>
        ${field(t('downtimeReason'), input('slReason'))}
        <div class="field-row">
          ${field(t('producedQty'), input('slProd', { type: 'number', min: 0, step: '0.01', value: 0 }))}
          ${field(t('scrapQty'), input('slScrap', { type: 'number', min: 0, step: '0.01', value: 0 }))}
        </div>
        ${field(t('notes'), textarea('slNote'))}
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Planlanan süre vardiya tanımından otomatik alınır; elle girilmez.'
          : 'Planned time comes from the shift definition; it is not entered by hand.'}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="slGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#slGo').onclick = async () => {
          try {
            await Api.createShiftLog({
              date: val('slDate'), shiftId: intVal('slShift'), workCenterId: intVal('slWc'),
              workedMinutes: numVal('slWorked'), downtimeMinutes: numVal('slDown'),
              downtimeReason: val('slReason'), producedQty: numVal('slProd'),
              scrapQty: numVal('slScrap'), operatorCount: intVal('slOps'), notes: val('slNote')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('planTitle')}</h2><div class="sub">${t('planSub')}</div></div>
      <div class="topbar-actions" id="planActions"></div>
    </div>
    ${UI.tabs([
      { k: 'mrp', l: t('tabMrp') }, { k: 'capacity', l: t('tabCapacity') },
      { k: 'workcenters', l: t('tabWorkCenters') }, { k: 'routings', l: t('tabRoutings') },
      { k: 'shifts', l: t('tabShiftLogs') }
    ], tab, k => setTab(k))}
    <div id="planBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
