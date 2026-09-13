// @ts-nocheck
/**
 * OpenAPI 3.0 şeması — ubl.js/zpl.js ile aynı desen: saf, yan etkisiz bir
 * ÜRETİCİ. server/routes/docs.js bunu JSON olarak servis eder.
 *
 * BİLİNÇLİ KAPSAM SINIRI: bu, sistemdeki 140+ endpoint'in TAMAMINI değil,
 * bir dış sistemin (e-ticaret, B2B portal, muhasebe, başka bir ERP) gerçekten
 * entegre olmak isteyeceği ANA kaynakları belgeliyor — ürünler, stok/lot,
 * satın alma, satış, üretim, kalite, bildirimler, webhook'lar, etiketler.
 * İç yönetim/ayar/rapor endpoint'leri (ör. /api/settings, /api/audit,
 * /api/reports/*) kasıtlı olarak dışarıda bırakıldı — bunlar arayüzün
 * kendi kullandığı, dışa açık bir entegrasyon sözleşmesi olması
 * beklenmeyen iç uçlar. Alan adları ICI HİÇBİR ŞEY İCAT EDİLMEDİ —
 * test/contract.js'in doğruladığı gerçek alan adlarından ve ilgili route
 * dosyalarındaki zod şemalarından birebir alındı.
 */

const bearerAuth = [{ bearerAuth: [] }];

function envelope(itemSchemaName) {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: `#/components/schemas/${itemSchemaName}` } },
      page: { type: 'integer' }, pageSize: { type: 'integer' },
      total: { type: 'integer' }, totalPages: { type: 'integer' }
    }
  };
}

const errorResponse = {
  description: 'Hata / Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
};

function jsonResponse(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

function ref(name) { return { $ref: `#/components/schemas/${name}` }; }

function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Depo Takip ERP — Entegrasyon API',
      version: '2.0.0',
      description:
        'Bu, sistemin TÜM iç uçlarının değil, dış sistemlerin (e-ticaret, ' +
        'B2B portal, muhasebe, başka bir ERP) entegre olmak isteyeceği ana ' +
        'kaynakların (ürün, stok, satın alma, satış, üretim, kalite, ' +
        'bildirim, webhook, etiket) sözleşmesidir. Kimlik doğrulama: ' +
        '`POST /api/auth/login` ile alınan JWT, `Authorization: Bearer <token>` ' +
        'başlığıyla gönderilir. Olay tabanlı bildirimler için bkz. Webhooks.'
    },
    servers: [{ url: '/api', description: 'Bu sunucu / This server' }],
    tags: [
      { name: 'Auth' }, { name: 'Items' }, { name: 'Stock' },
      { name: 'Purchasing' }, { name: 'Sales' }, { name: 'Production' },
      { name: 'Quality' }, { name: 'Notifications' }, { name: 'Webhooks' }, { name: 'Labels' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } }
          }
        },
        Item: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, code: { type: 'string', nullable: true },
            barcode: { type: 'string', nullable: true }, category: { type: 'string', nullable: true },
            itemType: { type: 'string', enum: ['raw', 'semi', 'finished', 'consumable'] },
            origin: { type: 'string' }, unit: { type: 'string' },
            qty: { type: 'number' }, minStock: { type: 'number' }, avgCost: { type: 'number' },
            quarantineQty: { type: 'number' }
          }
        },
        ItemDetail: {
          allOf: [ref('Item'), {
            type: 'object',
            properties: {
              warehouse: { type: 'string', nullable: true }, salePrice: { type: 'number' },
              description: { type: 'string', nullable: true },
              stockByStatus: { type: 'object', properties: { available: { type: 'number' }, quarantine: { type: 'number' }, blocked: { type: 'number' }, rejected: { type: 'number' } } },
              bom: { type: 'array', items: { type: 'object', properties: { componentItemId: { type: 'string' }, componentName: { type: 'string' }, qtyPerUnit: { type: 'number' }, scrapPct: { type: 'number' } } } },
              lots: { type: 'array', items: ref('Lot') }
            }
          }]
        },
        ItemCreate: {
          type: 'object', required: ['name'],
          properties: {
            name: { type: 'string' }, code: { type: 'string' }, barcode: { type: 'string' }, category: { type: 'string' },
            itemType: { type: 'string', enum: ['raw', 'semi', 'finished', 'consumable'], default: 'raw' },
            origin: { type: 'string', default: 'Yurt İçi' }, warehouseId: { type: 'integer' }, location: { type: 'string' },
            unit: { type: 'string', default: 'adet' }, minStock: { type: 'number', default: 0 }, reorderQty: { type: 'number', default: 0 },
            costingMethod: { type: 'string', enum: ['moving_average', 'fifo'], default: 'moving_average' },
            standardCost: { type: 'number', default: 0 }, salePrice: { type: 'number', default: 0 },
            saleCurrency: { type: 'string', enum: ['TRY', 'USD', 'EUR', 'GBP'], default: 'TRY' },
            isLotTracked: { type: 'boolean', default: true }, isSerialTracked: { type: 'boolean', default: false },
            shelfLifeDays: { type: 'integer', nullable: true }, requiresIncomingInspection: { type: 'boolean', default: false }
          }
        },
        Lot: {
          type: 'object',
          properties: {
            id: { type: 'string' }, itemName: { type: 'string' }, lotNo: { type: 'string', nullable: true },
            qty: { type: 'number' }, unit: { type: 'string' },
            status: { type: 'string', enum: ['available', 'quarantine', 'blocked', 'rejected'] },
            unitCost: { type: 'number' }, warehouse: { type: 'string', nullable: true }, warehouseId: { type: 'integer' },
            receivedAt: { type: 'integer', description: 'Unix ms timestamp' }
          }
        },
        StockMove: {
          type: 'object', required: ['itemId', 'type', 'qty'],
          properties: {
            itemId: { type: 'string' }, type: { type: 'string', enum: ['in', 'out'] }, qty: { type: 'number' },
            warehouseId: { type: 'integer' }, lotNo: { type: 'string' }, expiryDate: { type: 'string', format: 'date', nullable: true },
            unitCost: { type: 'number' }, note: { type: 'string' }
          }
        },
        Supplier: {
          type: 'object',
          properties: {
            name: { type: 'string' }, contactPerson: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true }, taxNo: { type: 'string', nullable: true },
            paymentTermsDays: { type: 'integer' }, leadTimeDays: { type: 'integer' },
            priceHistory: { type: 'array', items: { type: 'object' } },
            performance: { type: 'object', properties: { onTimePct: { type: 'number' }, deliveries: { type: 'integer' }, rejectPct: { type: 'number' }, totalSpendBase: { type: 'number' } } }
          }
        },
        SupplierCreate: {
          type: 'object', required: ['name'],
          properties: {
            code: { type: 'string' }, name: { type: 'string' }, contactPerson: { type: 'string' }, phone: { type: 'string' },
            email: { type: 'string' }, address: { type: 'string' }, country: { type: 'string' }, taxNo: { type: 'string' },
            currency: { type: 'string', enum: ['TRY', 'USD', 'EUR', 'GBP'], default: 'TRY' },
            paymentTermsDays: { type: 'integer', default: 30 }, leadTimeDays: { type: 'integer', default: 7 },
            incoterm: { type: 'string' }, bankInfo: { type: 'string' }, isApproved: { type: 'boolean', default: true }, notes: { type: 'string' }
          }
        },
        PurchaseOrderLine: {
          type: 'object',
          properties: { id: { type: 'integer' }, itemName: { type: 'string' }, qty: { type: 'number' }, receivedQty: { type: 'number' }, remainingQty: { type: 'number' }, price: { type: 'number' }, currency: { type: 'string' } }
        },
        PurchaseOrder: {
          type: 'object',
          properties: {
            id: { type: 'string' }, poNo: { type: 'string' }, supplier: { type: 'string' }, date: { type: 'string', format: 'date' },
            expected: { type: 'string', format: 'date', nullable: true }, currency: { type: 'string' }, fxRate: { type: 'number' },
            status: { type: 'string', enum: ['pending_approval', 'approved', 'partially_received', 'received', 'rejected'] },
            approvalStatus: { type: 'string', enum: ['not_required', 'pending', 'approved', 'rejected'] },
            totalBase: { type: 'number' }, items: { type: 'array', items: ref('PurchaseOrderLine') }
          }
        },
        PurchaseOrderCreate: {
          type: 'object', required: ['supplierId', 'items'],
          properties: {
            supplierId: { type: 'integer' }, date: { type: 'string', format: 'date' }, expected: { type: 'string', format: 'date' },
            warehouseId: { type: 'integer' }, currency: { type: 'string', enum: ['TRY', 'USD', 'EUR', 'GBP'], default: 'TRY' },
            incoterm: { type: 'string' }, notes: { type: 'string' },
            items: {
              type: 'array', items: {
                type: 'object', required: ['itemId', 'qty', 'price'],
                properties: { itemId: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' }, currency: { type: 'string' }, tolerancePct: { type: 'number', default: 0 } }
              }
            }
          }
        },
        PurchaseReceiptCreate: {
          type: 'object', required: ['lines'],
          properties: {
            waybillNo: { type: 'string' }, customsDeclNo: { type: 'string' }, notes: { type: 'string' },
            lines: {
              type: 'array', items: {
                type: 'object', required: ['poItemId', 'qty'],
                properties: { poItemId: { type: 'integer' }, qty: { type: 'number' }, lotNo: { type: 'string' }, expiryDate: { type: 'string', format: 'date' } }
              }
            }
          }
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, name: { type: 'string' }, contact_person: { type: 'string', nullable: true },
            currency: { type: 'string' }, payment_terms_days: { type: 'integer' }, credit_limit: { type: 'number' }
          },
          description: 'Alanlar KASITLI OLARAK snake_case — arayüz bu uçtan gelen veriyi ham okuyor.'
        },
        CustomerCreate: {
          type: 'object', required: ['name'],
          properties: {
            code: { type: 'string' }, name: { type: 'string' }, contactPerson: { type: 'string' }, phone: { type: 'string' },
            email: { type: 'string' }, address: { type: 'string' }, country: { type: 'string' }, taxNo: { type: 'string' },
            currency: { type: 'string', enum: ['TRY', 'USD', 'EUR'], default: 'TRY' },
            paymentTermsDays: { type: 'integer', default: 30 }, creditLimit: { type: 'number', default: 0 },
            incoterm: { type: 'string' }, notes: { type: 'string' }
          }
        },
        SalesOrderLine: {
          type: 'object',
          properties: { itemName: { type: 'string' }, qty: { type: 'number' }, shippedQty: { type: 'number' }, remainingQty: { type: 'number' }, price: { type: 'number' }, cogsBase: { type: 'number' } }
        },
        SalesOrder: {
          type: 'object',
          properties: {
            id: { type: 'string' }, soNo: { type: 'string' }, customerName: { type: 'string' }, date: { type: 'string', format: 'date' },
            currency: { type: 'string' }, fxRate: { type: 'number' },
            status: { type: 'string', enum: ['open', 'partially_shipped', 'shipped', 'invoiced', 'cancelled'] },
            totalBase: { type: 'number' }, lines: { type: 'array', items: ref('SalesOrderLine') }
          }
        },
        SalesOrderCreate: {
          type: 'object', required: ['customerId', 'lines'],
          properties: {
            customerId: { type: 'integer' }, date: { type: 'string', format: 'date' }, promisedDate: { type: 'string', format: 'date' },
            currency: { type: 'string', enum: ['TRY', 'USD', 'EUR'], default: 'TRY' }, incoterm: { type: 'string' }, notes: { type: 'string' },
            lines: {
              type: 'array', items: {
                type: 'object', required: ['itemId', 'qty'],
                properties: { itemId: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number', default: 0 } }
              }
            }
          }
        },
        ShipmentItem: {
          type: 'object',
          properties: { itemName: { type: 'string' }, lotId: { type: 'string', nullable: true }, lotNo: { type: 'string', nullable: true }, qty: { type: 'number' }, unitCost: { type: 'number' } }
        },
        Shipment: {
          type: 'object',
          properties: {
            id: { type: 'string' }, shipmentNo: { type: 'string' }, destination: { type: 'string' },
            status: { type: 'string', enum: ['Hazırlanıyor', 'Yolda', 'Teslim Edildi'] }, date: { type: 'string', format: 'date' },
            items: { type: 'array', items: ref('ShipmentItem') },
            crates: { type: 'array', items: { type: 'object', properties: { crateNo: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' }, weight: { type: 'number' } } } }
          }
        },
        ShipmentCreate: {
          type: 'object', required: ['destination', 'items'],
          properties: {
            soId: { type: 'string' }, customerId: { type: 'integer' }, type: { type: 'string', default: 'Yurt İçi' },
            carrier: { type: 'string' }, destination: { type: 'string' }, date: { type: 'string', format: 'date' },
            incoterm: { type: 'string' }, trackingNo: { type: 'string' }, warehouseId: { type: 'integer' },
            items: {
              type: 'array', items: {
                type: 'object', required: ['itemId', 'qty'],
                properties: { itemId: { type: 'string' }, qty: { type: 'number' }, lotId: { type: 'string', description: 'Boş bırakılırsa FEFO otomatik seçer' } }
              }
            },
            crates: { type: 'array', items: { type: 'object', properties: { crateNo: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' }, weight: { type: 'number' } } } }
          }
        },
        ProductionOrder: {
          type: 'object',
          properties: {
            id: { type: 'string' }, orderNo: { type: 'string' }, itemName: { type: 'string' }, qty: { type: 'number' },
            producedQty: { type: 'number' }, scrapQty: { type: 'number' },
            status: { type: 'string', enum: ['Planlandı', 'Devam Ediyor', 'Tamamlandı', 'İptal Edildi'] },
            date: { type: 'string', format: 'date' }
          }
        },
        ProductionOrderCreate: {
          type: 'object', required: ['itemId', 'qty'],
          properties: {
            itemId: { type: 'string' }, qty: { type: 'number' }, warehouseId: { type: 'integer' }, date: { type: 'string', format: 'date' },
            lotNo: { type: 'string' }, note: { type: 'string' }, laborCost: { type: 'number', default: 0 }, overheadCost: { type: 'number', default: 0 }
          }
        },
        ProductionComplete: {
          type: 'object',
          properties: {
            producedQty: { type: 'number' }, scrapQty: { type: 'number', default: 0 }, reworkQty: { type: 'number', default: 0 },
            lotNo: { type: 'string' }, expiryDate: { type: 'string', format: 'date' }, laborCost: { type: 'number' }, overheadCost: { type: 'number' }
          }
        },
        Inspection: {
          type: 'object',
          properties: {
            id: { type: 'string' }, inspectionNo: { type: 'string' }, type: { type: 'string', enum: ['incoming', 'in_process', 'final'] },
            itemName: { type: 'string' }, lotNo: { type: 'string', nullable: true }, inspectedQty: { type: 'number' },
            acceptedQty: { type: 'number' }, rejectedQty: { type: 'number' },
            result: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'conditional'] }
          }
        },
        InspectionCreate: {
          type: 'object', required: ['type', 'itemId'],
          properties: {
            type: { type: 'string', enum: ['incoming', 'in_process', 'final'] }, itemId: { type: 'string' }, lotId: { type: 'string' },
            supplierId: { type: 'integer' }, sampleSize: { type: 'integer' }, inspectedQty: { type: 'number' }, aql: { type: 'string' }, notes: { type: 'string' }
          }
        },
        NCR: {
          type: 'object',
          properties: {
            id: { type: 'string' }, ncrNo: { type: 'string' }, source: { type: 'string' },
            severity: { type: 'string', enum: ['minor', 'major', 'critical'] }, qtyAffected: { type: 'number', nullable: true },
            disposition: { type: 'string', enum: ['pending', 'use_as_is', 'rework', 'return_to_supplier', 'scrap'] },
            status: { type: 'string', enum: ['open', 'in_progress', 'closed'] }, openedAt: { type: 'integer' }
          }
        },
        NCRCreate: {
          type: 'object', required: ['source', 'description'],
          properties: {
            source: { type: 'string', enum: ['incoming', 'in_process', 'final', 'customer', 'internal'] },
            itemId: { type: 'string' }, lotId: { type: 'string' }, supplierId: { type: 'integer' }, customerId: { type: 'integer' },
            qtyAffected: { type: 'number' }, severity: { type: 'string', enum: ['minor', 'major', 'critical'], default: 'minor' },
            description: { type: 'string' }
          }
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string' }, ruleType: { type: 'string' }, severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            title: { type: 'string' }, body: { type: 'string' }, isRead: { type: 'boolean' }, createdAt: { type: 'integer' }
          }
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' }, url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } }, description: { type: 'string', nullable: true },
            isActive: { type: 'boolean' }, createdAt: { type: 'integer' }
          }
        },
        WebhookCreate: {
          type: 'object', required: ['url', 'events'],
          properties: {
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' }, description: 'GET /webhooks/events olay kataloğunu döner' },
            description: { type: 'string' }
          }
        },
        WebhookCreated: { allOf: [ref('Webhook'), { type: 'object', properties: { secret: { type: 'string', description: 'YALNIZCA burada bir kez döner — X-Webhook-Signature doğrulaması için saklayın.' } } }] },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'string' }, event: { type: 'string' }, statusCode: { type: 'integer', nullable: true },
            success: { type: 'boolean' }, error: { type: 'string', nullable: true }, durationMs: { type: 'integer' }, attemptedAt: { type: 'integer' }
          }
        }
      }
    },
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Giriş yap / Sign in', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } } } } },
          responses: {
            200: jsonResponse('JWT ve kullanıcı bilgisi', { type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' } } }),
            401: errorResponse, 429: errorResponse
          }
        }
      },
      '/items': {
        get: {
          tags: ['Items'], summary: 'Ürünleri listele / List items', security: bearerAuth,
          parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'pageSize', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Item')) }
        },
        post: {
          tags: ['Items'], summary: 'Yeni ürün / Create item', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('ItemCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('ItemDetail')), 422: errorResponse }
        }
      },
      '/items/{id}': {
        get: { tags: ['Items'], summary: 'Ürün detayı / Item detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Ürün', ref('ItemDetail')), 404: errorResponse } },
        put: { tags: ['Items'], summary: 'Ürünü güncelle / Update item', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: ref('ItemCreate') } } }, responses: { 200: jsonResponse('Güncellendi', ref('ItemDetail')), 404: errorResponse } }
      },
      '/items/barcode/{code}': {
        get: { tags: ['Items'], summary: 'Barkoddan ürün bul / Find item by barcode', security: bearerAuth, parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Ürün', ref('ItemDetail')), 404: errorResponse } }
      },
      '/stock/lots': {
        get: {
          tags: ['Stock'], summary: 'Partileri listele / List lots', security: bearerAuth,
          parameters: [{ name: 'itemId', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Lot')) }
        }
      },
      '/stock/move': {
        post: {
          tags: ['Stock'], summary: 'Stok girişi/çıkışı / Stock in or out', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('StockMove') } } },
          responses: { 201: jsonResponse('İşlem sonucu', { type: 'object' }), 400: errorResponse, 404: errorResponse }
        }
      },
      '/purchasing/suppliers': {
        get: { tags: ['Purchasing'], summary: 'Tedarikçileri listele / List suppliers', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Supplier')) } },
        post: { tags: ['Purchasing'], summary: 'Yeni tedarikçi / Create supplier', security: bearerAuth, requestBody: { required: true, content: { 'application/json': { schema: ref('SupplierCreate') } } }, responses: { 201: jsonResponse('Oluşturuldu', ref('Supplier')), 422: errorResponse } }
      },
      '/purchasing/suppliers/{id}': {
        get: { tags: ['Purchasing'], summary: 'Tedarikçi detayı / Supplier detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: jsonResponse('Tedarikçi', ref('Supplier')), 404: errorResponse } }
      },
      '/purchasing/orders': {
        get: { tags: ['Purchasing'], summary: 'Siparişleri listele / List purchase orders', security: bearerAuth, parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: jsonResponse('Sayfalanmış liste', envelope('PurchaseOrder')) } },
        post: {
          tags: ['Purchasing'], summary: 'Yeni sipariş / Create purchase order', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('PurchaseOrderCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu — webhook: purchase_order.created', ref('PurchaseOrder')), 404: errorResponse, 422: errorResponse }
        }
      },
      '/purchasing/orders/{id}': {
        get: { tags: ['Purchasing'], summary: 'Sipariş detayı / Order detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Sipariş', ref('PurchaseOrder')), 404: errorResponse } }
      },
      '/purchasing/orders/{id}/approve': {
        post: { tags: ['Purchasing'], summary: 'Siparişi onayla / Approve order', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Onaylandı — webhook: purchase_order.approved', { type: 'object', properties: { ok: { type: 'boolean' } } }), 403: errorResponse, 404: errorResponse } }
      },
      '/purchasing/orders/{id}/receipts': {
        post: {
          tags: ['Purchasing'], summary: 'Teslim alma kaydet / Record a receipt', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: ref('PurchaseReceiptCreate') } } },
          responses: { 201: jsonResponse('Kaydedildi — webhook: purchase_order.received', { type: 'object' }), 400: errorResponse, 404: errorResponse }
        }
      },
      '/sales/customers': {
        get: { tags: ['Sales'], summary: 'Müşterileri listele / List customers', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Customer')) } },
        post: { tags: ['Sales'], summary: 'Yeni müşteri / Create customer', security: bearerAuth, requestBody: { required: true, content: { 'application/json': { schema: ref('CustomerCreate') } } }, responses: { 201: jsonResponse('Oluşturuldu', ref('Customer')), 422: errorResponse } }
      },
      '/sales/orders': {
        get: { tags: ['Sales'], summary: 'Satış siparişlerini listele / List sales orders', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('SalesOrder')) } },
        post: {
          tags: ['Sales'], summary: 'Yeni satış siparişi / Create sales order', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('SalesOrderCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu — webhook: sales_order.created', ref('SalesOrder')), 400: jsonResponse('Kredi limiti aşıldı / Credit limit exceeded', ref('Error')), 404: errorResponse }
        }
      },
      '/sales/orders/{id}': {
        get: { tags: ['Sales'], summary: 'Sipariş detayı / Order detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Sipariş', ref('SalesOrder')), 404: errorResponse } }
      },
      '/sales/shipments': {
        get: { tags: ['Sales'], summary: 'Sevkiyatları listele / List shipments', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Shipment')) } },
        post: {
          tags: ['Sales'], summary: 'Yeni sevkiyat / Create shipment', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('ShipmentCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu — webhook: shipment.created', ref('Shipment')), 400: errorResponse, 404: errorResponse }
        }
      },
      '/sales/shipments/{id}/status': {
        patch: { tags: ['Sales'], summary: 'Sevkiyat durumunu ilerlet / Advance shipment status', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Güncellendi — webhook: shipment.status_changed', ref('Shipment')), 404: errorResponse } }
      },
      '/production': {
        get: { tags: ['Production'], summary: 'Üretim emirlerini listele / List production orders', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('ProductionOrder')) } },
        post: {
          tags: ['Production'], summary: 'Yeni üretim emri / Create production order', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('ProductionOrderCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('ProductionOrder')), 400: errorResponse }
        }
      },
      '/production/{id}': {
        get: { tags: ['Production'], summary: 'Üretim emri detayı / Order detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Emir', ref('ProductionOrder')), 404: errorResponse } }
      },
      '/production/{id}/complete': {
        post: {
          tags: ['Production'], summary: 'Üretimi tamamla / Complete production', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: ref('ProductionComplete') } } },
          responses: { 200: jsonResponse('Tamamlandı — webhook: production_order.completed', { type: 'object' }), 400: jsonResponse('Yetersiz hammadde / Insufficient stock', ref('Error')), 404: errorResponse }
        }
      },
      '/quality/inspections': {
        get: { tags: ['Quality'], summary: 'Muayeneleri listele / List inspections', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Inspection')) } },
        post: { tags: ['Quality'], summary: 'Yeni muayene / Create inspection', security: bearerAuth, requestBody: { required: true, content: { 'application/json': { schema: ref('InspectionCreate') } } }, responses: { 201: jsonResponse('Oluşturuldu', ref('Inspection')), 422: errorResponse } }
      },
      '/quality/ncrs': {
        get: { tags: ['Quality'], summary: 'Uygunsuzlukları listele / List NCRs', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste', envelope('NCR')) } },
        post: {
          tags: ['Quality'], summary: 'Yeni uygunsuzluk / Create NCR', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('NCRCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu — webhook: ncr.opened', ref('NCR')), 422: errorResponse }
        }
      },
      '/notifications': {
        get: { tags: ['Notifications'], summary: 'Bildirimleri listele / List notifications', security: bearerAuth, responses: { 200: jsonResponse('Sayfalanmış liste + unreadCount', envelope('Notification')) } }
      },
      '/webhooks': {
        get: { tags: ['Webhooks'], summary: "Webhook'ları listele / List webhooks (admin)", security: bearerAuth, responses: { 200: jsonResponse('Liste (secret hariç)', { type: 'array', items: ref('Webhook') }), 403: errorResponse } },
        post: {
          tags: ['Webhooks'], summary: 'Yeni webhook / Create webhook (admin)', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('WebhookCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu — secret YALNIZCA burada döner', ref('WebhookCreated')), 403: errorResponse, 422: errorResponse }
        }
      },
      '/webhooks/events': {
        get: { tags: ['Webhooks'], summary: 'Abone olunabilecek olay kataloğu / Subscribable event catalog', security: bearerAuth, responses: { 200: jsonResponse('Olay adları', { type: 'array', items: { type: 'string' } }) } }
      },
      '/webhooks/{id}': {
        put: { tags: ['Webhooks'], summary: "Webhook'u güncelle / Update webhook", security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Güncellendi', ref('Webhook')), 404: errorResponse } },
        delete: { tags: ['Webhooks'], summary: "Webhook'u sil / Delete webhook", security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Silindi / Deleted' }, 404: errorResponse } }
      },
      '/webhooks/{id}/test': {
        post: { tags: ['Webhooks'], summary: "Test bildirimi gönder (event: 'ping') / Send a test notification", security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Deneme sonucu', { type: 'object', properties: { success: { type: 'boolean' }, statusCode: { type: 'integer', nullable: true }, error: { type: 'string', nullable: true } } }), 404: errorResponse } }
      },
      '/webhooks/{id}/deliveries': {
        get: { tags: ['Webhooks'], summary: 'Teslimat geçmişi / Delivery log', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Sayfalanmış liste', envelope('WebhookDelivery')), 404: errorResponse } }
      },
      '/webhooks/{id}/deliveries/{deliveryId}/retry': {
        post: { tags: ['Webhooks'], summary: 'Başarısız teslimatı yeniden dene / Retry a failed delivery', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'deliveryId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Deneme sonucu', { type: 'object', properties: { success: { type: 'boolean' } } }), 404: errorResponse } }
      },
      '/labels/item/{id}/zpl': {
        get: { tags: ['Labels'], summary: 'Ürün etiketini ZPL olarak indir / Download item label as ZPL', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Ham ZPL komut metni / Raw ZPL command text', content: { 'text/plain': { schema: { type: 'string' } } } }, 404: errorResponse } }
      },
      '/labels/lot/{id}/zpl': {
        get: { tags: ['Labels'], summary: 'Parti etiketini ZPL olarak indir / Download lot label as ZPL', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Ham ZPL komut metni / Raw ZPL command text', content: { 'text/plain': { schema: { type: 'string' } } } }, 404: errorResponse } }
      },
      '/labels/print': {
        post: {
          tags: ['Labels'], summary: 'Ağdaki Zebra yazıcıya gönder / Send to a networked Zebra printer', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: ['item', 'lot'] }, id: { type: 'string' }, copies: { type: 'integer', default: 1, maximum: 50 } } } } } },
          responses: { 200: jsonResponse('Gönderildi', { type: 'object', properties: { ok: { type: 'boolean' } } }), 400: jsonResponse('Yazıcı ayarlanmamış / Printer not configured', ref('Error')), 502: jsonResponse('Yazıcıya ulaşılamadı / Printer unreachable', ref('Error')) }
        }
      }
    }
  };
}

module.exports = { buildOpenApiSpec };
