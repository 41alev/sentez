// @ts-nocheck
const App = (() => {
  const VIEWS = {
    dashboard: ViewDashboard, items: ViewItems, lots: ViewLots, counts: ViewCounts,
    production: ViewProduction, purchasing: ViewPurchasing, crm: ViewCrm, sales: ViewSales, planning: ViewPlanning,
    quality: ViewQuality, reports: ViewReports, admin: ViewAdmin
  };
  let current = null;

  /* ---------- i18n on static markup ---------- */
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = UI.t(n.dataset.i18n); });
    document.getElementById('htmlRoot').lang = UI.getLang();
  }

  /* ---------- routing ---------- */
  async function go(view) {
    if (!VIEWS[view]) view = 'dashboard';
    current = view;
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    el.classList.add('active');
    location.hash = view;
    try { await VIEWS[view].render(el); }
    catch (e) { UI.err(e); el.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; }
  }

  /* ---------- session ---------- */
  function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appShell').style.display = 'none';
  }

  async function showApp() {
    const u = Api.getUser();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'grid';
    document.body.dataset.role = u.role;

    document.getElementById('userName').textContent = u.fullName || u.username;
    document.getElementById('userRole').textContent = UI.roleLabel(u.role);
    document.getElementById('userAvatar').textContent = (u.fullName || u.username).charAt(0).toUpperCase();

    // Admin tab is meaningless for roles that cannot see anything in it
    const adminTab = document.querySelector('.nav-tab[data-view="admin"]');
    if (adminTab) adminTab.style.display = (u.role === 'viewer' || u.role === 'operator') ? 'none' : '';

    try {
      const s = await Api.settings();
      if (s.companyName) document.getElementById('brandName').textContent = s.companyName;
    } catch {}

    if (u.mustChangePassword) promptPasswordChange();

    refreshBadges();
    setInterval(refreshBadges, 120000);

    const start = (location.hash || '').replace('#', '') || 'dashboard';
    go(start);
  }

  function promptPasswordChange() {
    UI.modal({
      title: UI.getLang() === 'tr' ? 'Şifre Değiştirin' : 'Change Your Password',
      sub: UI.getLang() === 'tr' ? 'İlk girişte şifrenizi değiştirmeniz gerekiyor.' : 'You must change your password on first sign-in.',
      body: `${UI.field(UI.getLang() === 'tr' ? 'Mevcut şifre' : 'Current password', UI.input('cpCur', { type: 'password' }))}
             ${UI.field(UI.getLang() === 'tr' ? 'Yeni şifre' : 'New password', UI.input('cpNew2', { type: 'password' }), UI.t('passwordHint'))}`,
      footer: `<button class="btn btn-primary" id="cpGo2">${UI.t('save')}</button>`,
      onOpen: (box) => {
        box.querySelector('#cpGo2').onclick = async () => {
          try {
            await Api.changePassword(UI.val('cpCur'), UI.val('cpNew2'));
            UI.closeModal(); UI.ok(UI.t('saved'));
            const u = Api.getUser(); u.mustChangePassword = false;
            Api.setSession(Api.getToken(), u);
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ---------- badges ---------- */
  async function refreshBadges() {
    if (!Api.getToken()) return;
    try {
      const s = await Api.summary();
      setBadge('badgeApprovals', s.pendingApprovalCount);
      setBadge('badgeQuality', s.openNCRCount + s.pendingInspectionCount);
    } catch {}
    try {
      const n = await Api.notifications({ unread: '1', pageSize: 1 });
      const btn = document.getElementById('btnNotifications');
      btn.style.color = n.unreadCount > 0 ? 'var(--accent)' : '';
      btn.style.borderColor = n.unreadCount > 0 ? 'var(--accent)' : '';
      btn.title = `${UI.t('notifTitle')} (${n.unreadCount})`;
    } catch {}
  }

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count;
    el.classList.toggle('hidden', !count);
  };

  /* ---------- notifications panel ---------- */
  async function openNotifications() {
    const panel = document.getElementById('notifPanel');
    panel.classList.add('show');
    const list = document.getElementById('notifList');
    list.innerHTML = UI.loading();
    try {
      const res = await Api.notifications({ pageSize: 50 });
      list.innerHTML = res.data.length ? res.data.map(n => `
        <div class="notif-item ${n.isRead ? '' : 'unread'}" data-id="${n.id}" data-ref="${UI.esc(n.refType || '')}">
          <div class="t">${sevDot(n.severity)}${UI.esc(n.title)}</div>
          <div class="b">${UI.esc(n.body || '')}</div>
          <div class="d">${UI.ago(n.createdAt)}</div>
        </div>`).join('') : `<div class="empty">${UI.t('noNotifications')}</div>`;

      list.querySelectorAll('.notif-item').forEach(item => item.onclick = async () => {
        try { await Api.markRead(item.dataset.id); } catch {}
        item.classList.remove('unread');
        refreshBadges();
        // Jump to the module the alert is about, so the alert is actionable
        const map = { lot: 'lots', item: 'items', purchase_order: 'purchasing', ncr: 'quality', equipment: 'quality' };
        const target = map[item.dataset.ref];
        if (target) { panel.classList.remove('show'); go(target); }
      });
    } catch (e) { UI.err(e); }
  }

  const sevDot = (s) => `<span class="dot ${s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'info'}"></span>`;

  /* ---------- init ---------- */
  function init() {
    const langSaved = UI.getLang();
    document.getElementById('loginLang').value = langSaved;
    document.getElementById('langSelect').value = langSaved;
    applyStaticI18n();

    // Login
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('loginError');
      errEl.textContent = '';
      try {
        const r = await Api.login(
          document.getElementById('loginUsername').value.trim(),
          document.getElementById('loginPassword').value
        );
        Api.setSession(r.token, r.user);
        document.getElementById('loginPassword').value = '';
        showApp();
      } catch (err) {
        errEl.textContent = err.message || UI.t('loginFailed');
      }
    };

    document.getElementById('loginLang').onchange = (e) => {
      UI.setLang(e.target.value); applyStaticI18n();
    };
    document.getElementById('langSelect').onchange = (e) => {
      UI.setLang(e.target.value); applyStaticI18n();
      document.getElementById('userRole').textContent = UI.roleLabel(Api.getUser().role);
      go(current || 'dashboard');
    };

    document.getElementById('btnLogout').onclick = async () => {
      try { await Api.logout(); } catch {}
      Api.clearSession();
      showLogin();
    };

    document.querySelectorAll('.nav-tab').forEach(b => b.onclick = () => go(b.dataset.view));
    window.addEventListener('hashchange', () => {
      const v = location.hash.replace('#', '');
      if (v && v !== current) go(v);
    });

    document.getElementById('btnNotifications').onclick = openNotifications;
    document.getElementById('btnNotifClose').onclick = () => document.getElementById('notifPanel').classList.remove('show');
    document.getElementById('btnNotifReadAll').onclick = async () => {
      try { await Api.markAllRead(); openNotifications(); refreshBadges(); } catch (e) { UI.err(e); }
    };
    document.getElementById('btnNotifScan').onclick = async () => {
      try {
        const r = await Api.scanAlerts();
        UI.ok(`${r.created} ${UI.getLang() === 'tr' ? 'yeni uyarı' : 'new alert(s)'}`);
        openNotifications(); refreshBadges();
      } catch (e) { UI.err(e); }
    };

    // A revoked or expired token anywhere in the app drops straight back to login
    window.addEventListener('session-expired', () => {
      showLogin();
      UI.toast(UI.getLang() === 'tr' ? 'Oturum sona erdi, tekrar giriş yapın.' : 'Session ended — please sign in again.', 'err');
    });

    if (Api.getToken() && Api.getUser()) {
      // Verify the stored token is still good before showing the app
      Api.me().then(showApp).catch(() => { Api.clearSession(); showLogin(); });
    } else {
      showLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { go, refreshBadges };
})();
