// @ts-nocheck
const ViewDashboard = (() => {
  const { t, esc, money, num, dt, card, stat, table, loading, chart, PALETTE } = UI;

  async function render(el) {
    el.innerHTML = loading();
    let s, tr;
    try { [s, tr] = await Promise.all([Api.summary(), Api.trends(12)]); }
    catch (e) { UI.err(e); el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    el.innerHTML = `
      <div class="topbar">
        <div><h2>${t('dashTitle')}</h2><div class="sub">${t('dashSub')}</div></div>
        <div class="topbar-actions">
          <button class="btn btn-ghost btn-sm" id="dashRefresh">${UI.icon(UI.ICONS.search)}${t('refresh')}</button>
        </div>
      </div>

      <div class="stat-row">
        ${stat(t('kpiStockValue'), '₺' + money(s.totalValueTRY))}
        ${stat(t('kpiQuarantine'), '₺' + money(s.quarantineValueTRY), { kind: 'warn', sub: t('quarantine') })}
        ${stat(t('kpiBlocked'), '₺' + money(s.blockedValueTRY), { kind: 'crit' })}
        ${stat(t('kpiPendingPO'), '₺' + money(s.pendingPOTotalTRY), { kind: 'info' })}
      </div>

      <div class="stat-row">
        ${stat(t('kpiLowStock'), s.lowStockCount, { kind: s.lowStockCount ? 'warn' : 'ok' })}
        ${stat(t('kpiExpiring'), s.expiringCount, { kind: s.expiringCount ? 'crit' : 'ok' })}
        ${stat(t('kpiOverduePO'), s.overduePOCount, { kind: s.overduePOCount ? 'crit' : 'ok' })}
        ${stat(t('kpiApprovals'), s.pendingApprovalCount, { kind: s.pendingApprovalCount ? 'warn' : 'ok' })}
        ${stat(t('kpiOpenNCR'), s.openNCRCount, { kind: s.openNCRCount ? 'warn' : 'ok' })}
        ${stat(t('kpiPendingInsp'), s.pendingInspectionCount, { kind: s.pendingInspectionCount ? 'warn' : 'ok' })}
        ${stat(t('kpiOpenProd'), s.openProductionCount, { kind: 'info' })}
        ${stat(t('kpiCalibration'), s.calibrationDueCount, { kind: s.calibrationDueCount ? 'warn' : 'ok' })}
      </div>

      <div class="grid-2">
        ${card(t('chartTrend'), '<div class="chart-wrap"><canvas id="chTrend"></canvas></div>')}
        ${card(t('chartStockStatus'), '<div class="chart-wrap"><canvas id="chStatus"></canvas></div>')}
      </div>

      ${card(t('chartCategoryValue'), '<div class="chart-wrap"><canvas id="chCat"></canvas></div>')}

      <div class="grid-2">
        ${card(t('lowStockList'), table([
          { key: 'name', label: t('itemName') },
          { key: 'warehouse', label: t('warehouse'), render: r => esc(r.warehouse || '—') },
          { key: 'qty', label: t('onHand'), num: true, render: r => `${num(r.qty)} ${esc(r.unit || '')}` },
          { key: 'minStock', label: t('minStock'), num: true, render: r => num(r.minStock) }
        ], s.lowStockList, { emptyText: t('noData') }), '', true)}

        ${card(t('expiringList'), table([
          { key: 'itemName', label: t('itemName') },
          { key: 'lotNo', label: t('lotNo'), render: r => `<span class="mono">${esc(r.lotNo || '—')}</span>` },
          { key: 'qty', label: t('qty'), num: true, render: r => `${num(r.qty)} ${esc(r.unit || '')}` },
          {
            key: 'expiryDate', label: t('expiryDate'), render: r => r.daysLeft < 0
              ? `<span class="badge crit">${t('expired')} · ${dt(r.expiryDate)}</span>`
              : `<span class="badge warn">${num(r.daysLeft)} ${t('daysLeft')}</span>`
          }
        ], s.expiringList, { emptyText: t('noData') }), '', true)}
      </div>`;

    document.getElementById('dashRefresh').onclick = () => render(el);

    // Trend: stock value flowing in vs out per month
    chart('chTrend', {
      type: 'line',
      data: {
        labels: tr.periods,
        datasets: [
          { label: lang0('in'), data: tr.stockInValue, borderColor: PALETTE[2], backgroundColor: 'rgba(111,169,122,.12)', fill: true, tension: .3 },
          { label: lang0('out'), data: tr.stockOutValue, borderColor: PALETTE[3], backgroundColor: 'rgba(226,87,76,.12)', fill: true, tension: .3 }
        ]
      }
    });

    chart('chStatus', {
      type: 'doughnut',
      data: {
        labels: s.statusBreakdown.map(x => UI.lotStatusBadge(x.status).replace(/<[^>]*>/g, '')),
        datasets: [{ data: s.statusBreakdown.map(x => Math.round(x.value)), backgroundColor: PALETTE, borderColor: '#24282C', borderWidth: 2 }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });

    chart('chCat', {
      type: 'bar',
      data: {
        labels: s.categoryValue.map(c => c.category),
        datasets: [{ label: '₺', data: s.categoryValue.map(c => c.value), backgroundColor: PALETTE[0], borderRadius: 4 }]
      },
      options: { plugins: { legend: { display: false } } }
    });
  }

  const lang0 = (k) => UI.getLang() === 'tr'
    ? (k === 'in' ? 'Giriş değeri' : 'Çıkış değeri')
    : (k === 'in' ? 'Stock in' : 'Stock out');

  return { render };
})();
