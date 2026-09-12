// @ts-nocheck
const ViewAdmin = (() => {
  const { t, esc, num, money, dt, ts, table, pager, loading, modal, closeModal,
          field, input, select, textarea, checkbox, val, numVal, intVal, checked, can } = UI;

  let tab = 'users';

  async function render(el) { await load(el); }

  async function load(el) {
    el.innerHTML = `
      <div class="topbar">
        <div><h2>${t('adminTitle')}</h2><div class="sub">${t('adminSub')}</div></div>
        <div class="topbar-actions" id="adActions"></div>
      </div>
      ${UI.tabs([
        { k: 'users', l: t('tabUsers') }, { k: 'warehouses', l: t('tabWarehouses') },
        { k: 'fx', l: t('tabFx') }, { k: 'rules', l: t('tabRules') },
        { k: 'audit', l: t('tabAudit') }, { k: 'settings', l: t('tabSettings') },
        { k: 'import', l: t('tabImport') }, { k: 'templates', l: t('tabTemplates') }, { k: 'health', l: t('tabDataHealth') }, { k: 'edoc', l: t('edocSettings') }
      ], tab, k => { tab = k; load(el); })}
      <div id="adBody">${loading()}</div>`;

    const body = document.getElementById('adBody');
    const actions = document.getElementById('adActions');
    const fns = { users: usersTab, warehouses: whTab, fx: fxTab, rules: rulesTab, audit: auditTab, settings: settingsTab, edoc: edocTab, import: importTab, templates: templatesTab, health: healthTab };
    try { await fns[tab](el, body, actions); }
    catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  /* ================= USERS ================= */
  async function usersTab(el, body, actions) {
    if (!can('admin')) {
      body.innerHTML = `<div class="empty">${UI.getLang() === 'tr' ? 'Bu bölüm yalnızca yöneticilere açıktır.' : 'This section is admin-only.'}</div>`;
      actions.innerHTML = ''; return;
    }
    const rows = await Api.users();
    actions.innerHTML = `<button class="btn btn-primary btn-sm" id="usNew">${UI.icon(UI.ICONS.plus)}${t('newUser')}</button>`;

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Yetki değişikliği veya şifre sıfırlama, o kullanıcının açık oturumlarını anında sonlandırır.'
        : 'Changing a role or resetting a password immediately ends that user\'s active sessions.'}</div>
      <div class="card">${table([
        { key: 'username', label: t('username'), render: r => `<span class="mono">${esc(r.username)}</span>
            <div class="sub-line">${esc(r.fullName || '')}</div>` },
        { key: 'role', label: t('role'), render: r => `<span class="badge ${r.role === 'admin' ? 'crit' : r.role === 'manager' ? 'warn' : r.role === 'viewer' ? 'plain' : 'info'}">${UI.roleLabel(r.role)}</span>` },
        { key: 'email', label: t('email'), render: r => esc(r.email || '—') },
        { key: 'approvalLimit', label: t('approvalLimit'), num: true, render: r => r.approvalLimit ? '₺' + money(r.approvalLimit) : '—' },
        { key: 'lastLoginAt', label: t('lastLogin'), render: r => r.lastLoginAt ? ts(r.lastLoginAt) : '—', cls: 'nowrap' },
        { key: 'isActive', label: t('isActive'), render: r => r.lockedUntil && r.lockedUntil > Date.now()
            ? `<span class="badge crit">${UI.getLang() === 'tr' ? 'Kilitli' : 'Locked'}</span>`
            : (r.isActive ? `<span class="badge ok">${t('yes')}</span>` : `<span class="badge plain">${t('no')}</span>`) },
        { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
            <button class="icon-btn" data-edit="${esc(r.id)}" title="${t('edit')}">${UI.icon(UI.ICONS.edit)}</button>
            <button class="btn btn-ghost btn-sm" data-pw="${esc(r.id)}">${t('resetPassword')}</button>
            ${r.lockedUntil ? `<button class="btn btn-ghost btn-sm" data-unlock="${esc(r.id)}">${t('unlockUser')}</button>` : ''}
            ${r.isActive ? `<button class="icon-btn danger" data-del="${esc(r.id)}" title="${t('deactivate')}">${UI.icon(UI.ICONS.trash)}</button>` : ''}
          </div>` }
      ], rows)}</div>`;

    document.getElementById('usNew').onclick = () => userForm(el, null);
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => userForm(el, rows.find(x => String(x.id) === b.dataset.edit)));
    body.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => pwDialog(el, b.dataset.pw));
    body.querySelectorAll('[data-unlock]').forEach(b => b.onclick = async () => {
      try { await Api.unlockUser(b.dataset.unlock); UI.ok(t('saved')); load(el); } catch (e) { UI.err(e); }
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirmDialog(
      UI.getLang() === 'tr' ? 'Kullanıcı pasifleştirilecek ve oturumları kapatılacak.' : 'The user will be deactivated and signed out.',
      async () => { try { await Api.deleteUser(b.dataset.del); UI.ok(t('saved')); load(el); } catch (e) { UI.err(e); } },
      { danger: true }));
  }

  function userForm(el, u) {
    const roles = [
      { v: 'admin', l: t('roleAdmin') }, { v: 'manager', l: t('roleManager') },
      { v: 'operator', l: t('roleOperator') }, { v: 'quality', l: t('roleQuality') }, { v: 'viewer', l: t('roleViewer') }
    ];
    modal({
      title: u ? t('edit') + ' — ' + u.username : t('newUser'), size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('username'), input('usName', { value: u?.username || '', attrs: u ? 'disabled' : '' }))}
          ${field(t('fullName'), input('usFull', { value: u?.fullName || '' }))}
        </div>
        <div class="field-row">
          ${field(t('email'), input('usEmail', { type: 'email', value: u?.email || '' }))}
          ${field(t('role'), select('usRole', roles, u?.role || 'operator'))}
        </div>
        ${!u ? field(t('password'), input('usPw', { type: 'password' }), t('passwordHint')) : ''}
        ${field(t('approvalLimit') + ' (₺)', input('usLimit', { type: 'number', min: 0, value: u?.approvalLimit ?? 0 }),
          UI.getLang() === 'tr' ? 'Bu tutarın üzerindeki siparişleri onaylayamaz. 0 = sınırsız değil, onay yetkisi yok demektir.'
                                : 'Cannot approve orders above this amount. 0 means no approval authority.')}
        ${!u ? checkbox('usMust', t('mustChangePassword'), true) : ''}
        ${u ? checkbox('usActive', t('isActive'), u.isActive) : ''}
        <div class="section-title">${UI.getLang() === 'tr' ? 'Yetki matrisi' : 'Permission matrix'}</div>
        <div id="usPerms" style="font-size:12px;color:var(--text-muted);line-height:1.7"></div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="usGo">${t('save')}</button>`,
      onOpen: (box) => {
        const describe = (role) => {
          const L = UI.getLang() === 'tr';
          const map = {
            admin: L ? 'Her şeyi yapabilir: kullanıcı yönetimi, silme, onay, ayarlar.' : 'Everything: user management, deletion, approval, settings.',
            manager: L ? 'Onay verir, kayıt siler, kalite ve satın alma işlemlerini yürütür. Kullanıcı yönetemez.'
                       : 'Approves, deletes records, runs quality and purchasing. Cannot manage users.',
            operator: L ? 'Günlük işler: stok girişi, üretim, sipariş oluşturma. Onay ve silme yetkisi yok.'
                        : 'Day-to-day work: stock, production, creating orders. No approval or deletion.',
            quality: L ? 'Muayene, uygunsuzluk, DÖF, kalibrasyon ve lot durumu değiştirme. Satın alma ve finans yok.'
                       : 'Inspection, NCR, CAPA, calibration and lot status. No purchasing or finance.',
            viewer: L ? 'Sadece görüntüleme; hiçbir kayıt oluşturamaz veya değiştiremez.' : 'Read-only; cannot create or change anything.'
          };
          box.querySelector('#usPerms').textContent = map[role] || '';
        };
        box.querySelector('#usRole').onchange = e => describe(e.target.value);
        describe(u?.role || 'operator');

        box.querySelector('#usGo').onclick = async () => {
          try {
            if (u) {
              await Api.updateUser(u.id, {
                fullName: val('usFull'), email: val('usEmail'), role: val('usRole'),
                approvalLimit: numVal('usLimit'), isActive: checked('usActive')
              });
            } else {
              await Api.createUser({
                username: val('usName'), password: val('usPw'), fullName: val('usFull'),
                email: val('usEmail'), role: val('usRole'), approvalLimit: numVal('usLimit'),
                mustChangePassword: checked('usMust')
              });
            }
            closeModal(); UI.ok(t('saved')); load(el);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  function pwDialog(el, id) {
    modal({
      title: t('resetPassword'),
      body: `${field(t('password'), input('pwNew', { type: 'password' }), t('passwordHint'))}
             <div class="alert warn">${UI.getLang() === 'tr'
               ? 'Kullanıcının tüm açık oturumları kapatılır ve ilk girişte şifre değiştirmesi istenir.'
               : 'All of the user\'s sessions are ended and they must change the password at next sign-in.'}</div>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="pwGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#pwGo').onclick = async () => {
          try { await Api.updateUser(id, { password: val('pwNew') }); closeModal(); UI.ok(t('saved')); load(el); }
          catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= WAREHOUSES ================= */
  async function whTab(el, body, actions) {
    const rows = await Api.warehouses();
    if (can('approve')) actions.innerHTML = `<button class="btn btn-primary btn-sm" id="whNew">${UI.icon(UI.ICONS.plus)}${t('newWarehouse')}</button>`;
    else actions.innerHTML = '';

    body.innerHTML = `<div class="card">${table([
      { key: 'code', label: t('warehouseCode'), render: r => `<span class="mono">${esc(r.code || '—')}</span>` },
      { key: 'name', label: t('warehouseName'), render: r => esc(r.name) },
      { key: 'address', label: UI.getLang() === 'tr' ? 'Adres' : 'Address', render: r => esc(r.address || '—') },
      { key: 'isQuarantine', label: t('isQuarantine'), render: r => r.isQuarantine
          ? `<span class="badge warn">${t('yes')}</span>` : `<span class="badge plain">${t('no')}</span>` },
      { key: 'act', label: t('actions'), render: r => can('approve')
          ? `<div class="row-actions"><button class="icon-btn" data-edit="${esc(r.id)}">${UI.icon(UI.ICONS.edit)}</button></div>` : '' }
    ], rows)}</div>`;

    document.getElementById('whNew')?.addEventListener('click', () => whForm(el, null));
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => whForm(el, rows.find(x => String(x.id) === b.dataset.edit)));
  }

  function whForm(el, w) {
    modal({
      title: w ? t('edit') : t('newWarehouse'),
      body: `
        <div class="field-row">
          ${field(t('warehouseName'), input('whName', { value: w?.name || '' }))}
          ${field(t('warehouseCode'), input('whCode', { value: w?.code || '' }))}
        </div>
        ${field(UI.getLang() === 'tr' ? 'Adres' : 'Address', textarea('whAddr', { value: w?.address || '' }))}
        ${checkbox('whQuar', t('isQuarantine'), w?.isQuarantine || false)}
        ${w ? checkbox('whActive', t('isActive'), w.isActive !== 0) : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="whGo">${t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#whGo').onclick = async () => {
          const p = { name: val('whName'), code: val('whCode'), address: val('whAddr'), isQuarantine: checked('whQuar') };
          if (w) p.isActive = checked('whActive');
          try {
            if (w) await Api.updateWarehouse(w.id, p); else await Api.createWarehouse(p);
            closeModal(); UI.ok(t('saved')); load(el);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ================= FX ================= */
  async function fxTab(el, body, actions) {
    const [current, hist] = await Promise.all([Api.currentRates(), Api.exchangeRates({ pageSize: 100 })]);
    if (can('approve')) actions.innerHTML = `<button class="btn btn-primary btn-sm" id="fxNew">${UI.icon(UI.ICONS.plus)}${t('addFxRate')}</button>`;
    else actions.innerHTML = '';

    body.innerHTML = `
      <div class="alert info">${t('fxHint')}</div>
      <div class="stat-row">
        ${['USD', 'EUR', 'GBP'].map(c => current[c]
          ? UI.stat(c + '/TRY', num(current[c].rate, 4), { sub: dt(current[c].date) })
          : UI.stat(c + '/TRY', '—')).join('')}
      </div>
      <div class="card">${table([
        { key: 'currency', label: t('fxCurrency'), render: r => `<span class="badge plain">${esc(r.currency)}</span>` },
        { key: 'rate', label: t('fxRateValue'), num: true, render: r => num(r.rate, 4) },
        { key: 'rate_date', label: t('fxDate'), render: r => dt(r.rate_date) },
        { key: 'source', label: UI.getLang() === 'tr' ? 'Kaynak' : 'Source', render: r => esc(r.source || '—') }
      ], hist.data || hist)}
      ${hist.totalPages ? pager(hist, () => load(el)) : ''}</div>`;

    document.getElementById('fxNew')?.addEventListener('click', () => {
      modal({
        title: t('addFxRate'),
        body: `
          <div class="field-row">
            ${field(t('fxCurrency'), select('fxCur', [{ v: 'USD', l: 'USD' }, { v: 'EUR', l: 'EUR' }, { v: 'GBP', l: 'GBP' }]))}
            ${field(t('fxRateValue'), input('fxVal', { type: 'number', min: 0, step: '0.0001' }))}
          </div>
          ${field(t('fxDate'), input('fxDate', { type: 'date', value: UI.today() }))}`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                 <button class="btn btn-primary" id="fxGo">${t('save')}</button>`,
        onOpen: (box) => {
          box.querySelector('#fxGo').onclick = async () => {
            try {
              await Api.setRate({ currency: val('fxCur'), rate: numVal('fxVal'), rateDate: val('fxDate') });
              closeModal(); UI.ok(t('saved')); load(el);
            } catch (e) { UI.err(e); }
          };
        }
      });
    });
  }

  /* ================= RULES ================= */
  async function rulesTab(el, body, actions) {
    const [ar, nr] = await Promise.all([Api.approvalRules(), Api.notificationRules()]);
    actions.innerHTML = '';

    const ruleTypeLabel = (rt) => ({
      low_stock: t('ruleLowStock'), expiry: t('ruleExpiry'), overdue_po: t('ruleOverduePO'),
      ncr_open: t('ruleNcrOpen'), calibration_due: t('ruleCalibration')
    }[rt] || rt);

    body.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${t('approvalRules')}</h3>
          ${can('admin') ? `<button class="btn btn-ghost btn-sm" id="arNew">${UI.icon(UI.ICONS.plus)}${t('addApprovalRule')}</button>` : ''}</div>
        <div class="card-body" style="padding-top:0">
          <div class="alert info" style="margin-top:14px">${UI.getLang() === 'tr'
            ? 'Bir sipariş, eşik tutarı aştığında ilgili yetkinin onayı olmadan teslim alınamaz.'
            : 'An order above the threshold cannot be received until the required role approves it.'}</div>
          ${table([
            { key: 'doc_type', label: UI.getLang() === 'tr' ? 'Belge' : 'Document', render: r => `<span class="badge plain">${esc(r.doc_type)}</span>` },
            { key: 'threshold_base', label: t('thresholdAmount'), num: true, render: r => '₺' + money(r.threshold_base) },
            { key: 'required_role', label: t('requiredRole'), render: r => UI.roleLabel(r.required_role) },
            { key: 'act', label: t('actions'), render: r => can('admin')
                ? `<div class="row-actions"><button class="icon-btn danger" data-ard="${esc(r.id)}">${UI.icon(UI.ICONS.trash)}</button></div>` : '' }
          ], ar)}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${t('notificationRules')}</h3>
          ${can('approve') ? `<button class="btn btn-ghost btn-sm" id="nrNew">${UI.icon(UI.ICONS.plus)}${t('addNotifRule')}</button>` : ''}</div>
        <div class="card-body" style="padding-top:0">
          ${table([
            { key: 'rule_type', label: t('ruleType'), render: r => esc(ruleTypeLabel(r.rule_type)) },
            { key: 'channel', label: t('channel'), render: r => `<span class="badge ${r.channel === 'email' ? 'info' : 'plain'}">${esc(r.channel)}</span>` },
            { key: 'threshold_days', label: t('thresholdDays'), num: true, render: r => r.threshold_days == null ? '—' : num(r.threshold_days) },
            { key: 'recipients', label: t('recipients'), render: r => esc(r.recipients || '—') },
            { key: 'act', label: t('actions'), render: r => can('approve')
                ? `<div class="row-actions"><button class="icon-btn danger" data-nrd="${esc(r.id)}">${UI.icon(UI.ICONS.trash)}</button></div>` : '' }
          ], nr)}
        </div>
      </div>`;

    document.getElementById('arNew')?.addEventListener('click', () => {
      modal({
        title: t('addApprovalRule'),
        body: `
          ${field(UI.getLang() === 'tr' ? 'Belge' : 'Document', select('arDoc', [
            { v: 'purchase_order', l: t('poNo') }, { v: 'purchase_request', l: t('requestNo') }]))}
          ${field(t('thresholdAmount'), input('arAmt', { type: 'number', min: 0, value: 100000 }))}
          ${field(t('requiredRole'), select('arRole', [{ v: 'manager', l: t('roleManager') }, { v: 'admin', l: t('roleAdmin') }]))}`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                 <button class="btn btn-primary" id="arGo">${t('save')}</button>`,
        onOpen: (box) => {
          box.querySelector('#arGo').onclick = async () => {
            try {
              await Api.createApprovalRule({ docType: val('arDoc'), thresholdBase: numVal('arAmt'), requiredRole: val('arRole') });
              closeModal(); UI.ok(t('saved')); load(el);
            } catch (e) { UI.err(e); }
          };
        }
      });
    });

    document.getElementById('nrNew')?.addEventListener('click', () => {
      modal({
        title: t('addNotifRule'),
        body: `
          ${field(t('ruleType'), select('nrType', [
            { v: 'low_stock', l: t('ruleLowStock') }, { v: 'expiry', l: t('ruleExpiry') },
            { v: 'overdue_po', l: t('ruleOverduePO') }, { v: 'ncr_open', l: t('ruleNcrOpen') },
            { v: 'calibration_due', l: t('ruleCalibration') }]))}
          ${field(t('channel'), select('nrCh', [{ v: 'inapp', l: 'Uygulama içi / In-app' }, { v: 'email', l: 'E-posta / Email' }]))}
          ${field(t('thresholdDays'), input('nrDays', { type: 'number', min: 0, value: 30 }))}
          ${field(t('recipients'), input('nrRec'), UI.getLang() === 'tr' ? 'Virgülle ayrılmış e-posta adresleri (e-posta kanalı için).' : 'Comma-separated emails (for the email channel).')}`,
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                 <button class="btn btn-primary" id="nrGo">${t('save')}</button>`,
        onOpen: (box) => {
          box.querySelector('#nrGo').onclick = async () => {
            try {
              await Api.createNotificationRule({
                ruleType: val('nrType'), channel: val('nrCh'),
                thresholdDays: intVal('nrDays'), recipients: val('nrRec')
              });
              closeModal(); UI.ok(t('saved')); load(el);
            } catch (e) { UI.err(e); }
          };
        }
      });
    });

    body.querySelectorAll('[data-ard]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deleteApprovalRule(b.dataset.ard); UI.ok(t('deleted')); load(el); } catch (e) { UI.err(e); }
    }, { danger: true }));
    body.querySelectorAll('[data-nrd]').forEach(b => b.onclick = () => UI.confirmDialog(t('confirmDelete'), async () => {
      try { await Api.deleteNotificationRule(b.dataset.nrd); UI.ok(t('deleted')); load(el); } catch (e) { UI.err(e); }
    }, { danger: true }));
  }

  /* ================= AUDIT ================= */
  let auditFilter = { entityType: '', username: '', page: 1 };
  async function auditTab(el, body, actions) {
    const res = await Api.audit({ ...auditFilter, pageSize: 60 });
    actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="auCsv">${UI.icon(UI.ICONS.download)}CSV</button>`;
    document.getElementById('auCsv').onclick = () => UI.exportCsv('denetim-kaydi.csv',
      [t('date'), t('auditUser'), t('role'), t('auditAction'), t('auditEntity'), t('auditOld'), t('auditNew'), 'IP'],
      res.data.map(a => [new Date(a.ts).toISOString(), a.username, a.role, t(a.actionKey),
        `${a.entityType || ''} ${a.entityId || ''}`, JSON.stringify(a.oldValue || ''), JSON.stringify(a.newValue || ''), a.ip]));

    const types = ['item', 'stock_lot', 'purchase_order', 'sales_order', 'production_order', 'inspection', 'ncr', 'user', 'settings'];

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Her değişiklik kim, ne zaman, eski ve yeni değeriyle birlikte kaydedilir. Bu kayıt silinemez.'
        : 'Every change is recorded with who, when, and the old and new value. This log cannot be deleted.'}</div>
      <div class="filters">
        ${select('auType', [{ v: '', l: t('all') }, ...types.map(x => ({ v: x, l: x }))], auditFilter.entityType)}
        <input id="auUser" placeholder="${t('auditUser')}" value="${esc(auditFilter.username)}">
      </div>
      <div class="card">${table([
        { key: 'ts', label: t('date'), render: a => ts(a.ts), cls: 'nowrap' },
        { key: 'username', label: t('auditUser'), render: a => `${esc(a.username || '—')}<div class="sub-line">${UI.roleLabel(a.role)}</div>` },
        { key: 'actionKey', label: t('auditAction'), render: a => esc(t(a.actionKey)) },
        { key: 'entity', label: t('auditEntity'), render: a => a.entityType
            ? `<span class="badge plain">${esc(a.entityType)}</span><div class="sub-line mono">${esc(String(a.entityId || '').slice(0, 12))}</div>` : '—' },
        { key: 'detail', label: t('detail'), render: a => esc(a.detail || '—') },
        { key: 'change', label: `${t('auditOld')} → ${t('auditNew')}`, render: a => {
            if (!a.oldValue && !a.newValue) return '—';
            const keys = [...new Set([...Object.keys(a.oldValue || {}), ...Object.keys(a.newValue || {})])];
            return keys.slice(0, 4).map(k => {
              const o = a.oldValue ? a.oldValue[k] : undefined;
              const n = a.newValue ? a.newValue[k] : undefined;
              if (JSON.stringify(o) === JSON.stringify(n)) return '';
              return `<div style="font-size:11.5px"><span style="color:var(--text-faint)">${esc(k)}:</span>
                <span style="color:var(--danger)">${esc(fmtVal(o))}</span> →
                <span style="color:var(--success)">${esc(fmtVal(n))}</span></div>`;
            }).filter(Boolean).join('') || '—';
          } }
      ], res.data)}
      ${pager(res, p => { auditFilter.page = p; load(el); })}</div>`;

    document.getElementById('auType').onchange = e => { auditFilter.entityType = e.target.value; auditFilter.page = 1; load(el); };
    const uInp = document.getElementById('auUser');
    uInp.oninput = UI.debounce(() => { auditFilter.username = uInp.value; auditFilter.page = 1; load(el); }, 400);
  }

  const fmtVal = (v) => {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'boolean') return v ? '✓' : '✗';
    if (typeof v === 'number') return num(v, 2);
    const s = String(v);
    return s.length > 28 ? s.slice(0, 28) + '…' : s;
  };

  /* ================= SETTINGS ================= */
  async function settingsTab(el, body, actions) {
    const s = await Api.settings();
    actions.innerHTML = '';
    const editable = can('approve');

    body.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('tabSettings')}</h3></div><div class="card-body">
        <div class="field-row">
          ${field(t('companyName'), input('stName', { value: s.companyName, attrs: editable ? '' : 'disabled' }))}
          ${field(t('baseCurrency'), select('stCur', [{ v: 'TRY', l: 'TRY ₺' }, { v: 'USD', l: 'USD $' }, { v: 'EUR', l: 'EUR €' }], s.baseCurrency, { attrs: editable ? '' : 'disabled' }))}
        </div>
        <div class="field-row three">
          ${field(t('defaultLaborRate'), input('stLabor', { type: 'number', min: 0, step: '0.01', value: s.defaultLaborRate, attrs: editable ? '' : 'disabled' }))}
          ${field(t('defaultOverheadPct'), input('stOh', { type: 'number', min: 0, step: '0.1', value: s.defaultOverheadPct, attrs: editable ? '' : 'disabled' }))}
          ${field(t('expiryWarningDays'), input('stExp', { type: 'number', min: 1, value: s.expiryWarningDays, attrs: editable ? '' : 'disabled' }))}
        </div>
        ${editable ? `<button class="btn btn-primary" id="stGo">${t('save')}</button>` : ''}
      </div></div>

      <div class="card"><div class="card-head"><h3>${t('tabBackup')}</h3></div><div class="card-body">
        <div class="alert info">${t('backupHint')}</div>
        <div style="font-size:12.5px;color:var(--text-muted);line-height:1.7">
          ${UI.getLang() === 'tr'
            ? 'Sunucu her 24 saatte bir otomatik yedek alır ve son 14 yedeği saklar. Elle yedek için sunucuda <span class="mono">npm run backup</span> komutunu çalıştırın.'
            : 'The server backs up every 24 hours and keeps the last 14 copies. For a manual backup run <span class="mono">npm run backup</span> on the server.'}
        </div>
      </div></div>`;

    document.getElementById('stGo')?.addEventListener('click', async () => {
      try {
        await Api.updateSettings({
          companyName: val('stName'), baseCurrency: val('stCur'),
          defaultLaborRate: numVal('stLabor'), defaultOverheadPct: numVal('stOh'),
          expiryWarningDays: intVal('stExp')
        });
        UI.ok(t('saved'));
        document.getElementById('brandName').textContent = val('stName');
      } catch (e) { UI.err(e); }
    });
  }

  /* ================= e-BELGE AYARLARI ================= */
  async function edocTab(el, body, actions) {
    const s2 = await Api.edocSettings();
    actions.innerHTML = '';
    const editable = can('approve');
    const dis = editable ? '' : 'disabled';
    const c = s2.company || {};

    body.innerHTML = `
      <div class="alert info">${t('edocLegalWarning')}</div>
      ${s2.provider === 'local' ? `<div class="alert warn">${t('edocLocalHint')}</div>` : ''}

      <div class="card"><div class="card-head"><h3>${t('edocSettings')}</h3></div><div class="card-body">
        ${UI.checkbox('edEnabled', t('edocEnabled'), s2.enabled)}
        <div class="field-row three">
          ${field(t('edocProvider'), select('edProvider', [
            { v: 'local', l: UI.getLang() === 'tr' ? 'Yerel (dosyaya yaz)' : 'Local (write to disk)' },
            { v: 'http', l: UI.getLang() === 'tr' ? 'HTTP entegratör' : 'HTTP integrator' }], s2.provider, { attrs: dis }))}
          ${field('API URL', input('edUrl', { value: s2.providerConfig.baseUrl || '', attrs: dis }))}
          ${field('API Key', input('edKey', { type: 'password',
            placeholder: s2.providerConfig.apiKeySet ? '•••••• (tanımlı)' : '', attrs: dis }),
            UI.getLang() === 'tr' ? 'Boş bırakılırsa mevcut anahtar korunur.' : 'Leave blank to keep the existing key.')}
        </div>
        <div class="field-row">
          ${UI.checkbox('edTest', t('edocTestMode'), s2.testMode)}
          ${field(t('vatRate'), input('edVat', { type: 'number', min: 0, max: 100, step: '0.1', value: s2.defaultVatRate, attrs: dis }))}
        </div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${UI.getLang() === 'tr' ? 'Gönderici bilgileri' : 'Sender details'}</h3></div>
      <div class="card-body">
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Bu bilgiler faturanın üzerinde yer alır. Hatalı olması belgenin GİB tarafından reddedilmesine yol açar.'
          : 'These appear on the invoice header. Errors here cause the document to be rejected.'}</div>
        <div class="field-row">
          ${field(t('companyName'), input('edName', { value: c.name || '', attrs: dis }))}
          ${field(t('identityNo'), input('edTaxNo', { value: c.taxNo || '', attrs: dis }))}
        </div>
        <div class="field-row three">
          ${field(t('taxOffice'), input('edTaxOffice', { value: c.taxOffice || '', attrs: dis }))}
          ${field(t('district'), input('edDistrict', { value: c.district || '', attrs: dis }))}
          ${field(t('city'), input('edCity', { value: c.city || '', attrs: dis }))}
        </div>
        ${field(UI.getLang() === 'tr' ? 'Adres' : 'Address', input('edAddr', { value: c.address || '', attrs: dis }))}
        <div class="field-row three">
          ${field(t('postalCode'), input('edPostal', { value: c.postalCode || '', attrs: dis }))}
          ${field(t('mersisNo'), input('edMersis', { value: c.mersisNo || '', attrs: dis }))}
          ${field(t('tradeRegistryNo'), input('edTrade', { value: c.tradeRegistryNo || '', attrs: dis }))}
        </div>
        <div class="field-row">
          ${field(t('senderAlias'), input('edAlias', { value: c.senderAlias || '', attrs: dis }),
            'urn:mail:defaultgb@firma.com')}
          ${field(t('despatchAlias'), input('edDespAlias', { value: c.despatchAlias || '', attrs: dis }))}
        </div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${UI.getLang() === 'tr' ? 'Belge serileri' : 'Document series'}</h3></div>
      <div class="card-body">
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Seri kodu 3 büyük harf olmalıdır. Sıra numarası boşluksuz artar ve elle değiştirilemez.'
          : 'The prefix must be 3 uppercase letters. The sequence increments without gaps and cannot be edited.'}</div>
        ${table([
          { key: 'doc_type', label: t('edocType'), render: r => esc(
            { einvoice: t('edocEinvoice'), earchive: t('edocEarchive'), edespatch: t('edocEdespatch') }[r.doc_type] || r.doc_type) },
          { key: 'prefix', label: t('seriesPrefix'), render: r => editable
              ? `<input class="ed-series" data-type="${esc(r.doc_type)}" data-year="${r.year}" value="${esc(r.prefix)}" maxlength="3"
                   style="width:74px;text-transform:uppercase;background:var(--panel-2);border:1px solid var(--border-input);border-radius:5px;padding:5px 7px;color:var(--text)">`
              : `<span class="mono">${esc(r.prefix)}</span>` },
          { key: 'year', label: UI.getLang() === 'tr' ? 'Yıl' : 'Year', num: true, render: r => r.year },
          { key: 'next_value', label: UI.getLang() === 'tr' ? 'Sıradaki no' : 'Next no', num: true, render: r => num(r.next_value) },
          { key: 'sample', label: UI.getLang() === 'tr' ? 'Örnek' : 'Sample', render: r =>
              `<span class="mono">${esc(r.prefix)}${r.year}${String(r.next_value).padStart(9, '0')}</span>` }
        ], s2.series || [])}
      </div></div>

      ${editable ? `<button class="btn btn-primary" id="edSave">${t('save')}</button>` : ''}`;

    document.getElementById('edSave')?.addEventListener('click', async () => {
      const series = [...body.querySelectorAll('.ed-series')].map(i => ({
        docType: i.dataset.type, year: Number(i.dataset.year), prefix: i.value.toUpperCase().trim()
      }));
      try {
        await Api.updateEdocSettings({
          enabled: UI.checked('edEnabled'), provider: val('edProvider'), testMode: UI.checked('edTest'),
          defaultVatRate: numVal('edVat'),
          providerConfig: { baseUrl: val('edUrl'), apiKey: val('edKey') || undefined },
          company: {
            name: val('edName'), taxNo: val('edTaxNo'), taxOffice: val('edTaxOffice'),
            district: val('edDistrict'), city: val('edCity'), address: val('edAddr'),
            postalCode: val('edPostal'), mersisNo: val('edMersis'), tradeRegistryNo: val('edTrade'),
            senderAlias: val('edAlias'), despatchAlias: val('edDespAlias')
          },
          series
        });
        UI.ok(t('saved')); load(el);
      } catch (e) { UI.err(e); }
    });
  }

  /* ================= VERİ AKTARIMI ================= */
  let importType = 'items';
  let importPreviewData = null;

  async function importTab(el, body, actions) {
    actions.innerHTML = '';
    if (!can('approve')) {
      body.innerHTML = `<div class="empty">${UI.getLang() === 'tr'
        ? 'Veri aktarımı müdür yetkisi gerektirir.' : 'Data import requires manager rights.'}</div>`;
      return;
    }

    const [types, batches] = await Promise.all([
      Api.importTypes(),
      Api.importBatches({ pageSize: 15 }).catch(() => ({ data: [] }))
    ]);
    const current = types.find(x => x.key === importType) || types[0];

    body.innerHTML = `
      <div class="alert info">${t('importHint')}</div>
      <div class="alert warn">${t('importOrderHint')}</div>

      <div class="card"><div class="card-head"><h3>${t('importTitle')}</h3></div><div class="card-body">
        <div class="field-row three">
          ${field(t('importType'), select('imType', types.map(x => ({ v: x.key, l: x.label })), importType))}
          ${field(t('duplicateMode'), select('imDup', [
            { v: 'skip', l: t('dupSkip') }, { v: 'update', l: t('dupUpdate') }, { v: 'fail', l: t('dupFail') }]))}
          <div class="field"><label>&nbsp;</label>
            <button class="btn btn-ghost" id="imTpl" style="width:100%;justify-content:center">
              ${UI.icon(UI.ICONS.download)}${t('downloadTemplate')}</button></div>
        </div>

        ${current.dependsOn.length ? `<div class="alert warn">${t('dependsOn')}:
          ${current.dependsOn.map(d => esc((types.find(x => x.key === d) || {}).label || d)).join(', ')}</div>` : ''}

        <div class="section-title">${UI.getLang() === 'tr' ? 'Beklenen sütunlar' : 'Expected columns'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${current.fields.map(f => `<span class="badge ${f.required ? 'warn' : 'plain'}"
            title="${f.required ? 'zorunlu' : 'isteğe bağlı'}${f.options ? ' · ' + esc(f.options.join('/')) : ''}">${esc(f.label)}</span>`).join('')}
        </div>

        <div class="field"><label>${t('selectFile')}</label>
          <input type="file" id="imFile" accept=".xlsx,.xlsm" style="font-size:12.5px"></div>
        <button class="btn btn-primary" id="imUpload">${UI.icon(UI.ICONS.upload)}${t('uploadAndPreview')}</button>
      </div></div>

      <div id="imPreview"></div>

      <div class="card"><div class="card-head"><h3>${t('importHistory')}</h3></div>
        ${table([
          { key: 'batchNo', label: t('batchNo'), render: b => `<span class="mono">${esc(b.batchNo)}</span>
              <div class="sub-line">${esc(b.label)}</div>` },
          { key: 'fileName', label: t('fileName'), render: b => esc(b.fileName || '—') },
          { key: 'totalRows', label: t('totalRows'), num: true, render: b => num(b.totalRows) },
          { key: 'importedRows', label: t('imported'), num: true, render: b => num(b.importedRows) },
          { key: 'errorRows', label: t('errorRows'), num: true, render: b => b.errorRows
              ? `<span style="color:var(--danger)">${num(b.errorRows)}</span>` : '0' },
          { key: 'status', label: t('status'), render: b => importStatusBadge(b.status) },
          { key: 'username', label: t('auditUser'), render: b => esc(b.username || '—') },
          { key: 'createdAt', label: t('date'), render: b => ts(b.createdAt), cls: 'nowrap' },
          { key: 'act', label: t('actions'), render: b => `<div class="row-actions">
              ${b.status === 'preview' ? `<button class="btn btn-primary btn-sm" data-open="${esc(b.id)}">${t('importPreview')}</button>` : ''}
              ${b.status === 'committed' ? `<button class="btn btn-ghost btn-sm" data-revert="${esc(b.id)}">${t('importRevert')}</button>` : ''}
            </div>` }
        ], batches.data || [], { emptyText: t('noImports') })}</div>`;

    document.getElementById('imType').onchange = e => { importType = e.target.value; load(el); };
    document.getElementById('imTpl').onclick = () => {
      // Yetkilendirme başlığı gerektiği için doğrudan bağlantı kullanılamaz
      downloadTemplate(importType);
    };
    document.getElementById('imUpload').onclick = () => doUpload(el);
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => showPreview(el, b.dataset.open));
    body.querySelectorAll('[data-revert]').forEach(b => b.onclick = () => {
      UI.confirmDialog(t('importRevertHint'), async () => {
        try {
          const r = await Api.importRevert(b.dataset.revert);
          UI.ok(`${r.deleted} ${t('deletedRecords')}, ${r.kept} ${t('keptRecords')}`);
          if (r.reasons && r.reasons.length) {
            modal({
              title: t('importRevert'), size: 'wide',
              body: `<div class="alert warn">${UI.getLang() === 'tr'
                ? 'Bazı kayıtlar korundu:' : 'Some records were kept:'}</div>
                <ul style="font-size:12.5px;line-height:1.8;color:var(--text-muted)">
                ${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`,
              footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
            });
          }
          load(el);
        } catch (e) { UI.err(e); }
      }, { danger: true, confirmLabel: t('importRevert') });
    });

    if (importPreviewData) showPreviewInline(el, importPreviewData);
  }

  const importStatusBadge = (st) => {
    const m = {
      preview: ['warn', t('statusPreview')], committed: ['ok', t('statusCommitted')],
      reverted: ['plain', t('statusReverted')], failed: ['crit', t('statusFailed')]
    };
    const [c, l] = m[st] || ['plain', st];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };

  /** Şablon indirme: yetki başlığı gerektiği için blob üzerinden. */
  async function downloadTemplate(type) {
    try {
      const res = await fetch('/api/import/template/' + type, {
        headers: { Authorization: 'Bearer ' + Api.getToken() }
      });
      if (!res.ok) throw new Error('Şablon indirilemedi / Template download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `sablon-${type}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      UI.ok(t('saved'));
    } catch (e) { UI.err(e); }
  }

  async function doUpload(el) {
    const fileInput = document.getElementById('imFile');
    const file = fileInput.files[0];
    if (!file) return UI.toast(UI.getLang() === 'tr' ? 'Önce dosya seçin.' : 'Choose a file first.', 'err');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('importType', val('imType'));
    fd.append('duplicateMode', val('imDup'));

    const btn = document.getElementById('imUpload');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${t('loading')}`;
    try {
      importPreviewData = await Api.importPreview(fd);
      load(el);
    } catch (e) {
      UI.err(e);
      // Sütun bulunamadıysa dosyada hangi başlıklar olduğunu göstermek, kullanıcının
      // "neden olmadı" sorusunu tek bakışta cevaplar.
      if (e.payload && e.payload.headers) {
        modal({
          title: t('unmatchedColumns'), size: 'wide',
          body: `<div class="alert crit">${esc(e.message)}</div>
            <div class="section-title">${t('detectedHeaders')}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${e.payload.headers.map(h => `<span class="badge plain">${esc(h)}</span>`).join('')}</div>
            <div class="alert info" style="margin-top:14px">${UI.getLang() === 'tr'
              ? 'Doğru sütunlar için şablonu indirip kullanabilirsiniz.'
              : 'Download the template to get the correct columns.'}</div>`,
          footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
        });
      }
      btn.disabled = false;
      btn.innerHTML = UI.icon(UI.ICONS.upload) + t('uploadAndPreview');
    }
  }

  function showPreviewInline(el, p) {
    const host = document.getElementById('imPreview');
    if (!host) return;
    const allGood = p.errorRows === 0;
    host.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('importPreview')} — ${esc(p.batchNo)}</h3></div>
      <div class="card-body">
        <div class="stat-row">
          ${UI.stat(t('totalRows'), num(p.totalRows))}
          ${UI.stat(t('validRows'), num(p.validRows), { kind: 'ok' })}
          ${UI.stat(t('errorRows'), num(p.errorRows), { kind: p.errorRows ? 'crit' : 'ok' })}
        </div>
        ${p.unmatchedColumns && p.unmatchedColumns.length ? `<div class="alert warn">
          ${t('unmatchedColumns')}: ${p.unmatchedColumns.map(c => esc(c)).join(', ')}
          — ${UI.getLang() === 'tr' ? 'bu sütunlar yok sayılacak.' : 'these will be ignored.'}</div>` : ''}
        ${allGood ? `<div class="alert ok">${UI.getLang() === 'tr'
          ? 'Tüm satırlar geçerli. Kaydedebilirsiniz.' : 'All rows are valid. You can save.'}</div>`
          : `<div class="alert crit">${UI.getLang() === 'tr'
            ? `${p.errorRows} satır hatalı. Kaydederseniz bu satırlar ATLANIR, geri kalanı yazılır.`
            : `${p.errorRows} rows have errors. Saving will SKIP them and write the rest.`}</div>`}

        ${p.errorSample && p.errorSample.length ? `
          <div class="section-title">${t('rowErrors')}</div>
          ${table([
            { key: 'rowNo', label: t('rowNo'), num: true, render: r => num(r.rowNo) },
            { key: 'errors', label: t('rowErrors'), render: r => r.errors.map(e2 =>
                `<div style="color:var(--danger);font-size:12px">${esc(e2)}</div>`).join('') },
            { key: 'data', label: UI.getLang() === 'tr' ? 'Okunan' : 'Parsed', render: r =>
                `<span class="mono" style="font-size:11px">${esc(JSON.stringify(r.data).slice(0, 90))}</span>` }
          ], p.errorSample.slice(0, 20))}` : ''}

        <div class="section-title">${UI.getLang() === 'tr' ? 'İlk satırlar' : 'First rows'}</div>
        ${previewTable(p.sample)}

        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-primary" id="imCommit" ${p.validRows === 0 ? 'disabled' : ''}>
            ${t('importCommit')} (${num(p.validRows)})</button>
          <button class="btn btn-ghost" id="imAllRows">${UI.getLang() === 'tr' ? 'Tüm satırları gör' : 'See all rows'}</button>
          <button class="btn btn-danger" id="imDiscard">${t('importDiscard')}</button>
        </div>
      </div></div>`;

    document.getElementById('imCommit').onclick = async () => {
      try {
        const r = await Api.importCommit(p.batchId);
        importPreviewData = null;
        UI.ok(`${r.created} ${t('importedRowsInfo')}, ${r.updated} ${t('updatedRowsInfo')}, ${r.skipped} ${t('skippedRowsInfo')}`);
        load(el);
      } catch (e) { UI.err(e); }
    };
    document.getElementById('imDiscard').onclick = async () => {
      try { await Api.importDiscard(p.batchId); importPreviewData = null; UI.ok(t('deleted')); load(el); }
      catch (e) { UI.err(e); }
    };
    document.getElementById('imAllRows').onclick = () => showPreview(el, p.batchId);
  }

  const previewTable = (rows) => table([
    { key: 'rowNo', label: t('rowNo'), num: true, render: r => num(r.rowNo) },
    { key: 'valid', label: t('status'), render: r => (r.errors && r.errors.length)
        ? `<span class="badge crit">${t('rowErrors')}</span>`
        : (r.warnings && r.warnings.length)
          ? `<span class="badge warn">${t('rowWarnings')}</span>`
          : `<span class="badge ok">OK</span>` },
    { key: 'data', label: UI.getLang() === 'tr' ? 'Okunan veri' : 'Parsed data', render: r =>
        Object.entries(r.data).slice(0, 6).map(([k, v]) =>
          `<span class="badge plain" style="margin:1px">${esc(k)}: ${esc(String(v).slice(0, 24))}</span>`).join(' ') },
    { key: 'notes', label: t('rowWarnings'), render: r => [...(r.errors || []), ...(r.warnings || [])]
        .slice(0, 2).map(x => `<div style="font-size:11.5px;color:var(--text-faint)">${esc(x)}</div>`).join('') }
  ], rows);

  async function showPreview(el, batchId) {
    let onlyErrors = false, page = 1;
    const render2 = async () => {
      const rows = await Api.importRows(batchId, { onlyErrors: onlyErrors ? '1' : '', page, pageSize: 50 });
      modal({
        title: t('importPreview'), size: 'xwide',
        body: `<div class="filters">
            <button class="chip ${onlyErrors ? 'active' : ''}" id="pvErr">${t('showOnlyErrors')}</button>
          </div>
          ${previewTable(rows.data)}
          ${pager(rows, p2 => { page = p2; closeModal(); render2(); })}`,
        footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`,
        onOpen: (box) => {
          box.querySelector('#pvErr').onclick = () => { onlyErrors = !onlyErrors; page = 1; closeModal(); render2(); };
        }
      });
    };
    await render2();
  }

  /* ================= BELGE ŞABLONLARI ================= */
  let tplType = 'shipment';

  async function templatesTab(el, body, actions) {
    actions.innerHTML = '';
    if (!can('approve')) {
      body.innerHTML = `<div class="empty">${UI.getLang() === 'tr'
        ? 'Şablon düzenleme müdür yetkisi gerektirir.' : 'Editing templates requires manager rights.'}</div>`;
      return;
    }

    const [all, branding] = await Promise.all([Api.templates(), Api.branding()]);
    const tpl = all.find(x => x.docType === tplType) || all[0];
    tplType = tpl.docType;
    const L = tpl.layout || {};
    const isLabel = L.paperSize === 'label';

    const typeLabel = {
      shipment: t('docShipment'), purchase_order: t('docPurchaseOrder'),
      production_order: t('docProductionOrder'), inspection: t('docInspection'),
      traceability: t('docTraceability'), count: t('docCount'),
      label: t('docLabel'), stock_card: t('docStockCard')
    };

    body.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('branding')}</h3></div><div class="card-body">
        <div class="alert info">${UI.getLang() === 'tr'
          ? 'Buradaki bilgiler her belgenin üstünde çıkar. Müşteriye ve tedarikçiye giden belgelerdir.'
          : 'These appear on top of every document — the ones that reach customers and suppliers.'}</div>
        <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:0 0 auto;text-align:center">
            <div style="width:190px;height:96px;border:1px dashed var(--border-input);border-radius:7px;
              display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden">
              ${branding.logo
                ? `<img src="${esc(branding.logo)}" style="max-width:178px;max-height:84px;object-fit:contain">`
                : `<span style="color:#999;font-size:12px">${t('noLogo')}</span>`}
            </div>
            <div style="display:flex;gap:6px;margin-top:9px;justify-content:center">
              <input type="file" id="tplLogoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none">
              <button class="btn btn-ghost btn-sm" id="tplLogoBtn">${t('uploadLogo')}</button>
              ${branding.logo ? `<button class="btn btn-danger btn-sm" id="tplLogoDel">${t('removeLogo')}</button>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-faint);margin-top:7px;max-width:190px">${t('logoHint')}</div>
          </div>
          <div style="flex:1;min-width:280px">
            <div class="field-row">
              ${field(t('companyName'), input('brName', { value: branding.name || '' }))}
              ${field(t('phone'), input('brPhone', { value: branding.phone || '' }))}
            </div>
            <div class="field-row">
              ${field(t('email'), input('brEmail', { value: branding.email || '' }))}
              ${field('Web', input('brWeb', { value: branding.website || '' }))}
            </div>
            ${field(UI.getLang() === 'tr' ? 'Adres' : 'Address', input('brAddr', { value: branding.address || '' }))}
            ${field(t('printFooter'), textarea('brFooter', { value: branding.printFooter || '', rows: 2 }), t('printFooterHint'))}
            <button class="btn btn-primary btn-sm" id="brSave">${t('save')}</button>
          </div>
        </div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${t('templateTitle')}</h3></div><div class="card-body">
        <div class="filters">
          ${select('tplType', all.map(x => ({ v: x.docType, l: typeLabel[x.docType] || x.name })), tplType)}
        </div>

        <div class="section-title">${t('layout')}</div>
        <div class="field-row three">
          ${field(t('paperSize'), select('tplPaper', [
            { v: 'A4', l: 'A4' }, { v: 'A5', l: 'A5' }, { v: 'letter', l: 'Letter' },
            { v: 'label', l: UI.getLang() === 'tr' ? 'Etiket (100×70mm)' : 'Label (100×70mm)' }], L.paperSize || 'A4'))}
          ${field(t('orientation'), select('tplOrient', [
            { v: 'portrait', l: t('portrait') }, { v: 'landscape', l: t('landscape') }], L.orientation || 'portrait'))}
          ${field(t('accentColor'), `<input type="color" id="tplColor" value="${esc(L.accentColor || '#111111')}"
            style="width:100%;height:38px;background:var(--panel-2);border:1px solid var(--border-input);border-radius:6px;padding:3px">`)}
        </div>
        <div class="field-row three">
          ${field(t('marginMm'), input('tplMargin', { type: 'number', min: 0, max: 50, value: L.marginMm ?? 14 }))}
          ${field(t('fontSize'), input('tplFont', { type: 'number', min: 6, max: 20, step: '0.5', value: L.fontSize ?? 12 }))}
          ${field(t('logoHeight'), input('tplLogoH', { type: 'number', min: 5, max: 40, value: L.logoHeightMm ?? 16 }))}
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:6px">
          ${checkbox('tplShowLogo', t('showLogo'), L.showLogo !== false)}
          ${checkbox('tplShowCo', t('showCompanyInfo'), L.showCompanyInfo !== false)}
          ${checkbox('tplShowDate', t('showDocumentDate'), L.showDocumentDate !== false)}
          ${checkbox('tplStriped', t('tableStriped'), L.tableStriped !== false)}
          ${isLabel ? checkbox('tplBarcode', t('showBarcode'), !!L.showBarcode) : ''}
        </div>

        <div class="section-title">${t('visibleFields')}</div>
        <div class="alert info">${t('fieldsHint')}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          ${(tpl.fields || []).map(f => `<label style="display:flex;align-items:center;gap:7px;
            font-size:12.5px;cursor:pointer;background:var(--panel-2);border:1px solid var(--border-soft);
            border-radius:6px;padding:6px 10px">
            <input type="checkbox" class="tpl-field" data-key="${esc(f.key)}" ${f.visible ? 'checked' : ''} style="width:auto">
            ${esc(f.label)}</label>`).join('')}
        </div>

        <div class="section-title">${t('signatureBoxes')}</div>
        <div id="tplSigs" class="dyn-list"></div>
        <button class="btn btn-ghost btn-sm" id="tplSigAdd" style="margin-bottom:12px">${t('addSignature')}</button>

        ${field(t('headerText'), input('tplHeader', { value: tpl.headerText || '' }))}
        ${field(t('footerText'), textarea('tplFooter', { value: tpl.footerText || '', rows: 2 }))}

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-primary" id="tplSave">${t('save')}</button>
          <button class="btn btn-ghost" id="tplPreview">${UI.icon(UI.ICONS.print)}${t('previewPrint')}</button>
          <button class="btn btn-danger" id="tplReset">${t('resetTemplate')}</button>
        </div>
      </div></div>`;

    /* --- imza kutuları --- */
    let sigs = [...(tpl.signatures || [])];
    const drawSigs = () => {
      const host = document.getElementById('tplSigs');
      host.innerHTML = sigs.length ? sigs.map((sg, i) => `
        <div class="dyn-row">
          <input type="text" value="${esc(sg)}" data-i="${i}" style="flex:1" maxlength="60">
          <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
        </div>`).join('')
        : `<div style="font-size:12px;color:var(--text-faint);padding:6px 0">${UI.getLang() === 'tr'
            ? 'İmza kutusu yok.' : 'No signature boxes.'}</div>`;
      host.querySelectorAll('input').forEach(i => i.oninput = () => { sigs[+i.dataset.i] = i.value; });
      host.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sigs.splice(+b.dataset.rm, 1); drawSigs(); });
    };
    drawSigs();
    document.getElementById('tplSigAdd').onclick = () => {
      if (sigs.length >= 4) return UI.toast(UI.getLang() === 'tr' ? 'En fazla 4 imza kutusu.' : 'Up to 4 boxes.', 'err');
      sigs.push(''); drawSigs();
    };

    document.getElementById('tplType').onchange = e => { tplType = e.target.value; load(el); };

    /* --- logo --- */
    const fileInput = document.getElementById('tplLogoFile');
    document.getElementById('tplLogoBtn').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      if (!fileInput.files[0]) return;
      const fd = new FormData();
      fd.append('logo', fileInput.files[0]);
      try {
        await Api.uploadLogo(fd);
        UI.clearPrintCache();          // önbellekteki eski logo kalmasın
        UI.ok(t('saved')); load(el);
      } catch (e) { UI.err(e); }
    };
    document.getElementById('tplLogoDel')?.addEventListener('click', () => {
      UI.confirmDialog(t('confirmDelete'), async () => {
        try { await Api.deleteLogo(); UI.clearPrintCache(); UI.ok(t('deleted')); load(el); }
        catch (e) { UI.err(e); }
      }, { danger: true });
    });

    document.getElementById('brSave').onclick = async () => {
      try {
        await Api.saveBranding({
          name: val('brName'), phone: val('brPhone'), email: val('brEmail'),
          website: val('brWeb'), address: val('brAddr'), printFooter: val('brFooter')
        });
        UI.clearPrintCache(); UI.ok(t('saved')); load(el);
      } catch (e) { UI.err(e); }
    };

    const collect = () => ({
      layout: {
        paperSize: val('tplPaper'), orientation: val('tplOrient'),
        marginMm: numVal('tplMargin'), fontSize: numVal('tplFont'),
        accentColor: document.getElementById('tplColor').value,
        logoHeightMm: numVal('tplLogoH'),
        showLogo: checked('tplShowLogo'), showCompanyInfo: checked('tplShowCo'),
        showDocumentDate: checked('tplShowDate'), tableStriped: checked('tplStriped'),
        ...(document.getElementById('tplBarcode') ? { showBarcode: checked('tplBarcode') } : {})
      },
      fields: [...body.querySelectorAll('.tpl-field')].map((cb, i) => {
        const orig = (tpl.fields || []).find(f => f.key === cb.dataset.key) || {};
        return { key: cb.dataset.key, label: orig.label || cb.dataset.key, visible: cb.checked, order: i };
      }),
      signatures: sigs.filter(x => x.trim()),
      headerText: val('tplHeader'), footerText: val('tplFooter')
    });

    document.getElementById('tplSave').onclick = async () => {
      try {
        await Api.saveTemplate(tplType, collect());
        UI.clearPrintCache();
        UI.ok(t('templateSaved')); load(el);
      } catch (e) { UI.err(e); }
    };

    document.getElementById('tplReset').onclick = () => {
      UI.confirmDialog(UI.getLang() === 'tr'
        ? 'Bu şablon varsayılan ayarlara dönecek.' : 'This template will return to its defaults.',
        async () => {
          try { await Api.resetTemplate(tplType); UI.clearPrintCache(); UI.ok(t('saved')); load(el); }
          catch (e) { UI.err(e); }
        }, { danger: true });
    };

    // Önizleme: kaydetmeden önce nasıl göründüğünü görmek, deneme yanılmayı kısaltır
    document.getElementById('tplPreview').onclick = async () => {
      try {
        await Api.saveTemplate(tplType, collect());
        UI.clearPrintCache();
        const visible = collect().fields.filter(f => f.visible);
        await UI.printDoc(tplType, typeLabel[tplType] || tpl.name, `
          <div class="doc-note">${UI.getLang() === 'tr'
            ? 'ÖRNEK BELGE — gerçek veri içermez, yalnızca düzeni gösterir.'
            : 'SAMPLE DOCUMENT — layout preview only, no real data.'}</div>
          <div class="g">${visible.slice(0, 8).map(f =>
            `<div><b>${esc(f.label)}:</b> ${UI.getLang() === 'tr' ? 'örnek değer' : 'sample value'}</div>`).join('')}</div>
          <h4>${UI.getLang() === 'tr' ? 'Kalemler' : 'Line items'}</h4>
          <table><thead><tr><th>#</th><th>${UI.getLang() === 'tr' ? 'Açıklama' : 'Description'}</th>
            <th class="r">${UI.getLang() === 'tr' ? 'Miktar' : 'Qty'}</th>
            <th class="r">${UI.getLang() === 'tr' ? 'Tutar' : 'Amount'}</th></tr></thead>
          <tbody>${[1, 2, 3].map(i => `<tr><td>${i}</td><td>${UI.getLang() === 'tr'
            ? 'Örnek kalem ' + i : 'Sample line ' + i}</td><td class="r">${i * 10}</td>
            <td class="r">${(i * 1250).toLocaleString('tr-TR')},00</td></tr>`).join('')}</tbody></table>`);
      } catch (e) { UI.err(e); }
    };
  }

  /* ================= VERİ SAĞLIĞI ================= */
  async function healthTab(el, body, actions) {
    actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="dhRun">${UI.icon(UI.ICONS.check)}${t('runCheck')}</button>`;
    const rep = await Api.healthReport();

    const sevBadge = (s2) => {
      const m = { critical: ['crit', t('sevCritical')], warning: ['warn', t('sevWarning')], info: ['info', t('sevInfo')] };
      const [c, l] = m[s2] || ['plain', s2];
      return `<span class="badge ${c}">${esc(l)}</span>`;
    };
    const scoreColor = rep.score >= 90 ? 'var(--success)' : rep.score >= 70 ? 'var(--accent)' : 'var(--danger)';
    const withFindings = rep.checks.filter(c => c.count > 0);
    const order = { critical: 0, warning: 1, info: 2 };
    withFindings.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

    body.innerHTML = `
      <div class="alert info">${t('healthHint')}</div>
      <div class="stat-row">
        ${UI.stat(t('healthScore'), `<span style="color:${scoreColor}">${rep.score}</span>`,
          { sub: ts(rep.generatedAt) })}
        ${UI.stat(t('sevCritical'), rep.totals.criticalTypes, { kind: rep.totals.criticalTypes ? 'crit' : 'ok' })}
        ${UI.stat(t('sevWarning'), rep.totals.warningTypes, { kind: rep.totals.warningTypes ? 'warn' : 'ok' })}
        ${UI.stat(UI.getLang() === 'tr' ? 'Toplam bulgu' : 'Total findings', num(rep.totals.totalFindings))}
      </div>

      ${withFindings.length ? withFindings.map(c => `
        <div class="card">
          <div class="card-head">
            <div><h3 style="margin:0">${esc(c.title)}</h3>
              <div class="sub-line">${sevBadge(c.severity)} ${num(c.count)} ${t('findings')}</div></div>
            <div class="row-actions">
              ${c.count > c.sample.length ? `<button class="btn btn-ghost btn-sm" data-all="${esc(c.id)}">${t('seeAll')}</button>` : ''}
              ${c.fixable && can('approve')
                ? `<button class="btn btn-primary btn-sm" data-fix="${esc(c.id)}">${t('autoFix')}</button>`
                : `<span class="badge plain" title="${t('notAutoFixable')}">${t('notAutoFixable')}</span>`}
            </div>
          </div>
          <div class="card-body">
            <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">${esc(c.explanation)}</div>
            ${c.fixable ? `<div class="alert info"><b>${t('fixWhatHappens')}:</b> ${esc(c.fixAction)}</div>` : ''}
            ${table([
              { key: 'label', label: UI.getLang() === 'tr' ? 'Kayıt' : 'Record', render: r => esc(r.label) },
              { key: 'detail', label: UI.getLang() === 'tr' ? 'Ayrıntı' : 'Detail', render: r => `<span class="mono" style="font-size:11.5px">${esc(r.detail || '')}</span>` }
            ], c.sample)}
            ${c.truncated ? `<div class="sub-line" style="margin-top:8px">${UI.getLang() === 'tr'
              ? `İlk ${c.sample.length} kayıt gösteriliyor.` : `Showing first ${c.sample.length}.`}</div>` : ''}
          </div>
        </div>`).join('')
        : `<div class="card"><div class="card-body"><div class="empty" style="padding:36px">
            ${UI.icon(UI.ICONS.check)} ${t('allClean')}</div></div></div>`}

      ${can('approve') ? `<div class="card"><div class="card-head"><h3>${t('mergeRecords')}</h3></div>
        <div class="card-body">
          <div class="alert warn">${UI.getLang() === 'tr'
            ? 'Aynı şeyi temsil eden iki kaydı birleştirir. Kaynak kaydın tüm bağları hedefe taşınır ve kaynak silinir.'
            : 'Merges two records representing the same thing. All references move to the target and the source is removed.'}</div>
          <div class="field-row three">
            ${field(UI.getLang() === 'tr' ? 'Kayıt tipi' : 'Record type', select('mgType', [
              { v: 'item', l: t('itemName') }, { v: 'supplier', l: t('supplier') }, { v: 'customer', l: t('customerName') }]))}
            ${field(t('mergeSource'), input('mgSource', { placeholder: 'ID' }))}
            ${field(t('mergeTarget'), input('mgTarget', { placeholder: 'ID' }))}
          </div>
          <button class="btn btn-ghost" id="mgPrev">${t('mergePreview')}</button>
        </div></div>` : ''}`;

    document.getElementById('dhRun').onclick = () => load(el);

    body.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
      const c = rep.checks.find(x => x.id === b.dataset.fix);
      UI.confirmDialog(`${c.title}\n\n${c.fixAction}`, async () => {
        try {
          const r = await Api.healthFix(c.id);
          UI.ok(`${r.resolved} ${UI.getLang() === 'tr' ? 'kayıt düzeltildi' : 'records fixed'}`);
          load(el);
        } catch (e) { UI.err(e); }
      }, { confirmLabel: t('autoFix') });
    });

    body.querySelectorAll('[data-all]').forEach(b => b.onclick = async () => {
      try {
        const d = await Api.healthCheck(b.dataset.all, { limit: 500 });
        modal({
          title: d.title, sub: `${num(d.total)} ${t('findings')}`, size: 'wide',
          body: table([
            { key: 'label', label: UI.getLang() === 'tr' ? 'Kayıt' : 'Record', render: r => esc(r.label) },
            { key: 'detail', label: UI.getLang() === 'tr' ? 'Ayrıntı' : 'Detail', render: r => esc(r.detail || '') }
          ], d.rows),
          footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`
        });
      } catch (e) { UI.err(e); }
    });

    document.getElementById('mgPrev')?.addEventListener('click', async () => {
      const type = val('mgType'), sourceId = val('mgSource').trim(), targetId = val('mgTarget').trim();
      if (!sourceId || !targetId) return UI.toast(UI.getLang() === 'tr' ? 'İki kayıt da gerekli.' : 'Both records required.', 'err');
      try {
        const p = await Api.mergePreview(type, { sourceId, targetId });
        modal({
          title: t('mergeRecords'), size: 'wide',
          body: `<div class="alert crit"><b>${t('mergeIrreversible')}</b></div>
            <div class="kv-grid">
              <div class="kv"><div class="k">${t('mergeSource')}</div>
                <div class="v">${esc(p.source.name)} <span class="mono">${esc(p.source.code || '')}</span></div></div>
              <div class="kv"><div class="k">${t('mergeTarget')}</div>
                <div class="v">${esc(p.target.name)} <span class="mono">${esc(p.target.code || '')}</span></div></div>
            </div>
            <div class="section-title">${t('mergePreview')} (${num(p.totalReferences)})</div>
            ${p.references.length ? table([
              { key: 'label', label: UI.getLang() === 'tr' ? 'Bağ' : 'Reference', render: r => esc(r.label) },
              { key: 'count', label: UI.getLang() === 'tr' ? 'Adet' : 'Count', num: true, render: r => num(r.count) }
            ], p.references) : `<div class="empty" style="padding:20px">${UI.getLang() === 'tr'
              ? 'Taşınacak bağ yok — kaynak kayıt hiç kullanılmamış.' : 'Nothing to move.'}</div>`}`,
          footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
                   <button class="btn btn-danger" id="mgGo">${t('mergeConfirm')}</button>`,
          onOpen: (box) => {
            box.querySelector('#mgGo').onclick = async () => {
              try {
                const r = await Api.mergeRecords(type, { sourceId, targetId, confirm: true });
                closeModal();
                UI.ok(`${r.totalMoved} ${t('referencesMoved')}`);
                load(el);
              } catch (e) { UI.err(e); }
            };
          }
        });
      } catch (e) { UI.err(e); }
    });
  }

  return { render };
})();
