/**
 * UBL-TR 1.2 belge üreticisi.
 *
 * GİB, e-Fatura ve e-İrsaliyeyi OASIS UBL 2.1'in Türkiye özelleştirmesi olan
 * UBL-TR 1.2 formatında ister. Bu modül yalnızca XML'i üretir; gönderimi yapmaz.
 * Bu ayrım bilinçli: entegratör değişse bile belge üretimi aynı kalır.
 *
 * ÖNEMLİ: Buradaki çıktı, seçilen entegratörün şema doğrulamasından geçirilmeden
 * canlıya alınmamalıdır. Alan adları ve zorunluluklar GİB kılavuzuna göre yazıldı,
 * ancak entegratörler ek alan isteyebilir.
 */

const crypto = require('crypto');

/** XML metin kaçışı — & < > " ' karakterleri belgeyi bozar. */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** GİB tutarları noktalı ve en fazla 2 (birim fiyatta 4) ondalıkla ister. */
const money = (n, dp = 2) => Number(n || 0).toFixed(dp);

/** ETTN: belgeyi GİB nezdinde tekilleştiren UUID. */
const newEttn = () => crypto.randomUUID().toUpperCase();

/**
 * Belge numarası: 3 harf seri + 4 hane yıl + 9 hane sıra (ör. DPT2026000000001).
 * Sıra boşluksuz artmalıdır; numarayı veren taraf çağıran koddur.
 */
function formatDocumentNo(prefix, year, seq) {
  if (!/^[A-Z]{3}$/.test(prefix)) throw new Error('Seri kodu 3 büyük harf olmalı / Series prefix must be 3 uppercase letters');
  return `${prefix}${year}${String(seq).padStart(9, '0')}`;
}

/** GİB birim kodları (UN/ECE Rec 20). Tanımsız birim C62 (adet) sayılır. */
const UNIT_CODES = {
  'adet': 'C62', 'ad': 'C62', 'piece': 'C62',
  'kg': 'KGM', 'kilogram': 'KGM', 'gr': 'GRM', 'g': 'GRM', 'ton': 'TNE',
  'lt': 'LTR', 'litre': 'LTR', 'l': 'LTR', 'ml': 'MLT',
  'm': 'MTR', 'metre': 'MTR', 'm2': 'MTK', 'm3': 'MTQ', 'cm': 'CMT', 'mm': 'MMT',
  'kutu': 'BX', 'paket': 'PK', 'koli': 'CT', 'palet': 'PF', 'rulo': 'RO',
  'set': 'SET', 'çift': 'PR', 'cift': 'PR', 'bidon': 'CG', 'takım': 'SET',
  'saat': 'HUR', 'gün': 'DAY', 'ay': 'MON'
};
const unitCode = (u) => UNIT_CODES[String(u || '').toLowerCase().trim()] || 'C62';

/** Ülke adından ISO 3166-1 alpha-2. Bilinmeyende TR varsayılmaz, boş bırakılır. */
const COUNTRY_CODES = {
  'türkiye': 'TR', 'turkiye': 'TR', 'turkey': 'TR', 'tr': 'TR',
  'almanya': 'DE', 'germany': 'DE', 'de': 'DE',
  'isveç': 'SE', 'sweden': 'SE', 'se': 'SE',
  'i̇sviçre': 'CH', 'isviçre': 'CH', 'switzerland': 'CH', 'ch': 'CH',
  'irak': 'IQ', 'iraq': 'IQ', 'suriye': 'SY', 'syria': 'SY'
};
const countryCode = (c) => COUNTRY_CODES[String(c || '').toLowerCase().trim()] || (String(c || '').length === 2 ? String(c).toUpperCase() : '');

/**
 * Taraf (gönderici/alıcı) bloğu.
 * VKN 10 hane, TCKN 11 hanedir; şema hangi şemaID'nin yazılacağını buna göre belirler.
 */
function partyBlock(p, tag) {
  const id = String(p.identityNo || p.taxNo || '').replace(/\D/g, '');
  const schemeId = id.length === 11 ? 'TCKN' : 'VKN';
  return `    <cac:${tag}>
      <cac:Party>
        ${p.alias ? `<cbc:WebsiteURI>${esc(p.alias)}</cbc:WebsiteURI>` : ''}
        <cac:PartyIdentification>
          <cbc:ID schemeID="${schemeId}">${esc(id)}</cbc:ID>
        </cac:PartyIdentification>
        <cac:PartyName>
          <cbc:Name>${esc(p.name)}</cbc:Name>
        </cac:PartyName>
        <cac:PostalAddress>
          <cbc:StreetName>${esc(p.address || '')}</cbc:StreetName>
          <cbc:CitySubdivisionName>${esc(p.district || '')}</cbc:CitySubdivisionName>
          <cbc:CityName>${esc(p.city || '')}</cbc:CityName>
          ${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ''}
          <cac:Country>
            <cbc:Name>${esc(p.country || 'Türkiye')}</cbc:Name>
            ${countryCode(p.country) ? `<cbc:IdentificationCode>${countryCode(p.country)}</cbc:IdentificationCode>` : ''}
          </cac:Country>
        </cac:PostalAddress>
        ${schemeId === 'VKN' ? `<cac:PartyTaxScheme>
          <cac:TaxScheme><cbc:Name>${esc(p.taxOffice || '')}</cbc:Name></cac:TaxScheme>
        </cac:PartyTaxScheme>` : ''}
        <cac:Contact>
          ${p.phone ? `<cbc:Telephone>${esc(p.phone)}</cbc:Telephone>` : ''}
          ${p.email ? `<cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail>` : ''}
        </cac:Contact>
      </cac:Party>
    </cac:${tag}>`;
}

/** KDV oranına göre vergi alt toplamı. Oran 0 ise istisna kodu gerekir. */
function taxSubtotal(rate, base, amount) {
  return `      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">${money(base)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">${money(amount)}</cbc:TaxAmount>
        <cbc:Percent>${money(rate)}</cbc:Percent>
        <cac:TaxCategory>
          ${Number(rate) === 0 ? '<cbc:TaxExemptionReasonCode>350</cbc:TaxExemptionReasonCode>' : ''}
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;
}

/**
 * Fatura satırı. `lineTotal` KDV hariç, indirim sonrası tutardır —
 * GİB toplamları bu değerden doğrular, dolayısıyla yuvarlama burada kritiktir.
 */
function invoiceLine(l, i, currency) {
  return `    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${unitCode(l.unit)}">${money(l.qty, 4)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${currency}">${money(l.lineTotal)}</cbc:LineExtensionAmount>
      ${Number(l.discountAmount) > 0 ? `<cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:MultiplierFactorNumeric>${money(Number(l.discountRate || 0) / 100, 4)}</cbc:MultiplierFactorNumeric>
        <cbc:Amount currencyID="${currency}">${money(l.discountAmount)}</cbc:Amount>
      </cac:AllowanceCharge>` : ''}
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${money(l.vatAmount)}</cbc:TaxAmount>
${taxSubtotal(l.vatRate, l.lineTotal, l.vatAmount)}
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${esc(l.itemName)}</cbc:Name>
        ${l.itemCode ? `<cac:SellersItemIdentification><cbc:ID>${esc(l.itemCode)}</cbc:ID></cac:SellersItemIdentification>` : ''}
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${currency}">${money(l.unitPrice, 4)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
}

/**
 * e-Fatura / e-Arşiv belgesi üretir.
 *
 * @param {object} d
 *   docType      'einvoice' | 'earchive'
 *   ettn         belge UUID
 *   documentNo   DPT2026000000001 biçiminde
 *   issueDate    YYYY-MM-DD, issueTime HH:mm:ss
 *   profileId    TICARIFATURA | TEMELFATURA | EARSIVFATURA
 *   invoiceType  SATIS | IADE | TEVKIFAT | ISTISNA | IHRACKAYITLI
 *   supplier / customer  taraf bilgileri
 *   lines        [{itemName,itemCode,qty,unit,unitPrice,discountRate,discountAmount,vatRate,vatAmount,lineTotal}]
 *   currency, exchangeRate, notes, orderReference, despatchReference
 */
function buildInvoice(d) {
  const cur = d.currency || 'TRY';
  const lines = d.lines || [];
  if (!lines.length) throw new Error('Fatura en az bir satır içermeli / Invoice must have at least one line');

  const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
  const vatTotal = lines.reduce((s, l) => s + Number(l.vatAmount || 0), 0);
  const discountTotal = lines.reduce((s, l) => s + Number(l.discountAmount || 0), 0);
  const grandTotal = subtotal + vatTotal;

  // KDV oranı bazında grupla: GİB, oran başına tek alt toplam bekler.
  const byRate = {};
  lines.forEach(l => {
    const r = Number(l.vatRate || 0);
    byRate[r] = byRate[r] || { base: 0, amount: 0 };
    byRate[r].base += Number(l.lineTotal || 0);
    byRate[r].amount += Number(l.vatAmount || 0);
  });

  const profileId = d.profileId || (d.docType === 'earchive' ? 'EARSIVFATURA' : 'TICARIFATURA');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${esc(profileId)}</cbc:ProfileID>
  <cbc:ID>${esc(d.documentNo)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${esc(d.ettn)}</cbc:UUID>
  <cbc:IssueDate>${esc(d.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(d.issueTime || '00:00:00')}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${esc(d.invoiceType || 'SATIS')}</cbc:InvoiceTypeCode>
  ${d.notes ? `<cbc:Note>${esc(d.notes)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${lines.length}</cbc:LineCountNumeric>
${d.orderReference ? `  <cac:OrderReference>
    <cbc:ID>${esc(d.orderReference)}</cbc:ID>
    <cbc:IssueDate>${esc(d.orderDate || d.issueDate)}</cbc:IssueDate>
  </cac:OrderReference>` : ''}
${d.despatchReference ? `  <cac:DespatchDocumentReference>
    <cbc:ID>${esc(d.despatchReference)}</cbc:ID>
    <cbc:IssueDate>${esc(d.despatchDate || d.issueDate)}</cbc:IssueDate>
  </cac:DespatchDocumentReference>` : ''}
${cur !== 'TRY' ? `  <cac:PricingExchangeRate>
    <cbc:SourceCurrencyCode>${cur}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${money(d.exchangeRate || 1, 4)}</cbc:CalculationRate>
  </cac:PricingExchangeRate>` : ''}
${partyBlock(d.supplier, 'AccountingSupplierParty')}
${partyBlock(d.customer, 'AccountingCustomerParty')}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${cur}">${money(vatTotal)}</cbc:TaxAmount>
${Object.entries(byRate).map(([r, v]) => taxSubtotal(r, v.base, v.amount)).join('\n')}
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="${cur}">${money(subtotal)}</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="${cur}">${money(subtotal)}</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="${cur}">${money(grandTotal)}</cbc:TaxInclusiveAmount>
      <cbc:AllowanceTotalAmount currencyID="${cur}">${money(discountTotal)}</cbc:AllowanceTotalAmount>
      <cbc:PayableAmount currencyID="${cur}">${money(grandTotal)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
${lines.map((l, i) => invoiceLine(l, i, cur)).join('\n')}
</Invoice>`;
}

/**
 * e-İrsaliye (DespatchAdvice) belgesi üretir.
 * Faturadan farkı: tutar taşımaz, sevk edilen malın miktarı ve taşıma bilgisi esastır.
 */
function buildDespatchAdvice(d) {
  const lines = d.lines || [];
  if (!lines.length) throw new Error('İrsaliye en az bir satır içermeli / Despatch advice must have at least one line');

  return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
                xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${esc(d.profileId || 'TEMELIRSALIYE')}</cbc:ProfileID>
  <cbc:ID>${esc(d.documentNo)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${esc(d.ettn)}</cbc:UUID>
  <cbc:IssueDate>${esc(d.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(d.issueTime || '00:00:00')}</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>
  ${d.notes ? `<cbc:Note>${esc(d.notes)}</cbc:Note>` : ''}
  <cbc:LineCountNumeric>${lines.length}</cbc:LineCountNumeric>
${d.orderReference ? `  <cac:OrderReference>
    <cbc:ID>${esc(d.orderReference)}</cbc:ID>
    <cbc:IssueDate>${esc(d.orderDate || d.issueDate)}</cbc:IssueDate>
  </cac:OrderReference>` : ''}
${partyBlock(d.supplier, 'DespatchSupplierParty')}
${partyBlock(d.customer, 'DeliveryCustomerParty')}
    <cac:Shipment>
      <cbc:ID>${esc(d.shipmentNo || d.documentNo)}</cbc:ID>
      ${d.grossWeight ? `<cbc:GrossWeightMeasure unitCode="KGM">${money(d.grossWeight, 3)}</cbc:GrossWeightMeasure>` : ''}
      ${d.crateCount ? `<cbc:TotalTransportHandlingUnitQuantity>${d.crateCount}</cbc:TotalTransportHandlingUnitQuantity>` : ''}
      <cac:Delivery>
        <cac:DeliveryAddress>
          <cbc:StreetName>${esc(d.deliveryAddress || '')}</cbc:StreetName>
          <cbc:CityName>${esc(d.deliveryCity || '')}</cbc:CityName>
          <cac:Country><cbc:Name>${esc(d.deliveryCountry || 'Türkiye')}</cbc:Name></cac:Country>
        </cac:DeliveryAddress>
        <cac:Despatch>
          <cbc:ActualDespatchDate>${esc(d.despatchDate || d.issueDate)}</cbc:ActualDespatchDate>
          <cbc:ActualDespatchTime>${esc(d.despatchTime || d.issueTime || '00:00:00')}</cbc:ActualDespatchTime>
        </cac:Despatch>
      </cac:Delivery>
      ${d.carrier || d.plateNo ? `<cac:ShipmentStage>
        ${d.plateNo ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID>${esc(d.plateNo)}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>` : ''}
        ${d.driverName ? `<cac:DriverPerson><cbc:FirstName>${esc(d.driverName)}</cbc:FirstName></cac:DriverPerson>` : ''}
      </cac:ShipmentStage>` : ''}
    </cac:Shipment>
${lines.map((l, i) => `    <cac:DespatchLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:DeliveredQuantity unitCode="${unitCode(l.unit)}">${money(l.qty, 4)}</cbc:DeliveredQuantity>
      <cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference>
      <cac:Item>
        <cbc:Name>${esc(l.itemName)}</cbc:Name>
        ${l.itemCode ? `<cac:SellersItemIdentification><cbc:ID>${esc(l.itemCode)}</cbc:ID></cac:SellersItemIdentification>` : ''}
        ${l.lotNo ? `<cac:ItemInstance><cac:LotIdentification><cbc:LotNumberID>${esc(l.lotNo)}</cbc:LotNumberID></cac:LotIdentification></cac:ItemInstance>` : ''}
      </cac:Item>
    </cac:DespatchLine>`).join('\n')}
</DespatchAdvice>`;
}

/**
 * Üretilen belgenin kendi içinde tutarlı olduğunu kontrol eder.
 * Entegratöre gönderilmeden önce çalıştırılır: GİB'den dönen belge, gönderilmeyen
 * belgeden çok daha pahalıdır.
 */
function validateInvoiceInput(d) {
  const errors = [];
  const need = (v, msg) => { if (v === undefined || v === null || String(v).trim() === '') errors.push(msg); };

  need(d.documentNo, 'Belge numarası yok');
  need(d.ettn, 'ETTN yok');
  need(d.issueDate, 'Düzenleme tarihi yok');
  if (d.issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate)) errors.push('Düzenleme tarihi YYYY-AA-GG olmalı');

  const sup = d.supplier || {};
  need(sup.name, 'Gönderici unvanı yok');
  const supId = String(sup.identityNo || sup.taxNo || '').replace(/\D/g, '');
  if (supId.length !== 10 && supId.length !== 11) errors.push('Gönderici VKN 10 / TCKN 11 hane olmalı');

  const cus = d.customer || {};
  need(cus.name, 'Alıcı unvanı yok');
  const cusId = String(cus.identityNo || cus.taxNo || '').replace(/\D/g, '');
  if (cusId.length !== 10 && cusId.length !== 11) errors.push('Alıcı VKN 10 / TCKN 11 hane olmalı');
  // e-Fatura alıcı posta kutusuna gider; etiket yoksa belge iletilemez
  if (d.docType === 'einvoice') need(cus.alias, 'e-Fatura için alıcı etiketi (posta kutusu) zorunlu');

  if (!d.lines || !d.lines.length) errors.push('En az bir satır gerekli');
  (d.lines || []).forEach((l, i) => {
    if (!l.itemName) errors.push(`Satır ${i + 1}: ürün adı yok`);
    if (!(Number(l.qty) > 0)) errors.push(`Satır ${i + 1}: miktar sıfırdan büyük olmalı`);
    if (Number(l.unitPrice) < 0) errors.push(`Satır ${i + 1}: birim fiyat negatif olamaz`);
    // Satır toplamı ile miktar × fiyat − indirim arasında sapma varsa GİB reddeder
    const expected = Number(l.qty) * Number(l.unitPrice) - Number(l.discountAmount || 0);
    if (Math.abs(expected - Number(l.lineTotal || 0)) > 0.02) {
      errors.push(`Satır ${i + 1}: satır toplamı tutarsız (beklenen ${expected.toFixed(2)}, gelen ${Number(l.lineTotal || 0).toFixed(2)})`);
    }
    const expVat = Number(l.lineTotal || 0) * Number(l.vatRate || 0) / 100;
    if (Math.abs(expVat - Number(l.vatAmount || 0)) > 0.02) {
      errors.push(`Satır ${i + 1}: KDV tutarı tutarsız (beklenen ${expVat.toFixed(2)}, gelen ${Number(l.vatAmount || 0).toFixed(2)})`);
    }
  });

  return errors;
}

module.exports = {
  buildInvoice, buildDespatchAdvice, validateInvoiceInput,
  newEttn, formatDocumentNo, unitCode, countryCode, esc, money
};
