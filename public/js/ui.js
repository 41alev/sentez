// @ts-nocheck
const UI = (() => {
  let lang = localStorage.getItem('dt_lang') || 'tr';
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.tr[k] || k;
  const setLang = (l) => { lang = l; localStorage.setItem('dt_lang', l); };
  const getLang = () => lang;

  /* ---------- escaping ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- formatting ---------- */
  const locale = () => (lang === 'tr' ? 'tr-TR' : 'en-US');
  const money = (n, dp = 0) => Number(n || 0).toLocaleString(locale(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const num = (n, dp = 2) => {
    const v = Number(n || 0);
    return (Math.abs(v % 1) < 1e-9 ? v.toLocaleString(locale()) : v.toLocaleString(locale(), { maximumFractionDigits: dp }));
  };
  const cur = (c) => (c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : '₺');
  const dt = (d) => { if (!d) return '—'; const p = String(d).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d; };
  const ts = (v) => v ? new Date(v).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const ago = (v) => {
    if (!v) return '—';
    const m = Math.floor((Date.now() - v) / 60000);
    if (m < 1) return lang === 'tr' ? 'az önce' : 'just now';
    if (m < 60) return lang === 'tr' ? `${m} dk önce` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return lang === 'tr' ? `${h} sa önce` : `${h}h ago`;
    return lang === 'tr' ? `${Math.floor(h / 24)} gün önce` : `${Math.floor(h / 24)}d ago`;
  };
  // toISOString() UTC döner; tarayıcının yerel saat dilimi UTC'nin doğusundaysa
  // (ör. Türkiye, UTC+3) gece yarısından sonraki birkaç saat "dün" gösterir.
  // Yerel tarih bileşenleriyle üretmek bunu önler (bkz. server/lib/dates.js).
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  /** YYYY-MM-DD tarihine N gün ekler (negatif olabilir), yerel takvim gününe göre. */
  const addDays = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 3200);
  }
  const ok = (m) => toast(m, 'ok');
  function err(e) {
    let msg = e && e.message ? e.message : String(e);
    const p = e && e.payload;
    if (p) {
      if (p.details) msg += ' — ' + p.details.map(d => `${d.field}: ${d.message}`).join(', ');
      if (p.shortfall) msg += ` — ${p.shortfall.name}: ${t('needed')} ${num(p.shortfall.needed)}, ${t('available')} ${num(p.shortfall.available)} ${p.shortfall.unit || ''}`;
      if (p.shortfalls) msg += ' — ' + p.shortfalls.map(s => `${s.name}: ${num(s.needed)}/${num(s.available)}`).join(' · ');
    }
    toast(msg, 'err');
  }

  /* ---------- modal ---------- */
  function modal({ title, sub, body, footer, size = '', onOpen }) {
    const ov = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    box.className = 'modal ' + size;
    // T18: a real dialog for assistive technology, with focus kept inside.
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'modalTitle');
    if (!ov.classList.contains('show')) lastFocus = document.activeElement;
    box.innerHTML = `
      <div class="modal-head">
        <div><h3 id="modalTitle">${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
        <button class="icon-btn" data-close title="${esc(t('close'))}" aria-label="${esc(t('close'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}`;
    ov.classList.add('show');
    box.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    ov.onclick = (e) => { if (e.target === ov) closeModal(); };
    if (onOpen) onOpen(box);
    // Line rows re-render their selects; enhance whatever appears later too.
    enhanceSelects(box);
    if (modalObserver) modalObserver.disconnect();
    modalObserver = new MutationObserver(() => enhanceSelects(box));
    modalObserver.observe(box, { childList: true, subtree: true });
    const first = box.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])')
      || box.querySelector('.modal-foot button:not([data-close])') || box.querySelector('button');
    if (first) setTimeout(() => { if (box.contains(first)) first.focus(); }, 0);
    return box;
  }
  let modalObserver = null;
  let lastFocus = null;
  function closeModal() {
    if (modalObserver) { modalObserver.disconnect(); modalObserver = null; }
    const ov = document.getElementById('modalOverlay');
    const wasOpen = ov.classList.contains('show');
    ov.classList.remove('show');
    if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); return; }
    // Focus trap: Tab cycles inside an open dialog.
    const ov = document.getElementById('modalOverlay');
    if (e.key !== 'Tab' || !ov || !ov.classList.contains('show')) return;
    const box = document.getElementById('modalBox');
    const items = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0], lastEl = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === firstEl || !box.contains(document.activeElement))) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && (document.activeElement === lastEl || !box.contains(document.activeElement))) { e.preventDefault(); firstEl.focus(); }
  });
  // T18: a second click on a dialog's Save/Confirm while its request is still
  // running is ignored, so one click = one record.
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#modalBox .modal-foot .btn-primary, #modalBox .modal-foot .btn-danger');
    if (btn && typeof Api !== 'undefined' && Api.pendingWriteCount && Api.pendingWriteCount() > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  /**
   * T18: failed list load shows the reason and a retry button instead of an
   * endless spinner. Without a host element it falls back to a toast.
   */
  function errorState(host, error, onRetry) {
    if (!host || !host.isConnected) { err(error); return; }
    const id = 'retry' + Math.random().toString(36).slice(2, 8);
    host.innerHTML = `<div class="empty" role="alert">${esc(error && error.message ? error.message : String(error))}
      ${onRetry ? `<div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="${id}">${esc(t('retry'))}</button></div>` : ''}</div>`;
    if (onRetry) host.querySelector('#' + id).onclick = () => onRetry();
  }

  function confirmDialog(message, onYes, opts = {}) {
    modal({
      title: opts.title || t('confirm'),
      body: `<div style="font-size:13.5px;line-height:1.6">${esc(message)}</div>${opts.warning ? `<div class="alert warn" style="margin-top:12px">${esc(opts.warning)}</div>` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" id="cfmYes">${opts.confirmLabel || t('confirm')}</button>`,
      onOpen: (box) => { box.querySelector('#cfmYes').onclick = async () => { closeModal(); await onYes(); }; }
    });
  }

  /* ---------- form helpers ---------- */
  // Labels point at their control so screen readers announce them (T18).
  const field = (label, inner, hint) => {
    const m = /\bid="([^"]+)"/.exec(inner || '');
    return `<div class="field"><label${m ? ` for="${m[1]}"` : ''}>${esc(label)}</label>${inner}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  };
  const input = (id, o = {}) =>
    `<input id="${id}" type="${o.type || 'text'}" ${o.value !== undefined ? `value="${esc(o.value)}"` : ''} ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.step ? `step="${o.step}"` : ''} ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''} ${o.attrs || ''}>`;
  const textarea = (id, o = {}) => `<textarea id="${id}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}>${esc(o.value || '')}</textarea>`;
  const select = (id, options, selected, o = {}) => {
    // A selected record outside the preloaded page must not silently fall back
    // to the first option (T08); it is kept and its label is resolved later.
    const missing = selected !== undefined && selected !== null && selected !== '' &&
      !options.some(op => String(op.v) === String(selected));
    const extra = missing ? `<option value="${esc(selected)}" selected data-unresolved="1">#${esc(selected)}</option>` : '';
    const search = o.search ? ` data-search="${esc(o.search)}"` : '';
    return `<select id="${id}"${search} ${o.attrs || ''}>${extra}${options.map(op => `<option value="${esc(op.v)}" ${String(op.v) === String(selected) ? 'selected' : ''}>${esc(op.l)}</option>`).join('')}</select>`;
  };

  /* ---------- server-side searchable selects (T08) ---------- */
  const SEARCH_SOURCES = {
    items: {
      find: q => Api.items({ q, pageSize: 30 }).then(r => (r.data || r).map(i => ({ v: i.id, l: i.code ? `${i.name} (${i.code})` : i.name }))),
      one: id => Api.item(id).then(i => i.code ? `${i.name} (${i.code})` : i.name)
    },
    customers: {
      find: q => Api.customers({ q, pageSize: 30 }).then(r => (r.data || r).map(c => ({ v: c.id, l: c.name }))),
      one: id => Api.customer(id).then(c => c.name)
    },
    suppliers: {
      find: q => Api.suppliers({ q, pageSize: 30 }).then(r => (r.data || r).map(x => ({ v: x.id, l: x.name }))),
      one: id => Api.supplier(id).then(x => x.name)
    }
  };

  /**
   * Adds a search box above `<select data-search="items|customers|suppliers">`.
   * Typing queries the server (debounced) and replaces the options with the
   * matches while keeping the current choice, so lists larger than the
   * preloaded page stay reachable. Callers keep reading `select.value`.
   */
  function enhanceSelect(sel) {
    if (sel.dataset.enhanced) return;
    const source = SEARCH_SOURCES[sel.dataset.search];
    if (!source) return;
    sel.dataset.enhanced = '1';
    const unresolved = sel.querySelector('option[data-unresolved]');
    if (unresolved) {
      source.one(unresolved.value).then(label => { unresolved.textContent = label; unresolved.removeAttribute('data-unresolved'); })
        .catch(() => {});
    }
    const box = document.createElement('input');
    box.type = 'search';
    box.className = 'select-search';
    box.placeholder = t('search');
    box.setAttribute('aria-label', `${t('search')} ${sel.closest('.field')?.querySelector('label')?.textContent || ''}`.trim());
    box.style.marginBottom = '4px';
    sel.parentNode.insertBefore(box, sel);
    let version = 0;
    const run = debounce(async () => {
      const q = box.value.trim();
      if (q.length < 2) return;
      const mine = ++version;
      try {
        const found = await source.find(q);
        if (mine !== version) return;
        if (!found.length) return;
        // The first match becomes the choice; the previous choice stays in the
        // list (last) so the user can switch back without searching again.
        const current = sel.value;
        const currentOpt = sel.selectedOptions[0];
        const keep = current && !found.some(o => String(o.v) === String(current)) && currentOpt
          ? [{ v: current, l: currentOpt.textContent }] : [];
        const all = [...found, ...keep];
        sel.innerHTML = all.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
        sel.value = found[0].v;
        if (String(found[0].v) !== String(current)) {
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (e) { if (mine === version) err(e); }
    }, 250);
    box.addEventListener('input', run);
  }
  /** Option for a selected id that is not in the preloaded list (resolved by enhanceSelect). */
  function missingOption(list, id) {
    if (id === undefined || id === null || id === '' || list.some(o => String(o.id ?? o.v) === String(id))) return '';
    return `<option value="${esc(id)}" selected data-unresolved="1">#${esc(id)}</option>`;
  }
  function enhanceSelects(root) {
    (root || document).querySelectorAll('select[data-search]').forEach(enhanceSelect);
  }
  const checkbox = (id, label, checked) =>
    `<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-muted);cursor:pointer;margin-bottom:12px">
       <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="width:auto;margin:0"> ${esc(label)}</label>`;

  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const numVal = (id) => { const v = parseFloat(val(id)); return isNaN(v) ? 0 : v; };
  const intVal = (id) => { const v = parseInt(val(id), 10); return isNaN(v) ? 0 : v; };
  const checked = (id) => { const e = document.getElementById(id); return e ? e.checked : false; };

  /* ---------- table ---------- */
  /**
   * cols: [{ key, label, num, width, render(row), cls }]
   * Renders a card-wrapped table with optional pager.
   */
  function table(cols, rows, opts = {}) {
    if (!rows || rows.length === 0) return `<div class="empty">${esc(opts.emptyText || t('noData'))}</div>`;
    const head = cols.map(c => `<th class="${c.num ? 'num' : ''}" ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('');
    const body = rows.map((r, i) => {
      const tds = cols.map(c => {
        const content = c.render ? c.render(r, i) : esc(r[c.key] ?? '—');
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${content}</td>`;
      }).join('');
      return `<tr ${opts.rowAttrs ? opts.rowAttrs(r, i) : ''}>${tds}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function pager(res, onPage) {
    if (!res || !res.totalPages || res.totalPages <= 1) return '';
    const id = 'pg' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.querySelector('[data-prev]')?.addEventListener('click', () => onPage(res.page - 1));
      el.querySelector('[data-next]')?.addEventListener('click', () => onPage(res.page + 1));
    }, 0);
    const from = (res.page - 1) * res.pageSize + 1;
    const to = Math.min(res.page * res.pageSize, res.total);
    return `<div class="pager" id="${id}">
      <span>${t('showing')} ${from}–${to} ${t('of')} ${res.total}</span>
      <div class="pager-btns">
        <button class="btn btn-ghost btn-sm" data-prev ${res.page <= 1 ? 'disabled' : ''}>${t('prev')}</button>
        <button class="btn btn-ghost btn-sm" data-next ${res.page >= res.totalPages ? 'disabled' : ''}>${t('next')}</button>
      </div></div>`;
  }

  const card = (title, bodyHtml, actionsHtml = '', flush = false) =>
    `<div class="card">
      ${title ? `<div class="card-head"><h3>${esc(title)}</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${actionsHtml}</div></div>` : ''}
      <div class="card-body ${flush ? 'flush' : ''}">${bodyHtml}</div>
    </div>`;

  const stat = (k, v, o = {}) =>
    `<div class="stat ${o.onClick ? 'clickable' : ''}" ${o.id ? `id="${o.id}"` : ''}>
      <div class="k">${esc(k)}</div><div class="v ${o.kind || ''}">${v}</div>
      ${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</div>`;

  const loading = () => `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;

  const tabs = (items, active, onSelect) => {
    const id = 'tb' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      document.getElementById(id)?.querySelectorAll('.chip').forEach(b => {
        b.onclick = () => onSelect(b.dataset.k);
      });
    }, 0);
    return `<div class="chip-row" id="${id}" style="margin-bottom:16px">${items.map(i =>
      `<button class="chip ${i.k === active ? 'active' : ''}" data-k="${esc(i.k)}">${esc(i.l)}${i.badge ? ` (${i.badge})` : ''}</button>`).join('')}</div>`;
  };

  /* ---------- status badges ---------- */
  const lotStatusBadge = (s) => {
    const map = { available: ['ok', t('available')], quarantine: ['warn', t('quarantine')], blocked: ['crit', t('blocked')], rejected: ['crit', t('rejected')], consumed: ['plain', lang === 'tr' ? 'Tükendi' : 'Consumed'] };
    const [cls, label] = map[s] || ['plain', s];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  };
  const stockStatus = (qty, min) => {
    if (qty <= 0) return `<span class="dot crit"></span><span style="color:var(--danger)">${t('statusOut')}</span>`;
    if (qty <= min) return `<span class="dot warn"></span><span style="color:var(--accent)">${t('statusLow')}</span>`;
    return `<span class="dot ok"></span><span style="color:var(--success)">${t('statusOk')}</span>`;
  };
  const poStatusBadge = (s) => {
    const map = {
      draft: ['plain', t('poStatusDraft')], pending_approval: ['warn', t('poStatusPendingApproval')],
      approved: ['info', t('poStatusApproved')], rejected: ['crit', t('poStatusRejected')],
      partially_received: ['warn', t('poStatusPartial')], received: ['ok', t('poStatusReceived')],
      closed: ['plain', t('poStatusClosed')], cancelled: ['plain', t('poStatusCancelled')]
    };
    const [c, l] = map[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const prodStatusBadge = (s) => {
    const map = { 'Planlandı': ['info', t('prodPlanned')], 'Devam Ediyor': ['warn', t('prodInProgress')], 'Tamamlandı': ['ok', t('prodDone')], 'İptal Edildi': ['plain', t('prodCancelled')] };
    const [c, l] = map[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const shipStatusBadge = (s) => {
    const map = { 'Hazırlanıyor': ['plain', t('shipPrep')], 'Yolda': ['warn', t('shipTransit')], 'Teslim Edildi': ['ok', t('shipDelivered')] };
    const [c, l] = map[s] || ['plain', s];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const originBadge = (o) => o === 'Yurt Dışı'
    ? `<span class="badge info">${t('originIntl')}</span>`
    : `<span class="badge ok">${t('originDomestic')}</span>`;

  // r null/undefined olabilir (ör. denetim kaydında "system" aktörünün başarısız
  // giriş denemesi satırı) - `|| r` o durumda ham null/undefined'ı şablona
  // sızdırıp literal "null" metni bastırıyordu.
  const roleLabel = (r) => r ? ({ admin: t('roleAdmin'), manager: t('roleManager'), operator: t('roleOperator'), quality: t('roleQuality'), viewer: t('roleViewer') }[r] || r) : '—';

  /* ---------- charts ---------- */
  const charts = {};
  function chart(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return;
    if (charts[canvasId]) charts[canvasId].destroy();
    const gridColor = '#2F3438', tickColor = '#9AA0A6';
    if (config.type !== 'doughnut' && config.type !== 'pie') {
      config.options = config.options || {};
      config.options.scales = config.options.scales || {};
      ['x', 'y'].forEach(ax => {
        config.options.scales[ax] = Object.assign({
          ticks: { color: tickColor, font: { family: 'Inter', size: 10.5 } },
          grid: { color: gridColor }
        }, config.options.scales[ax] || {});
      });
    }
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false }, config.options || {});
    config.options.plugins = Object.assign({
      legend: { labels: { color: '#ECE9E2', font: { family: 'Inter', size: 11.5 }, boxWidth: 12 } }
    }, config.options.plugins || {});
    charts[canvasId] = new Chart(el.getContext('2d'), config);
  }
  const PALETTE = ['#F2A900', '#7FA6D9', '#6FA97A', '#E2574C', '#A88BD0', '#D9A87F', '#8BD0C4', '#D08BA8'];

  /* ---------- print ---------- */
  /* ---------- Şablonlu yazdırma ---------- */

  // Şablon ve firma bilgisi her yazdırmada sunucudan çekilmez; ilk kullanımda
  // alınıp saklanır. Yazdırma sık yapılan bir işlem ve gecikmesi rahatsız eder.
  let _branding = null;
  const _templates = {};

  async function loadPrintConfig(docType) {
    if (!_branding) {
      try { _branding = await Api.branding(); } catch { _branding = {}; }
    }
    if (docType && !_templates[docType]) {
      try { _templates[docType] = await Api.template(docType); }
      catch { _templates[docType] = null; }
    }
    return { branding: _branding, template: docType ? _templates[docType] : null };
  }

  /** Şablon ayarları değiştiğinde önbelleği boşalt. */
  function clearPrintCache() { _branding = null; Object.keys(_templates).forEach(k => delete _templates[k]); }

  /** Kâğıt boyutuna göre @page kuralı. Etiket yazıcıları küçük kâğıt kullanır. */
  function pageRule(layout) {
    const sizes = { A4: '210mm 297mm', A5: '148mm 210mm', letter: '216mm 279mm', label: '100mm 70mm' };
    const size = sizes[layout.paperSize] || sizes.A4;
    const orient = layout.orientation === 'landscape' ? ' landscape' : '';
    return `@page { size: ${size}${orient}; margin: ${layout.marginMm ?? 14}mm; }`;
  }

  /**
   * Belgeyi şablona göre yazdırır.
   *
   * @param docType  şablon anahtarı ('shipment', 'purchase_order', ...). Boş bırakılırsa
   *                 varsayılan düzen kullanılır — eski çağrılar çalışmaya devam eder.
   * @param title    belge başlığı
   * @param bodyHtml gövde (zaten kaçışlanmış HTML)
   */
  async function printDoc(titleOrType, bodyHtmlOrTitle, maybeBody) {
    // İki imza desteklenir: printDoc(title, body) ve printDoc(docType, title, body).
    // Eski çağrıların hepsini değiştirmek yerine geriye dönük uyum korunuyor.
    const threeArg = maybeBody !== undefined;
    const docType = threeArg ? titleOrType : null;
    const title = threeArg ? bodyHtmlOrTitle : titleOrType;
    const bodyHtml = threeArg ? maybeBody : bodyHtmlOrTitle;

    const { branding, template } = await loadPrintConfig(docType);
    const layout = Object.assign({
      paperSize: 'A4', orientation: 'portrait', marginMm: 14, fontSize: 12,
      accentColor: '#111111', showLogo: true, showCompanyInfo: true,
      showDocumentDate: true, showPageNumbers: true, logoHeightMm: 16, tableStriped: true
    }, (template && template.layout) || {});

    const b = branding || {};
    const accent = layout.accentColor || '#111111';
    const isLabel = layout.paperSize === 'label';

    const companyLines = [
      [b.address, b.district, b.city].filter(Boolean).join(' · '),
      [b.phone && `T: ${b.phone}`, b.email, b.website].filter(Boolean).join(' · '),
      [b.taxOffice && `V.D. ${b.taxOffice}`, b.taxNo && `VKN ${b.taxNo}`].filter(Boolean).join(' · ')
    ].filter(Boolean);

    const header = isLabel ? '' : `
      <div class="doc-head">
        <div class="doc-brand">
          ${layout.showLogo && b.logo ? `<img class="doc-logo" src="${esc(b.logo)}" alt="">` : ''}
          <div>
            <div class="doc-company">${esc(b.name || '')}</div>
            ${layout.showCompanyInfo ? companyLines.map(l => `<div class="doc-cline">${esc(l)}</div>`).join('') : ''}
          </div>
        </div>
        <div class="doc-meta">
          <div class="doc-title">${esc(title)}</div>
          ${layout.showDocumentDate ? `<div class="doc-cline">${esc(new Date().toLocaleString(locale()))}</div>` : ''}
        </div>
      </div>
      ${template && template.headerText ? `<div class="doc-note">${esc(template.headerText)}</div>` : ''}`;

    const sigs = (template && template.signatures) || [];
    const footer = isLabel ? '' : `
      ${template && template.footerText ? `<div class="doc-note doc-foot-note">${esc(template.footerText)}</div>` : ''}
      ${b.printFooter ? `<div class="doc-cline doc-foot-note">${esc(b.printFooter)}</div>` : ''}
      ${sigs.length ? `<div class="doc-sigs">${sigs.map(sg =>
        `<div class="doc-sig">${esc(sg)}</div>`).join('')}</div>` : ''}`;

    const w = window.open('', '_blank', 'width=880,height=960');
    if (!w) { toast(lang === 'tr' ? 'Açılır pencere engellendi.' : 'Popup blocked.', 'err'); return; }

    w.document.write(`<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">
      <title>${esc(title)}</title><style>
      ${pageRule(layout)}
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:${isLabel ? '2mm' : '0'};
        font-size:${layout.fontSize}px;line-height:1.45}
      .doc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;
        border-bottom:2.5px solid ${accent};padding-bottom:10px;margin-bottom:16px}
      .doc-brand{display:flex;gap:14px;align-items:flex-start}
      .doc-logo{height:${layout.logoHeightMm}mm;width:auto;object-fit:contain}
      .doc-company{font-size:${layout.fontSize + 3}px;font-weight:bold;color:${accent};margin-bottom:3px}
      .doc-cline{font-size:${layout.fontSize - 2}px;color:#555}
      .doc-meta{text-align:right;flex-shrink:0}
      .doc-title{font-size:${layout.fontSize + 5}px;font-weight:bold;letter-spacing:.04em;
        text-transform:uppercase;color:${accent}}
      .doc-note{font-size:${layout.fontSize - 1}px;color:#444;background:#f6f6f6;
        border-left:3px solid ${accent};padding:7px 10px;margin-bottom:14px}
      .doc-foot-note{margin-top:16px;background:none;border:none;padding:0}
      h4{font-size:${layout.fontSize - 1}px;text-transform:uppercase;letter-spacing:.05em;
        color:#444;margin:18px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px;
        font-size:${layout.fontSize - 0.5}px;margin-bottom:8px}
      .g b{color:#444;font-weight:normal}
      table{width:100%;border-collapse:collapse;font-size:${layout.fontSize - 1}px;margin-bottom:10px}
      th,td{border:1px solid #b0b0b0;padding:5px 8px;text-align:left;vertical-align:top}
      th{background:${accent};color:#fff;font-weight:bold;font-size:${layout.fontSize - 1.5}px}
      ${layout.tableStriped ? 'tbody tr:nth-child(even){background:#f7f7f7}' : ''}
      .r{text-align:right}
      .doc-sigs{display:flex;justify-content:space-between;gap:26px;margin-top:44px;
        page-break-inside:avoid}
      .doc-sig{border-top:1px solid #333;flex:1;max-width:210px;padding-top:6px;
        text-align:center;font-size:${layout.fontSize - 2}px;color:#555}
      .label-wrap{text-align:center}
      .label-name{font-size:${layout.fontSize + 4}px;font-weight:bold;margin-bottom:2mm}
      .label-row{font-size:${layout.fontSize}px;display:flex;justify-content:space-between;
        border-bottom:1px dotted #999;padding:1mm 0}
      @media print{
        body{padding:0}
        .doc-head{page-break-after:avoid}
        tr{page-break-inside:avoid}
        ${layout.showPageNumbers ? '' : ''}
      }
      </style></head><body>${header}${bodyHtml}${footer}</body></html>`);
    w.document.close();
    w.focus();
    // Logolar gömülü veri olduğu için yükleme hızlıdır; yine de küçük bir pay bırakılır.
    setTimeout(() => { try { w.print(); } catch {} }, 400);
  }

  /* ---------- CSV export ---------- */
  // CSV/formül enjeksiyonu: bir müşteri/ürün adı "=HYPERLINK(...)" gibi
  // =,+,-,@ ile başlıyorsa, bu dosya Excel/Sheets'te açıldığında hücre
  // metin değil FORMÜL olarak yorumlanır (veri sızıntısı, eski Excel'lerde
  // DDE ile komut çalıştırma riski — OWASP "CSV Injection"). Başına tek
  // tırnak eklemek (Excel/Sheets'in "zorla metin" kuralı) formülü
  // etkisiz hale getirir, görünen değeri değiştirmez.
  function csvCell(v) {
    const s = String(v ?? '');
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  }
  function exportCsv(filename, headers, rows) {
    const csv = [headers, ...rows].map(r => r.map(v => `"${csvCell(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    ok(lang === 'tr' ? 'CSV indirildi.' : 'CSV downloaded.');
  }

  /* ---------- JSON export (KVKK veri dışa aktarım raporları) ---------- */
  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- misc ---------- */
  const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`;
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    truck: '<path d="M3 7l9 5 9-5"/><path d="M3 7v10l9 5 9-5V7"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    upload: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  };

  const debounce = (fn, ms = 300) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };

  /* ---------- USB barkod okuyucu (klavye emülasyonu) ---------- */
  /**
   * Depolarda kullanılan okuyucuların çoğu klavye gibi davranır: karakterleri çok
   * hızlı yazar ve Enter ile bitirir. İnsan yazışından ayırt etmenin güvenilir yolu
   * tuşlar arası süredir — bir insan 30 ms'de bir karakter yazamaz.
   *
   * onScan(code) çağrılır. Kullanıcı bir metin alanına yazarken devreye girmez.
   */
  function onBarcodeScan(onScan, opts = {}) {
    const maxGapMs = opts.maxGapMs || 35;      // tuşlar arası azami süre
    const minLength = opts.minLength || 6;     // bu kadar kısa diziler barkod sayılmaz
    let buf = '';
    let lastTs = 0;

    const handler = (e) => {
      // Kullanıcı bir alana yazıyorsa karışma; o alan zaten girdiyi alıyor.
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing && !el.dataset.barcodeTarget) return;

      const now = Date.now();
      if (now - lastTs > maxGapMs) buf = '';   // duraklama oldu: yeni dizi
      lastTs = now;

      if (e.key === 'Enter') {
        const code = buf.trim();
        buf = '';
        if (code.length >= minLength) { e.preventDefault(); onScan(code); }
        return;
      }
      // Yalnızca tek karakterli tuşlar barkodun parçasıdır (Shift, Tab vb. değil)
      if (e.key && e.key.length === 1) buf += e.key;
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }

  function can(perm) {
    const u = Api.getUser();
    if (!u) return false;
    // 'count' burada ayrı tutuluyor çünkü backend'in kendi izin matrisinde
    // (server/middleware/auth.js PERMISSIONS) count.write hem operator/manager/
    // admin'de HEM DE quality'de var — genel 'write' bayrağına eklemek yerine
    // ayrı tutulması, quality'ye yanlışlıkla stok/satış/üretim yazma erişimi
    // sızdırmadan sayım özelliğini doğru şekilde açıyor (bkz. PROJECT_STATUS.md:
    // Sayım oluşturma/kaydetme butonları quality için hiç görünmüyordu).
    // 'docs' de aynı sebeple ayrı: server/routes/documents.js'teki WRITE
    // (belge/eki yükleme) admin/manager/operator/quality içeriyor — quality'nin
    // ürüne kalite sertifikası/test raporu ekleyebilmesi gerekiyor, ama genel
    // 'write' bayrağı ona verilirse stok/satış/üretim yazma erişimi de sızardı.
    // 'lotStatus' de ayrı: server/routes/stock.js'teki POST /lot-status
    // requirePermission('stock.status') kullanıyor ve PERMISSIONS'ta bu
    // yalnızca admin (*) ve quality'de var — manager'da YOK (quality.write'ı
    // olsa da stock.status'u yok). Genel 'quality' bayrağı manager'a da
    // verildiği için (kalite dispozisyonu gibi quality.write işleri için),
    // parti durumu değiştirme (karantina/blokaj/serbest bırakma) o bayrakla
    // kapatılırsa manager ve operator'a hep 403 veren bir buton gösterilmiş
    // olur — bkz. PROJECT_STATUS.md rol taraması bulgu 11.
    const P = {
      admin: ['write', 'delete', 'approve', 'quality', 'admin', 'count', 'docs', 'lotStatus'],
      manager: ['write', 'delete', 'approve', 'quality', 'count', 'docs'],
      operator: ['write', 'count', 'docs'],
      quality: ['quality', 'count', 'docs', 'lotStatus'],
      viewer: []
    };
    return (P[u.role] || []).includes(perm);
  }

  return {
    t, setLang, getLang, esc, money, num, cur, dt, ts, ago, today, addDays, locale,
    toast, ok, err, modal, closeModal, confirmDialog,
    field, input, textarea, select, checkbox, val, numVal, intVal, checked,
    table, pager, card, stat, loading, tabs,
    lotStatusBadge, stockStatus, poStatusBadge, prodStatusBadge, shipStatusBadge, originBadge, roleLabel,
    chart, PALETTE, printDoc, clearPrintCache, loadPrintConfig, exportCsv, downloadJson, icon, ICONS,
    debounce, can, onBarcodeScan, enhanceSelects, missingOption, errorState
  };
})();
