// @ts-nocheck
/**
 * Müşteri Destek — CrmView.jsx'teki AYNI desen (UI.table/modal, Api.xxx).
 * Kalite modülündeki NCR akışından KASITLI olarak ayrı bir modül (bkz.
 * server/routes/support.js dosya başı yorumu); yalnızca gerçek bir ürün
 * kusuru şikayeti geldiğinde "Uygunsuzluğa Dönüştür" ile tek adımda bir
 * NCR'ye bağlanır.
 */
import { useEffect, useState, useRef } from 'react';

export default function SupportView() {
  const { t, esc, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, val, intVal, can } = UI;

  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);

  const customersRef = useRef([]);

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cs = await Api.customers({ pageSize: 200 });
        if (cancelled) return;
        customersRef.current = cs.data || cs;
      } catch (e) { UI.err(e); }
      if (cancelled) return;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const body = document.getElementById('supBody');
    const actions = document.getElementById('supActions');
    if (!body || !actions) return;
    (async () => {
      try { await renderList(body, actions); }
      catch (e) { UI.errorState(body, e, reload); }
    })();
  }, [ready, reloadToken]);

  const catLabel = (c) => t('cat' + c[0].toUpperCase() + c.slice(1));
  const prioBadge = (p) => {
    const m = { low: ['plain', t('prioLow')], normal: ['info', t('prioNormal')], high: ['warn', t('prioHigh')], urgent: ['crit', t('prioUrgent')] };
    const [cl, l] = m[p] || ['plain', p];
    return `<span class="badge ${cl}">${esc(l)}</span>`;
  };
  const statusBadge = (s) => {
    const m = {
      open: ['info', t('ticketOpen')], in_progress: ['warn', t('ticketInProgress')],
      waiting_customer: ['warn', t('ticketWaitingCustomer')], resolved: ['ok', t('ticketResolved')], closed: ['plain', t('ticketClosed')]
    };
    const [cl, l] = m[s] || ['plain', s];
    return `<span class="badge ${cl}">${esc(l)}</span>`;
  };

  /* ================= LİSTE ================= */
  async function renderList(body, actions) {
    const statusFilter = actions.dataset.status ?? '';
    const catFilter = actions.dataset.cat ?? '';
    let res;
    const page = Number(actions.dataset.page) || 1;
    try { res = await Api.tickets({ page, pageSize: 50, status: statusFilter || undefined, category: catFilter || undefined }); }
    catch (e) { UI.errorState(typeof body !== 'undefined' ? body : null, e, typeof reload === 'function' ? reload : null); return; }
    const rows = res.data || res;

    actions.innerHTML = `
      ${select('supStatusFilter', [{ v: '', l: t('all') }, ...['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'].map(s => ({ v: s, l: statusBadge(s).replace(/<[^>]+>/g, '') }))], statusFilter)}
      ${select('supCatFilter', [{ v: '', l: t('all') }, ...['complaint', 'question', 'return', 'warranty', 'other'].map(c => ({ v: c, l: catLabel(c) }))], catFilter)}
      ${can('write') ? `<button class="btn btn-primary btn-sm" id="supNew">${UI.icon(UI.ICONS.plus)}${t('newTicket')}</button>` : ''}`;
    // A new filter starts from the first page (T08).
    actions.querySelector('#supStatusFilter').onchange = (e) => { actions.dataset.status = e.target.value; actions.dataset.page = '1'; renderList(body, actions); };
    actions.querySelector('#supCatFilter').onchange = (e) => { actions.dataset.cat = e.target.value; actions.dataset.page = '1'; renderList(body, actions); };
    document.getElementById('supNew')?.addEventListener('click', () => ticketForm());

    body.innerHTML = `<div class="card">${rows.length ? table([
      { key: 'ticketNo', label: t('ticketNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.ticketNo)}</button>
          <div class="sub-line">${esc(r.customerName)}</div>` },
      { key: 'subject', label: t('ticketSubject'), render: r => esc(r.subject) },
      { key: 'category', label: t('ticketCategory'), render: r => esc(catLabel(r.category)) },
      { key: 'priority', label: t('ticketPriority'), render: r => prioBadge(r.priority) },
      { key: 'status', label: t('ticketStatus'), render: r => statusBadge(r.status) },
      { key: 'assignedUsername', label: t('assignedTo'), render: r => esc(r.assignedUsername || '—') },
      { key: 'createdAt', label: UI.getLang() === 'tr' ? 'Oluşturulma' : 'Created', render: r => ts(r.createdAt) }
    ], rows) : `<div class="empty" style="padding:36px">${t('noTickets')}</div>`}${pager(res, p => { actions.dataset.page = String(p); renderList(body, actions); })}</div>`;

    body.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openTicket(el.dataset.open));
  }

  /* ================= FORM / OLUŞTURMA ================= */
  function ticketForm() {
    const customers = customersRef.current;
    modal({
      title: t('newTicket'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('customerName'), select('supCus', [{ v: '', l: t('none') }, ...customers.map(c => ({ v: c.id, l: c.name }))], undefined, { search: 'customers' }))}
          ${field(t('ticketCategory'), select('supCat', ['complaint', 'question', 'return', 'warranty', 'other'].map(c => ({ v: c, l: catLabel(c) }))))}
        </div>
        <div class="field-row" id="supNewCusRow">
          ${field(UI.getLang() === 'tr' ? 'Müşteri adı (kayıtlı değilse)' : 'Customer name (if not registered)', input('supNewCus'))}
        </div>
        <div class="field-row">
          ${field(t('ticketSubject'), input('supSubject'))}
          ${field(t('ticketPriority'), select('supPrio', ['low', 'normal', 'high', 'urgent'].map(p => ({ v: p, l: t('prio' + p[0].toUpperCase() + p.slice(1)) })), 'normal'))}
        </div>
        ${field(t('ticketDescription'), textarea('supDesc'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="supGo">${t('save')}</button>`,
      onOpen: (box) => {
        const toggleCusRow = () => { box.querySelector('#supNewCusRow').style.display = val('supCus') ? 'none' : ''; };
        box.querySelector('#supCus').onchange = toggleCusRow;
        toggleCusRow();

        box.querySelector('#supGo').onclick = async () => {
          const cusId = val('supCus');
          const cusName = cusId ? document.querySelector('#supCus').selectedOptions[0]?.textContent : val('supNewCus');
          const subject = val('supSubject');
          if (!cusName) return UI.toast(UI.getLang() === 'tr' ? 'Müşteri adı gerekli.' : 'Customer name is required.', 'err');
          if (!subject) return UI.toast(t('ticketSubject'), 'err');
          try {
            await Api.createTicket({
              customerId: cusId ? intVal('supCus') : undefined, customerName: cusName,
              subject, description: val('supDesc') || undefined, category: val('supCat'), priority: val('supPrio')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= DETAY ================= */
  async function openTicket(id) {
    let tk;
    try { tk = await Api.ticket(id); } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
    const isClosed = tk.status === 'closed';

    modal({
      title: tk.ticketNo, sub: `${tk.customerName} · ${catLabel(tk.category)}`, size: 'wide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${statusBadge(tk.status)}${prioBadge(tk.priority)}
          ${tk.resultingNcrId ? `<span class="badge ok">${t('convertedToNcr')}</span>` : ''}</div>
        <div class="kv-grid">
          <div class="kv"><div class="k">${t('ticketSubject')}</div><div class="v">${esc(tk.subject)}</div></div>
          <div class="kv"><div class="k">${t('assignedTo')}</div><div class="v">${esc(tk.assignedUsername || '—')}</div></div>
        </div>
        ${tk.description ? `<div class="section-title">${t('ticketDescription')}</div><div class="alert info">${esc(tk.description)}</div>` : ''}
        ${tk.resolution ? `<div class="section-title">${t('ticketResolution')}</div><div class="alert ok">${esc(tk.resolution)}</div>` : ''}

        <div class="section-title">${t('comments')}</div>
        <div id="supComments">${tk.comments.length ? tk.comments.map(c => `
          <div class="card" style="margin-bottom:6px"><div class="card-body" style="padding:8px 12px">
            <div class="sub-line">${esc(c.username || '—')} · ${ts(c.ts)}</div>
            <div>${esc(c.comment)}</div>
          </div></div>`).join('') : `<div class="sub-line">${t('noComments')}</div>`}</div>
        ${!isClosed && can('write') ? `
          <div class="dyn-row" style="margin-top:8px">
            ${input('supNewComment', { placeholder: t('addComment') })}
            <button class="btn btn-ghost btn-sm" id="supAddComment">${t('addComment')}</button>
          </div>` : ''}

        ${tk.category === 'complaint' && !tk.resultingNcrId ? `<div class="alert info" style="margin-top:12px">${t('ticketConvertHint')}</div>` : ''}
        <div id="supResolveRow"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${!isClosed && can('write') ? `<button class="btn btn-primary" id="supResolve">${t('markResolved')}</button>` : ''}
               ${!isClosed && tk.status === 'resolved' && can('write') ? `<button class="btn btn-ghost" id="supCloseTicket">${t('closeTicket')}</button>` : ''}
               ${tk.category === 'complaint' && !tk.resultingNcrId && tk.customerId && can('write') ? `<button class="btn btn-danger" id="supToNcr">${t('convertToNcr')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#supAddComment')?.addEventListener('click', async () => {
          const comment = val('supNewComment');
          if (!comment) return;
          try { await Api.addTicketComment(tk.id, { comment }); closeModal(); openTicket(tk.id); }
          catch (e) { UI.err(e); }
        });
        box.querySelector('#supResolve')?.addEventListener('click', () => {
          box.querySelector('#supResolveRow').innerHTML = `
            <div class="section-title">${t('ticketResolution')}</div>
            ${textarea('supResolutionText')}
            <button class="btn btn-primary btn-sm" id="supResolveGo" style="margin-top:8px">${t('confirm')}</button>`;
          box.querySelector('#supResolveGo').onclick = async () => {
            const resolution = val('supResolutionText');
            if (!resolution) return UI.toast(t('ticketResolution'), 'err');
            try { await Api.setTicketStatus(tk.id, { status: 'resolved', resolution }); closeModal(); UI.ok(t('saved')); reload(); }
            catch (e) { UI.err(e); }
          };
        });
        box.querySelector('#supCloseTicket')?.addEventListener('click', () => {
          UI.confirmDialog(t('closeTicket') + '?', async () => {
            try { await Api.setTicketStatus(tk.id, { status: 'closed' }); closeModal(); UI.ok(t('saved')); reload(); }
            catch (e) { UI.err(e); }
          });
        });
        box.querySelector('#supToNcr')?.addEventListener('click', () => {
          UI.confirmDialog(t('convertToNcr') + '?', async () => {
            try { await Api.convertTicketToNcr(tk.id); closeModal(); UI.ok(t('saved')); reload(); }
            catch (e) { UI.err(e); }
          });
        });
      }
    });
  }

  if (!ready) {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('supportTitle')}</h2><div class="sub">${t('supportSub')}</div></div>
      <div class="topbar-actions" id="supActions"></div>
    </div>
    <div id="supBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
