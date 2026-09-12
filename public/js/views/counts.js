const ViewCounts = (() => {
  const { t, esc, num, ts, dt, card, table, pager, loading, modal, closeModal,
          field, input, select, val, intVal, can } = UI;

  let warehouses = [];

  async function render(el) {
    el.innerHTML = loading();
    try { warehouses = await Api.warehouses(); } catch { warehouses = []; }
    await load(el);
  }

  async function load(el) {
    let res;
    try { res = await Api.counts({ pageSize: 25 }); } catch (e) { UI.err(e); return; }
    const rows = res.data || res;

    el.innerHTML = `
      <div class="topbar">
        <div><h2>${t('countsTitle')}</h2><div class="sub">${t('countsSub')}</div></div>
        <div class="topbar-actions">
          ${can('write') ? `<button class="btn btn-primary btn-sm" id="cNew">${UI.icon(UI.ICONS.plus)}${t('newCount')}</button>` : ''}
        </div>
      </div>
      <div class="card">
        ${table([
          { key: 'countNo', label: t('countNo'), render: r => `<button class="link-btn" data-open="${esc(r.id)}">${esc(r.countNo)}</button>` },
          { key: 'warehouse', label: t('warehouse'), render: r => esc(r.warehouse || '—') },
          { key: 'status', label: t('status'), render: r => statusBadge(r.status) },
          { key: 'lineCount', label: UI.getLang() === 'tr' ? 'Satır' : 'Lines', num: true, render: r => num(r.lineCount || 0) },
          { key: 'startedAt', label: t('date'), render: r => ts(r.startedAt) },
          { key: 'approvedAt', label: t('countApproved'), render: r => r.approvedAt ? ts(r.approvedAt) : '—' }
        ], rows)}
        ${pager(res, p => load(el))}
      </div>`;

    document.getElementById('cNew')?.addEventListener('click', () => newCount(el));
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCount(el, b.dataset.open));
  }

  const statusBadge = (s) => {
    const m = { open: ['info', t('countOpen')], counted: ['warn', t('countCounted')], approved: ['ok', t('countApproved')], cancelled: ['plain', t('countCancelled')] };
    const [c, l] = m[s] || ['plain', s];
    return `<span class="badge ${esc(c)}">${esc(l)}</span>`;
  };

  function newCount(el) {
    modal({
      title: t('newCount'),
      body: `${field(t('warehouse'), select('nWh', warehouses.map(w => ({ v: w.id, l: w.name }))))}
             ${field(t('notes'), input('nNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="nGo">${t('confirm')}</button>`,
      onOpen: (box) => {
        box.querySelector('#nGo').onclick = async () => {
          try {
            const c = await Api.createCount({ warehouseId: intVal('nWh'), notes: val('nNote') });
            closeModal(); UI.ok(t('saved')); openCount(el, c.id);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  async function openCount(el, id) {
    let c;
    try { c = await Api.count(id); } catch (e) { UI.err(e); return; }
    const editable = c.status === 'open' || c.status === 'counted';

    modal({
      title: c.countNo, sub: `${c.warehouse || ''} · ${t('status')}: ${esc(c.status)}`,
      size: 'xwide',
      body: `
        ${c.status === 'approved' ? `<div class="alert ok">${UI.getLang() === 'tr' ? 'Bu sayım onaylanmış ve farklar stoğa işlenmiştir.' : 'This count is approved and variances have been posted.'}</div>` : ''}
        ${editable ? `<div class="alert warn">${t('countWarning')}</div>` : ''}
        <div class="table-wrap"><table>
          <thead><tr>
            <th>${t('itemName')}</th><th>${t('lotNo')}</th>
            <th class="num">${t('systemQty')}</th><th class="num">${t('countedQty')}</th>
            <th class="num">${t('difference')}</th><th>${UI.getLang() === 'tr' ? 'Gerekçe' : 'Reason'}</th>
          </tr></thead>
          <tbody id="cntBody">
            ${c.lines.map(l => `
              <tr data-id="${esc(l.id)}">
                <td>${esc(l.itemName)}</td>
                <td class="mono">${esc(l.lotNo || '—')}</td>
                <td class="num">${num(l.systemQty)}</td>
                <td class="num">${editable
                  ? `<input type="number" step="0.0001" class="cnt-q" data-id="${esc(l.id)}" value="${l.countedQty ?? ''}" style="width:96px;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text);text-align:right">`
                  : num(l.countedQty ?? 0)}</td>
                <td class="num diff" data-id="${esc(l.id)}">${l.difference == null ? '—' : diffHtml(l.difference)}</td>
                <td>${editable
                  ? `<input type="text" class="cnt-r" data-id="${esc(l.id)}" value="${esc(l.reason || '')}" style="width:100%;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--text)">`
                  : esc(l.reason || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="totals-row" id="cntTotals"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${editable && can('write') ? `<button class="btn btn-ghost" id="cntSave">${t('saveCounts')}</button>` : ''}
               ${editable && can('approve') ? `<button class="btn btn-primary" id="cntApprove">${t('approveCount')}</button>` : ''}`,
      onOpen: (box) => {
        const recalc = () => {
          let totalDiffValue = 0, counted = 0;
          box.querySelectorAll('.cnt-q').forEach(inp => {
            const line = c.lines.find(x => String(x.id) === inp.dataset.id);
            const cell = box.querySelector(`.diff[data-id="${inp.dataset.id}"]`);
            if (inp.value === '') { cell.innerHTML = '—'; return; }
            counted++;
            const d = Number(inp.value) - line.systemQty;
            cell.innerHTML = diffHtml(d);
            totalDiffValue += d * (line.unitCost || 0);
          });
          box.querySelector('#cntTotals').innerHTML =
            `<span class="total-chip">${t('countedQty')}: ${counted}/${c.lines.length}</span>
             <span class="total-chip ${totalDiffValue < 0 ? 'crit' : 'ok'}">${t('totalDiffValue')}: ₺${num(totalDiffValue, 0)}</span>`;
        };
        box.querySelectorAll('.cnt-q').forEach(i => i.oninput = recalc);
        recalc();

        box.querySelector('#cntSave')?.addEventListener('click', async () => {
          const lines = [];
          box.querySelectorAll('.cnt-q').forEach(inp => {
            if (inp.value === '') return;
            const reason = box.querySelector(`.cnt-r[data-id="${inp.dataset.id}"]`)?.value || '';
            lines.push({ id: Number(inp.dataset.id), countedQty: Number(inp.value), reason });
          });
          try { await Api.saveCountLines(c.id, lines); UI.ok(t('saved')); closeModal(); load(el); } catch (e) { UI.err(e); }
        });

        box.querySelector('#cntApprove')?.addEventListener('click', () => {
          UI.confirmDialog(t('countWarning'), async () => {
            const lines = [];
            box.querySelectorAll('.cnt-q').forEach(inp => {
              if (inp.value === '') return;
              const reason = box.querySelector(`.cnt-r[data-id="${inp.dataset.id}"]`)?.value || '';
              lines.push({ id: Number(inp.dataset.id), countedQty: Number(inp.value), reason });
            });
            try {
              if (lines.length) await Api.saveCountLines(c.id, lines);
              await Api.approveCount(c.id);
              closeModal(); UI.ok(t('saved')); load(el);
            } catch (e) { UI.err(e); }
          }, { danger: true, confirmLabel: t('approve') });
        });
      }
    });
  }

  const diffHtml = (d) => {
    if (Math.abs(d) < 1e-9) return `<span style="color:var(--success)">0</span>`;
    return `<span style="color:${d < 0 ? 'var(--danger)' : 'var(--accent)'}">${d > 0 ? '+' : ''}${num(d)}</span>`;
  };

  return { render };
})();
