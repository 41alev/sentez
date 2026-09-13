// @ts-nocheck
/**
 * Raporlar (Reports) — React'e kademeli geçişin bir sonraki ekranı.
 *
 * Items/Counts/Lots/Production ile aynı disiplin. Bu ekranın kendine özgü
 * yapısı: dış kabuk (topbar + `UI.tabs()` + `#repBody`/`#repActions`
 * konteynerleri) sabit, her sekme kendi verisini çekip bu iki konteyneri
 * DOĞRUDAN dolduran ayrı bir async fonksiyon (`valuation`, `trends`, vb.).
 * `UI.tabs()` kendi tıklama bağlamasını (`setTimeout(0)` ile) kendisi
 * yapıyor ve her çağrıda rastgele bir id üretiyor — bu yüzden dış HTML
 * string'i her render'da değişir ve React `dangerouslySetInnerHTML`'i her
 * seferinde tazeler; bu, vanilla sürümün "her load() tam yeniden kurar"
 * davranışıyla zaten birebir örtüşüyor.
 */
import { useEffect, useState, useRef } from 'react';

const DEAD_STOCK_DEFAULT_DAYS = 180;

export default function ReportsView() {
  const { t, esc, num, money, dt, ts, table, loading, select, field, input, modal, closeModal, val } = UI;

  const [tab, setTab] = useState('valuation');
  const [reloadToken, setReloadToken] = useState(0);
  const deadDaysRef = useRef(DEAD_STOCK_DEFAULT_DAYS);
  const pivotConfigRef = useRef({ dataSource: 'movements', dimension: 'month', metric: 'value', filters: {} });

  function reload() { setReloadToken(x => x + 1); }

  useEffect(() => {
    const body = document.getElementById('repBody');
    const actions = document.getElementById('repActions');
    if (!body || !actions) return;
    const fns = { valuation, trends, deadStock, turnover, abc, reorder, supplier, quality: qualityKpi, prodCost, custom: customReport };
    (async () => {
      try { await fns[tab](body, actions); }
      catch (e) { UI.err(e); body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    })();
  }, [tab, reloadToken]);

  const csvBtn = (actions, onClick) => {
    actions.innerHTML = `<button class="btn btn-ghost btn-sm" id="repCsv">${UI.icon(UI.ICONS.download)}CSV</button>`;
    document.getElementById('repCsv').onclick = onClick;
  };

  /* ---------- valuation ---------- */
  async function valuation(body, actions) {
    const d = await Api.valuation();
    csvBtn(actions, () => UI.exportCsv('stok-degerleme.csv',
      [t('itemName'), t('itemCode'), t('category'), t('available'), t('unit'), t('avgCost'), t('totalValue'), t('quarantine'), t('blocked')],
      d.data.map(r => [r.name, r.code, r.category, r.availableQty, r.unit, r.avgCost, r.availableValueBase, r.quarantineQty, r.blockedQty])));

    body.innerHTML = `
      <div class="stat-row">${UI.stat(t('totalValue'), '₺' + money(d.totalValueBase))}</div>
      <div class="card">${table([
        { key: 'name', label: t('itemName'), render: r => `${esc(r.name)}<div class="sub-line mono">${esc(r.code || '')}</div>` },
        { key: 'category', label: t('category'), render: r => esc(r.category || '—') },
        { key: 'availableQty', label: t('available'), num: true, render: r => `${num(r.availableQty)} <span style="color:var(--text-faint);font-size:11px">${esc(r.unit)}</span>` },
        { key: 'avgCost', label: t('avgCost'), num: true, render: r => '₺' + num(r.avgCost, 2) },
        { key: 'availableValueBase', label: t('totalValue'), num: true, render: r => '₺' + money(r.availableValueBase) },
        { key: 'quarantineQty', label: t('quarantine'), num: true, render: r => r.quarantineQty ? `<span style="color:var(--accent)">${num(r.quarantineQty)}</span>` : '—' },
        { key: 'blockedQty', label: t('blocked'), num: true, render: r => r.blockedQty ? `<span style="color:var(--danger)">${num(r.blockedQty)}</span>` : '—' },
        { key: 'costingMethod', label: t('costingMethod'), render: r => `<span class="badge plain">${r.costingMethod === 'fifo' ? t('fifo') : t('movingAverage')}</span>` }
      ], d.data)}</div>`;
  }

  /* ---------- trends ---------- */
  async function trends(body, actions) {
    const d = await Api.trends(12);
    actions.innerHTML = '';
    body.innerHTML = `
      <div class="card"><div class="card-head"><h3>${t('chartTrend')}</h3></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="rpTrend"></canvas></div></div></div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h3>${t('tabProdCost')}</h3></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="rpProd"></canvas></div></div></div>
        <div class="card"><div class="card-head"><h3>${t('profitability')}</h3></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="rpSales"></canvas></div></div></div>
      </div>`;

    UI.chart('rpTrend', {
      type: 'line',
      data: {
        labels: d.periods,
        datasets: [
          { label: UI.getLang() === 'tr' ? 'Giriş' : 'In', data: d.stockInValue, borderColor: UI.PALETTE[2], backgroundColor: 'rgba(111,169,122,.12)', fill: true, tension: .3 },
          { label: UI.getLang() === 'tr' ? 'Çıkış' : 'Out', data: d.stockOutValue, borderColor: UI.PALETTE[3], backgroundColor: 'rgba(226,87,76,.12)', fill: true, tension: .3 }
        ]
      }
    });
    UI.chart('rpProd', {
      type: 'bar',
      data: {
        labels: d.production.map(p => p.period),
        datasets: [
          { label: t('producedQty'), data: d.production.map(p => p.qty), backgroundColor: UI.PALETTE[0], borderRadius: 4 },
          { label: t('scrapQty'), data: d.production.map(p => p.scrap), backgroundColor: UI.PALETTE[3], borderRadius: 4 }
        ]
      }
    });
    UI.chart('rpSales', {
      type: 'bar',
      data: {
        labels: d.sales.map(s => s.period),
        datasets: [
          { label: t('revenue'), data: d.sales.map(s => s.revenue), backgroundColor: UI.PALETTE[1], borderRadius: 4 },
          { label: t('profit'), data: d.sales.map(s => s.profit), backgroundColor: UI.PALETTE[2], borderRadius: 4 }
        ]
      }
    });
  }

  /* ---------- dead stock ---------- */
  async function deadStock(body, actions) {
    const deadDays = deadDaysRef.current;
    const d = await Api.deadStock(deadDays);
    csvBtn(actions, () => UI.exportCsv('olu-stok.csv',
      [t('itemName'), t('lotNo'), t('warehouse'), t('qty'), t('unit'), t('totalValue'), 'age', 'daysSinceLastOut'],
      d.items.map(r => [r.itemName, r.lotNo, r.warehouse, r.qty, r.unit, r.valueBase, r.ageDays, r.daysSinceLastOut])));

    body.innerHTML = `
      <div class="filters">
        ${select('dsDays', [
          { v: '90', l: '90 ' + (UI.getLang() === 'tr' ? 'gün' : 'days') },
          { v: '180', l: '180 ' + (UI.getLang() === 'tr' ? 'gün' : 'days') },
          { v: '365', l: '365 ' + (UI.getLang() === 'tr' ? 'gün' : 'days') }], String(deadDays))}
      </div>
      <div class="stat-row">
        ${UI.stat(t('deadStockValue'), '₺' + money(d.deadStockValueBase), { kind: d.deadStockValueBase > 0 ? 'crit' : 'ok' })}
        ${UI.stat(UI.getLang() === 'tr' ? 'Hareketsiz parti' : 'Idle lots', d.items.length, { kind: 'warn' })}
      </div>
      <div class="card"><div class="card-head"><h3>${t('ageBuckets')}</h3></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="rpAge"></canvas></div></div></div>
      <div class="card">${table([
        { key: 'itemName', label: t('itemName'), render: r => `${esc(r.itemName)}<div class="sub-line mono">${esc(r.lotNo || '—')}</div>` },
        { key: 'warehouse', label: t('warehouse'), render: r => esc(r.warehouse || '—') },
        { key: 'qty', label: t('qty'), num: true, render: r => `${num(r.qty)} ${esc(r.unit || '')}` },
        { key: 'valueBase', label: t('totalValue'), num: true, render: r => '₺' + money(r.valueBase) },
        { key: 'ageDays', label: UI.getLang() === 'tr' ? 'Yaş (gün)' : 'Age (days)', num: true, render: r => r.ageDays == null ? '—' : num(r.ageDays) },
        { key: 'daysSinceLastOut', label: UI.getLang() === 'tr' ? 'Son çıkıştan beri' : 'Since last issue', num: true, render: r =>
            r.daysSinceLastOut == null ? `<span class="badge crit">${UI.getLang() === 'tr' ? 'hiç' : 'never'}</span>` : num(r.daysSinceLastOut) },
        { key: 'expiryDate', label: t('expiryDate'), render: r => dt(r.expiryDate) }
      ], d.items)}</div>`;

    document.getElementById('dsDays').onchange = e => { deadDaysRef.current = Number(e.target.value); reload(); };
    UI.chart('rpAge', {
      type: 'bar',
      data: {
        labels: d.ageBuckets.map(b => b.bucket),
        datasets: [{ label: '₺', data: d.ageBuckets.map(b => b.value), backgroundColor: UI.PALETTE, borderRadius: 4 }]
      },
      options: { plugins: { legend: { display: false } } }
    });
  }

  /* ---------- turnover ---------- */
  async function turnover(body, actions) {
    const d = await Api.turnover(365);
    csvBtn(actions, () => UI.exportCsv('devir-hizi.csv',
      [t('itemName'), t('category'), t('onHand'), t('consumed'), t('turnoverRatio'), t('daysOnHand'), t('totalValue')],
      d.data.map(r => [r.name, r.category, r.onHand, r.consumed, r.turnoverRatio, r.daysOnHand, r.valueBase])));

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Devir hızı düşük ve stokta kalma süresi yüksek olan ürünler, bağlı sermayenin nerede beklediğini gösterir.'
        : 'Low turnover and high days-on-hand show where working capital is sitting idle.'}</div>
      <div class="card">${table([
        { key: 'name', label: t('itemName'), render: r => esc(r.name) },
        { key: 'category', label: t('category'), render: r => esc(r.category || '—') },
        { key: 'onHand', label: t('onHand'), num: true, render: r => `${num(r.onHand)} ${esc(r.unit || '')}` },
        { key: 'consumed', label: t('consumed'), num: true, render: r => num(r.consumed) },
        { key: 'turnoverRatio', label: t('turnoverRatio'), num: true, render: r =>
            `<span style="color:${r.turnoverRatio < 1 ? 'var(--danger)' : r.turnoverRatio < 3 ? 'var(--accent)' : 'var(--success)'}">${num(r.turnoverRatio, 2)}</span>` },
        { key: 'daysOnHand', label: t('daysOnHand'), num: true, render: r =>
            r.daysOnHand == null ? `<span class="badge plain">—</span>` : num(r.daysOnHand) },
        { key: 'valueBase', label: t('totalValue'), num: true, render: r => '₺' + money(r.valueBase) }
      ], d.data)}</div>`;
  }

  /* ---------- ABC ---------- */
  async function abc(body, actions) {
    const d = await Api.abc(365);
    csvBtn(actions, () => UI.exportCsv('abc-analizi.csv',
      [t('itemName'), t('category'), t('annualValue'), t('cumulative'), t('abcClass')],
      d.data.map(r => [r.name, r.category, r.annualValue, r.cumulativePct, r.abcClass])));

    const counts = { A: 0, B: 0, C: 0 };
    d.data.forEach(r => counts[r.abcClass]++);

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'A sınıfı ürünler cironun %80\'ini oluşturur; sıkı takip edilmeli. C sınıfı için basit kurallar yeterlidir.'
        : 'Class A items drive 80% of value and deserve tight control; simple rules suffice for class C.'}</div>
      <div class="stat-row">
        ${UI.stat('A', counts.A, { kind: 'crit', sub: UI.getLang() === 'tr' ? 'Sıkı takip' : 'Tight control' })}
        ${UI.stat('B', counts.B, { kind: 'warn' })}
        ${UI.stat('C', counts.C, { kind: 'ok', sub: UI.getLang() === 'tr' ? 'Basit kural' : 'Simple rules' })}
        ${UI.stat(t('totalValue'), '₺' + money(d.totalValueBase))}
      </div>
      <div class="card">${table([
        { key: 'name', label: t('itemName'), render: r => esc(r.name) },
        { key: 'category', label: t('category'), render: r => esc(r.category || '—') },
        { key: 'annualValue', label: t('annualValue'), num: true, render: r => '₺' + money(r.annualValue) },
        { key: 'cumulativePct', label: t('cumulative'), num: true, render: r => num(r.cumulativePct, 1) + '%' },
        { key: 'abcClass', label: t('abcClass'), render: r =>
            `<span class="badge ${r.abcClass === 'A' ? 'crit' : r.abcClass === 'B' ? 'warn' : 'ok'}">${r.abcClass}</span>` }
      ], d.data)}</div>`;
  }

  /* ---------- reorder ---------- */
  async function reorder(body, actions) {
    const d = await Api.reorderSuggestions(90);
    csvBtn(actions, () => UI.exportCsv('siparis-onerileri.csv',
      [t('itemName'), t('onHand'), t('onOrder'), t('dailyUse'), t('leadTime'), t('reorderPoint'), t('suggestedQty'), t('supplierName')],
      d.suggestions.map(r => [r.name, r.onHand, r.onOrder, r.dailyUse, r.leadTimeDays, r.reorderPoint, r.suggestedQty, r.supplierName])));

    body.innerHTML = `
      <div class="alert ${d.count ? 'warn' : 'ok'}">${UI.getLang() === 'tr'
        ? `Sipariş noktası = günlük tüketim × tedarik süresi + emniyet stoğu. Yolda olan miktarlar düşülmüştür. ${d.count} öneri.`
        : `Reorder point = daily usage × lead time + safety stock. Quantities already on order are netted off. ${d.count} suggestion(s).`}</div>
      <div class="card">${table([
        { key: 'name', label: t('itemName'), render: r => `${esc(r.name)}<div class="sub-line">${esc(r.supplierName || '—')}</div>` },
        { key: 'onHand', label: t('onHand'), num: true, render: r => `${num(r.onHand)} ${esc(r.unit || '')}` },
        { key: 'onOrder', label: t('onOrder'), num: true, render: r => num(r.onOrder) },
        { key: 'dailyUse', label: t('dailyUse'), num: true, render: r => num(r.dailyUse, 3) },
        { key: 'leadTimeDays', label: t('leadTime'), num: true, render: r => num(r.leadTimeDays) },
        { key: 'reorderPoint', label: t('reorderPoint'), num: true, render: r => num(r.reorderPoint) },
        { key: 'daysUntilStockout', label: t('daysUntilStockout'), num: true, render: r => {
            if (r.daysUntilStockout == null) return '—';
            const c = r.daysUntilStockout <= r.leadTimeDays ? 'var(--danger)' : r.daysUntilStockout < r.leadTimeDays * 2 ? 'var(--accent)' : 'var(--success)';
            return `<span style="color:${c}">${num(r.daysUntilStockout)}</span>`;
          } },
        { key: 'suggestedQty', label: t('suggestedQty'), num: true, render: r => `<b>${num(r.suggestedQty)}</b>` },
        { key: 'estimatedCostBase', label: UI.getLang() === 'tr' ? 'Tahmini tutar' : 'Est. cost', num: true, render: r => '₺' + money(r.estimatedCostBase) }
      ], d.suggestions)}</div>`;
  }

  /* ---------- supplier performance ---------- */
  async function supplier(body, actions) {
    const d = await Api.supplierPerformance();
    csvBtn(actions, () => UI.exportCsv('tedarikci-performansi.csv',
      [t('supplierName'), t('deliveries'), t('onTimePct'), t('avgDelay'), t('totalSpend'), t('rejectPct'), 'NCR', t('supplierScore')],
      d.data.map(r => [r.name, r.deliveries, r.onTimePct, r.avgDelayDays, r.totalSpendBase, r.rejectPct, r.ncrCount, r.score])));

    body.innerHTML = `
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Puan = zamanında teslim %50 + kalite (red oranı) %50. Yeni tedarikçilerde veri yoksa puan hesaplanmaz.'
        : 'Score = 50% on-time delivery + 50% quality (reject rate). New suppliers without history are not scored.'}</div>
      <div class="card"><div class="card-body"><div class="chart-wrap"><canvas id="rpSup"></canvas></div></div></div>
      <div class="card">${table([
        { key: 'name', label: t('supplierName'), render: r => esc(r.name) },
        { key: 'deliveries', label: t('deliveries'), num: true, render: r => num(r.deliveries) },
        { key: 'onTimePct', label: t('onTimePct'), num: true, render: r => {
            if (r.onTimePct == null) return '—';
            const c = r.onTimePct >= 90 ? 'var(--success)' : r.onTimePct >= 70 ? 'var(--accent)' : 'var(--danger)';
            return `<span style="color:${c}">${num(r.onTimePct, 1)}%</span>`;
          } },
        { key: 'avgDelayDays', label: t('avgDelay'), num: true, render: r => num(r.avgDelayDays, 1) },
        { key: 'rejectPct', label: t('rejectPct'), num: true, render: r =>
            `<span style="color:${r.rejectPct > 2 ? 'var(--danger)' : 'var(--success)'}">${num(r.rejectPct, 2)}%</span>` },
        { key: 'ncrCount', label: 'NCR', num: true, render: r => r.ncrCount ? `<span style="color:var(--accent)">${num(r.ncrCount)}</span>` : '—' },
        { key: 'totalSpendBase', label: t('totalSpend'), num: true, render: r => '₺' + money(r.totalSpendBase) },
        { key: 'score', label: t('supplierScore'), num: true, render: r => r.score == null
            ? '<span class="badge plain">—</span>'
            : `<span class="badge ${r.score >= 85 ? 'ok' : r.score >= 65 ? 'warn' : 'crit'}">${r.score}</span>` }
      ], d.data)}</div>`;

    const scored = d.data.filter(r => r.score != null);
    UI.chart('rpSup', {
      type: 'bar',
      data: {
        labels: scored.map(r => r.name),
        datasets: [{ label: t('supplierScore'), data: scored.map(r => r.score), backgroundColor: UI.PALETTE[0], borderRadius: 4 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { max: 100 } } }
    });
  }

  /* ---------- quality KPIs ---------- */
  const ncrSourceLabel = (s) => ({
    incoming: t('inspIncoming'), in_process: t('inspInProcess'), final: t('inspFinal'),
    customer: UI.getLang() === 'tr' ? 'Müşteri şikayeti' : 'Customer complaint',
    internal: UI.getLang() === 'tr' ? 'İç denetim' : 'Internal'
  }[s] || s);

  async function qualityKpi(body, actions) {
    const d = await Api.qualityKpis(365);
    actions.innerHTML = '';
    body.innerHTML = `
      <div class="stat-row">
        ${UI.stat(t('incomingRejectPct'), num(d.incomingRejectPct, 2) + '%', { kind: d.incomingRejectPct > 2 ? 'crit' : 'ok' })}
        ${UI.stat(t('scrapPct'), num(d.production.scrapPct, 2) + '%', { kind: d.production.scrapPct > 3 ? 'crit' : 'ok' })}
        ${UI.stat(t('yieldPct'), num(d.production.yieldPct, 1) + '%', { kind: d.production.yieldPct >= 97 ? 'ok' : 'warn' })}
        ${UI.stat(t('openCapa'), d.openCapaCount, { kind: d.openCapaCount ? 'warn' : 'ok' })}
        ${UI.stat(t('overdueCapa'), d.overdueCapaCount, { kind: d.overdueCapaCount ? 'crit' : 'ok' })}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h3>${t('tabNcr')} — ${t('severity')}</h3></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="rpSev"></canvas></div></div></div>
        <div class="card"><div class="card-head"><h3>${t('tabInspections')}</h3></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="rpIns"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-head"><h3>${t('source')}</h3></div>
        ${table([
          { key: 'source', label: t('source'), render: r => esc(ncrSourceLabel(r.source)) },
          { key: 'c', label: UI.getLang() === 'tr' ? 'Adet' : 'Count', num: true, render: r => num(r.c) }
        ], d.ncrBySource)}</div>`;

    const sevLabels = { minor: t('sevMinor'), major: t('sevMajor'), critical: t('sevCritical') };
    UI.chart('rpSev', {
      type: 'doughnut',
      data: {
        labels: d.ncrBySeverity.map(s => sevLabels[s.severity] || s.severity),
        datasets: [{ data: d.ncrBySeverity.map(s => s.c), backgroundColor: [UI.PALETTE[1], UI.PALETTE[0], UI.PALETTE[3]], borderColor: '#24282C', borderWidth: 2 }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
    const resLabels = { pending: t('resultPending'), accepted: t('resultAccepted'), rejected: t('resultRejected'), conditional: t('resultConditional') };
    UI.chart('rpIns', {
      type: 'doughnut',
      data: {
        labels: d.inspectionsByResult.map(r => resLabels[r.result] || r.result),
        datasets: [{ data: d.inspectionsByResult.map(r => r.count), backgroundColor: UI.PALETTE, borderColor: '#24282C', borderWidth: 2 }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  }

  /* ---------- production costs ---------- */
  async function prodCost(body, actions) {
    const rows = await Api.productionCosts();
    csvBtn(actions, () => UI.exportCsv('uretim-maliyetleri.csv',
      [t('prodOrderNo'), t('itemName'), t('producedQty'), t('scrapQty'), t('materialCost'), t('laborCost'), t('overheadCost'), t('totalCost'), t('unitCostLabel')],
      rows.map(r => [r.orderNo, r.itemName, r.qty, r.scrapQty, r.materialCost, r.laborCost, r.overheadCost, r.totalCost, r.unitCost])));

    body.innerHTML = `
      <div class="card"><div class="card-body"><div class="chart-wrap"><canvas id="rpCost"></canvas></div></div></div>
      <div class="card">${table([
        { key: 'orderNo', label: t('prodOrderNo'), render: r => `<span class="mono">${esc(r.orderNo)}</span><div class="sub-line">${esc(r.itemName)}</div>` },
        { key: 'qty', label: t('producedQty'), num: true, render: r => `${num(r.qty)} ${esc(r.unit || '')}` },
        { key: 'scrapQty', label: t('scrapQty'), num: true, render: r => r.scrapQty ? `<span style="color:var(--danger)">${num(r.scrapQty)}</span>` : '—' },
        { key: 'yieldPct', label: t('yieldPct'), num: true, render: r =>
            `<span style="color:${r.yieldPct >= 97 ? 'var(--success)' : 'var(--accent)'}">${num(r.yieldPct, 1)}%</span>` },
        { key: 'materialCost', label: t('materialCost'), num: true, render: r => '₺' + money(r.materialCost) },
        { key: 'laborCost', label: t('laborCost'), num: true, render: r => '₺' + money(r.laborCost) },
        { key: 'overheadCost', label: t('overheadCost'), num: true, render: r => '₺' + money(r.overheadCost) },
        { key: 'totalCost', label: t('totalCost'), num: true, render: r => '₺' + money(r.totalCost) },
        { key: 'unitCost', label: t('unitCostLabel'), num: true, render: r => '₺' + num(r.unitCost, 2) },
        { key: 'completedAt', label: t('date'), render: r => ts(r.completedAt), cls: 'nowrap' }
      ], rows)}</div>`;

    const recent = rows.slice(0, 12).reverse();
    UI.chart('rpCost', {
      type: 'bar',
      data: {
        labels: recent.map(r => r.orderNo),
        datasets: [
          { label: t('materialCost'), data: recent.map(r => r.materialCost), backgroundColor: UI.PALETTE[0], stack: 's', borderRadius: 3 },
          { label: t('laborCost'), data: recent.map(r => r.laborCost), backgroundColor: UI.PALETTE[1], stack: 's', borderRadius: 3 },
          { label: t('overheadCost'), data: recent.map(r => r.overheadCost), backgroundColor: UI.PALETTE[4], stack: 's', borderRadius: 3 }
        ]
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } }
    });
  }

  /* ---------- özel rapor (pivot) — BI derinliği ---------- */
  const movementTypeLabel = (mt) => ({
    in: UI.getLang() === 'tr' ? 'Stok girişi' : 'Stock in',
    out: UI.getLang() === 'tr' ? 'Stok çıkışı' : 'Stock out',
    transfer: UI.getLang() === 'tr' ? 'Depo transferi' : 'Transfer',
    adjust: UI.getLang() === 'tr' ? 'Sayım düzeltmesi' : 'Count adjustment',
    status_change: UI.getLang() === 'tr' ? 'Durum değişikliği' : 'Status change'
  }[mt] || mt);

  async function customReport(body, actions) {
    actions.innerHTML = '';
    let meta, saved;
    try { [meta, saved] = await Promise.all([Api.pivotMeta(), Api.savedReports()]); }
    catch (e) { UI.err(e); return; }
    const cfg = pivotConfigRef.current;
    const dsOf = (key) => meta.dataSources.find(d => d.key === key) || meta.dataSources[0];

    const dimLabel = (dsKey, k) => dsOf(dsKey).dimensions.find(d => d.key === k)?.label || k;
    const metLabel = (dsKey, k) => dsOf(dsKey).metrics.find(m => m.key === k)?.label || k;

    function drawFields(dsKey) {
      const ds = dsOf(dsKey);
      // Boyut/ölçü seçimi seçili veri kaynağında YOKSA o kaynağın ilk seçeneğine düş —
      // her veri kaynağının kendi boyut/ölçü kümesi var (bkz. server/services/pivot.js).
      const dimVal = ds.dimensions.some(d => d.key === cfg.dimension) ? cfg.dimension : ds.dimensions[0].key;
      const metVal = ds.metrics.some(m => m.key === cfg.metric) ? cfg.metric : ds.metrics[0].key;
      document.getElementById('pvFields').innerHTML = `
        <div class="filters">
          ${field(t('pivotDimension'), select('pvDim', ds.dimensions.map(d => ({ v: d.key, l: d.label })), dimVal))}
          ${field(t('pivotMetric'), select('pvMet', ds.metrics.map(m => ({ v: m.key, l: m.label })), metVal))}
          ${ds.extraFilterKeys.includes('type')
            ? field(t('pivotTypeFilter'), select('pvType', [{ v: '', l: t('all') }, ...meta.movementTypes.map(mt => ({ v: mt, l: movementTypeLabel(mt) }))], cfg.filters.type || ''))
            : ''}
        </div>`;
    }

    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="filters">
          ${field(t('pivotDataSource'), select('pvSrc', meta.dataSources.map(d => ({ v: d.key, l: d.label })), cfg.dataSource))}
        </div>
        <div id="pvFields"></div>
        <div class="filters">
          ${field(t('from'), input('pvFrom', { type: 'date', value: cfg.filters.from || '' }))}
          ${field(t('to'), input('pvTo', { type: 'date', value: cfg.filters.to || '' }))}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-primary btn-sm" id="pvRun">${t('runReport')}</button>
          <button class="btn btn-ghost btn-sm" id="pvSave">${t('saveReport')}</button>
        </div>
      </div></div>
      ${saved.length ? `<div class="card"><div class="card-body">
        <div class="section-title">${t('savedReports')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${saved.map(s => `<span class="badge plain" style="cursor:pointer" data-load="${esc(s.id)}">${esc(dsOf(s.dataSource).label)} · ${esc(s.name)}
            <span data-del="${esc(s.id)}" style="margin-left:6px;opacity:.7">✕</span></span>`).join('')}
        </div>
      </div></div>` : ''}
      <div id="pvResult"></div>`;

    drawFields(cfg.dataSource);
    document.getElementById('pvSrc').onchange = (e) => drawFields(e.target.value);

    async function runAndRender() {
      cfg.dataSource = val('pvSrc'); cfg.dimension = val('pvDim'); cfg.metric = val('pvMet');
      cfg.filters = { type: document.getElementById('pvType') ? (val('pvType') || undefined) : undefined,
        from: val('pvFrom') || undefined, to: val('pvTo') || undefined };
      const resultEl = document.getElementById('pvResult');
      resultEl.innerHTML = loading();
      let r;
      try { r = await Api.runPivot(cfg); } catch (e) { UI.err(e); resultEl.innerHTML = ''; return; }
      resultEl.innerHTML = `
        <div class="card"><div class="card-body"><div class="chart-wrap"><canvas id="pvChart"></canvas></div></div></div>
        <div class="card">${table([
          { key: 'dim', label: dimLabel(cfg.dataSource, cfg.dimension) },
          { key: 'val', label: metLabel(cfg.dataSource, cfg.metric), num: true, render: row => num(row.val, 2) }
        ], r.data)}</div>`;
      UI.chart('pvChart', {
        type: 'bar',
        data: { labels: r.data.map(d => String(d.dim)), datasets: [{ label: metLabel(cfg.dataSource, cfg.metric), data: r.data.map(d => d.val), backgroundColor: UI.PALETTE[1], borderRadius: 4 }] }
      });
    }

    document.getElementById('pvRun').onclick = runAndRender;
    document.getElementById('pvSave').onclick = () => {
      modal({
        title: t('saveReport'),
        body: field(t('reportName'), input('pvName')),
        footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="pvSaveGo">${t('save')}</button>`,
        onOpen: (box) => {
          box.querySelector('#pvSaveGo').onclick = async () => {
            const name = val('pvName');
            if (!name) return UI.toast(t('reportName'), 'err');
            try {
              await Api.createSavedReport({
                name, dataSource: val('pvSrc'), dimension: val('pvDim'), metric: val('pvMet'),
                filters: { type: document.getElementById('pvType') ? (val('pvType') || undefined) : undefined,
                  from: val('pvFrom') || undefined, to: val('pvTo') || undefined }
              });
              closeModal(); UI.ok(t('saved')); reload();
            } catch (e) { UI.err(e); }
          };
        }
      });
    };
    body.querySelectorAll('[data-load]').forEach(el => el.onclick = (e) => {
      if (e.target.dataset.del) return;
      const s = saved.find(x => x.id === el.dataset.load);
      pivotConfigRef.current = { dataSource: s.dataSource, dimension: s.dimension, metric: s.metric, filters: s.filters };
      reload();
    });
    body.querySelectorAll('[data-del]').forEach(el => el.onclick = async (e) => {
      e.stopPropagation();
      try { await Api.deleteSavedReport(el.dataset.del); UI.ok(t('deleted')); reload(); } catch (err) { UI.err(err); }
    });

    runAndRender();
  }

  const html = `
    <div class="topbar">
      <div><h2>${t('repTitle')}</h2><div class="sub">${t('repSub')}</div></div>
      <div class="topbar-actions" id="repActions"></div>
    </div>
    ${UI.tabs([
      { k: 'valuation', l: t('tabValuation') }, { k: 'trends', l: t('tabTrends') },
      { k: 'deadStock', l: t('tabDeadStock') }, { k: 'turnover', l: t('tabTurnover') },
      { k: 'abc', l: t('tabAbc') }, { k: 'reorder', l: t('tabReorder') },
      { k: 'supplier', l: t('tabSupplierPerf') }, { k: 'quality', l: t('tabQualityKpi') },
      { k: 'prodCost', l: t('tabProdCost') }, { k: 'custom', l: t('tabCustomReport') }
    ], tab, k => setTab(k))}
    <div id="repBody">${loading()}</div>`;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
