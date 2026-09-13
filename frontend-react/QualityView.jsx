// @ts-nocheck
/**
 * Kalite (Quality) — React'e kademeli geçişin bir sonraki ekranı.
 * Planning/Purchasing ile aynı sekmeli desen (6 sekme) + ön-koşul veri
 * çekimi (items/suppliers/users). fullReload()'a gerek yok — tüm
 * kaydetme işlemleri orijinalde yalnızca aktif sekmeyi yeniden çekiyordu.
 */
import { useEffect, useState, useRef } from 'react';

export default function QualityView() {
  const { t, esc, num, dt, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  const [tab, setTab] = useState('inspections');
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const itemsRef = useRef([]);
  const suppliersRef = useRef([]);
  const usersRef = useRef([]);

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [it, sp] = await Promise.all([
          Api.items({ pageSize: 300 }),
          Api.suppliers({ pageSize: 200 }).catch(() => ({ data: [] }))
        ]);
        if (cancelled) return;
        itemsRef.current = it.data; suppliersRef.current = sp.data || sp;
        usersRef.current = await Api.users().catch(() => []);
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('qBody');
    const actions = document.getElementById('qActions');
    if (!body || !actions) return;
    const fns = { inspections: renderInspections, ncr: renderNcrs, capa: renderCapas, equipment: renderEquipment, plans: renderPlans, trace: renderTrace };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [ready, tab, reloadToken]);

  /* ================= INSPECTIONS ================= */
  const inspResultBadge = (r) => {
    const m = {
      pending: ['warn', t('resultPending')], accepted: ['ok', t('resultAccepted')],
      rejected: ['crit', t('resultRejected')], conditional: ['info', t('resultConditional')]
    };
    const [c, l] = m[r] || ['plain', r];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const inspTypeLabel = (ty) => ({ incoming: t('inspIncoming'), in_process: t('inspInProcess'), final: t('inspFinal') }[ty] || ty);

  async function renderInspections(body, actions) {
    let res;
    try { res = await Api.inspections({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('quality') ? `<button class="btn btn-primary btn-sm" id="inNew">${UI.icon(UI.ICONS.plus)}${t('newInspection')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'inspectionNo', label: t('inspectionNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.inspectionNo || r.inspection_no)}</button>
          <div class="sub-line">${esc(r.itemName || r.item_name || '')}</div>` },
      { key: 'type', label: t('inspType'), render: r => `<span class="badge plain">${inspTypeLabel(r.type)}</span>` },
      { key: 'lotNo', label: t('lotNo'), render: r => `<span class="mono">${esc(r.lotNo || r.lot_no || '—')}</span>` },
      { key: 'inspectedQty', label: t('inspectedQty'), num: true, render: r => num(r.inspectedQty ?? r.inspected_qty ?? 0) },
      { key: 'acceptedQty', label: t('acceptedQty'), num: true, render: r => num(r.acceptedQty ?? r.accepted_qty ?? 0) },
      { key: 'rejectedQty', label: t('rejectedQty'), num: true, render: r => {
          const v = r.rejectedQty ?? r.rejected_qty ?? 0;
          return v ? `<span style="color:var(--danger)">${num(v)}</span>` : '—';
        } },
      { key: 'result', label: t('inspResult'), render: r => inspResultBadge(r.result) },
      { key: 'createdAt', label: t('date'), render: r => ts(r.createdAt || r.created_at), cls: 'nowrap' },
      { key: 'act', label: t('actions'), render: r => r.result === 'pending' && can('quality')
          ? `<div class="row-actions"><button class="btn btn-primary btn-sm" data-res="${esc(r.id)}">${t('recordResult')}</button></div>` : '' }
    ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    document.getElementById('inNew')?.addEventListener('click', () => inspForm());
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openInspection(b.dataset.open));
    body.querySelectorAll('[data-res]').forEach(b => b.onclick = () => resultDialog(b.dataset.res));
  }

  function inspForm() {
    const items = itemsRef.current, suppliers = suppliersRef.current;
    modal({
      title: t('newInspection'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('inspType'), select('inType', [
            { v: 'incoming', l: t('inspIncoming') }, { v: 'in_process', l: t('inspInProcess') }, { v: 'final', l: t('inspFinal') }]))}
          ${field(t('itemName'), select('inItem', items.map(i => ({ v: i.id, l: i.name }))))}
        </div>
        ${field(t('lotNo'), select('inLot', [{ v: '', l: t('none') }]), UI.getLang() === 'tr' ? 'Ürün seçildiğinde partiler yüklenir.' : 'Lots load once you pick an item.')}
        <div class="field-row three">
          ${field(t('sampleSize'), input('inSample', { type: 'number', min: 0, value: 5 }))}
          ${field(t('inspectedQty'), input('inQty', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
          ${field(t('aql'), input('inAql', { value: '2.5' }))}
        </div>
        ${field(t('supplierName'), select('inSup', [{ v: '', l: t('none') }, ...suppliers.map(s => ({ v: s.id, l: s.name }))]))}
        ${field(t('notes'), textarea('inNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="inGo">${t('save')}</button>`,
      onOpen: (box) => {
        const loadLots = async () => {
          const sel = box.querySelector('#inLot');
          sel.innerHTML = `<option value="">${t('none')}</option>`;
          try {
            const r = await Api.lots({ itemId: val('inItem'), pageSize: 100 });
            (r.data || []).forEach(l => {
              const o = document.createElement('option');
              o.value = l.id;
              o.textContent = `${l.lotNo || '—'} · ${num(l.qty)} · ${l.status}`;
              sel.appendChild(o);
            });
          } catch {}
        };
        box.querySelector('#inItem').onchange = loadLots;
        loadLots();

        box.querySelector('#inGo').onclick = async () => {
          try {
            await Api.createInspection({
              type: val('inType'), itemId: val('inItem'),
              lotId: val('inLot') || undefined,
              supplierId: val('inSup') ? intVal('inSup') : undefined,
              sampleSize: intVal('inSample'), inspectedQty: numVal('inQty'),
              aql: val('inAql'), notes: val('inNote')
            });
            closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openInspection(id) {
    let i;
    try { i = await Api.inspection(id); } catch (e) { UI.err(e); return; }
    modal({
      title: i.inspectionNo || i.inspection_no, sub: `${i.itemName || ''} · ${i.lotNo || ''}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${inspResultBadge(i.result)}
          <span class="badge plain">${inspTypeLabel(i.type)}</span>
          ${i.aql ? `<span class="badge plain">AQL ${esc(i.aql)}</span>` : ''}
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('inspectedQty')}</div><div class="v">${num(i.inspectedQty ?? i.inspected_qty ?? 0)}</div></div>
          <div class="kv"><div class="k">${t('sampleSize')}</div><div class="v">${num(i.sampleSize ?? i.sample_size ?? 0)}</div></div>
          <div class="kv"><div class="k">${t('acceptedQty')}</div><div class="v">${num(i.acceptedQty ?? i.accepted_qty ?? 0)}</div></div>
          <div class="kv"><div class="k">${t('rejectedQty')}</div><div class="v">${num(i.rejectedQty ?? i.rejected_qty ?? 0)}</div></div>
        </div>
        ${i.inspectedByName || i.inspected_by_name ? `<div class="alert ok">${t('eSignature')}: ${esc(i.inspectedByName || i.inspected_by_name)} · ${ts(i.inspectedAt || i.inspected_at)}</div>` : ''}
        <div class="section-title">${t('characteristic')}</div>
        ${(i.lines || []).length ? table([
          { key: 'characteristic', label: t('characteristic') },
          { key: 'spec', label: UI.getLang() === 'tr' ? 'Şartname' : 'Spec', render: r => {
              if (r.specText || r.spec_text) return esc(r.specText || r.spec_text);
              const mn = r.specMin ?? r.spec_min, mx = r.specMax ?? r.spec_max;
              return `${mn ?? '—'} … ${mx ?? '—'}`;
            } },
          { key: 'measured', label: t('measured'), num: true, render: r => {
              const v = r.measuredValue ?? r.measured_value;
              return v == null ? '—' : num(v, 4);
            } },
          { key: 'result', label: t('inspResult'), render: r => {
              if (!r.result) return '—';
              return r.result === 'pass'
                ? `<span class="badge ok">${t('pass')}</span>`
                : `<span class="badge crit">${t('fail')}</span>`;
            } }
        ], i.lines) : `<div class="empty" style="padding:18px">${t('noData')}</div>`}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${i.result === 'pending' && can('quality') ? `<button class="btn btn-primary" id="inRes">${t('recordResult')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#inRes')?.addEventListener('click', () => { closeModal(); resultDialog(id); });
      }
    });
  }

  async function resultDialog(id) {
    let i;
    try { i = await Api.inspection(id); } catch (e) { UI.err(e); return; }
    const lines = i.lines || [];
    const inspected = i.inspectedQty ?? i.inspected_qty ?? 0;

    modal({
      title: t('recordResult'), sub: `${i.inspectionNo || i.inspection_no} · ${i.itemName || ''}`,
      size: 'xwide',
      body: `
        ${lines.length ? `<div class="section-title">${t('characteristic')}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>${t('characteristic')}</th><th>${UI.getLang() === 'tr' ? 'Şartname' : 'Spec'}</th>
            <th class="num">${t('measured')}</th><th>${t('inspResult')}</th></tr></thead>
          <tbody>${lines.map(l => {
            const mn = l.specMin ?? l.spec_min, mx = l.specMax ?? l.spec_max;
            const txt = l.specText || l.spec_text;
            return `<tr>
              <td>${esc(l.characteristic)}</td>
              <td>${txt ? esc(txt) : `${mn ?? '—'} … ${mx ?? '—'}`}</td>
              <td class="num">${txt
                ? '—'
                : `<input type="number" step="0.0001" class="ln-v" data-id="${l.id}" data-min="${mn ?? ''}" data-max="${mx ?? ''}" style="width:100px;text-align:right;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)">`}</td>
              <td><select class="ln-p" data-id="${l.id}" style="background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)">
                <option value="">—</option><option value="1">${t('pass')}</option><option value="0">${t('fail')}</option></select></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : ''}

        <div class="section-title">${t('inspResult')}</div>
        <div class="field-row three">
          ${field(t('acceptedQty'), input('rsAcc', { type: 'number', min: 0, step: '0.0001', value: inspected }))}
          ${field(t('rejectedQty'), input('rsRej', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
          ${field(t('inspResult'), select('rsRes', [
            { v: 'accepted', l: t('resultAccepted') }, { v: 'rejected', l: t('resultRejected') },
            { v: 'conditional', l: t('resultConditional') }]))}
        </div>
        ${field(t('notes'), textarea('rsNote'))}
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Sonuç "Kabul" dışında olursa sistem otomatik olarak bir uygunsuzluk (NCR) kaydı açar.'
          : 'Any result other than "Accepted" automatically opens a non-conformance (NCR) record.'}</div>
        <div class="alert warn">${t('eSignHint')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="rsGo">${t('recordResult')}</button>`,
      onOpen: (box) => {
        // Auto-judge pass/fail against the spec as the inspector types the measurement
        box.querySelectorAll('.ln-v').forEach(inp => inp.oninput = () => {
          const sel = box.querySelector(`.ln-p[data-id="${inp.dataset.id}"]`);
          if (inp.value === '') { sel.value = ''; return; }
          const v = Number(inp.value);
          const mn = inp.dataset.min === '' ? null : Number(inp.dataset.min);
          const mx = inp.dataset.max === '' ? null : Number(inp.dataset.max);
          const okv = (mn === null || v >= mn) && (mx === null || v <= mx);
          sel.value = okv ? '1' : '0';
        });

        // Keep the two quantities consistent with what was inspected
        const acc = box.querySelector('#rsAcc'), rej = box.querySelector('#rsRej'), res = box.querySelector('#rsRes');
        rej.oninput = () => {
          const r = Number(rej.value) || 0;
          acc.value = Math.max(0, inspected - r);
          res.value = r <= 0 ? 'accepted' : (r >= inspected ? 'rejected' : 'conditional');
        };

        box.querySelector('#rsGo').onclick = async () => {
          const lineResults = [];
          box.querySelectorAll('.ln-p').forEach(sel => {
            const vEl = box.querySelector(`.ln-v[data-id="${sel.dataset.id}"]`);
            if (sel.value === '' && (!vEl || vEl.value === '')) return;
            lineResults.push({
              id: Number(sel.dataset.id),
              measuredValue: vEl && vEl.value !== '' ? Number(vEl.value) : null,
              result: sel.value === '' ? 'na' : (sel.value === '1' ? 'pass' : 'fail')
            });
          });
          try {
            await Api.recordInspection(id, {
              result: val('rsRes'), acceptedQty: numVal('rsAcc'), rejectedQty: numVal('rsRej'),
              notes: val('rsNote'), lines: lineResults
            });
            closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= NCR ================= */
  const sevBadge = (s) => {
    const m = { minor: ['info', t('sevMinor')], major: ['warn', t('sevMajor')], critical: ['crit', t('sevCritical')] };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const dispLabel = (d) => ({
    use_as_is: t('dispUseAsIs'), rework: t('dispRework'),
    return_to_supplier: t('dispReturn'), scrap: t('dispScrap')
  }[d] || t('dispPending'));
  const ncrSourceLabel = (s) => ({
    incoming: t('inspIncoming'), in_process: t('inspInProcess'), final: t('inspFinal'),
    customer: UI.getLang() === 'tr' ? 'Müşteri şikayeti' : 'Customer complaint',
    internal: UI.getLang() === 'tr' ? 'İç denetim' : 'Internal'
  }[s] || s);

  async function renderNcrs(body, actions) {
    let res;
    try { res = await Api.ncrs({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('quality') ? `<button class="btn btn-primary btn-sm" id="ncNew">${UI.icon(UI.ICONS.plus)}${t('newNcr')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'ncrNo', label: t('ncrNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.ncrNo || r.ncr_no)}</button>
          <div class="sub-line">${esc(r.itemName || r.item_name || '')}</div>` },
      { key: 'source', label: t('source'), render: r => `<span class="badge plain">${esc(ncrSourceLabel(r.source))}</span>` },
      { key: 'severity', label: t('severity'), render: r => sevBadge(r.severity) },
      { key: 'qtyAffected', label: t('qtyAffected'), num: true, render: r => num(r.qtyAffected ?? r.qty_affected ?? 0) },
      { key: 'disposition', label: t('disposition'), render: r => esc(dispLabel(r.disposition)) },
      { key: 'status', label: t('status'), render: r => {
          const m = { open: ['crit', t('ncrOpen')], in_progress: ['warn', t('ncrInProgress')], closed: ['ok', t('ncrClosed')] };
          const [c, l] = m[r.status] || ['plain', r.status];
          return `<span class="badge ${c}">${esc(l)}</span>`;
        } },
      { key: 'openedAt', label: t('date'), render: r => ts(r.openedAt || r.opened_at), cls: 'nowrap' },
      { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
          ${r.status !== 'closed' && can('quality') ? `<button class="btn btn-ghost btn-sm" data-disp="${esc(r.id)}">${t('disposition')}</button>` : ''}
          ${r.status !== 'closed' && r.disposition && can('quality') ? `<button class="icon-btn ok" data-close2="${esc(r.id)}">${UI.icon(UI.ICONS.check)}</button>` : ''}
        </div>` }
    ], rows)}${res.totalPages ? pager(res, () => reload()) : ''}</div>`;

    document.getElementById('ncNew')?.addEventListener('click', () => ncrForm());
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openNcr(rows.find(x => x.id === b.dataset.open)));
    body.querySelectorAll('[data-disp]').forEach(b => b.onclick = () => dispositionDialog(b.dataset.disp));
    body.querySelectorAll('[data-close2]').forEach(b => b.onclick = () => UI.confirmDialog(
      UI.getLang() === 'tr' ? 'Uygunsuzluğu kapatmak istediğinize emin misiniz?' : 'Close this non-conformance?',
      async () => { try { await Api.closeNcr(b.dataset.close2); UI.ok(t('saved')); reload(); App.refreshBadges(); } catch (e) { UI.err(e); } }));
  }

  function ncrForm() {
    const items = itemsRef.current, suppliers = suppliersRef.current;
    modal({
      title: t('newNcr'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('source'), select('ncSrc', [
            { v: 'incoming', l: t('inspIncoming') }, { v: 'in_process', l: t('inspInProcess') },
            { v: 'final', l: t('inspFinal') }, { v: 'customer', l: UI.getLang() === 'tr' ? 'Müşteri şikayeti' : 'Customer complaint' },
            { v: 'internal', l: UI.getLang() === 'tr' ? 'İç denetim' : 'Internal' }]))}
          ${field(t('severity'), select('ncSev', [
            { v: 'minor', l: t('sevMinor') }, { v: 'major', l: t('sevMajor') }, { v: 'critical', l: t('sevCritical') }], 'major'))}
        </div>
        <div class="field-row">
          ${field(t('itemName'), select('ncItem', [{ v: '', l: t('none') }, ...items.map(i => ({ v: i.id, l: i.name }))]))}
          ${field(t('qtyAffected'), input('ncQty', { type: 'number', min: 0, step: '0.0001', value: 0 }))}
        </div>
        ${field(t('lotNo'), select('ncLot', [{ v: '', l: t('none') }]))}
        ${field(t('supplierName'), select('ncSup', [{ v: '', l: t('none') }, ...suppliers.map(s => ({ v: s.id, l: s.name }))]))}
        ${field(t('description'), textarea('ncDesc', { placeholder: UI.getLang() === 'tr' ? 'Uygunsuzluğun ne olduğunu açıkça yazın.' : 'Describe the non-conformance clearly.' }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="ncGo">${t('save')}</button>`,
      onOpen: (box) => {
        const loadLots = async () => {
          const sel = box.querySelector('#ncLot');
          sel.innerHTML = `<option value="">${t('none')}</option>`;
          if (!val('ncItem')) return;
          try {
            const r = await Api.lots({ itemId: val('ncItem'), pageSize: 100 });
            (r.data || []).forEach(l => {
              const o = document.createElement('option');
              o.value = l.id; o.textContent = `${l.lotNo || '—'} · ${num(l.qty)} · ${l.status}`;
              sel.appendChild(o);
            });
          } catch {}
        };
        box.querySelector('#ncItem').onchange = loadLots;

        box.querySelector('#ncGo').onclick = async () => {
          try {
            await Api.createNcr({
              source: val('ncSrc'), severity: val('ncSev'),
              itemId: val('ncItem') || undefined, lotId: val('ncLot') || undefined,
              supplierId: val('ncSup') ? intVal('ncSup') : undefined,
              qtyAffected: numVal('ncQty'), description: val('ncDesc')
            });
            closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function openNcr(n) {
    modal({
      title: n.ncrNo || n.ncr_no, sub: n.itemName || n.item_name || '', size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${sevBadge(n.severity)}<span class="badge plain">${esc(ncrSourceLabel(n.source))}</span>
          <span class="badge plain">${esc(dispLabel(n.disposition))}</span>
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('lotNo')}</div><div class="v mono">${esc(n.lotNo || n.lot_no || '—')}</div></div>
          <div class="kv"><div class="k">${t('qtyAffected')}</div><div class="v">${num(n.qtyAffected ?? n.qty_affected ?? 0)}</div></div>
          <div class="kv"><div class="k">${UI.getLang() === 'tr' ? 'Açılış' : 'Opened'}</div><div class="v">${ts(n.openedAt || n.opened_at)}</div></div>
          <div class="kv"><div class="k">${UI.getLang() === 'tr' ? 'Kapanış' : 'Closed'}</div><div class="v">${n.closedAt || n.closed_at ? ts(n.closedAt || n.closed_at) : '—'}</div></div>
        </div>
        <div class="section-title">${t('description')}</div>
        <div style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(n.description || '—')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${can('quality') ? `<button class="btn btn-ghost" id="ncCapa">${t('newCapa')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#ncCapa')?.addEventListener('click', () => { closeModal(); capaForm(n.id); });
      }
    });
  }

  function dispositionDialog(id) {
    modal({
      title: t('disposition'),
      body: `
        ${field(t('disposition'), select('dpD', [
          { v: 'use_as_is', l: t('dispUseAsIs') }, { v: 'rework', l: t('dispRework') },
          { v: 'return_to_supplier', l: t('dispReturn') }, { v: 'scrap', l: t('dispScrap') }]))}
        ${field(t('notes'), textarea('dpNote'))}
        <div class="alert warn">${UI.getLang() === 'tr'
          ? 'Hurda veya iade kararı, ilgili partinin stok durumunu da değiştirir.'
          : 'Scrap or return also changes the affected lot\'s stock status.'}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="dpGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#dpGo').onclick = async () => {
          try {
            await Api.setDisposition(id, { disposition: val('dpD'), notes: val('dpNote') });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= CAPA ================= */
  const capaStatusBadge = (s) => {
    const m = { open: ['crit', t('ncrOpen')], in_progress: ['warn', t('ncrInProgress')], verifying: ['info', t('capaVerifying')], closed: ['ok', t('ncrClosed')] };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  async function renderCapas(body, actions) {
    let res;
    try { res = await Api.capas({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('quality') ? `<button class="btn btn-primary btn-sm" id="cpNew">${UI.icon(UI.ICONS.plus)}${t('newCapa')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'capaNo', label: t('capaNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.capaNo || r.capa_no)}</button>` },
      { key: 'type', label: t('capaType'), render: r => `<span class="badge plain">${r.type === 'preventive' ? t('capaPreventive') : t('capaCorrective')}</span>` },
      { key: 'rootCause', label: t('rootCause'), render: r => {
          const v = r.rootCause || r.root_cause || '';
          return esc(v.length > 60 ? v.slice(0, 60) + '…' : v || '—');
        } },
      { key: 'dueDate', label: UI.getLang() === 'tr' ? 'Termin' : 'Due', render: r => {
          const d = r.dueDate || r.due_date;
          if (!d) return '—';
          const late = new Date(d) < new Date() && r.status !== 'closed';
          return late ? `<span class="badge crit">${dt(d)}</span>` : dt(d);
        } },
      { key: 'status', label: t('status'), render: r => capaStatusBadge(r.status) },
      { key: 'act', label: t('actions'), render: r => r.status !== 'closed' && can('quality')
          ? `<div class="row-actions"><button class="btn btn-ghost btn-sm" data-cl="${esc(r.id)}">${UI.getLang() === 'tr' ? 'Kapat' : 'Close'}</button></div>` : '' }
    ], rows)}</div>`;

    document.getElementById('cpNew')?.addEventListener('click', () => capaForm(null));
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCapa(rows.find(x => x.id === b.dataset.open)));
    body.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => closeCapaDialog(b.dataset.cl));
  }

  async function capaForm(ncrId) {
    const users = usersRef.current;
    let ncrs = [];
    try { ncrs = (await Api.ncrs({ pageSize: 100 })).data || []; } catch {}
    modal({
      title: t('newCapa'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('capaType'), select('cpType', [{ v: 'corrective', l: t('capaCorrective') }, { v: 'preventive', l: t('capaPreventive') }]))}
          ${field(t('ncrNo'), select('cpNcr', [{ v: '', l: t('none') }, ...ncrs.map(n => ({ v: n.id, l: n.ncrNo || n.ncr_no }))], ncrId || ''))}
        </div>
        ${field(t('rootCause'), textarea('cpRoot', { placeholder: UI.getLang() === 'tr' ? 'Neden oldu? (5 neden analizi)' : 'Why did it happen? (5 whys)' }))}
        ${field(t('actionPlan'), textarea('cpPlan', { placeholder: UI.getLang() === 'tr' ? 'Ne yapılacak, kim yapacak?' : 'What will be done, by whom?' }))}
        <div class="field-row">
          ${field(t('responsible'), select('cpResp', [{ v: '', l: t('none') }, ...users.map(u => ({ v: u.id, l: u.fullName || u.username }))]))}
          ${field(UI.getLang() === 'tr' ? 'Termin' : 'Due date', input('cpDue', { type: 'date' }))}
        </div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="cpGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#cpGo').onclick = async () => {
          try {
            await Api.createCapa({
              type: val('cpType'), ncrId: val('cpNcr') || undefined,
              rootCause: val('cpRoot'), actionPlan: val('cpPlan'),
              responsibleUserId: val('cpResp') ? intVal('cpResp') : undefined,
              dueDate: val('cpDue') || undefined
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function openCapa(c) {
    modal({
      title: c.capaNo || c.capa_no, size: 'wide',
      body: `
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('capaType')}</div><div class="v">${c.type === 'preventive' ? t('capaPreventive') : t('capaCorrective')}</div></div>
          <div class="kv"><div class="k">${t('status')}</div><div class="v">${capaStatusBadge(c.status)}</div></div>
        </div>
        <div class="section-title">${t('rootCause')}</div>
        <div style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(c.rootCause || c.root_cause || '—')}</div>
        <div class="section-title">${t('actionPlan')}</div>
        <div style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(c.actionPlan || c.action_plan || '—')}</div>
        ${c.effectivenessCheck || c.effectiveness_check ? `<div class="section-title">${t('effectivenessCheck')}</div>
          <div style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(c.effectivenessCheck || c.effectiveness_check)}</div>` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
    });
  }

  function closeCapaDialog(id) {
    modal({
      title: UI.getLang() === 'tr' ? 'DÖF Kapat' : 'Close CAPA',
      body: `${field(t('effectivenessCheck'), textarea('clEff', {
        placeholder: UI.getLang() === 'tr' ? 'Aksiyon işe yaradı mı? Kanıt nedir?' : 'Did the action work? What is the evidence?' }))}
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Etkinlik kontrolü yazılmadan DÖF kapatmak, denetimde eksiklik olarak görülür.'
          : 'Closing a CAPA without an effectiveness check is an audit finding.'}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="clGo">${UI.getLang() === 'tr' ? 'Kapat' : 'Close'}</button>`,
      onOpen: (box) => {
        box.querySelector('#clGo').onclick = async () => {
          try { await Api.closeCapa(id, { effectivenessCheck: val('clEff') }); closeModal(); UI.ok(t('saved')); reload(); }
          catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= EQUIPMENT / CALIBRATION ================= */
  async function renderEquipment(body, actions) {
    let res;
    try { res = await Api.equipment({ pageSize: 50 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('quality') ? `<button class="btn btn-primary btn-sm" id="eqNew">${UI.icon(UI.ICONS.plus)}${t('newEquipment')}</button>` : '';

    body.innerHTML = `<div class="card">${table([
      { key: 'code', label: t('equipmentCode'), render: r => `<span class="mono">${esc(r.code || '—')}</span>` },
      { key: 'name', label: t('equipmentName'), render: r => `${esc(r.name)}<div class="sub-line">${esc(r.serial_no || r.serialNo || '')}</div>` },
      { key: 'location', label: t('location'), render: r => esc(r.location || '—') },
      { key: 'last', label: t('lastCalibration'), render: r => dt(r.last_calibration_date || r.lastCalibrationDate) },
      { key: 'next', label: t('nextCalibration'), render: r => {
          const d = r.next_calibration_date || r.nextCalibrationDate;
          if (!d) return '—';
          const days = Math.floor((new Date(d) - Date.now()) / 86400000);
          if (days < 0) return `<span class="badge crit">${dt(d)} · ${UI.getLang() === 'tr' ? 'geçti' : 'overdue'}</span>`;
          if (days <= 30) return `<span class="badge warn">${dt(d)} · ${days}g</span>`;
          return dt(d);
        } },
      { key: 'act', label: t('actions'), render: r => can('quality')
          ? `<div class="row-actions"><button class="btn btn-ghost btn-sm" data-cal="${esc(r.id)}">${t('addCalibration')}</button></div>` : '' }
    ], rows)}</div>`;

    document.getElementById('eqNew')?.addEventListener('click', () => eqForm());
    body.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => calForm(b.dataset.cal, rows.find(x => String(x.id) === b.dataset.cal)));
  }

  function eqForm() {
    modal({
      title: t('newEquipment'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('equipmentCode'), input('eqCode'))}
          ${field(t('equipmentName'), input('eqName'))}
        </div>
        <div class="field-row">
          ${field(t('serialNo'), input('eqSerial'))}
          ${field(t('location'), input('eqLoc'))}
        </div>
        <div class="field-row">
          ${field(t('calibrationInterval'), input('eqInt', { type: 'number', min: 1, value: 365 }))}
          ${field(t('lastCalibration'), input('eqLast', { type: 'date' }))}
        </div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="eqGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#eqGo').onclick = async () => {
          try {
            await Api.createEquipment({
              code: val('eqCode'), name: val('eqName'), serialNo: val('eqSerial'), location: val('eqLoc'),
              calibrationIntervalDays: intVal('eqInt'), lastCalibrationDate: val('eqLast') || undefined
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function calForm(id, eq) {
    modal({
      title: t('addCalibration'), sub: eq ? `${eq.code || ''} ${eq.name || ''}` : '',
      body: `
        <div class="field-row">
          ${field(t('lastCalibration'), input('caDate', { type: 'date', value: UI.today() }))}
          ${field(t('calibResult'), select('caRes', [
            { v: 'pass', l: t('calibPass') }, { v: 'fail', l: t('calibFail') }, { v: 'adjusted', l: t('calibAdjusted') }]))}
        </div>
        <div class="field-row">
          ${field(t('certificateNo'), input('caCert'))}
          ${field(t('performedBy'), input('caBy'))}
        </div>
        ${field(t('notes'), textarea('caNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="caGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#caGo').onclick = async () => {
          try {
            await Api.addCalibration(id, {
              calibrationDate: val('caDate'), result: val('caRes'),
              certificateNo: val('caCert'), performedBy: val('caBy'), notes: val('caNote')
            });
            closeModal(); UI.ok(t('saved')); reload(); App.refreshBadges();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= INSPECTION PLANS ================= */
  async function renderPlans(body, actions) {
    let res;
    try { res = await Api.inspectionPlans({ pageSize: 100 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = can('quality') ? `<button class="btn btn-primary btn-sm" id="plNew">${UI.icon(UI.ICONS.plus)}${t('newPlan')}</button>` : '';

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Muayene planı, o ürün için muayene açıldığında ölçülecek özellikleri otomatik doldurur.'
        : 'An inspection plan pre-fills the characteristics to measure when an inspection is opened for that item.'}</div>
      <div class="card">${table([
        { key: 'itemName', label: t('planFor'), render: r => esc(r.itemName || r.item_name || '—') },
        { key: 'type', label: t('inspType'), render: r => `<span class="badge plain">${inspTypeLabel(r.type)}</span>` },
        { key: 'characteristic', label: t('characteristic'), render: r => esc(r.characteristic) },
        { key: 'spec', label: UI.getLang() === 'tr' ? 'Şartname' : 'Spec', render: r => {
            const txt = r.specText || r.spec_text;
            if (txt) return esc(txt);
            const mn = r.specMin ?? r.spec_min, mx = r.specMax ?? r.spec_max;
            return `${mn ?? '—'} … ${mx ?? '—'}`;
          } },
        { key: 'aql', label: t('aql'), render: r => esc(r.aql || '—') },
        { key: 'act', label: t('actions'), render: r => can('quality')
            ? `<div class="row-actions"><button class="icon-btn danger" data-del="${esc(r.id)}">${UI.icon(UI.ICONS.trash)}</button></div>` : '' }
      ], rows)}</div>`;

    document.getElementById('plNew')?.addEventListener('click', () => planForm());
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deletePlan(b.dataset.del); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
    }, { danger: true }));
  }

  function planForm() {
    const items = itemsRef.current;
    modal({
      title: t('newPlan'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('planFor'), select('plItem', items.map(i => ({ v: i.id, l: i.name }))))}
          ${field(t('inspType'), select('plType', [
            { v: 'incoming', l: t('inspIncoming') }, { v: 'in_process', l: t('inspInProcess') }, { v: 'final', l: t('inspFinal') }]))}
        </div>
        ${field(t('characteristic'), input('plChar'))}
        <div class="field-row three">
          ${field(t('specMin'), input('plMin', { type: 'number', step: '0.0001' }))}
          ${field(t('specMax'), input('plMax', { type: 'number', step: '0.0001' }))}
          ${field(t('aql'), input('plAql', { value: '2.5' }))}
        </div>
        ${field(t('specText'), input('plText'), UI.getLang() === 'tr'
          ? 'Sayısal limit yoksa buraya yazın (ör. "Çizik olmamalı").'
          : 'Use this when there is no numeric limit (e.g. "No scratches").')}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="plGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#plGo').onclick = async () => {
          try {
            await Api.createPlan({
              itemId: val('plItem'), type: val('plType'), characteristic: val('plChar'),
              specMin: val('plMin') !== '' ? numVal('plMin') : undefined,
              specMax: val('plMax') !== '' ? numVal('plMax') : undefined,
              specText: val('plText') || undefined, aql: val('plAql')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= TRACEABILITY ================= */
  function renderTrace(body, actions) {
    const items = itemsRef.current;
    actions.innerHTML = '';
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Bir parti seçin: içine ne girdiğini, nereye gittiğini ve geri çağırma gerekirse hangi müşterilerin etkileneceğini gösterir.'
          : 'Pick a lot to see what went into it, where it went, and which customers a recall would touch.'}</div>
        <div class="field-row">
          ${field(t('itemName'), select('trItem', [{ v: '', l: t('none') }, ...items.map(i => ({ v: i.id, l: i.name }))]))}
          ${field(t('lotNo'), select('trLot', [{ v: '', l: t('none') }]))}
        </div>
        <button class="btn btn-primary" id="trGo" disabled>${UI.icon(UI.ICONS.eye)}${t('traceability')}</button>
      </div></div>`;

    const lotSel = document.getElementById('trLot');
    const goBtn = document.getElementById('trGo');
    document.getElementById('trItem').onchange = async (e) => {
      lotSel.innerHTML = `<option value="">${t('none')}</option>`;
      goBtn.disabled = true;
      if (!e.target.value) return;
      try {
        const r = await Api.lots({ itemId: e.target.value, pageSize: 200 });
        (r.data || []).forEach(l => {
          const o = document.createElement('option');
          o.value = l.id;
          o.textContent = `${l.lotNo || (UI.getLang() === 'tr' ? 'partisiz' : 'no lot')} · ${num(l.qty)} ${l.unit || ''} · ${l.status}`;
          lotSel.appendChild(o);
        });
      } catch (err) { UI.err(err); }
    };
    lotSel.onchange = () => { goBtn.disabled = !lotSel.value; };
    goBtn.onclick = () => { if (lotSel.value) ViewLots.traceDialog(lotSel.value); };
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('qualTitle')}</h2><div class="sub">${t('qualSub')}</div></div>
      <div class="topbar-actions" id="qActions"></div>
    </div>
    ${UI.tabs([
      { k: 'inspections', l: t('tabInspections') }, { k: 'ncr', l: t('tabNcr') },
      { k: 'capa', l: t('tabCapa') }, { k: 'equipment', l: t('tabEquipment') },
      { k: 'plans', l: t('tabPlans') }, { k: 'trace', l: t('tabTrace') }
    ], tab, k => setTab(k))}
    <div id="qBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
