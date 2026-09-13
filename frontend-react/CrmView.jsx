// @ts-nocheck
/**
 * CRM / Satış Hunisi — sipariş oluşmadan ÖNCEKİ süreç. Sales.jsx'teki
 * yardımcı fonksiyon çağırma deseninin (UI.table/modal/tabs, Api.xxx)
 * AYNISI. Sürükle-bırak kanban YOK — sütunlar arası geçiş "İlerlet"/
 * "Kaybedildi" butonlarıyla, kazanılan fırsat "Dönüştür" butonuyla gerçek
 * bir satış siparişine dönüşür (server/services/sales-orders.js — sales.js
 * ile aynı kod yolu).
 */
import { useEffect, useState, useRef } from 'react';

const STAGE_ORDER = ['new', 'contacted', 'quoted', 'won'];

export default function CrmView() {
  const { t, esc, num, money, dt, table, loading, modal, closeModal,
          field, input, select, textarea, val, numVal, intVal, can } = UI;

  const [tab, setTab] = useState('pipeline');
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const itemsRef = useRef([]);
  const customersRef = useRef([]);

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [it, cs] = await Promise.all([Api.items({ pageSize: 300 }), Api.customers({ pageSize: 200 })]);
        if (cancelled) return;
        itemsRef.current = it.data; customersRef.current = cs.data || cs;
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('crmBody');
    const actions = document.getElementById('crmActions');
    if (!body || !actions) return;
    const fns = { pipeline: renderPipeline, list: renderList, visits: renderVisits };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [ready, tab, reloadToken]);

  const stageBadge = (s) => {
    const m = {
      new: ['info', t('stageNew')], contacted: ['warn', t('stageContacted')],
      quoted: ['purple', t('stageQuoted')], won: ['ok', t('stageWon')], lost: ['crit', t('stageLost')]
    };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  const sourceLabel = (s) => t('source' + s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(''));

  /* ================= HUNİ / PIPELINE ================= */
  async function renderPipeline(body, actions) {
    let p;
    try { p = await Api.pipeline(); } catch (e) { UI.err(e); return; }
    actions.innerHTML = can('write') ? `<button class="btn btn-primary btn-sm" id="oppNew">${UI.icon(UI.ICONS.plus)}${t('newOpportunity')}</button>` : '';

    body.innerHTML = `
      <div class="pipeline-board" style="display:grid;grid-template-columns:repeat(${STAGE_ORDER.length},1fr);gap:12px;align-items:start">
        ${STAGE_ORDER.map(stage => {
          const col = p.stages.find(s => s.stage === stage) || { totalValue: 0, opportunities: [] };
          return `<div class="card" style="min-height:120px">
            <div class="card-body" style="padding:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                ${stageBadge(stage)}
                <span class="sub-line">₺${money(col.totalValue)}</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${col.opportunities.length ? col.opportunities.map(o => `
                  <div class="card card-tap" data-open="${esc(o.id)}" style="padding:10px;cursor:pointer">
                    <div style="font-weight:600">${esc(o.customerName)}</div>
                    <div class="sub-line mono">${esc(o.oppNo)}</div>
                    <div style="display:flex;justify-content:space-between;margin-top:6px">
                      <span>₺${money(o.estimatedValue)}</span><span class="sub-line">%${num(o.probability)}</span>
                    </div>
                  </div>`).join('') : `<div class="empty" style="padding:8px 0">${t('noOpportunities')}</div>`}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    document.getElementById('oppNew')?.addEventListener('click', () => opportunityForm());
    body.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openOpportunity(el.dataset.open));
  }

  /* ================= FIRSATLAR / LIST ================= */
  async function renderList(body, actions) {
    const stageFilter = actions.dataset.stage || '';
    let res;
    try { res = await Api.opportunities({ pageSize: 100, stage: stageFilter }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    actions.innerHTML = `
      ${select('crmStageFilter', [{ v: '', l: t('all') }, ...STAGE_ORDER.concat('lost').map(s => ({ v: s, l: t('stage' + s[0].toUpperCase() + s.slice(1)) }))], stageFilter)}
      ${can('write') ? `<button class="btn btn-primary btn-sm" id="oppNew2">${UI.icon(UI.ICONS.plus)}${t('newOpportunity')}</button>` : ''}`;
    actions.querySelector('#crmStageFilter').onchange = (e) => { actions.dataset.stage = e.target.value; renderList(body, actions); };
    document.getElementById('oppNew2')?.addEventListener('click', () => opportunityForm());

    body.innerHTML = `<div class="card">${table([
      { key: 'oppNo', label: t('oppNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.oppNo)}</button>
          <div class="sub-line">${esc(r.customerName)}</div>` },
      { key: 'source', label: t('oppSource'), render: r => esc(sourceLabel(r.source)) },
      { key: 'estimatedValue', label: t('estimatedValue'), num: true, render: r => '₺' + money(r.estimatedValue) },
      { key: 'probability', label: t('probability'), num: true, render: r => '%' + num(r.probability) },
      { key: 'estimatedCloseDate', label: t('estimatedCloseDate'), render: r => r.estimatedCloseDate ? dt(r.estimatedCloseDate) : '—' },
      { key: 'stage', label: t('status'), render: r => stageBadge(r.stage) }
    ], rows)}</div>`;

    body.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openOpportunity(el.dataset.open));
  }

  /* ================= ZİYARETLER ================= */
  async function renderVisits(body, actions) {
    const customerFilter = actions.dataset.customer || '';
    let res;
    try { res = await Api.visits({ pageSize: 100, customerId: customerFilter || undefined }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;
    const customers = customersRef.current;
    actions.innerHTML = `
      ${select('visitCusFilter', [{ v: '', l: t('all') }, ...customers.map(c => ({ v: c.id, l: c.name }))], customerFilter)}
      ${can('write') ? `<button class="btn btn-primary btn-sm" id="visitNew">${UI.icon(UI.ICONS.plus)}${t('newVisit')}</button>` : ''}`;
    actions.querySelector('#visitCusFilter').onchange = (e) => { actions.dataset.customer = e.target.value; renderVisits(body, actions); };
    document.getElementById('visitNew')?.addEventListener('click', () => visitForm());

    body.innerHTML = `<div class="card">${rows.length ? table([
      { key: 'visitDate', label: t('visitDate'), render: r => dt(r.visitDate) },
      { key: 'customerName', label: t('customerName'), render: r => `${esc(r.customerName || '')}${r.oppNo ? `<div class="sub-line mono">${esc(r.oppNo)}</div>` : ''}` },
      { key: 'purpose', label: t('visitPurpose'), render: r => esc(r.purpose || '—') },
      { key: 'visitedUsername', label: t('visitedBy'), render: r => esc(r.visitedUsername || '—') },
      { key: 'location', label: t('visitLocation'), render: r => r.latitude != null
          ? `<span class="badge ok">${UI.icon(UI.ICONS.check)}</span>` : `<span class="sub-line">${t('visitLocationNone')}</span>` },
      { key: 'followUpDate', label: t('followUpDate'), render: r => r.followUpDate ? dt(r.followUpDate) : '—' },
      { key: 'actions', label: '', render: r => can('approve')
          ? `<button class="btn btn-ghost btn-sm" data-del="${esc(r.id)}">${UI.icon(UI.ICONS.x)}</button>` : '' }
    ], rows) : `<div class="empty" style="padding:36px">${t('noVisits')}</div>`}</div>`;

    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      UI.confirmDialog(t('confirmDeleteVisit'), async () => {
        try { await Api.deleteVisit(b.dataset.del); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
      });
    });
  }

  function visitForm() {
    const customers = customersRef.current;
    let coords = null;
    modal({
      title: t('newVisit'),
      body: `
        <div class="field-row">
          ${field(t('customerName'), select('visitCus', customers.map(c => ({ v: c.id, l: c.name }))))}
          ${field(t('visitDate'), input('visitDate', { type: 'date', value: UI.today() }))}
        </div>
        ${field(t('visitPurpose'), input('visitPurpose'))}
        ${field(t('visitNotes'), textarea('visitNotes'))}
        <div class="field-row">
          ${field(t('followUpDate'), input('visitFollowUp', { type: 'date' }))}
          <div class="field">
            <label>${t('visitLocation')}</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-ghost btn-sm" id="visitGps" type="button">${t('visitLocationCapture')}</button>
              <span class="sub-line" id="visitGpsStatus">${t('visitLocationNone')}</span>
            </div>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="visitGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#visitGps').onclick = () => {
          if (!navigator.geolocation) { box.querySelector('#visitGpsStatus').textContent = t('visitLocationDenied'); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
              box.querySelector('#visitGpsStatus').textContent = t('visitLocationCaptured');
            },
            () => { box.querySelector('#visitGpsStatus').textContent = t('visitLocationDenied'); }
          );
        };
        box.querySelector('#visitGo').onclick = async () => {
          try {
            await Api.createVisit({
              customerId: intVal('visitCus'), visitDate: val('visitDate'),
              purpose: val('visitPurpose') || undefined, notes: val('visitNotes') || undefined,
              followUpDate: val('visitFollowUp') || undefined,
              ...(coords || {})
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= FORM / OLUŞTURMA ================= */
  function opportunityForm() {
    const items = itemsRef.current, customers = customersRef.current;
    let lines = [];
    modal({
      title: t('newOpportunity'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('customerName'), select('oppCus', [{ v: '', l: t('none') + ' (' + (UI.getLang() === 'tr' ? 'yeni aday' : 'new lead') + ')' }, ...customers.map(c => ({ v: c.id, l: c.name }))]))}
          ${field(t('oppSource'), select('oppSrc', ['referans', 'web', 'fuar', 'soguk_arama', 'diger'].map(s => ({ v: s, l: sourceLabel(s) })), 'diger'))}
        </div>
        <div class="field-row" id="oppNewCusRow">
          ${field(UI.getLang() === 'tr' ? 'Aday adı' : 'Lead name', input('oppNewCus'))}
        </div>
        <div class="field-row three">
          ${field(t('estimatedValue'), input('oppVal', { type: 'number', min: 0, value: 0 }))}
          ${field(t('probability') + ' %', input('oppProb', { type: 'number', min: 0, max: 100, value: 20 }))}
          ${field(t('estimatedCloseDate'), input('oppClose', { type: 'date' }))}
        </div>
        ${field(t('notes'), textarea('oppNote'))}
        <div class="section-title">${UI.getLang() === 'tr' ? 'İlgilenilen ürünler (isteğe bağlı)' : 'Products of interest (optional)'}</div>
        <div class="dyn-list" id="oppLines"></div>
        <button class="btn btn-ghost btn-sm" id="oppAddLine" type="button">+ ${t('add')}</button>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="oppGo">${t('save')}</button>`,
      onOpen: (box) => {
        const toggleCusRow = () => { box.querySelector('#oppNewCusRow').style.display = val('oppCus') ? 'none' : ''; };
        box.querySelector('#oppCus').onchange = toggleCusRow;
        toggleCusRow();

        const draw = () => {
          box.querySelector('#oppLines').innerHTML = lines.map((l, i) => `
            <div class="dyn-row">
              <select data-i="${i}" data-f="itemId" style="flex:1;min-width:150px">
                ${items.map(o => `<option value="${esc(o.id)}" ${o.id === l.itemId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
              </select>
              <input type="number" min="0.0001" step="0.0001" value="${l.qty}" data-i="${i}" data-f="qty" style="width:84px" title="${t('qty')}">
              <input type="number" min="0" step="0.01" value="${l.unitPrice}" data-i="${i}" data-f="unitPrice" style="width:96px" title="${t('price')}">
              <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
            </div>`).join('');
          box.querySelectorAll('#oppLines select,#oppLines input').forEach(inp => inp.oninput = () => {
            lines[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'itemId' ? inp.value : Number(inp.value);
          });
          box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
        };
        box.querySelector('#oppAddLine').onclick = () => { lines.push({ itemId: items[0]?.id || '', qty: 1, unitPrice: 0 }); draw(); };
        draw();

        box.querySelector('#oppGo').onclick = async () => {
          const cusId = val('oppCus');
          const cusName = cusId ? customers.find(c => String(c.id) === String(cusId))?.name : val('oppNewCus');
          if (!cusName) return UI.toast(UI.getLang() === 'tr' ? 'Müşteri veya aday adı gerekli.' : 'Customer or lead name is required.', 'err');
          try {
            await Api.createOpportunity({
              customerId: cusId ? intVal('oppCus') : undefined, customerName: cusName,
              source: val('oppSrc'), estimatedValue: numVal('oppVal'), probability: intVal('oppProb'),
              estimatedCloseDate: val('oppClose') || undefined, notes: val('oppNote'),
              lines: lines.filter(l => l.itemId && l.qty > 0).map(l => ({
                ...l, itemName: items.find(x => x.id === l.itemId)?.name || l.itemId
              }))
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= DETAY ================= */
  async function openOpportunity(id) {
    let o;
    try { o = await Api.opportunity(id); } catch (e) { UI.err(e); return; }
    const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(o.stage) + 1];
    const isClosed = o.stage === 'won' || o.stage === 'lost';

    modal({
      title: o.oppNo, sub: `${o.customerName} · ${sourceLabel(o.source)}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${stageBadge(o.stage)}
          ${o.convertedSalesOrder ? `<span class="badge ok">${t('convertedToSO')}: ${esc(o.convertedSalesOrder.so_no)}</span>` : ''}</div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('estimatedValue')}</div><div class="v">₺${money(o.estimatedValue)}</div></div>
          <div class="kv"><div class="k">${t('probability')}</div><div class="v">%${num(o.probability)}</div></div>
          <div class="kv"><div class="k">${t('estimatedCloseDate')}</div><div class="v">${o.estimatedCloseDate ? dt(o.estimatedCloseDate) : '—'}</div></div>
          <div class="kv"><div class="k">${t('assignedTo')}</div><div class="v">${o.assignedTo ?? '—'}</div></div>
        </div>
        ${o.notes ? `<div class="section-title">${t('notes')}</div><div class="alert info">${esc(o.notes)}</div>` : ''}
        ${o.lostReason ? `<div class="alert crit">${esc(o.lostReason)}</div>` : ''}
        ${o.lines.length ? `<div class="section-title">${UI.getLang() === 'tr' ? 'İlgilenilen ürünler' : 'Products of interest'}</div>
          ${table([
            { key: 'itemName', label: t('itemName') },
            { key: 'qty', label: t('qty'), num: true, render: r => num(r.qty) },
            { key: 'unitPrice', label: t('price'), num: true, render: r => num(r.unitPrice, 2) }
          ], o.lines)}` : ''}
        <div id="oppConvertRow"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${!isClosed && can('write') ? `<button class="btn btn-danger" id="oppLost">${t('markLost')}</button>` : ''}
               ${!isClosed && nextStage && can('write') ? `<button class="btn btn-primary" id="oppAdvance">${t('advanceStage')}</button>` : ''}
               ${o.stage === 'won' && !o.convertedSoId && can('write') ? `<button class="btn btn-primary" id="oppConvert">${t('convertToSO')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#oppAdvance')?.addEventListener('click', async () => {
          try { await Api.setOpportunityStage(o.id, { stage: nextStage }); closeModal(); UI.ok(t('saved')); reload(); }
          catch (e) { UI.err(e); }
        });
        box.querySelector('#oppLost')?.addEventListener('click', () => {
          modal({
            title: t('markLost'),
            body: field(t('lostReason'), textarea('oppLostReason')),
            footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                     <button class="btn btn-danger" id="oppLostGo">${t('confirm')}</button>`,
            onOpen: (box2) => {
              box2.querySelector('#oppLostGo').onclick = async () => {
                const reason = val('oppLostReason');
                if (!reason) return UI.toast(t('lostReason'), 'err');
                try { await Api.setOpportunityStage(o.id, { stage: 'lost', lostReason: reason }); closeModal(); UI.ok(t('saved')); reload(); }
                catch (e) { UI.err(e); }
              };
            }
          });
        });
        box.querySelector('#oppConvert')?.addEventListener('click', () => {
          if (o.customerId) {
            UI.confirmDialog(t('convertToSO') + '?', async () => {
              try { await Api.convertOpportunity(o.id); closeModal(); UI.ok(t('saved')); reload(); } catch (e) { UI.err(e); }
            });
            return;
          }
          const customers = customersRef.current;
          box.querySelector('#oppConvertRow').innerHTML = `
            <div class="section-title">${t('oppConvertNeedsCustomer')}</div>
            <div class="dyn-row">
              ${select('oppConvertCus', customers.map(c => ({ v: c.id, l: c.name })))}
              <button class="btn btn-primary btn-sm" id="oppConvertGo">${t('convertToSO')}</button>
            </div>`;
          box.querySelector('#oppConvertGo').onclick = async () => {
            try { await Api.convertOpportunity(o.id, { customerId: intVal('oppConvertCus') }); closeModal(); UI.ok(t('saved')); reload(); }
            catch (e) { UI.err(e); }
          };
        });
      }
    });
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('crmTitle')}</h2><div class="sub">${t('crmSub')}</div></div>
      <div class="topbar-actions" id="crmActions"></div>
    </div>
    ${UI.tabs([{ k: 'pipeline', l: t('tabPipeline') }, { k: 'list', l: t('tabOpportunities') }, { k: 'visits', l: t('tabVisits') }], tab, k => setTab(k))}
    <div id="crmBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
