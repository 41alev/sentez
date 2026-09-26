// @ts-nocheck
/**
 * Ürünler (Items) — React'e kademeli geçişin ikinci ekranı.
 *
 * Dashboard pilotuyla aynı disiplin: iş mantığı YENİDEN YAZILMADI. Bu dosya
 * `public/js/views/items.js`'nin (artık silindi) neredeyse birebir aynısı —
 * yalnızca dış kabuk değişti: modül-seviyesi `let state/warehouses/...`
 * yerine `useState`/`ref`, ve `render(el)/load(el)` yerine bir veri-çekme
 * `useEffect`'i + `dangerouslySetInnerHTML` + DOM-bağlama `useEffect`'i.
 * Barkod tarama, ürün formu (BOM dahil), stok girişi diyaloğu, ürün kartı
 * ve CSV dışa aktarım fonksiyonları `UI.modal()` gibi GLOBAL (bu view'ın
 * React ağacından bağımsız) bir overlay sistemi kullandığı için hiç
 * değişmeden taşındı.
 *
 * Bilinçli tasarım kararı — filtre/sayfa durumu KORUNMAZ: vanilla sürümde
 * bu durum modül kapsamında tutulduğu için ekrandan ayrılıp geri dönünce
 * filtre aynen dururdu. Kullanıcıyla netleştirildi: Dashboard'daki gibi
 * her navigasyonda bileşen sıfırdan mount edilir (bkz. mountView.jsx) ve
 * filtreler varsayılana döner — bilinçli, kabul edilmiş küçük bir davranış
 * değişikliği (ek "yenile" altyapısı kurmaktan kaçınmak için).
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { openLabelPrintDialog } from './labelPrint.js';

const DEFAULT_FILTERS = { page: 1, q: '', category: '', origin: '', warehouseId: '', itemType: '', lowOnly: false };

export default function ItemsView() {
  const { t, esc, num, card, table, pager, loading, modal, closeModal,
          field, input, select, textarea, checkbox, val, numVal, intVal, checked, can } = UI;

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [reloadToken, setReloadToken] = useState(0);
  const [phase, setPhase] = useState({ status: 'loading', res: null, error: null });

  const warehousesRef = useRef([]);
  const suppliersRef = useRef([]);
  const allItemsRef = useRef([]);
  const firstLoadRef = useRef(true);
  const stopWedgeRef = useRef(null);
  const scanStreamRef = useRef(null);
  const scanTimerRef = useRef(null);

  const reload = useCallback(() => setReloadToken(x => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        try {
          const [wh, sup] = await Promise.all([
            Api.warehouses(),
            Api.suppliers({ pageSize: 200 }).then(r => r.data || r).catch(() => [])
          ]);
          if (cancelled) return;
          warehousesRef.current = wh;
          suppliersRef.current = sup;
        } catch (e) {
          warehousesRef.current = [];
          suppliersRef.current = [];
        }
      }
      if (cancelled) return;
      let res;
      try { res = await Api.items({ ...filters, pageSize: 25 }); }
      catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }
      if (cancelled) return;
      allItemsRef.current = res.data;
      setPhase({ status: 'ready', res, error: null });
    })();
    return () => { cancelled = true; };
  }, [filters, reloadToken]);

  // Veri geldikten ve HTML DOM'a yazıldıktan SONRA: filtreleri, arama
  // kutusunu, satır aksiyonlarını ve diyalog tetikleyicilerini bağla —
  // orijinal render()'daki "wiring" bölümüyle birebir aynı.
  useEffect(() => {
    if (phase.status !== 'ready') return;
    const res = phase.res;

    const s = document.getElementById('itSearch');
    s.oninput = UI.debounce(() => setFilters(f => ({ ...f, q: s.value, page: 1 })), 350);
    document.getElementById('fCat').onchange = e => setFilters(f => ({ ...f, category: e.target.value, page: 1 }));
    document.getElementById('fOrigin').onchange = e => setFilters(f => ({ ...f, origin: e.target.value, page: 1 }));
    document.getElementById('fWh').onchange = e => setFilters(f => ({ ...f, warehouseId: e.target.value, page: 1 }));
    document.getElementById('fType').onchange = e => setFilters(f => ({ ...f, itemType: e.target.value, page: 1 }));
    document.getElementById('fLow').onclick = () => setFilters(f => ({ ...f, lowOnly: !f.lowOnly, page: 1 }));
    document.getElementById('itCsv').onclick = () => exportCsv(res.data);
    document.getElementById('itScan').onclick = () => scanDialog();
    document.getElementById('itNew')?.addEventListener('click', () => itemForm(null));

    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCard(b.dataset.open));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => itemForm(await Api.item(b.dataset.edit)));
    document.querySelectorAll('[data-in]').forEach(b => b.onclick = () => stockInDialog(res.data.find(x => x.id === b.dataset.in)));
    document.querySelectorAll('[data-label]').forEach(b => b.onclick = () => {
      const it = res.data.find(x => x.id === b.dataset.label);
      openLabelPrintDialog('item', it.id, it.name);
    });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const it = res.data.find(x => x.id === b.dataset.del);
      UI.confirmDialog(`"${it.name}" — ${t('confirmDelete')}`, async () => {
        try { await Api.deleteItem(it.id); UI.ok(t('deleted')); reload(); } catch (e) { UI.err(e); }
      }, { danger: true, confirmLabel: t('del') });
    });
  }, [phase]);

  function exportCsv(rows) {
    UI.exportCsv('urunler.csv',
      [t('itemName'), t('itemCode'), t('barcode'), t('category'), t('itemType'), t('origin'), t('available'), t('unit'), t('minStock'), t('avgCost')],
      rows.map(r => [r.name, r.code, r.barcode, r.category, r.itemType, r.origin, r.qty, r.unit, r.minStock, r.avgCost]));
  }

  /* ---------- barkod tarama ---------- */
  // ref: bileşen her yeniden render olduğunda fonksiyon gövdesi baştan
  // çalışır — düz `let` kullanılsaydı tarama sırasında bir render daha
  // olması durumunda kamera/dinleyici referansı sessizce sıfırlanırdı.
  function scanDialog() {
    modal({
      title: UI.getLang() === 'tr' ? 'Barkod Tara' : 'Scan Barcode',
      sub: UI.getLang() === 'tr' ? 'Okuyucu ile okutun veya elle girin' : 'Scan with a reader or type manually',
      body: `<div id="scanArea" style="background:#000;border-radius:8px;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:#6C7278;font-size:12.5px;position:relative;overflow:hidden">
               ${UI.getLang() === 'tr' ? 'Kamera başlatılıyor…' : 'Starting camera…'}</div>
             ${field(t('barcode'), input('scanInput', { attrs: 'inputmode="numeric" autofocus' }))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>`,
      onOpen: (box) => {
        const inp = box.querySelector('#scanInput');
        inp.dataset.barcodeTarget = '1';
        inp.focus();
        inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); lookup(inp.value.trim()); } };
        // USB okuyucu: alan odakta olmasa bile yakalanır
        stopWedgeRef.current = UI.onBarcodeScan(code => { inp.value = code; lookup(code); });
        startCamera(box.querySelector('#scanArea'), lookup);
      }
    });
    async function lookup(code) {
      stopCamera();
      if (stopWedgeRef.current) { stopWedgeRef.current(); stopWedgeRef.current = null; }
      try {
        const item = await Api.itemByBarcode(code);
        closeModal();
        openCard(item.id);
      } catch {
        closeModal();
        UI.toast(UI.getLang() === 'tr' ? 'Barkod bulunamadı, yeni ürün olarak ekleyebilirsiniz.' : 'Barcode not found — you can add it as a new item.');
        if (can('write')) itemForm(null, code);
      }
    }
  }

  async function startCamera(area, onCode) {
    if (!('BarcodeDetector' in window)) {
      area.innerHTML = `<div style="padding:18px;text-align:center;line-height:1.6">${UI.esc(UI.getLang() === 'tr'
        ? 'Bu tarayıcı kamerayla barkod okumayı desteklemiyor (Chrome/Edge destekler). USB okuyucu bağlıysa okutmanız yeterli — aşağıdaki alana odaklanmanıza gerek yok. Elle de girebilirsiniz.'
        : 'This browser cannot scan with the camera (Chrome/Edge can). If a USB reader is connected, just scan — no need to focus the field. You can also type it in.')}</div>`;
      return;
    }
    try {
      scanStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = document.createElement('video');
      v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = scanStreamRef.current;
      v.style.cssText = 'width:100%;height:100%;object-fit:cover';
      area.innerHTML = ''; area.appendChild(v);
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
      scanTimerRef.current = setInterval(async () => {
        try { const c = await det.detect(v); if (c && c[0]?.rawValue) onCode(c[0].rawValue); } catch {}
      }, 350);
    } catch {
      area.innerHTML = `<div style="padding:18px;text-align:center;line-height:1.6">${UI.esc(UI.getLang() === 'tr'
        ? 'Kameraya erişilemedi (izin verilmemiş veya kamera yok). USB okuyucu ile okutabilir ya da elle girebilirsiniz.'
        : 'Camera unavailable (permission denied or no camera). Use a USB reader or type it in.')}</div>`;
    }
  }
  function stopCamera() {
    if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
    if (scanStreamRef.current) { scanStreamRef.current.getTracks().forEach(tr => tr.stop()); scanStreamRef.current = null; }
  }

  /* ---------- ürün formu (BOM dahil) ---------- */
  function itemForm(item, prefillBarcode) {
    const allItems = allItemsRef.current;
    const warehouses = warehousesRef.current;
    const suppliers = suppliersRef.current;
    let bom = item?.bom ? item.bom.map(b => ({ ...b })) : [];
    const isEdit = !!item;

    modal({
      title: isEdit ? t('edit') + ' — ' + item.name : t('newItem'),
      size: 'wide',
      body: `
        <div class="field-row">
          ${field(t('itemName'), input('iName', { value: item?.name || '' }))}
          ${field(t('itemCode'), input('iCode', { value: item?.code || '' }))}
        </div>
        <div class="field-row">
          ${field(t('barcode'), input('iBarcode', { value: item?.barcode || prefillBarcode || '' }))}
          ${field(t('category'), input('iCategory', { value: item?.category || '' }))}
        </div>
        <div class="field-row three">
          ${field(t('itemType'), select('iType', [
            { v: 'raw', l: t('typeRaw') }, { v: 'semi', l: t('typeSemi') },
            { v: 'finished', l: t('typeFinished') }, { v: 'consumable', l: t('typeConsumable') }], item?.itemType || 'raw'))}
          ${field(t('origin'), select('iOrigin', [{ v: 'Yurt İçi', l: t('originDomestic') }, { v: 'Yurt Dışı', l: t('originIntl') }], item?.origin || 'Yurt İçi'))}
          ${field(t('unit'), input('iUnit', { value: item?.unit || 'adet' }))}
        </div>
        <div class="field-row">
          ${field(t('warehouse'), select('iWh', warehouses.map(w => ({ v: w.id, l: w.name })), item?.warehouseId || warehouses[0]?.id))}
          ${field(t('location'), input('iLoc', { value: item?.location || '' }))}
        </div>
        <div class="field-row three">
          ${field(t('minStock'), input('iMin', { type: 'number', value: item?.minStock ?? 0, min: 0 }))}
          ${field(t('reorderQty'), input('iReorder', { type: 'number', value: item?.reorderQty ?? 0, min: 0 }))}
          ${field(t('shelfLife'), input('iShelf', { type: 'number', value: item?.shelfLifeDays ?? '', min: 0 }))}
        </div>
        <div class="field-row three">
          ${field(t('costingMethod'), select('iCosting', [{ v: 'moving_average', l: t('movingAverage') }, { v: 'fifo', l: t('fifo') }], item?.costingMethod || 'moving_average'))}
          ${field(t('salePrice'), input('iSale', { type: 'number', step: '0.01', value: item?.salePrice ?? 0, min: 0 }))}
          ${field(t('hsCode'), input('iHs', { value: item?.hsCode || '' }))}
        </div>
          ${field(t('defaultSupplier'), select('iSup', [{ v: '', l: t('none') }, ...suppliers.map(sp => ({ v: sp.id, l: sp.name }))], item?.defaultSupplierId || ''))}
          ${field(UI.getLang() === 'tr' ? 'Tedarik yöntemi' : 'Procurement method', select('iProcurement', [
            { v: 'buy', l: UI.getLang() === 'tr' ? 'Satın al' : 'Buy' },
            { v: 'make', l: UI.getLang() === 'tr' ? 'Üret' : 'Make' }
          ], item?.procurementType || 'buy'))}
        ${checkbox('iLot', t('lotTracked'), item ? item.isLotTracked : true)}
        ${checkbox('iInsp', t('requiresInspection'), item?.requiresIncomingInspection || false)}
        ${field(t('description'), textarea('iDesc', { value: item?.description || '' }))}

        <div class="section-title">${t('bomTitle')}</div>
        <div class="sub" style="font-size:11.5px;color:var(--text-faint);margin-bottom:8px">${t('bomSub')}</div>
        <div class="dyn-list" id="bomList"></div>
        <button class="btn btn-ghost btn-sm" id="bomAdd" type="button">${t('addBomLine')}</button>`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="iSave">${t('save')}</button>`,
      onOpen: (box) => {
        renderBom(box);
        box.querySelector('#bomAdd').onclick = () => {
          const first = allItems.find(i => i.id !== item?.id);
          bom.push({ componentItemId: first?.id || '', qtyPerUnit: 1, scrapPct: 0 });
          renderBom(box);
        };
        box.querySelector('#iSave').onclick = async () => {
          const payload = {
            name: val('iName'), code: val('iCode'), barcode: val('iBarcode'), category: val('iCategory'),
            itemType: val('iType'), procurementType: val('iProcurement'), origin: val('iOrigin'), unit: val('iUnit'),
            warehouseId: intVal('iWh') || undefined, location: val('iLoc'),
            minStock: numVal('iMin'), reorderQty: numVal('iReorder'),
            shelfLifeDays: val('iShelf') ? intVal('iShelf') : null,
            costingMethod: val('iCosting'), salePrice: numVal('iSale'), hsCode: val('iHs'),
            defaultSupplierId: val('iSup') ? intVal('iSup') : null,
            isLotTracked: checked('iLot'), requiresIncomingInspection: checked('iInsp'),
            description: val('iDesc'),
            bom: bom.filter(b => b.componentItemId).map(b => ({
              componentItemId: b.componentItemId, qtyPerUnit: Number(b.qtyPerUnit) || 0, scrapPct: Number(b.scrapPct) || 0
            }))
          };
          if (!isEdit) payload.qty = 0;
          try {
            if (isEdit) await Api.updateItem(item.id, payload); else await Api.createItem(payload);
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });

    function renderBom(box) {
      const list = box.querySelector('#bomList');
      if (!bom.length) { list.innerHTML = `<div style="font-size:12.5px;color:var(--text-faint);padding:4px 2px">${t('noBom')}</div>`; return; }
      const opts = allItems.filter(i => i.id !== item?.id);
      list.innerHTML = bom.map((b, i) => `
        <div class="dyn-row">
          <select data-i="${i}" data-f="componentItemId" data-search="items" style="flex:1;min-width:160px">
            ${UI.missingOption(opts, b.componentItemId)}${opts.map(o => `<option value="${esc(o.id)}" ${o.id === b.componentItemId ? 'selected' : ''}>${esc(o.name)} (${esc(o.unit)})</option>`).join('')}
          </select>
          <input type="number" step="0.0001" min="0" value="${b.qtyPerUnit}" data-i="${i}" data-f="qtyPerUnit" style="width:96px" title="${t('bomQtyPer')}">
          <input type="number" step="0.1" min="0" value="${b.scrapPct || 0}" data-i="${i}" data-f="scrapPct" style="width:74px" title="${t('bomScrapPct')}">
          <button class="rm" data-rm="${i}">${UI.icon(UI.ICONS.x)}</button>
        </div>`).join('');
      list.querySelectorAll('select,input').forEach(inp => inp.oninput = () => {
        bom[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'componentItemId' ? inp.value : Number(inp.value);
      });
      list.querySelectorAll('[data-rm]').forEach(b2 => b2.onclick = () => { bom.splice(+b2.dataset.rm, 1); renderBom(box); });
    }
  }

  /* ---------- stok girişi ---------- */
  function stockInDialog(item) {
    const warehouses = warehousesRef.current;
    modal({
      title: (UI.getLang() === 'tr' ? 'Stok girişi' : 'Stock in') + ' — ' + item.name,
      sub: `${t('available')}: ${num(item.qty)} ${item.unit}`,
      body: `
        <div class="field-row">
          ${field(t('qty'), input('sQty', { type: 'number', min: 0.0001, step: '0.0001', value: 1 }))}
          ${field(t('warehouse'), select('sWh', warehouses.map(w => ({ v: w.id, l: w.name })), item.warehouseId || warehouses[0]?.id))}
        </div>
        <div class="field-row">
          ${field(t('lotNo'), input('sLot', { placeholder: UI.getLang() === 'tr' ? 'Boş bırakılabilir' : 'Optional' }))}
          ${field(t('expiryDate'), input('sExp', { type: 'date' }))}
        </div>
        ${field(t('unitCost') + ' (₺)', input('sCost', { type: 'number', min: 0, step: '0.0001', value: item.avgCost || 0 }))}
        ${checkbox('sQuar', t('toQuarantine'), item.requiresIncomingInspection)}
        ${field(t('notes'), input('sNote'))}`,
      footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
               <button class="btn btn-primary" id="sGo">${t('confirm')}</button>`,
      onOpen: (box) => {
        box.querySelector('#sGo').onclick = async () => {
          try {
            await Api.moveStock({
              itemId: item.id, type: 'in', qty: numVal('sQty'), warehouseId: intVal('sWh'),
              lotNo: val('sLot') || undefined, expiryDate: val('sExp') || undefined,
              unitCost: numVal('sCost'), status: checked('sQuar') ? 'quarantine' : 'available', note: val('sNote')
            });
            closeModal(); UI.ok(t('saved')); reload();
          } catch (e) { UI.err(e); }
        };
      }
    });
  }

  /* ---------- ürün kartı ---------- */
  async function openCard(id) {
    let item, movements, docs, prices;
    try {
      item = await Api.item(id);
      [movements, docs, prices] = await Promise.all([
        Api.movements({ itemId: id, pageSize: 20 }).then(r => r.data || r).catch(() => []),
        Api.documents({ refType: 'item', refId: id }).catch(() => ({ data: [] })),
        Api.priceHistory(id).catch(() => [])
      ]);
    } catch (e) { UI.errorState(null, e, typeof reload === 'function' ? reload : null); return; }

    const st = item.stockByStatus || {};
    modal({
      title: item.name, sub: `${item.code || ''}${item.barcode ? ' · ' + item.barcode : ''}`,
      size: 'xwide',
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
          ${UI.originBadge(item.origin)}
          <span class="badge plain">${esc(item.category || '—')}</span>
          <span class="badge plain">${t('type' + item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1))}</span>
          ${item.isLotTracked ? `<span class="badge info">${t('lotTracked')}</span>` : ''}
          ${item.requiresIncomingInspection ? `<span class="badge warn">${t('requiresInspection')}</span>` : ''}
        </div>

        <div class="kv-grid">
          <div class="kv"><div class="k">${t('available')}</div><div class="v">${num(item.qty)} ${esc(item.unit)}</div></div>
          <div class="kv"><div class="k">${t('minStock')}</div><div class="v">${num(item.minStock)} ${esc(item.unit)}</div></div>
          <div class="kv"><div class="k">${t('avgCost')}</div><div class="v">₺${num(item.avgCost, 2)}</div></div>
          <div class="kv"><div class="k">${t('salePrice')}</div><div class="v">${item.salePrice ? '₺' + num(item.salePrice, 2) : '—'}</div></div>
          <div class="kv"><div class="k">${t('warehouse')} / ${t('location')}</div><div class="v">${esc(item.warehouse || '—')} · ${esc(item.location || '—')}</div></div>
          <div class="kv"><div class="k">${t('defaultSupplier')}</div><div class="v">${esc(item.supplierName || item.supplier || '—')}</div></div>
        </div>

        <div class="section-title">${t('stockByStatus')}</div>
        <div class="totals-row">
          <span class="total-chip ok">${t('available')}: ${num(st.available || 0)}</span>
          <span class="total-chip" style="color:var(--accent)">${t('quarantine')}: ${num(st.quarantine || 0)}</span>
          <span class="total-chip crit">${t('blocked')}: ${num(st.blocked || 0)}</span>
          <span class="total-chip crit">${t('rejected')}: ${num(st.rejected || 0)}</span>
        </div>

        ${item.description ? `<div style="font-size:13px;color:var(--text-muted);line-height:1.6;margin:14px 0">${esc(item.description)}</div>` : ''}

        <div class="section-title">${t('bomTitle')}</div>
        ${item.bom && item.bom.length ? table([
          { key: 'componentName', label: t('bomComponent') },
          { key: 'qtyPerUnit', label: t('bomQtyPer'), num: true, render: r => `${num(r.qtyPerUnit, 4)} ${esc(r.unit || '')}` },
          { key: 'scrapPct', label: t('bomScrapPct'), num: true, render: r => num(r.scrapPct || 0) + '%' }
        ], item.bom) : `<div class="empty" style="padding:18px">${t('noBom')}</div>`}

        <div class="section-title">${t('priceHistory')}</div>
        ${prices.length ? table([
          { key: 'supplierName', label: t('supplierName'), render: r => esc(r.supplierName || '—') },
          { key: 'price', label: t('price'), num: true, render: r => `${num(r.price, 2)} ${UI.cur(r.currency)}` },
          { key: 'priceBase', label: '₺', num: true, render: r => '₺' + num(r.priceBase, 2) },
          { key: 'recordedAt', label: t('date'), render: r => UI.ts(r.recordedAt) }
        ], prices.slice(0, 10)) : `<div class="empty" style="padding:18px">${t('noData')}</div>`}

        <div class="section-title">${t('recentMovements')}</div>
        <div class="timeline">${movements.length ? movements.map(m => `
          <div class="tl-row">
            <div class="tl-icon ${esc(m.type)}">${UI.icon(m.type === 'in' ? UI.ICONS.plus : m.type === 'out' ? UI.ICONS.minus : UI.ICONS.truck)}</div>
            <div class="tl-main">
              <div>${esc(movLabel(m))}${m.lotNo ? ` · <span class="mono" style="font-size:11.5px">${esc(m.lotNo)}</span>` : ''}</div>
              <div class="tl-meta">${esc(m.note || '')}</div>
            </div>
            <div class="tl-right">${m.type === 'out' ? '−' : m.type === 'in' ? '+' : ''}${num(Math.abs(m.qty))}<div class="tl-meta">${UI.ago(m.ts)}</div></div>
          </div>`).join('') : `<div class="empty" style="padding:18px">${t('noMovements')}</div>`}</div>

        <div class="section-title">${t('attachments')}</div>
        ${docs.data && docs.data.length ? table([
          { key: 'title', label: t('itemName'), render: d => `<a href="${esc(d.downloadUrl)}" target="_blank">${esc(d.title)}</a>` },
          { key: 'docType', label: t('itemType'), render: d => `<span class="badge plain">${esc(d.docType)}</span>` },
          { key: 'uploadedAt', label: t('date'), render: d => UI.ts(d.uploadedAt) }
        ], docs.data) : `<div class="empty" style="padding:18px">${t('noData')}</div>`}
        ${can('docs') ? `<div style="margin-top:10px"><input type="file" id="docFile" style="font-size:12px">
          <button class="btn btn-ghost btn-sm" id="docUp" style="margin-left:6px">${t('uploadDoc')}</button></div>` : ''}`,
      footer: `<button class="btn btn-ghost" data-close>${t('close')}</button>
               ${can('write') ? `<button class="btn btn-primary" id="cardEdit">${t('edit')}</button>` : ''}`,
      onOpen: (box) => {
        box.querySelector('#cardEdit')?.addEventListener('click', () => { closeModal(); itemForm(item); });
        box.querySelector('#docUp')?.addEventListener('click', async () => {
          const f = box.querySelector('#docFile').files[0];
          if (!f) return UI.toast(UI.getLang() === 'tr' ? 'Dosya seçin.' : 'Choose a file.');
          const fd = new FormData();
          fd.append('file', f); fd.append('title', f.name); fd.append('refType', 'item'); fd.append('refId', id); fd.append('docType', 'other');
          try { await Api.uploadDocument(fd); UI.ok(t('saved')); closeModal(); openCard(id); } catch (e) { UI.err(e); }
        });
      }
    });
  }

  const movLabel = (m) => {
    const L = UI.getLang() === 'tr';
    if (m.type === 'in') return L ? 'Stok girişi' : 'Stock in';
    if (m.type === 'out') return L ? 'Stok çıkışı' : 'Stock out';
    if (m.type === 'transfer') return L ? 'Depo transferi' : 'Transfer';
    if (m.type === 'adjust') return L ? 'Sayım düzeltmesi' : 'Count adjustment';
    if (m.type === 'status_change') return `${L ? 'Durum' : 'Status'}: ${m.fromStatus || '?'} → ${m.toStatus || '?'}`;
    return m.type;
  };

  if (phase.status === 'loading') {
    return <div dangerouslySetInnerHTML={{ __html: loading() }} />;
  }

  const { res } = phase;
  const categories = [...new Set(res.facets?.categories || res.data.map(i => i.category).filter(Boolean))].sort();
  const html = `
    <div class="topbar">
      <div><h2>${t('itemsTitle')}</h2><div class="sub">${t('itemsSub')} · ${res.total}</div></div>
      <div class="topbar-actions">
        <div class="search-box">${UI.icon(UI.ICONS.search)}<input id="itSearch" placeholder="${t('search')}" value="${esc(filters.q)}"></div>
        <button class="btn btn-ghost btn-sm" id="itScan">${UI.icon(UI.ICONS.eye)}${UI.getLang() === 'tr' ? 'Barkod' : 'Barcode'}</button>
        <button class="btn btn-ghost btn-sm" id="itCsv">${UI.icon(UI.ICONS.download)}CSV</button>
        ${can('write') ? `<button class="btn btn-primary btn-sm" id="itNew">${UI.icon(UI.ICONS.plus)}${t('newItem')}</button>` : ''}
      </div>
    </div>

    <div class="filters">
      ${select('fCat', [{ v: '', l: t('all') + ' — ' + t('category') }, ...categories.map(c => ({ v: c, l: c }))], filters.category)}
      ${select('fOrigin', [{ v: '', l: t('all') + ' — ' + t('origin') }, { v: 'Yurt İçi', l: t('originDomestic') }, { v: 'Yurt Dışı', l: t('originIntl') }], filters.origin)}
      ${select('fWh', [{ v: '', l: t('all') + ' — ' + t('warehouse') }, ...warehousesRef.current.map(w => ({ v: w.id, l: w.name }))], filters.warehouseId)}
      ${select('fType', [{ v: '', l: t('all') + ' — ' + t('itemType') },
        { v: 'raw', l: t('typeRaw') }, { v: 'semi', l: t('typeSemi') }, { v: 'finished', l: t('typeFinished') }, { v: 'consumable', l: t('typeConsumable') }], filters.itemType)}
      <button class="chip ${filters.lowOnly ? 'active' : ''}" id="fLow">${t('statusLow')}</button>
    </div>

    <div class="card">
      ${table([
        { key: 'name', label: t('itemName'), render: r => `
            <button class="link-btn" data-open="${esc(r.id)}">${esc(r.name)}</button>
            <div class="sub-line mono">${esc(r.code || '')}${r.barcode ? ' · ' + esc(r.barcode) : ''}</div>` },
        { key: 'itemType', label: t('itemType'), render: r => `<span class="badge plain">${t('type' + r.itemType.charAt(0).toUpperCase() + r.itemType.slice(1))}</span>` },
        { key: 'origin', label: t('origin'), render: r => UI.originBadge(r.origin) },
        { key: 'category', label: t('category'), render: r => esc(r.category || '—') },
        { key: 'qty', label: t('available'), num: true, render: r => `${num(r.qty)} <span style="color:var(--text-faint);font-size:11px">${esc(r.unit)}</span>` },
        { key: 'quarantineQty', label: t('quarantine'), num: true, render: r => r.quarantineQty ? `<span style="color:var(--accent)">${num(r.quarantineQty)}</span>` : '—' },
        { key: 'avgCost', label: t('avgCost'), num: true, render: r => '₺' + num(r.avgCost, 2) },
        { key: 'status', label: t('status'), render: r => UI.stockStatus(r.qty, r.minStock) },
        { key: 'act', label: t('actions'), render: r => `<div class="row-actions">
            ${can('write') ? `<button class="icon-btn ok" data-in="${esc(r.id)}" title="${UI.getLang() === 'tr' ? 'Stok girişi' : 'Stock in'}">${UI.icon(UI.ICONS.plus)}</button>` : ''}
            ${can('write') ? `<button class="icon-btn" data-label="${esc(r.id)}" title="${UI.getLang() === 'tr' ? 'Etiket yazdır' : 'Print label'}">${UI.icon(UI.ICONS.print)}</button>` : ''}
            ${can('write') ? `<button class="icon-btn" data-edit="${esc(r.id)}" title="${t('edit')}">${UI.icon(UI.ICONS.edit)}</button>` : ''}
            ${can('delete') ? `<button class="icon-btn danger" data-del="${esc(r.id)}" title="${t('del')}">${UI.icon(UI.ICONS.trash)}</button>` : ''}
          </div>` }
      ], res.data)}
      ${pager(res, p => setFilters(f => ({ ...f, page: p })))}
    </div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
