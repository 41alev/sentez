// @ts-nocheck
/* ============================================================
   Depo Terminali

   Tasarımın merkezinde tek bir fikir var: kullanıcı okutur, sistem anlar.
   Masaüstünde "işlem seç → ürün ara → miktar gir" sırası vardır. Depoda bu
   ters çalışır; eldeki okuyucu her an tetiklenebilir ve ekran ne olursa olsun
   okunan koda anlamlı tepki vermelidir.

   Çevrimdışı kuyruk: depoların kablosuz kapsaması genelde kötüdür. İşlem
   kaybetmek yerine kuyruğa alıp bağlantı gelince göndeririz. Kuyruk
   IndexedDB'de durur (bkz. mobile-db.js — bu dosyadan ÖNCE yüklenmeli);
   uygulama kapansa, sekme kapansa hatta cihaz yeniden başlasa bile kaybolmaz.
   Sayfanın kendisi de bir service worker (sw.js) ile önbelleklenir — açılış
   anında hiç bağlantı olmasa bile terminal arayüzü yüklenir; yalnızca API
   verisi gerçek zamanlı kalır (asla önbellekten servis edilmez).
   ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => Number(n || 0).toLocaleString('tr-TR',
    { minimumFractionDigits: d, maximumFractionDigits: d });
  const dt = (s) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('tr-TR') : '—';

  const TOKEN_KEY = 'depoTerminalToken';
  const QUEUE_KEY = 'depoTerminalQueue';

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let user = null;
  let warehouses = [];
  let screen = 'home';
  let screenState = {};
  const history = [];

  /* ============ AĞ ============ */

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401) { logout(false); throw new Error('Oturum sona erdi'); }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Hata ${res.status}`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /* ============ ÇEVRİMDIŞI KUYRUK (IndexedDB — bkz. mobile-db.js) ============ */

  /**
   * Eski sürümün localStorage kuyruğunda bekleyen işlem varsa (yükseltme
   * anında), bir kerelik olarak IndexedDB'ye taşır. Aksi halde bu işlemler
   * sessizce kaybolurdu — kullanıcının o an sahada beklettiği gerçek bir
   * stok/sayım işlemi olabilir.
   */
  async function migrateLegacyQueue() {
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { legacy = []; }
    if (!Array.isArray(legacy) || !legacy.length) return;
    try {
      for (const op of legacy) await MobileDB.add(op);
      localStorage.removeItem(QUEUE_KEY);
    } catch { /* Keep the source until every record has been persisted. */ }
  }

  async function ownQueue() {
    const all = await MobileDB.getAll();
    return user ? all.filter(op => op.ownerId === user.id) : [];
  }

  async function paintQueue() {
    const q = await ownQueue();
    const el = $('mQueue');
    if (!el) return;
    el.hidden = q.length === 0;
    el.textContent = q.length;
    $('mOffline').hidden = navigator.onLine;
  }

  /**
   * İşlemi gönderir; bağlantı yoksa kuyruğa alır.
   * Kuyruğa alınan işlem kullanıcıya "oldu" diye gösterilir çünkü kullanıcı
   * açısından olmuştur — sorumluluğu sistem üstlenir, kişi işine devam eder.
   */
  async function submit(op) {
    if (!user) throw new Error('Önce giriş yapın');
    const sessionToken = token;
    const pending = { ...op, clientId: crypto.randomUUID(), ownerId: user.id, queuedAt: Date.now() };
    // Persist before network I/O: closing the browser after the server commits
    // must still leave the same id available for a safe retry.
    await MobileDB.add(pending);
    if (!navigator.onLine || token !== sessionToken) {
      await paintQueue();
      toast('Çevrimdışı — kuyruğa alındı', 'info');
      return { queued: true };
    }
    try {
      const r = await api('POST', '/mobile/sync', { operations: [pending] });
      const first = r.results[0];
      const sent = (await MobileDB.getAll()).filter(record => record.clientId === pending.clientId && record.ownerId === pending.ownerId);
      await MobileDB.acknowledge(sent, r.results);
      await paintQueue();
      if (!first.ok) {
        const error = new Error(first.error); error.status = first.status || 422; throw error;
      }
      return { queued: false, id: first.id };
    } catch (e) {
      // Ağ hatası kuyruğa gider; iş kuralı hatası gitmez — o tekrar denense de geçmez.
      if (e.status && e.status < 500) throw e;
      await paintQueue();
      toast('Bağlantı yok — kuyruğa alındı', 'info');
      return { queued: true };
    }
  }

  let flushing = false;
  async function flushQueue(silent) {
    if (flushing || !navigator.onLine || !token || !user || user.mustChangePassword) return;
    flushing = true;
    const sessionToken = token;
    try {
      const q = (await ownQueue()).filter(op => !silent || !op.lastError);
      const failed = [];
      let succeeded = 0;
      for (let offset = 0; offset < q.length; offset += 200) {
        if (token !== sessionToken) break;
        const batch = q.slice(offset, offset + 200);
        const r = await api('POST', '/mobile/sync', { operations: batch });
        await MobileDB.acknowledge(batch, r.results);
        failed.push(...r.results.filter(result => !result.ok));
        succeeded += r.succeeded;
      }
      await paintQueue();
      if (token !== sessionToken || !q.length) return;
      if (!silent || failed.length) {
        if (failed.length) {
          toast(`${succeeded} gönderildi, ${failed.length} kuyrukta kaldı`, 'err');
          sheet({
            title: 'Gönderilemeyen işlemler',
            sub: 'Başarısız işlemler hata nedeniyle birlikte kuyrukta saklandı. Stok ve sayım durumunu kontrol ederek yeniden deneyin.',
            body: failed.map(f => `<div class="m-note crit">${esc(f.error)}</div>`).join(''),
            actions: [{ label: 'Anladım', kind: 'primary', onClick: closeSheet }]
          });
        } else {
          toast(`${succeeded} işlem gönderildi`, 'ok');
        }
      }
      if (screen === 'home') render();
    } catch { /* connection lost; exact pending records remain durable */ }
    finally { flushing = false; }
  }

  window.addEventListener('online', async () => { await paintQueue(); flushQueue(true); });
  window.addEventListener('offline', () => { paintQueue(); });

  /* ============ BİLDİRİM VE ALT SAYFA ============ */

  let toastTimer = null;
  function toast(msg, kind = 'ok') {
    const el = $('mToast');
    el.className = 'm-toast show ' + kind;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'm-toast ' + kind; }, 2600);
    // Dokunsal geri bildirim: gürültülü depoda sesli uyarı duyulmaz
    if (navigator.vibrate) navigator.vibrate(kind === 'err' ? [80, 50, 80] : 40);
  }

  function sheet({ title, sub, body, actions = [] }) {
    const host = $('mSheetHost');
    host.hidden = false;
    host.innerHTML = `<div class="m-sheet">
      <div class="m-sheet-grip"></div>
      <div class="m-sheet-title">${esc(title)}</div>
      ${sub ? `<div class="m-sheet-sub">${esc(sub)}</div>` : ''}
      ${body || ''}
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
        ${actions.map((a, i) => `<button class="m-btn ${a.kind ? 'm-btn-' + a.kind : ''} ${a.large ? 'm-btn-lg' : ''}"
          data-act="${i}">${esc(a.label)}</button>`).join('')}
      </div>
    </div>`;
    host.querySelectorAll('[data-act]').forEach(b =>
      b.onclick = () => actions[+b.dataset.act].onClick && actions[+b.dataset.act].onClick(host));
    // Arka plana dokunmak kapatır; kazara kapanmayı önlemek için sadece dış alan
    host.onclick = (e) => { if (e.target === host) closeSheet(); };
  }
  function closeSheet() { const h = $('mSheetHost'); h.hidden = true; h.innerHTML = ''; }

  /* ============ TARAMA ============ */

  /**
   * USB okuyucu klavye gibi davranır: çok hızlı yazar ve Enter'a basar.
   * Tuşlar arası süre, insan yazışından ayırt etmenin güvenilir yoludur.
   */
  function initScanner() {
    const input = $('mScanInput');
    let buf = '', last = 0;

    document.addEventListener('keydown', (e) => {
      if ($('mSheetHost').hidden === false) return;   // diyalog açıkken karışma
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.dataset.barcodeTarget;
      if (typing) return;

      const now = Date.now();
      if (now - last > 35) buf = '';
      last = now;

      if (e.key === 'Enter') {
        const code = (buf || input.value).trim();
        buf = '';
        if (code.length >= 3) { e.preventDefault(); handleScan(code); }
        return;
      }
      if (e.key && e.key.length === 1) buf += e.key;
    }, true);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); handleScan(input.value.trim()); }
    });

    // Tarama alanı her zaman odakta kalsın: okuyucu tetiklendiğinde girdi kaybolmasın
    const refocus = () => {
      if ($('mSheetHost').hidden && !$('mCam').hidden === false) {
        const active = document.activeElement;
        if (!active || active === document.body) input.focus();
      }
    };
    setInterval(refocus, 1200);
  }

  /** Okunan kodu çözer ve ekrana göre doğru işlemi yapar. */
  async function handleScan(code) {
    $('mScanInput').value = '';

    // Bazı ekranlar okumayı kendi işler (sayım, toplama)
    if (screenState.onScan) { screenState.onScan(code); return; }

    try {
      const r = await api('GET', '/mobile/resolve?code=' + encodeURIComponent(code));
      if (r.type === 'item') go('item', { item: r.item, lots: r.lots });
      else if (r.type === 'lot') go('lot', { lot: r.lot });
      else if (r.type === 'purchase_order') go('receive', { poId: r.document.id, doc: r.document });
      else if (r.type === 'shipment') { toast('Sevkiyat: ' + r.document.no, 'info'); }
      else if (r.type === 'production_order') go('issue', { orderId: r.document.id });
      else if (r.type === 'count') go('count', { countId: r.document.id });
      else if (r.type === 'location') go('location', { location: r.location, lots: r.lots });
    } catch (e) {
      if (e.status === 404) {
        toast('Kod bulunamadı: ' + code, 'err');
      } else toast(e.message, 'err');
    }
  }

  /* ============ KAMERA ============ */

  let camStream = null, camTimer = null;
  async function openCamera() {
    if (!('BarcodeDetector' in window)) {
      toast('Bu tarayıcı kamerayla okumayı desteklemiyor', 'err');
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } }
      });
    } catch {
      toast('Kameraya erişilemedi', 'err');
      return;
    }
    const video = $('mVideo');
    video.srcObject = camStream;
    await video.play();
    $('mCam').hidden = false;

    const det = new window.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'data_matrix']
    });
    camTimer = setInterval(async () => {
      try {
        const found = await det.detect(video);
        if (found && found.length) {
          const code = found[0].rawValue;
          closeCamera();
          handleScan(code);
        }
      } catch { /* kare atlandı */ }
    }, 320);
  }
  function closeCamera() {
    clearInterval(camTimer);
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    $('mCam').hidden = true;
  }

  /* ============ YÖNLENDİRME ============ */

  function go(name, state = {}, push = true) {
    if (push && screen) history.push({ screen, screenState });
    screen = name;
    screenState = state;
    render();
  }
  function back() {
    const prev = history.pop();
    if (prev) { screen = prev.screen; screenState = prev.screenState; render(); }
    else go('home', {}, false);
  }

  const TITLES = {
    home: 'Görevler', item: 'Ürün', lot: 'Parti', location: 'Raf',
    receiveList: 'Mal Kabul', receive: 'Mal Kabul', transfer: 'Yer Değiştirme',
    countList: 'Sayım', count: 'Sayım', pickList: 'Toplama', pick: 'Toplama',
    issueList: 'Malzeme Çıkışı', issue: 'Malzeme Çıkışı', queue: 'Bekleyen İşlemler'
  };

  async function render() {
    $('mTitle').textContent = TITLES[screen] || '';
    $('mBack').hidden = screen === 'home';
    const main = $('mMain');
    main.innerHTML = '<div class="m-loading"><span class="m-spin"></span></div>';
    await paintQueue();
    try {
      await SCREENS[screen](main);
    } catch (e) {
      main.innerHTML = `<div class="m-note crit">${esc(e.message)}</div>
        <button class="m-btn" onclick="location.reload()">Yenile</button>`;
    }
  }

  /* ============ EKRANLAR ============ */

  const ICON = {
    receive: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
    transfer: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
    count: '<path d="M9 11l3 3 7-7"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
    pick: '<path d="M3 7l9 5 9-5"/><path d="M3 7v10l9 5 9-5V7"/>',
    issue: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/>'
  };
  const tile = (key, label, icon, count) => `
    <div class="m-tile-wrap">
      <button class="m-tile" data-go="${key}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
        <span class="m-tile-label">${esc(label)}</span>
      </button>
      ${count ? `<span class="m-tile-count">${count}</span>` : ''}
    </div>`;

  const SCREENS = {

    async home(main) {
      const t = await api('GET', '/mobile/tasks');
      screenState.tasks = t;
      const c = t.counts_summary;
      const q = await ownQueue();

      main.innerHTML = `
        <div class="m-note">Okuyucuyu her an kullanabilirsiniz — ürün, parti, belge veya raf
          etiketi okutun, sistem ne olduğunu bulur.</div>
        ${q.length ? `<button class="m-btn m-btn-primary" data-go="queue"
          style="margin-bottom:12px">${q.length} işlem gönderilmeyi bekliyor</button>` : ''}
        <div class="m-tiles">
          ${tile('receiveList', 'Mal Kabul', ICON.receive, c.receipts)}
          ${tile('pickList', 'Toplama', ICON.pick, c.shipments)}
          ${tile('countList', 'Sayım', ICON.count, c.counts)}
          ${tile('issueList', 'Malzeme Çıkışı', ICON.issue, c.production)}
          ${tile('transfer', 'Yer Değiştirme', ICON.transfer, 0)}
        </div>`;
      bindGo(main);
    },

    /* ---------- Ürün ---------- */
    async item(main) {
      const { item, lots } = screenState;
      const low = item.qty <= item.minStock;
      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title">${esc(item.name)}</div>
          <div class="m-card-sub m-mono">${esc(item.code || '')}${item.barcode ? ' · ' + esc(item.barcode) : ''}</div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:14px">
            <span class="m-big-num" style="color:${low ? 'var(--m-danger)' : 'var(--m-ok)'}">${num(item.qty, 2)}</span>
            <span style="color:var(--m-muted);font-size:17px">${esc(item.unit)}</span>
            ${low ? '<span class="m-badge crit">KRİTİK</span>' : ''}
          </div>
          ${item.location ? `<div class="m-card-meta">Raf: <b class="m-mono">${esc(item.location)}</b></div>` : ''}
        </div>
        <button class="m-btn m-btn-primary m-btn-lg" id="itAdd">STOK GİRİŞİ</button>
        <div class="m-card" style="margin-top:12px">
          <div class="m-card-sub" style="margin-bottom:8px">Partiler (${lots.length})</div>
          ${lots.length ? lots.map(l => `
            <div class="m-row">
              <div class="m-row-main">
                <div class="m-row-title m-mono">${esc(l.lotNo || '—')}</div>
                <div class="m-row-sub">${esc(l.warehouseName || '')}${l.expiryDate ? ' · SKT ' + dt(l.expiryDate) : ''}</div>
              </div>
              <div style="text-align:right">
                <div class="m-row-val">${num(l.qty, 2)}</div>
                ${l.status !== 'available'
                  ? `<span class="m-badge ${l.status === 'quarantine' ? 'warn' : 'crit'}">${esc(l.status)}</span>` : ''}
              </div>
            </div>`).join('')
            : '<div class="m-empty">Stokta parti yok</div>'}
        </div>`;

      $('itAdd').onclick = () => qtySheet({
        title: 'Stok Girişi', sub: item.name, unit: item.unit, value: 1,
        extra: `<div class="m-field"><label>Depo</label>
            <select id="qsWh">${warehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
          <div class="m-field"><label>Parti no (isteğe bağlı)</label>
            <input type="text" id="qsLot" placeholder="Okutabilir veya yazabilirsiniz"></div>`,
        onConfirm: async (qty) => {
          await submit({
            type: 'move', itemId: item.id, warehouseId: Number($('qsWh').value),
            qty, lotNo: $('qsLot').value.trim() || null, unitCost: item.avgCost || 0
          });
          closeSheet();
          toast(`${num(qty, 2)} ${item.unit} girildi`, 'ok');
          go('home', {}, false);
        }
      });
    },

    /* ---------- Parti ---------- */
    async lot(main) {
      const l = screenState.lot;
      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(l.lotNo)}</div>
          <div class="m-card-sub">${esc(l.itemName)}</div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:14px">
            <span class="m-big-num">${num(l.qty, 2)}</span>
            <span style="color:var(--m-muted);font-size:17px">${esc(l.unit)}</span>
            <span class="m-badge ${l.status === 'available' ? 'ok' : l.status === 'quarantine' ? 'warn' : 'crit'}">${esc(l.status)}</span>
          </div>
          <div class="m-card-meta">
            ${esc(l.warehouseName || '')}${l.location ? ' · Raf ' + esc(l.location) : ''}
            ${l.expiryDate ? '<br>SKT: ' + dt(l.expiryDate) : ''}
          </div>
        </div>
        <div class="m-btn-row">
          <button class="m-btn m-btn-primary" id="lotMove">TAŞI</button>
          <button class="m-btn" id="lotItem">ÜRÜN KARTI</button>
        </div>`;

      $('lotItem').onclick = () => handleScan(l.itemCode);
      $('lotMove').onclick = () => qtySheet({
        title: 'Yer Değiştirme', sub: `${l.lotNo} · ${l.itemName}`, unit: l.unit,
        value: l.qty, max: l.qty,
        extra: `<div class="m-field"><label>Hedef depo</label>
          <select id="qsWh">${warehouses.filter(w => w.id !== l.warehouseId)
            .map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>`,
        onConfirm: async (qty) => {
          await submit({ type: 'transfer', lotId: l.id, toWarehouseId: Number($('qsWh').value), qty });
          closeSheet();
          toast('Taşındı', 'ok');
          go('home', {}, false);
        }
      });
    },

    /* ---------- Raf ---------- */
    async location(main) {
      const { location, lots } = screenState;
      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(location)}</div>
          <div class="m-card-sub">${lots.length} parti</div>
        </div>
        <div class="m-card">
          ${lots.map(l => `<div class="m-row">
            <div class="m-row-main">
              <div class="m-row-title">${esc(l.itemName)}</div>
              <div class="m-row-sub m-mono">${esc(l.lotNo || l.itemCode || '')}</div>
            </div>
            <div class="m-row-val">${num(l.qty, 2)}</div>
          </div>`).join('') || '<div class="m-empty">Bu rafta stok yok</div>'}
        </div>`;
    },

    /* ---------- Mal kabul listesi ---------- */
    async receiveList(main) {
      const t = await api('GET', '/mobile/tasks');
      main.innerHTML = t.receipts.length
        ? t.receipts.map(r => `<div class="m-card m-card-tap" data-po="${esc(r.id)}">
            <div class="m-card-head">
              <div><div class="m-card-title m-mono">${esc(r.no)}</div>
                <div class="m-card-sub">${esc(r.party || '')}</div></div>
              <span class="m-badge warn">${r.openLines} kalem</span>
            </div>
            <div class="m-card-meta">Termin: ${dt(r.date)}</div>
          </div>`).join('')
        : '<div class="m-empty">Teslim alınacak sipariş yok</div>';
      main.querySelectorAll('[data-po]').forEach(c =>
        c.onclick = () => go('receive', { poId: c.dataset.po }));
    },

    /* ---------- Mal kabul ---------- */
    async receive(main) {
      const po = await api('GET', '/purchasing/orders/' + screenState.poId);
      const open = (po.items || []).filter(i => i.qty > i.receivedQty);
      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(po.poNo)}</div>
          <div class="m-card-sub">${esc(po.supplier || po.supplierName || '')}</div>
        </div>
        ${po.approvalStatus !== 'approved'
          ? '<div class="m-note crit">Bu sipariş onaylanmamış — teslim alınamaz.</div>' : ''}
        <div class="m-note">Kalemi okutun ya da listeden seçin.</div>
        ${open.map((i, idx) => `<div class="m-card m-card-tap" data-line="${idx}">
          <div class="m-card-head">
            <div class="m-row-main"><div class="m-card-title">${esc(i.itemName)}</div>
              <div class="m-card-sub m-mono">${esc(i.itemCode || '')}</div></div>
            <div style="text-align:right">
              <div class="m-row-val">${num(i.qty - i.receivedQty, 2)}</div>
              <div class="m-row-sub">kalan</div>
            </div>
          </div>
        </div>`).join('') || '<div class="m-empty">Bekleyen kalem yok</div>'}`;

      const receiveLine = (i) => qtySheet({
        title: 'Teslim Al', sub: i.itemName, unit: i.unit || 'adet',
        value: i.qty - i.receivedQty, max: i.qty - i.receivedQty,
        extra: `<div class="m-field"><label>Parti no</label>
            <input type="text" id="qsLot" placeholder="İsteğe bağlı"></div>
          <div class="m-field"><label>İrsaliye no</label>
            <input type="text" id="qsWaybill" placeholder="İsteğe bağlı"></div>`,
        onConfirm: async (qty) => {
          // Mal kabul sipariş bağını korumalı; genel stok girişi değil satın alma ucu kullanılır.
          // Sunucu poItemId (sipariş KALEMİNİN satır id'si) bekler, itemId (ürünün kendi id'si)
          // değil — ikisi karıştırılırsa her istek 422 ile reddedilir.
          await api('POST', `/purchasing/orders/${po.id}/receipts`, {
            waybillNo: $('qsWaybill').value.trim() || undefined,
            lines: [{ poItemId: i.id, qty, lotNo: $('qsLot').value.trim() || undefined }]
          });
          closeSheet();
          toast(`${num(qty, 2)} teslim alındı`, 'ok');
          render();
        }
      });

      main.querySelectorAll('[data-line]').forEach(c =>
        c.onclick = () => receiveLine(open[+c.dataset.line]));

      // Bu ekranda okutma, listedeki kalemi bulup doğrudan miktar sorar
      screenState.onScan = (code) => {
        const hit = open.find(i => i.itemCode === code || i.barcode === code);
        if (hit) receiveLine(hit);
        else toast('Bu kalem siparişte yok', 'err');
      };
    },

    /* ---------- Yer değiştirme ---------- */
    async transfer(main) {
      main.innerHTML = `
        <div class="m-note">Taşınacak partiyi okutun.</div>
        <div class="m-empty">Parti bekleniyor…</div>`;
      screenState.onScan = async (code) => {
        try {
          const r = await api('GET', '/mobile/resolve?code=' + encodeURIComponent(code));
          if (r.type !== 'lot') { toast('Parti etiketi okutun', 'err'); return; }
          go('lot', { lot: r.lot });
        } catch { toast('Parti bulunamadı', 'err'); }
      };
    },

    /* ---------- Sayım listesi ---------- */
    async countList(main) {
      const t = await api('GET', '/mobile/tasks');
      main.innerHTML = t.counts.length
        ? t.counts.map(c => `<div class="m-card m-card-tap" data-count="${esc(c.id)}">
            <div class="m-card-head">
              <div><div class="m-card-title m-mono">${esc(c.no)}</div>
                <div class="m-card-sub">${esc(c.party || '')}</div></div>
              <span class="m-badge ${c.counted === c.lineCount ? 'ok' : 'warn'}">${c.counted}/${c.lineCount}</span>
            </div>
            <div class="m-progress"><div style="width:${c.lineCount ? (c.counted / c.lineCount * 100) : 0}%"></div></div>
          </div>`).join('')
        : '<div class="m-empty">Açık sayım yok</div>';
      main.querySelectorAll('[data-count]').forEach(c =>
        c.onclick = () => go('count', { countId: c.dataset.count }));
    },

    /* ---------- Sayım ---------- */
    async count(main) {
      const c = await api('GET', '/stock/counts/' + screenState.countId);
      const lines = c.lines || [];
      const done = lines.filter(l => l.countedQty !== null && l.countedQty !== undefined).length;

      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(c.countNo)}</div>
          <div class="m-card-sub">${esc(c.warehouseName || '')} · ${done}/${lines.length} sayıldı</div>
          <div class="m-progress"><div style="width:${lines.length ? done / lines.length * 100 : 0}%"></div></div>
        </div>
        <div class="m-note">Partiyi okutun, miktarı girin. Sayılanlar listenin altına iner.</div>
        ${lines.slice().sort((a, b) =>
          (a.countedQty != null) - (b.countedQty != null)).map((l, idx) => {
          const counted = l.countedQty != null;
          const diff = counted ? l.countedQty - l.systemQty : 0;
          return `<div class="m-card m-card-tap" data-cl="${esc(l.id)}" style="${counted ? 'opacity:.65' : ''}">
            <div class="m-card-head">
              <div class="m-row-main">
                <div class="m-card-title">${esc(l.itemName)}</div>
                <div class="m-card-sub m-mono">${esc(l.lotNo || '—')}</div>
              </div>
              <div style="text-align:right">
                <div class="m-row-val">${counted ? num(l.countedQty, 2) : num(l.systemQty, 2)}</div>
                ${counted
                  ? `<span class="m-badge ${Math.abs(diff) < 0.001 ? 'ok' : 'crit'}">${diff > 0 ? '+' : ''}${num(diff, 2)}</span>`
                  : '<div class="m-row-sub">sistemde</div>'}
              </div>
            </div>
          </div>`;
        }).join('')}`;

      const countLine = (l) => qtySheet({
        title: 'Sayım', sub: `${l.itemName}${l.lotNo ? ' · ' + l.lotNo : ''}`,
        unit: '', value: l.countedQty != null ? l.countedQty : l.systemQty,
        hint: `Sistemde: ${num(l.systemQty, 2)}`,
        onConfirm: async (qty) => {
          await submit({ type: 'count_line', lineId: l.id, countedQty: qty });
          closeSheet();
          toast('Sayıldı', 'ok');
          render();
        }
      });

      main.querySelectorAll('[data-cl]').forEach(el =>
        el.onclick = () => countLine(lines.find(x => String(x.id) === el.dataset.cl)));

      screenState.onScan = (code) => {
        const hit = lines.find(l => l.lotNo === code || l.itemCode === code);
        if (hit) countLine(hit);
        else toast('Bu parti sayım listesinde yok', 'err');
      };
    },

    /* ---------- Toplama listesi ---------- */
    async pickList(main) {
      const t = await api('GET', '/mobile/tasks');
      main.innerHTML = t.shipments.length
        ? t.shipments.map(s => `<div class="m-card m-card-tap" data-so="${esc(s.id)}">
            <div class="m-card-head">
              <div><div class="m-card-title m-mono">${esc(s.no)}</div>
                <div class="m-card-sub">${esc(s.party || '')}</div></div>
              <span class="m-badge warn">${s.openLines} kalem</span>
            </div>
            <div class="m-card-meta">Söz verilen: ${dt(s.date)}</div>
          </div>`).join('')
        : '<div class="m-empty">Toplanacak sipariş yok</div>';
      main.querySelectorAll('[data-so]').forEach(c =>
        c.onclick = () => go('pick', { soId: c.dataset.so }));
    },

    /* ---------- Toplama ---------- */
    async pick(main) {
      const p = await api('GET', '/mobile/pick-list/' + screenState.soId);
      screenState.picked = screenState.picked || {};

      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(p.soNo)}</div>
          <div class="m-card-sub">${esc(p.customerName || '')}</div>
          ${p.shortageLines ? `<div class="m-badge crit" style="margin-top:8px">${p.shortageLines} kalemde stok yetersiz</div>` : ''}
        </div>
        <div class="m-note">Toplanacak parti ve raf listede yazıyor. Okutarak işaretleyin.</div>
        ${p.lines.map(l => {
          const picked = screenState.picked[l.itemId] || 0;
          const complete = picked >= l.toPick;
          return `<div class="m-card" style="${complete ? 'border-color:var(--m-ok)' : ''}">
            <div class="m-card-head">
              <div class="m-row-main">
                <div class="m-card-title">${esc(l.itemName)}</div>
                <div class="m-card-sub m-mono">${esc(l.itemCode || '')}</div>
              </div>
              <div style="text-align:right">
                <div class="m-row-val" style="color:${complete ? 'var(--m-ok)' : 'var(--m-text)'}">
                  ${num(picked, 2)} / ${num(l.toPick, 2)}</div>
                <div class="m-row-sub">${esc(l.unit || '')}</div>
              </div>
            </div>
            ${l.shortage ? `<div class="m-note crit" style="margin:10px 0 0">Eksik: ${num(l.shortage, 2)} ${esc(l.unit || '')}</div>` : ''}
            ${l.suggestedLots.map(s => `<div class="m-row">
              <div class="m-row-main">
                <div class="m-row-title m-mono">${esc(s.lotNo || '—')}</div>
                <div class="m-row-sub">${s.location ? 'Raf ' + esc(s.location) + ' · ' : ''}${esc(s.warehouseName || '')}${s.expiryDate ? ' · SKT ' + dt(s.expiryDate) : ''}</div>
              </div>
              <div class="m-row-val">${num(s.takeQty, 2)}</div>
            </div>`).join('')}
            <button class="m-btn ${complete ? 'm-btn-ok' : 'm-btn-primary'}" data-pick="${esc(l.itemId)}"
              style="margin-top:10px">${complete ? 'TOPLANDI' : 'TOPLANDI İŞARETLE'}</button>
          </div>`;
        }).join('')}
        <div class="m-note warn">Toplama tamamlandığında sevkiyatı masaüstü arayüzden
          oluşturun — parti seçimi ve kasa bilgisi orada girilir.</div>`;

      const markPicked = (line) => qtySheet({
        title: 'Toplanan miktar', sub: line.itemName, unit: line.unit || '',
        value: line.toPick, max: line.toPick,
        onConfirm: (qty) => {
          // Toplama yerel bir işaretlemedir; stok hareketi sevkiyat oluşturulunca yazılır.
          screenState.picked[line.itemId] = qty;
          closeSheet();
          toast('İşaretlendi', 'ok');
          render();
        }
      });

      main.querySelectorAll('[data-pick]').forEach(b =>
        b.onclick = () => markPicked(p.lines.find(l => l.itemId === b.dataset.pick)));

      screenState.onScan = (code) => {
        const hit = p.lines.find(l => l.itemCode === code || l.barcode === code)
          || p.lines.find(l => l.suggestedLots.some(s => s.lotNo === code));
        if (hit) markPicked(hit);
        else toast('Bu kalem siparişte yok', 'err');
      };
    },

    /* ---------- Malzeme çıkışı listesi ---------- */
    async issueList(main) {
      const t = await api('GET', '/mobile/tasks');
      main.innerHTML = t.production.length
        ? t.production.map(p => `<div class="m-card m-card-tap" data-po="${esc(p.id)}">
            <div class="m-card-head">
              <div><div class="m-card-title m-mono">${esc(p.no)}</div>
                <div class="m-card-sub">${esc(p.party || '')}</div></div>
              <span class="m-badge info">${num(p.qty, 2)}</span>
            </div>
            <div class="m-card-meta">${esc(p.status)}${p.date ? ' · Termin ' + dt(p.date) : ''}</div>
          </div>`).join('')
        : '<div class="m-empty">Açık üretim emri yok</div>';
      main.querySelectorAll('[data-po]').forEach(c =>
        c.onclick = () => go('issue', { orderId: c.dataset.po }));
    },

    /* ---------- Malzeme çıkışı ---------- */
    async issue(main) {
      const d = await api('GET', '/mobile/issue-list/' + screenState.orderId);
      main.innerHTML = `
        <div class="m-card">
          <div class="m-card-title m-mono">${esc(d.orderNo)}</div>
          <div class="m-card-sub">${esc(d.itemName)} · ${num(d.qty, 2)} adet</div>
          ${d.shortageCount ? `<div class="m-badge crit" style="margin-top:8px">${d.shortageCount} malzemede eksik</div>` : ''}
        </div>
        <div class="m-note">Bu liste üretim için çekilecek malzemeleri gösterir.
          Malzemeler üretim tamamlanınca sistem tarafından düşülür.</div>
        ${d.components.map(c => `<div class="m-card">
          <div class="m-card-head">
            <div class="m-row-main">
              <div class="m-card-title">${esc(c.itemName)}</div>
              <div class="m-card-sub m-mono">${esc(c.itemCode || '')}</div>
            </div>
            <div style="text-align:right">
              <div class="m-row-val" style="color:${c.shortage ? 'var(--m-danger)' : 'var(--m-ok)'}">
                ${num(c.needed, 2)}</div>
              <div class="m-row-sub">gerekli · ${num(c.available, 2)} var</div>
            </div>
          </div>
          ${c.shortage ? `<div class="m-note crit" style="margin:10px 0 0">Eksik: ${num(c.shortage, 2)} ${esc(c.unit || '')}</div>` : ''}
          ${c.lots.slice(0, 3).map(l => `<div class="m-row">
            <div class="m-row-main">
              <div class="m-row-title m-mono">${esc(l.lotNo || '—')}</div>
              <div class="m-row-sub">${l.location ? 'Raf ' + esc(l.location) + ' · ' : ''}${esc(l.warehouseName || '')}</div>
            </div>
            <div class="m-row-val">${num(l.qty, 2)}</div>
          </div>`).join('')}
        </div>`).join('')}`;
    },

    /* ---------- Kuyruk ---------- */
    async queue(main) {
      const q = await ownQueue();
      const legacy = (await MobileDB.getAll()).filter(op => op.ownerId == null);
      main.innerHTML = q.length ? `
        <div class="m-note warn">Bu işlemler henüz sunucuya gönderilmedi.
          Bağlantı geldiğinde otomatik gönderilir.</div>
        ${q.map(op => `<div class="m-card">
          <div class="m-card-title">${esc({ move: 'Stok girişi', transfer: 'Yer değiştirme', count_line: 'Sayım' }[op.type] || op.type)}</div>
          <div class="m-card-sub">Miktar: ${num(op.qty ?? op.countedQty, 2)}</div>
          <div class="m-card-meta">${new Date(op.queuedAt).toLocaleString('tr-TR')}</div>
          ${op.lastError ? `<div class="m-note crit">${esc(op.lastError)}</div>` : ''}
        </div>`).join('')}
        <button class="m-btn m-btn-primary m-btn-lg" id="qFlush">ŞİMDİ GÖNDER</button>
        <button class="m-btn m-btn-danger" id="qClear" style="margin-top:10px">KUYRUĞU TEMİZLE</button>`
        : '<div class="m-empty">Bekleyen işlem yok</div>';

      $('qFlush')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        await flushQueue(false);
        render();
      });
      $('qClear')?.addEventListener('click', () => {
        sheet({
          title: 'Kuyruk silinecek',
          sub: 'Gönderilmemiş işlemler kalıcı olarak kaybolur. Bu geri alınamaz.',
          actions: [
            { label: 'Vazgeç', onClick: closeSheet },
            { label: 'SİL', kind: 'danger', onClick: async () => { await MobileDB.remove(q); await paintQueue(); closeSheet(); render(); } }
          ]
        });
      });
      if (legacy.length) {
        const note = document.createElement('div');
        note.className = 'm-note warn';
        note.textContent = `${legacy.length} eski işlemin kullanıcı bilgisi yok. Otomatik gönderilmedi; yönetici incelemesi gerekiyor.`;
        main.appendChild(note);
        if (user.role === 'admin') {
          const exportBtn = document.createElement('button');
          exportBtn.className = 'm-btn'; exportBtn.textContent = 'Eski işlemleri incelemek için indir';
          exportBtn.onclick = () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'eski-terminal-islemleri.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          main.appendChild(exportBtn);
        }
      }
    }
  };

  function bindGo(root) {
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  }

  /* ============ MİKTAR DİYALOĞU ============ */

  /**
   * Miktar girişi terminalin en sık kullanılan ekranı.
   * +/- düğmeleri klavye açmaktan hızlıdır ve eldivenle çalışır.
   */
  function qtySheet({ title, sub, unit, value = 1, max = null, hint = '', extra = '', onConfirm }) {
    sheet({
      title, sub,
      body: `
        ${hint ? `<div class="m-note">${esc(hint)}</div>` : ''}
        <div class="m-qty">
          <button id="qsMinus" aria-label="Azalt">−</button>
          <input type="number" id="qsVal" value="${value}" step="any" inputmode="decimal" min="0">
          <button id="qsPlus" aria-label="Artır">+</button>
        </div>
        ${unit ? `<div style="text-align:center;color:var(--m-muted);margin:-6px 0 12px">${esc(unit)}</div>` : ''}
        ${max != null ? `<div class="m-note">En fazla: ${num(max, 2)}</div>` : ''}
        ${extra}`,
      actions: [
        { label: 'ONAYLA', kind: 'primary', large: true, onClick: async () => {
          const qty = Number($('qsVal').value);
          if (!(qty > 0)) { toast('Miktar sıfırdan büyük olmalı', 'err'); return; }
          if (max != null && qty > max + 1e-9) { toast(`En fazla ${num(max, 2)} olabilir`, 'err'); return; }
          const btn = document.querySelector('[data-act="0"]');
          btn.disabled = true; btn.innerHTML = '<span class="m-spin"></span>';
          try { await onConfirm(qty); }
          catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'ONAYLA'; }
        } },
        { label: 'Vazgeç', onClick: closeSheet }
      ]
    });

    const input = $('qsVal');
    const step = (d) => { input.value = Math.max(0, (Number(input.value) || 0) + d); };
    $('qsMinus').onclick = () => step(-1);
    $('qsPlus').onclick = () => step(1);
    input.select();
  }

  /* ============ OTURUM ============ */

  async function login() {
    const btn = $('mLoginBtn');
    btn.disabled = true; btn.innerHTML = '<span class="m-spin"></span>';
    $('mLoginErr').textContent = '';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('mUser').value.trim(), password: $('mPass').value })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Giriş başarısız');
      token = d.token;
      localStorage.setItem(TOKEN_KEY, token);
      await start();
    } catch (e) {
      $('mLoginErr').textContent = e.message;
    } finally {
      btn.disabled = false; btn.textContent = 'GİRİŞ';
    }
  }

  function logout(revoke = true) {
    const previousToken = token;
    token = '';
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    $('mPass').value = '';
    $('mPasswordForm').reset();
    $('mPasswordChange').hidden = true;
    $('mApp').hidden = true;
    $('mLogin').style.display = '';
    if (revoke && previousToken) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + previousToken } })
        .catch(() => { $('mLoginErr').textContent = 'Cihazdan çıkıldı. Bağlantı yok; sunucu oturumu süre sonunda kapanacak.'; });
    }
  }

  async function start() {
    try {
      const session = await api('GET', '/auth/me');
      user = session.user;
      if (user.mustChangePassword) {
        $('mLogin').style.display = 'none';
        $('mApp').hidden = true;
        $('mPasswordChange').hidden = false;
        $('mCurrentPassword').focus();
        return;
      }
      warehouses = await api('GET', '/warehouses');
    } catch { logout(); return; }
    $('mLogin').style.display = 'none';
    $('mPasswordChange').hidden = true;
    $('mApp').hidden = false;
    await paintQueue();
    flushQueue(true);
    go('home', {}, false);
    $('mScanInput').focus();
  }

  /* ============ BAŞLANGIÇ ============ */

  document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      // Terminal sayfasının kendisini önbellekler (bkz. sw.js); kayıt
      // başarısız olsa bile (ör. eski tarayıcı) uygulama çevrimiçiyken
      // normal çalışmaya devam eder — çevrimdışı açılış desteklenmez, o kadar.
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    await migrateLegacyQueue();

    initScanner();
    $('mLoginBtn').onclick = login;
    $('mPasswordLogout').onclick = () => logout();
    $('mPasswordForm').onsubmit = async event => {
      event.preventDefault();
      const btn = $('mPasswordSave');
      const error = $('mPasswordError');
      error.textContent = '';
      if ($('mNewPassword').value !== $('mRepeatPassword').value) {
        error.textContent = 'Yeni şifreler eşleşmiyor.'; return;
      }
      btn.disabled = true;
      try {
        await api('POST', '/auth/change-password', { currentPassword: $('mCurrentPassword').value, newPassword: $('mNewPassword').value });
        $('mPasswordForm').reset();
        $('mPass').value = '';
        await start();
      } catch (err) { error.textContent = err.message; }
      finally { btn.disabled = false; }
    };
    $('mPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    $('mBack').onclick = back;
    $('mCamBtn').onclick = openCamera;
    $('mCamClose').onclick = closeCamera;
    $('mMenu').onclick = async () => {
      const qCount = (await ownQueue()).length;
      sheet({
        title: user ? user.username : 'Menü',
        sub: user ? `${user.role} · ${qCount} bekleyen işlem` : '',
        actions: [
          { label: 'Bekleyen işlemler', onClick: () => { closeSheet(); go('queue'); } },
          { label: 'Masaüstü arayüz', onClick: () => { location.href = '/'; } },
          { label: 'Çıkış', kind: 'danger', onClick: () => { closeSheet(); logout(); } }
        ]
      });
    };

    if (token) start(); else $('mApp').hidden = true;
  });
})();
