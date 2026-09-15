// @ts-nocheck
/**
 * OpenAPI 3.0 şeması — ubl.js/zpl.js ile aynı desen: saf, yan etkisiz bir
 * ÜRETİCİ. server/routes/docs.js bunu JSON olarak servis eder.
 *
 * BİLİNÇLİ KAPSAM SINIRI: bu, sistemdeki 140+ endpoint'in TAMAMINI değil,
 * bir dış sistemin (e-ticaret, B2B portal, muhasebe, başka bir ERP, bir CRM/
 * pazarlama aracı) gerçekten entegre olmak isteyeceği ANA kaynakları
 * belgeliyor — ürünler, stok/lot, satın alma, satış, üretim, kalite,
 * bildirimler, webhook'lar, etiketler, CRM fırsatları ve özel rapor (pivot)
 * motoru. İç yönetim/ayar endpoint'leri (ör. /api/settings, /api/audit)
 * kasıtlı olarak dışarıda bırakıldı — bunlar arayüzün kendi kullandığı,
 * dışa açık bir entegrasyon sözleşmesi olması beklenmeyen iç uçlar. Alan
 * adları ICI HİÇBİR ŞEY İCAT EDİLMEDİ — test/contract.js'in ve ilgili
 * route dosyalarındaki zod şemalarının doğruladığı gerçek alan adlarından
 * birebir alındı.
 *
 * BAKIM NOTU: bu dosya yeni bir modül eklendiğinde (Aşama 7 CRM, Aşama 8
 * BI/pivot gibi) ELLE güncellenmesi gereken, otomatik türetilmeyen statik
 * bir belge. Yeni route'lar eklerken burayı da güncellemeyi unutmayın —
 * aksi halde /api/docs/openapi.json sessizce eksik/bayat kalır.
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
      title: 'Dream Plus — Entegrasyon API',
      version: '2.0.0',
      description:
        'Bu, sistemin TÜM iç uçlarının değil, dış sistemlerin (e-ticaret, ' +
        'B2B portal, muhasebe, başka bir ERP, bir CRM/pazarlama aracı) ' +
        'entegre olmak isteyeceği ana kaynakların (ürün, stok, satın alma, ' +
        'satış, üretim, kalite, CRM fırsatları, özel rapor/pivot, bildirim, ' +
        'webhook, etiket) sözleşmesidir. Kimlik doğrulama: ' +
        '`POST /api/auth/login` ile alınan JWT, `Authorization: Bearer <token>` ' +
        'başlığıyla gönderilir. Olay tabanlı bildirimler için bkz. Webhooks.'
    },
    servers: [{ url: '/api', description: 'Bu sunucu / This server' }],
    tags: [
      { name: 'Auth' }, { name: 'Items' }, { name: 'Stock' },
      { name: 'Purchasing' }, { name: 'Sales' }, { name: 'Production' },
      { name: 'Quality' }, { name: 'CRM' }, { name: 'Support' }, { name: 'Visits' }, { name: 'Reports' },
      { name: 'Notifications' }, { name: 'Webhooks' }, { name: 'Labels' }
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
            success: { type: 'boolean' }, error: { type: 'string', nullable: true }, durationMs: { type: 'integer' }, attemptedAt: { type: 'integer' },
            retryCount: { type: 'integer', description: 'Bu denemenin kaçıncı otomatik deneme olduğu (0 = ilk deneme veya elle yeniden deneme)' },
            nextRetryAt: { type: 'integer', nullable: true, description: 'Dolu ise bu kayıt otomatik kuyrukta bekliyor demektir; NULL ise başarılı veya deneme hakkı tükenmiş (dead-letter)' }
          }
        },
        OpportunityLine: {
          type: 'object',
          properties: { id: { type: 'integer' }, itemId: { type: 'string', nullable: true }, itemName: { type: 'string' }, qty: { type: 'number' }, unitPrice: { type: 'number' } }
        },
        Opportunity: {
          type: 'object',
          properties: {
            id: { type: 'string' }, oppNo: { type: 'string' }, customerId: { type: 'integer', nullable: true }, customerName: { type: 'string' },
            contactPerson: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true }, email: { type: 'string', nullable: true },
            source: { type: 'string', enum: ['referans', 'web', 'fuar', 'soguk_arama', 'diger'] },
            stage: { type: 'string', enum: ['new', 'contacted', 'quoted', 'won', 'lost'] },
            estimatedValue: { type: 'number' }, estimatedCloseDate: { type: 'string', format: 'date', nullable: true },
            probability: { type: 'integer', minimum: 0, maximum: 100 }, lostReason: { type: 'string', nullable: true },
            assignedTo: { type: 'integer', nullable: true }, notes: { type: 'string', nullable: true },
            convertedSoId: { type: 'string', nullable: true, description: 'Dolu ise fırsat zaten bir satış siparişine dönüştürülmüştür' },
            createdAt: { type: 'integer' }, closedAt: { type: 'integer', nullable: true },
            lines: { type: 'array', items: ref('OpportunityLine') }
          }
        },
        OpportunityCreate: {
          type: 'object', required: ['customerName'],
          properties: {
            customerId: { type: 'integer', description: 'Boş bırakılırsa fırsat henüz müşteri olmayan bir "aday" için açılır' },
            customerName: { type: 'string' }, contactPerson: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
            source: { type: 'string', enum: ['referans', 'web', 'fuar', 'soguk_arama', 'diger'], default: 'diger' },
            estimatedValue: { type: 'number', default: 0 }, estimatedCloseDate: { type: 'string', format: 'date' },
            probability: { type: 'integer', minimum: 0, maximum: 100, default: 20 }, assignedTo: { type: 'integer' }, notes: { type: 'string' },
            lines: {
              type: 'array', default: [], items: {
                type: 'object', required: ['itemId', 'itemName', 'qty'],
                properties: { itemId: { type: 'string' }, itemName: { type: 'string' }, qty: { type: 'number' }, unitPrice: { type: 'number', default: 0 } }
              }
            }
          }
        },
        OpportunityStageUpdate: {
          type: 'object', required: ['stage'],
          properties: {
            stage: { type: 'string', enum: ['new', 'contacted', 'quoted', 'won', 'lost'] },
            lostReason: { type: 'string', description: "stage='lost' iken zorunlu" }
          }
        },
        OpportunityConvertResult: {
          type: 'object',
          properties: { opportunity: ref('Opportunity'), salesOrder: { type: 'object', properties: { id: { type: 'string' }, soNo: { type: 'string' } } } }
        },
        TicketComment: {
          type: 'object',
          properties: { id: { type: 'integer' }, userId: { type: 'integer', nullable: true }, username: { type: 'string', nullable: true }, ts: { type: 'integer' }, comment: { type: 'string' } }
        },
        Ticket: {
          type: 'object',
          properties: {
            id: { type: 'string' }, ticketNo: { type: 'string' }, customerId: { type: 'integer', nullable: true }, customerName: { type: 'string' },
            subject: { type: 'string' }, description: { type: 'string', nullable: true },
            category: { type: 'string', enum: ['complaint', 'question', 'return', 'warranty', 'other'] },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
            status: { type: 'string', enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] },
            assignedTo: { type: 'integer', nullable: true },
            relatedOrderId: { type: 'string', nullable: true }, relatedShipmentId: { type: 'string', nullable: true }, relatedLotId: { type: 'string', nullable: true },
            resolution: { type: 'string', nullable: true },
            resultingNcrId: { type: 'string', nullable: true, description: 'Dolu ise talep bir uygunsuzluk (NCR) kaydına dönüştürülmüştür' },
            createdAt: { type: 'integer' }, resolvedAt: { type: 'integer', nullable: true }, closedAt: { type: 'integer', nullable: true },
            comments: { type: 'array', items: ref('TicketComment') }
          }
        },
        TicketCreate: {
          type: 'object', required: ['customerName', 'subject'],
          properties: {
            customerId: { type: 'integer', description: 'Boş bırakılırsa kayıtlı olmayan bir müşteri için talep açılır' },
            customerName: { type: 'string' }, subject: { type: 'string' }, description: { type: 'string' },
            category: { type: 'string', enum: ['complaint', 'question', 'return', 'warranty', 'other'], default: 'question' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
            assignedTo: { type: 'integer' }, relatedOrderId: { type: 'string' }, relatedShipmentId: { type: 'string' }, relatedLotId: { type: 'string' }
          }
        },
        TicketStatusUpdate: {
          type: 'object', required: ['status'],
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] },
            resolution: { type: 'string', description: "status='resolved' iken zorunlu (daha önce girilmemişse)" }
          }
        },
        TicketToNcrResult: {
          type: 'object',
          properties: { ncrId: { type: 'string' }, ncrNo: { type: 'string' } }
        },
        Visit: {
          type: 'object',
          properties: {
            id: { type: 'string' }, customerId: { type: 'integer' }, customerName: { type: 'string', nullable: true },
            opportunityId: { type: 'string', nullable: true }, oppNo: { type: 'string', nullable: true },
            visitedBy: { type: 'integer', nullable: true }, visitedUsername: { type: 'string', nullable: true },
            visitDate: { type: 'string', format: 'date' }, purpose: { type: 'string', nullable: true }, notes: { type: 'string', nullable: true },
            latitude: { type: 'number', nullable: true }, longitude: { type: 'number', nullable: true },
            followUpDate: { type: 'string', format: 'date', nullable: true }, createdAt: { type: 'integer' }
          }
        },
        VisitCreate: {
          type: 'object', required: ['customerId', 'visitDate'],
          properties: {
            customerId: { type: 'integer' }, opportunityId: { type: 'string' }, visitDate: { type: 'string', format: 'date' },
            purpose: { type: 'string' }, notes: { type: 'string' },
            latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Tarayıcı Geolocation API\'sinden — isteğe bağlı' },
            longitude: { type: 'number', minimum: -180, maximum: 180 }, followUpDate: { type: 'string', format: 'date' }
          }
        },
        PivotMeta: {
          type: 'object',
          description: "GET /reports/pivot-meta çağrısı, mevcut veri kaynağı BAŞINA kendi boyut/ölçü whitelist'ini döner — 'movements' (stok hareketleri), 'sales' (satış kalemleri), 'purchasing' (satın alma kalemleri), 'quality' (muayeneler).",
          properties: {
            dataSources: {
              type: 'array', items: {
                type: 'object', properties: {
                  key: { type: 'string', enum: ['movements', 'sales', 'purchasing', 'quality'] }, label: { type: 'string' },
                  dimensions: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' } } } },
                  metrics: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' } } } },
                  extraFilterKeys: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            movementTypes: { type: 'array', items: { type: 'string' } }
          }
        },
        PivotRequest: {
          type: 'object', required: ['dimension', 'metric'],
          description: "dataSource/dimension/metric YALNIZCA GET /reports/pivot-meta'nın döndürdüğü anahtarlardan biri olabilir — whitelist dışı bir değer 400 ile reddedilir.",
          properties: {
            dataSource: { type: 'string', enum: ['movements', 'sales', 'purchasing', 'quality'], default: 'movements' },
            dimension: { type: 'string', description: "ör. movements için 'day' | 'month' | 'item' | 'warehouse' | 'type' | 'refType'" },
            metric: { type: 'string', description: "ör. movements için 'qty' | 'value' | 'count'" },
            filters: {
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
                type: { type: 'string', enum: ['in', 'out', 'transfer', 'adjust', 'status_change'], description: "yalnızca dataSource='movements'" },
                warehouseId: { type: 'integer' }, itemId: { type: 'string' },
                customerId: { type: 'integer', description: "yalnızca dataSource='sales'" },
                supplierId: { type: 'integer', description: "dataSource='purchasing' veya 'quality'" }
              }
            }
          }
        },
        PivotResult: {
          type: 'object',
          properties: {
            dataSource: { type: 'string' }, dimension: { type: 'string' }, metric: { type: 'string' },
            data: { type: 'array', items: { type: 'object', properties: { dim: { type: 'string' }, val: { type: 'number' } } } }
          }
        },
        SavedReport: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, dataSource: { type: 'string' }, dimension: { type: 'string' }, metric: { type: 'string' },
            chartType: { type: 'string', enum: ['bar', 'line'] }, filters: { type: 'object' },
            createdBy: { type: 'integer', nullable: true }, createdAt: { type: 'integer' }
          }
        },
        SavedReportCreate: {
          type: 'object', required: ['name', 'dimension', 'metric'],
          properties: {
            name: { type: 'string' }, dataSource: { type: 'string', enum: ['movements', 'sales', 'purchasing', 'quality'], default: 'movements' },
            dimension: { type: 'string' }, metric: { type: 'string' },
            chartType: { type: 'string', enum: ['bar', 'line'], default: 'bar' }, filters: { type: 'object' }
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
      '/purchasing/suppliers/{id}/anonymize': {
        post: { tags: ['Purchasing'], summary: 'KVKK — kişisel veriyi geri döndürülemez şekilde anonimleştir / Anonymize personal data (irreversible)', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: jsonResponse('Anonimleştirildi', ref('Supplier')), 404: errorResponse, 409: errorResponse } }
      },
      '/purchasing/suppliers/{id}/data-export': {
        get: { tags: ['Purchasing'], summary: 'KVKK m.11/b — bu tedarikçi hakkında tutulan tüm veriyi dışa aktar / Export all data held about this supplier', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: jsonResponse('Veri raporu', { type: 'object' }), 404: errorResponse } }
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
      '/sales/customers/{id}/anonymize': {
        post: { tags: ['Sales'], summary: 'KVKK — kişisel veriyi geri döndürülemez şekilde anonimleştir / Anonymize personal data (irreversible)', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: jsonResponse('Anonimleştirildi', ref('Customer')), 404: errorResponse, 409: errorResponse } }
      },
      '/sales/customers/{id}/data-export': {
        get: { tags: ['Sales'], summary: 'KVKK m.11/b — bu müşteri hakkında tutulan tüm veriyi dışa aktar / Export all data held about this customer', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: jsonResponse('Veri raporu', { type: 'object' }), 404: errorResponse } }
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
      '/webhooks/process-retry-queue': {
        post: {
          tags: ['Webhooks'], summary: "Otomatik yeniden deneme kuyruğunu şimdi işle (admin) / Process the auto-retry queue now (admin)", security: bearerAuth,
          description: 'Kuyruk normalde 60 saniyede bir kendiliğinden işlenir; bu, beklemeden tetiklemek içindir.',
          responses: { 200: jsonResponse('Tetiklendi', { type: 'object', properties: { ok: { type: 'boolean' } } }), 403: errorResponse }
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
      },
      '/crm/opportunities': {
        get: {
          tags: ['CRM'], summary: 'Fırsatları listele / List opportunities', security: bearerAuth,
          parameters: [
            { name: 'stage', in: 'query', schema: { type: 'string', enum: ['new', 'contacted', 'quoted', 'won', 'lost'] } },
            { name: 'assignedTo', in: 'query', schema: { type: 'integer' } }, { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'pageSize', in: 'query', schema: { type: 'integer' } }
          ],
          responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Opportunity')) }
        },
        post: {
          tags: ['CRM'], summary: 'Yeni fırsat / Create opportunity', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('OpportunityCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('Opportunity')), 403: errorResponse, 422: errorResponse }
        }
      },
      '/crm/opportunities/pipeline': {
        get: {
          tags: ['CRM'], summary: 'Huni görünümü — aşama başına gruplanmış fırsatlar / Pipeline grouped by stage', security: bearerAuth,
          description: "'lost' hariç 4 aktif aşamayı ve her aşamanın toplam tahmini değerini döner.",
          responses: { 200: jsonResponse('Aşama grupları', { type: 'object', properties: { stages: { type: 'array', items: { type: 'object', properties: { stage: { type: 'string' }, totalValue: { type: 'number' }, opportunities: { type: 'array', items: ref('Opportunity') } } } } } }) }
        }
      },
      '/crm/opportunities/{id}': {
        get: { tags: ['CRM'], summary: 'Fırsat detayı / Opportunity detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Fırsat', ref('Opportunity')), 404: errorResponse } },
        put: {
          tags: ['CRM'], summary: 'Fırsatı güncelle (yalnızca açık aşamalarda) / Update opportunity (open stages only)', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: ref('OpportunityCreate') } } },
          responses: { 200: jsonResponse('Güncellendi', ref('Opportunity')), 404: errorResponse, 409: jsonResponse('Kapanmış (won/lost) fırsat düzenlenemez', ref('Error')) }
        }
      },
      '/crm/opportunities/{id}/stage': {
        post: {
          tags: ['CRM'], summary: 'Aşama geçişi / Change stage', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: ref('OpportunityStageUpdate') } } },
          responses: { 200: jsonResponse("Güncellendi — 'won' olunca webhook: opportunity.won", ref('Opportunity')), 404: errorResponse, 409: jsonResponse('Kapanmış fırsat yeniden açılamaz', ref('Error')), 422: jsonResponse('lostReason eksik', ref('Error')) }
        }
      },
      '/crm/opportunities/{id}/convert': {
        post: {
          tags: ['CRM'], summary: 'Kazanılan fırsatı satış siparişine dönüştür / Convert a won opportunity to a sales order', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { customerId: { type: 'integer', description: 'Fırsatın kendi müşterisi yoksa (yeni aday) zorunlu' } } } } } },
          responses: { 201: jsonResponse('Dönüştürüldü — gerçek bir satış siparişi oluşur', ref('OpportunityConvertResult')), 404: errorResponse, 409: jsonResponse('Yalnızca won VE henüz dönüştürülmemiş fırsatlar dönüştürülebilir', ref('Error')), 422: jsonResponse('Müşteri veya kalem eksik', ref('Error')) }
        }
      },
      '/support': {
        get: {
          tags: ['Support'], summary: 'Destek taleplerini listele / List support tickets', security: bearerAuth,
          parameters: ['status', 'priority', 'assignedTo', 'customerId', 'q'].map(n => ({ name: n, in: 'query', schema: { type: 'string' } })),
          responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Ticket')) }
        },
        post: {
          tags: ['Support'], summary: 'Yeni destek talebi / Create a support ticket', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('TicketCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('Ticket')), 403: errorResponse, 404: jsonResponse('customerId verildiyse ve müşteri bulunamazsa', ref('Error')), 422: errorResponse }
        }
      },
      '/support/{id}': {
        get: { tags: ['Support'], summary: 'Talep detayı (yorumlarla birlikte) / Ticket detail with comments', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Talep', ref('Ticket')), 404: errorResponse } },
        put: {
          tags: ['Support'], summary: 'Talebi güncelle (kapalı değilse) / Update ticket (if not closed)', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: ref('TicketCreate') } } },
          responses: { 200: jsonResponse('Güncellendi', ref('Ticket')), 404: errorResponse, 409: jsonResponse('Kapalı talep düzenlenemez', ref('Error')) }
        }
      },
      '/support/{id}/status': {
        post: {
          tags: ['Support'], summary: 'Durum geçişi / Change status', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: ref('TicketStatusUpdate') } } },
          responses: { 200: jsonResponse('Güncellendi', ref('Ticket')), 404: errorResponse, 409: jsonResponse('Kapalı talep yeniden açılamaz', ref('Error')), 422: jsonResponse('resolved için resolution eksik', ref('Error')) }
        }
      },
      '/support/{id}/comments': {
        post: {
          tags: ['Support'], summary: 'Yorum ekle / Add a comment', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['comment'], properties: { comment: { type: 'string' } } } } } },
          responses: { 201: jsonResponse('Eklendi', ref('TicketComment')), 404: errorResponse }
        }
      },
      '/support/{id}/to-ncr': {
        post: {
          tags: ['Support'], summary: 'Şikayeti uygunsuzluğa (NCR) dönüştür / Convert a complaint to a nonconformity', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { itemId: { type: 'string' }, lotId: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'critical'], default: 'minor' }, qtyAffected: { type: 'number' } } } } } },
          responses: { 201: jsonResponse('Dönüştürüldü — gerçek bir NCR kaydı oluşur', ref('TicketToNcrResult')), 404: errorResponse, 409: jsonResponse('Yalnızca şikayet kategorisi VE henüz dönüştürülmemiş talepler dönüştürülebilir', ref('Error')), 422: jsonResponse('Talepte kayıtlı müşteri yok', ref('Error')) }
        }
      },
      '/visits': {
        get: {
          tags: ['Visits'], summary: 'Saha ziyaretlerini listele / List field visits', security: bearerAuth,
          parameters: ['customerId', 'opportunityId', 'visitedBy', 'from', 'to'].map(n => ({ name: n, in: 'query', schema: { type: 'string' } })),
          responses: { 200: jsonResponse('Sayfalanmış liste', envelope('Visit')) }
        },
        post: {
          tags: ['Visits'], summary: 'Yeni ziyaret kaydı / Log a field visit', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('VisitCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('Visit')), 403: errorResponse, 404: jsonResponse('Müşteri veya fırsat bulunamazsa', ref('Error')), 422: errorResponse }
        }
      },
      '/visits/{id}': {
        get: { tags: ['Visits'], summary: 'Ziyaret detayı / Visit detail', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonResponse('Ziyaret', ref('Visit')), 404: errorResponse } },
        put: {
          tags: ['Visits'], summary: 'Ziyareti güncelle / Update visit', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: ref('VisitCreate') } } },
          responses: { 200: jsonResponse('Güncellendi', ref('Visit')), 404: errorResponse }
        },
        delete: {
          tags: ['Visits'], summary: 'Ziyaret kaydını sil (yalnızca yönetici) / Delete a visit (manager only)', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 204: { description: 'Silindi' }, 403: errorResponse, 404: errorResponse }
        }
      },
      '/reports/pivot-meta': {
        get: { tags: ['Reports'], summary: 'Özel rapor seçenekleri / Custom report options', security: bearerAuth, responses: { 200: jsonResponse('Boyut/ölçü/hareket tipi whitelist\'i', ref('PivotMeta')) } }
      },
      '/reports/pivot': {
        post: {
          tags: ['Reports'], summary: 'Özel rapor çalıştır / Run a custom (pivot) report', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('PivotRequest') } } },
          responses: { 200: jsonResponse('Sonuç', ref('PivotResult')), 400: jsonResponse('Whitelist dışı boyut/ölçü/filtre', ref('Error')) }
        }
      },
      '/reports/saved': {
        get: { tags: ['Reports'], summary: 'Kayıtlı raporları listele / List saved reports', security: bearerAuth, responses: { 200: jsonResponse('Liste', { type: 'array', items: ref('SavedReport') }) } },
        post: {
          tags: ['Reports'], summary: 'Rapor konfigürasyonunu kaydet / Save a report configuration', security: bearerAuth,
          requestBody: { required: true, content: { 'application/json': { schema: ref('SavedReportCreate') } } },
          responses: { 201: jsonResponse('Oluşturuldu', ref('SavedReport')), 400: errorResponse }
        }
      },
      '/reports/saved/{id}': {
        delete: {
          tags: ['Reports'], summary: 'Kayıtlı raporu sil (sahibi veya yönetici) / Delete a saved report (owner or manager)', security: bearerAuth,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 204: { description: 'Silindi / Deleted' }, 403: jsonResponse('Yalnızca sahibi veya yönetici/müdür silebilir', ref('Error')), 404: errorResponse }
        }
      }
    }
  };
}

module.exports = { buildOpenApiSpec };
