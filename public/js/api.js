// @ts-nocheck
const Api = (() => {
  const TOKEN_KEY = 'dt_token', USER_KEY = 'dt_user';
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const getUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
  const setSession = (t, u) => { localStorage.setItem(TOKEN_KEY, t); localStorage.setItem(USER_KEY, JSON.stringify(u)); };
  const clearSession = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

  async function req(method, path, body, isForm) {
    const headers = {};
    if (!isForm) headers['Content-Type'] = 'application/json';
    const tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const res = await fetch('/api' + path, {
      method, headers,
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body))
    });
    if (res.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent('session-expired'));
      throw new Error('Unauthorized');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  const qs = (o = {}) => {
    const p = new URLSearchParams();
    Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.append(k, v); });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  return {
    getToken, getUser, setSession, clearSession,

    // auth
    login: (username, password) => req('POST', '/auth/login', { username, password }),
    logout: () => req('POST', '/auth/logout'),
    me: () => req('GET', '/auth/me'),
    changePassword: (currentPassword, newPassword) => req('POST', '/auth/change-password', { currentPassword, newPassword }),
    sessions: () => req('GET', '/auth/sessions'),

    // items
    items: (p) => req('GET', '/items' + qs(p)),
    item: (id) => req('GET', '/items/' + id),
    itemByBarcode: (code) => req('GET', '/items/barcode/' + encodeURIComponent(code)),
    createItem: (d) => req('POST', '/items', d),
    updateItem: (id, d) => req('PUT', '/items/' + id, d),
    deleteItem: (id) => req('DELETE', '/items/' + id),

    // stock
    lots: (p) => req('GET', '/stock/lots' + qs(p)),
    movements: (p) => req('GET', '/stock/movements' + qs(p)),
    moveStock: (d) => req('POST', '/stock/move', d),
    changeLotStatus: (d) => req('POST', '/stock/lot-status', d),
    transferLot: (d) => req('POST', '/stock/transfer', d),
    counts: (p) => req('GET', '/stock/counts' + qs(p)),
    count: (id) => req('GET', '/stock/counts/' + id),
    createCount: (d) => req('POST', '/stock/counts', d),
    saveCountLines: (id, lines) => req('PUT', `/stock/counts/${id}/lines`, { lines }),
    approveCount: (id) => req('POST', `/stock/counts/${id}/approve`),

    // production
    production: (p) => req('GET', '/production' + qs(p)),
    productionOrder: (id) => req('GET', '/production/' + id),
    productionRequirements: (id) => req('GET', `/production/${id}/requirements`),
    requirementsPreview: (itemId, qty) => req('GET', '/production/requirements-preview' + qs({ itemId, qty })),
    createProduction: (d) => req('POST', '/production', d),
    completeProduction: (id, d) => req('POST', `/production/${id}/complete`, d),
    deleteProduction: (id) => req('DELETE', '/production/' + id),

    // purchasing
    suppliers: (p) => req('GET', '/purchasing/suppliers' + qs(p)),
    supplier: (id) => req('GET', '/purchasing/suppliers/' + id),
    createSupplier: (d) => req('POST', '/purchasing/suppliers', d),
    updateSupplier: (id, d) => req('PUT', '/purchasing/suppliers/' + id, d),
    deleteSupplier: (id) => req('DELETE', '/purchasing/suppliers/' + id),
    anonymizeSupplier: (id) => req('POST', `/purchasing/suppliers/${id}/anonymize`),
    exportSupplierData: (id) => req('GET', `/purchasing/suppliers/${id}/data-export`),
    requests: (p) => req('GET', '/purchasing/requests' + qs(p)),
    createRequest: (d) => req('POST', '/purchasing/requests', d),
    approveRequest: (id) => req('POST', `/purchasing/requests/${id}/approve`),
    rejectRequest: (id, reason) => req('POST', `/purchasing/requests/${id}/reject`, { reason }),
    rfqs: (p) => req('GET', '/purchasing/rfqs' + qs(p)),
    createRfq: (d) => req('POST', '/purchasing/rfqs', d),
    addQuote: (id, d) => req('POST', `/purchasing/rfqs/${id}/quotes`, d),
    compareQuotes: (id) => req('GET', `/purchasing/rfqs/${id}/compare`),
    purchaseOrders: (p) => req('GET', '/purchasing/orders' + qs(p)),
    purchaseOrder: (id) => req('GET', '/purchasing/orders/' + id),
    createPO: (d) => req('POST', '/purchasing/orders', d),
    approvePO: (id) => req('POST', `/purchasing/orders/${id}/approve`),
    rejectPO: (id, reason) => req('POST', `/purchasing/orders/${id}/reject`, { reason }),
    receivePO: (id, d) => req('POST', `/purchasing/orders/${id}/receipts`, d),
    receipt: (id) => req('GET', '/purchasing/receipts/' + id),
    addLandedCost: (receiptId, d) => req('POST', `/purchasing/receipts/${receiptId}/landed-costs`, d),
    supplierInvoices: (p) => req('GET', '/purchasing/invoices' + qs(p)),
    supplierInvoiceReceivableLines: (poId) => req('GET', '/purchasing/invoices/receivable-lines' + qs({ poId })),
    createSupplierInvoice: (d) => req('POST', '/purchasing/invoices', d),
    createSupplierReturn: (d) => req('POST', '/purchasing/returns', d),

    // crm
    opportunities: (p) => req('GET', '/crm/opportunities' + qs(p)),
    opportunity: (id) => req('GET', '/crm/opportunities/' + id),
    pipeline: () => req('GET', '/crm/opportunities/pipeline'),
    createOpportunity: (d) => req('POST', '/crm/opportunities', d),
    updateOpportunity: (id, d) => req('PUT', '/crm/opportunities/' + id, d),
    setOpportunityStage: (id, d) => req('POST', `/crm/opportunities/${id}/stage`, d),
    convertOpportunity: (id, d) => req('POST', `/crm/opportunities/${id}/convert`, d || {}),

    // saha ziyaretleri
    visits: (p) => req('GET', '/visits' + qs(p)),
    visit: (id) => req('GET', '/visits/' + id),
    createVisit: (d) => req('POST', '/visits', d),
    updateVisit: (id, d) => req('PUT', '/visits/' + id, d),
    deleteVisit: (id) => req('DELETE', '/visits/' + id),

    // müşteri destek / ticket
    tickets: (p) => req('GET', '/support' + qs(p)),
    ticket: (id) => req('GET', '/support/' + id),
    createTicket: (d) => req('POST', '/support', d),
    updateTicket: (id, d) => req('PUT', '/support/' + id, d),
    setTicketStatus: (id, d) => req('POST', `/support/${id}/status`, d),
    addTicketComment: (id, d) => req('POST', `/support/${id}/comments`, d),
    convertTicketToNcr: (id, d) => req('POST', `/support/${id}/to-ncr`, d || {}),

    // sales
    customers: (p) => req('GET', '/sales/customers' + qs(p)),
    customer: (id) => req('GET', '/sales/customers/' + id),
    createCustomer: (d) => req('POST', '/sales/customers', d),
    updateCustomer: (id, d) => req('PUT', '/sales/customers/' + id, d),
    deleteCustomer: (id) => req('DELETE', '/sales/customers/' + id),
    anonymizeCustomer: (id) => req('POST', `/sales/customers/${id}/anonymize`),
    exportCustomerData: (id) => req('GET', `/sales/customers/${id}/data-export`),
    salesOrders: (p) => req('GET', '/sales/orders' + qs(p)),
    salesOrder: (id) => req('GET', '/sales/orders/' + id),
    createSalesOrder: (d) => req('POST', '/sales/orders', d),
    cancelSalesOrder: (id) => req('POST', `/sales/orders/${id}/cancel`),
    shipments: (p) => req('GET', '/sales/shipments' + qs(p)),
    shipment: (id) => req('GET', '/sales/shipments/' + id),
    createShipment: (d) => req('POST', '/sales/shipments', d),
    advanceShipment: (id) => req('PATCH', `/sales/shipments/${id}/status`),
    deleteShipment: (id) => req('DELETE', '/sales/shipments/' + id),
    customerInvoices: (p) => req('GET', '/sales/invoices' + qs(p)),
    createCustomerInvoice: (d) => req('POST', '/sales/invoices', d),
    customerInvoicePreview: (id) => req('GET', '/sales/orders/' + id + '/invoice-preview'),
    payInvoice: (id) => req('POST', `/sales/invoices/${id}/pay`),
    profitability: (p) => req('GET', '/sales/profitability' + qs(p)),

    // quality
    inspectionPlans: (p) => req('GET', '/quality/plans' + qs(p)),
    createPlan: (d) => req('POST', '/quality/plans', d),
    deletePlan: (id) => req('DELETE', '/quality/plans/' + id),
    inspections: (p) => req('GET', '/quality/inspections' + qs(p)),
    inspection: (id) => req('GET', '/quality/inspections/' + id),
    createInspection: (d) => req('POST', '/quality/inspections', d),
    recordInspection: (id, d) => req('POST', `/quality/inspections/${id}/result`, d),
    ncrs: (p) => req('GET', '/quality/ncrs' + qs(p)),
    createNcr: (d) => req('POST', '/quality/ncrs', d),
    setDisposition: (id, d) => req('POST', `/quality/ncrs/${id}/disposition`, d),
    closeNcr: (id) => req('POST', `/quality/ncrs/${id}/close`),
    capas: (p) => req('GET', '/quality/capas' + qs(p)),
    createCapa: (d) => req('POST', '/quality/capas', d),
    closeCapa: (id, d) => req('POST', `/quality/capas/${id}/close`, d),
    equipment: (p) => req('GET', '/quality/equipment' + qs(p)),
    createEquipment: (d) => req('POST', '/quality/equipment', d),
    addCalibration: (id, d) => req('POST', `/quality/equipment/${id}/calibrations`, d),
    traceBackward: (lotId) => req('GET', '/quality/trace/backward/' + lotId),
    traceForward: (lotId) => req('GET', '/quality/trace/forward/' + lotId),
    recall: (lotId) => req('GET', '/quality/recall/' + lotId),

    // reports
    summary: () => req('GET', '/reports/summary'),
    trends: (months) => req('GET', '/reports/trends' + qs({ months })),
    deadStock: (days) => req('GET', '/reports/dead-stock' + qs({ days })),
    turnover: (days) => req('GET', '/reports/turnover' + qs({ days })),
    abc: (days) => req('GET', '/reports/abc' + qs({ days })),
    reorderSuggestions: (days) => req('GET', '/reports/reorder-suggestions' + qs({ days })),
    supplierPerformance: () => req('GET', '/reports/supplier-performance'),
    qualityKpis: (days) => req('GET', '/reports/quality-kpis' + qs({ days })),
    productionCosts: () => req('GET', '/reports/production-costs'),
    valuation: () => req('GET', '/reports/valuation'),
    priceHistory: (itemId) => req('GET', '/reports/price-history/' + itemId),
    pivotMeta: () => req('GET', '/reports/pivot-meta'),
    runPivot: (d) => req('POST', '/reports/pivot', d),
    savedReports: () => req('GET', '/reports/saved'),
    createSavedReport: (d) => req('POST', '/reports/saved', d),
    deleteSavedReport: (id) => req('DELETE', '/reports/saved/' + id),

    // documents
    documents: (p) => req('GET', '/documents' + qs(p)),
    uploadDocument: (formData) => req('POST', '/documents', formData, true),
    reviseDocument: (id, formData) => req('POST', `/documents/${id}/revise`, formData, true),
    deleteDocument: (id) => req('DELETE', '/documents/' + id),

    // notifications
    notifications: (p) => req('GET', '/notifications' + qs(p)),
    markRead: (id) => req('POST', `/notifications/${id}/read`),
    markAllRead: () => req('POST', '/notifications/read-all'),
    scanAlerts: () => req('POST', '/notifications/scan'),

    // data health
    healthReport: (p) => req('GET', '/data-health/report' + qs(p)),
    systemInfo: () => req('GET', '/data-health/system'),
    healthCheck: (id, p) => req('GET', `/data-health/check/${id}` + qs(p)),
    healthFix: (id) => req('POST', `/data-health/check/${id}/fix`),
    mergePreview: (type, p) => req('GET', `/data-health/merge/${type}/preview` + qs(p)),
    mergeRecords: (type, d) => req('POST', `/data-health/merge/${type}`, d),
    bulkUpdateItems: (d) => req('POST', '/data-health/bulk-update/items', d),

    // document templates
    templates: () => req('GET', '/templates'),
    template: (docType) => req('GET', '/templates/' + docType),
    saveTemplate: (docType, d) => req('PUT', '/templates/' + docType, d),
    resetTemplate: (docType) => req('POST', `/templates/${docType}/reset`),
    branding: () => req('GET', '/templates/branding/current'),
    saveBranding: (d) => req('PUT', '/templates/branding/current', d),
    uploadLogo: (formData) => req('POST', '/templates/branding/logo', formData, true),
    deleteLogo: () => req('DELETE', '/templates/branding/logo'),

    // import
    importTypes: () => req('GET', '/import/types'),
    importPreview: (formData) => req('POST', '/import/preview', formData, true),
    importRows: (id, p) => req('GET', `/import/batches/${id}/rows` + qs(p)),
    importCommit: (id) => req('POST', `/import/batches/${id}/commit`),
    importRevert: (id) => req('POST', `/import/batches/${id}/revert`),
    importDiscard: (id) => req('DELETE', '/import/batches/' + id),
    importBatches: (p) => req('GET', '/import/batches' + qs(p)),
    importBatch: (id) => req('GET', '/import/batches/' + id),

    // planning
    workCenters: () => req('GET', '/planning/work-centers'),
    createWorkCenter: (d) => req('POST', '/planning/work-centers', d),
    updateWorkCenter: (id, d) => req('PUT', '/planning/work-centers/' + id, d),
    deleteWorkCenter: (id) => req('DELETE', '/planning/work-centers/' + id),
    shifts: () => req('GET', '/planning/shifts'),
    createShift: (d) => req('POST', '/planning/shifts', d),
    calendarExceptions: () => req('GET', '/planning/calendar-exceptions'),
    createCalendarException: (d) => req('POST', '/planning/calendar-exceptions', d),
    deleteCalendarException: (id) => req('DELETE', '/planning/calendar-exceptions/' + id),
    routings: (itemId) => req('GET', '/planning/routings/' + itemId),
    saveRouting: (itemId, operations) => req('PUT', '/planning/routings/' + itemId, { operations }),
    capacity: (p) => req('GET', '/planning/capacity' + qs(p)),
    scheduleOrder: (orderId, d) => req('POST', '/planning/schedule/' + orderId, d || {}),
    operations: (p) => req('GET', '/planning/operations' + qs(p)),
    operationAction: (id, action, d) => req('POST', `/planning/operations/${id}/${action}`, d || {}),
    shiftLogs: (p) => req('GET', '/planning/shift-logs' + qs(p)),
    createShiftLog: (d) => req('POST', '/planning/shift-logs', d),
    oee: (p) => req('GET', '/planning/oee' + qs(p)),
    mrpRuns: () => req('GET', '/planning/mrp/runs'),
    runMrp: (d) => req('POST', '/planning/mrp/run', d || {}),
    mrpSuggestions: (p) => req('GET', '/planning/mrp/suggestions' + qs(p)),
    convertSuggestion: (id, d) => req('POST', `/planning/mrp/suggestions/${id}/convert`, d || {}),
    dismissSuggestion: (id) => req('POST', `/planning/mrp/suggestions/${id}/dismiss`),

    customerInvoice: (id) => req('GET', '/sales/invoices/' + id),
    search: (q) => req('GET', '/search?q=' + encodeURIComponent(q)),

    // admin
    users: () => req('GET', '/users'),
    createUser: (d) => req('POST', '/users', d),
    updateUser: (id, d) => req('PUT', '/users/' + id, d),
    unlockUser: (id) => req('POST', `/users/${id}/unlock`),
    deleteUser: (id) => req('DELETE', '/users/' + id),
    anonymizeUser: (id) => req('POST', `/users/${id}/anonymize`),
    exportUserData: (id) => req('GET', `/users/${id}/data-export`),
    runDataRetentionSweep: () => req('POST', '/data-retention/run'),
    warehouses: () => req('GET', '/warehouses'),
    createWarehouse: (d) => req('POST', '/warehouses', d),
    updateWarehouse: (id, d) => req('PUT', '/warehouses/' + id, d),
    settings: () => req('GET', '/settings'),
    updateSettings: (d) => req('PUT', '/settings', d),
    exchangeRates: (p) => req('GET', '/exchange-rates' + qs(p)),
    currentRates: () => req('GET', '/exchange-rates/current'),
    setRate: (d) => req('POST', '/exchange-rates', d),
    approvalRules: () => req('GET', '/approval-rules'),
    createApprovalRule: (d) => req('POST', '/approval-rules', d),
    deleteApprovalRule: (id) => req('DELETE', '/approval-rules/' + id),
    notificationRules: () => req('GET', '/notification-rules'),
    createNotificationRule: (d) => req('POST', '/notification-rules', d),
    deleteNotificationRule: (id) => req('DELETE', '/notification-rules/' + id),
    accountingMappings: () => req('GET', '/accounting/mappings'),
    setAccountingMappings: (mappings) => req('PUT', '/accounting/mappings', { mappings }),
    accountingExport: (from, to) => req('GET', `/accounting/export${qs({ from, to })}`),
    audit: (p) => req('GET', '/audit' + qs(p)),

    // webhooks
    webhooks: () => req('GET', '/webhooks'),
    webhookEvents: () => req('GET', '/webhooks/events'),
    createWebhook: (d) => req('POST', '/webhooks', d),
    updateWebhook: (id, d) => req('PUT', '/webhooks/' + id, d),
    regenerateWebhookSecret: (id) => req('POST', `/webhooks/${id}/regenerate-secret`),
    deleteWebhook: (id) => req('DELETE', '/webhooks/' + id),
    webhookDeliveries: (id, p) => req('GET', `/webhooks/${id}/deliveries` + qs(p)),
    retryWebhookDelivery: (id, deliveryId) => req('POST', `/webhooks/${id}/deliveries/${deliveryId}/retry`),
    processWebhookRetryQueue: () => req('POST', '/webhooks/process-retry-queue'),
    testWebhook: (id) => req('POST', `/webhooks/${id}/test`),

    // labels (ZPL)
    printLabel: (d) => req('POST', '/labels/print', d),
    /** ZPL dosyasını indirir — yetki başlığı gerektiği için doğrudan <a href> kullanılamaz. */
    downloadLabelZpl: async (type, id) => {
      const res = await fetch(`/api/labels/${type}/${id}/zpl`, { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) throw new Error('Etiket indirilemedi / Label download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `etiket-${id}.zpl`; a.click();
      URL.revokeObjectURL(url);
    },
  };
})();
