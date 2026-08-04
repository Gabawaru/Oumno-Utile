// Génération du XML Factur-X — syntaxe UN/CEFACT CII (Cross-Industry Invoice),
// profil EN 16931. C'est le format structuré de la facturation électronique
// française (réforme 2026-2027) : ce XML est embarqué dans le PDF/A-3 sous le
// nom réservé "factur-x.xml".
//
// Références : norme EN 16931-1, spécification Factur-X 1.0.7 (FNFE-MPE / FeRD).

import { centsToXml, qtyToXml } from './compute.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** "2026-08-04" -> "20260804" (format 102 UN/CEFACT) */
const d102 = (iso) => (iso ? iso.replaceAll('-', '') : '');

// Codes UNTDID 1001 : 380 facture commerciale, 381 avoir, sans objet pour devis.
const TYPE_CODES = { invoice: '380', credit_note: '381' };

// UNTDID 4461 (moyens de paiement)
const PAYMENT_CODES = { transfer: '30', card: '48', cheque: '20', cash: '10', direct_debit: '49' };

// Unités UN/ECE Rec 20 courantes ; les libellés libres retombent sur C62 (unité).
const UNIT_CODES = {
  u: 'C62', unité: 'C62', unite: 'C62', pce: 'H87', h: 'HUR', heure: 'HUR',
  j: 'DAY', jour: 'DAY', forfait: 'C62', mois: 'MON', km: 'KMT', m: 'MTR',
  'm²': 'MTK', m2: 'MTK', kg: 'KGM', l: 'LTR', lot: 'C62', mot: 'C62',
};
const unitCode = (u) => UNIT_CODES[String(u || '').toLowerCase()] || 'C62';

/**
 * Catégorie de TVA (UNTDID 5305) pour une ligne / un groupe :
 *  - E : exonéré (franchise en base art. 293 B du CGI)
 *  - Z : taux zéro
 *  - S : taux standard/réduit
 */
function vatCategory(rate, vatExempt) {
  if (vatExempt) return 'E';
  return Number(rate) === 0 ? 'Z' : 'S';
}

function partyXml(tag, p, { includeVat = true } = {}) {
  const siren = String(p.siren || '').replace(/\D/g, '').slice(0, 9);
  return `      <ram:${tag}>
        <ram:Name>${esc(p.name)}</ram:Name>${siren ? `
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${esc(siren)}</ram:ID>
        </ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(p.postal_code)}</ram:PostcodeCode>
          <ram:LineOne>${esc(p.address_line1)}</ram:LineOne>${p.address_line2 ? `
          <ram:LineTwo>${esc(p.address_line2)}</ram:LineTwo>` : ''}
          <ram:CityName>${esc(p.city)}</ram:CityName>
          <ram:CountryID>${esc(p.country || 'FR')}</ram:CountryID>
        </ram:PostalTradeAddress>${p.email ? `
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${esc(p.email)}</ram:URIID>
        </ram:URIUniversalCommunication>` : ''}${includeVat && p.vat_number ? `
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${esc(p.vat_number)}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
      </ram:${tag}>`;
}

/**
 * Génère le XML CII complet d'une facture ou d'un avoir.
 * @param {object} doc  document émis (avec number, dates, lignes, totaux figés)
 * @param {object} seller  paramètres de l'émetteur (settings)
 * @param {object} buyer   snapshot client
 * @param {object} totals  résultat de computeTotals
 */
export function buildFacturX(doc, seller, buyer, totals) {
  const typeCode = TYPE_CODES[doc.doc_type];
  if (!typeCode) throw new Error(`Type de document sans équivalent Factur-X : ${doc.doc_type}`);
  const vatExempt = !!doc.vat_exempt;
  const currency = doc.currency || 'EUR';

  const linesXml = totals.lines
    .map((l, i) => {
      const cat = vatCategory(l.vat_rate, vatExempt);
      return `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${i + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${esc(l.label)}</ram:Name>${l.description ? `
        <ram:Description>${esc(l.description)}</ram:Description>` : ''}
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${centsToXml(l.unit_price_cents)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${unitCode(l.unit)}">${qtyToXml(l.qty_milli)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${cat}</ram:CategoryCode>
          <ram:RateApplicablePercent>${l.vat_rate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${centsToXml(l.total_ht_cents)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join('\n');

  const taxXml = totals.vatBreakdown
    .map((g) => {
      const cat = vatCategory(g.rate, vatExempt);
      return `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${centsToXml(g.tax_cents)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${cat === 'E' ? `
        <ram:ExemptionReason>${esc(seller.vat_exemption_mention || 'TVA non applicable, art. 293 B du CGI')}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${centsToXml(g.basis_cents)}</ram:BasisAmount>
        <ram:CategoryCode>${cat}</ram:CategoryCode>
        <ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
    })
    .join('\n');

  const paymentCode = PAYMENT_CODES[doc.payment_means] || '30';
  const prepaid = doc.prepaid_cents || 0;
  const due = totals.total_ttc_cents - prepaid;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(doc.number)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${d102(doc.issue_date)}</udt:DateTimeString>
    </ram:IssueDateTime>${doc.notes_public ? `
    <ram:IncludedNote>
      <ram:Content>${esc(doc.notes_public)}</ram:Content>
    </ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${linesXml}
    <ram:ApplicableHeaderTradeAgreement>${doc.purchase_order_ref ? `
      <ram:BuyerReference>${esc(doc.purchase_order_ref)}</ram:BuyerReference>` : ''}
${partyXml('SellerTradeParty', {
    name: seller.company_name,
    siren: seller.siren || seller.siret,
    vat_number: vatExempt ? '' : seller.vat_number,
    address_line1: seller.address_line1,
    address_line2: seller.address_line2,
    postal_code: seller.postal_code,
    city: seller.city,
    country: seller.country,
    email: seller.email,
  })}
${partyXml('BuyerTradeParty', buyer)}${doc.purchase_order_ref ? `
      <ram:BuyerOrderReferencedDocument>
        <ram:IssuerAssignedID>${esc(doc.purchase_order_ref)}</ram:IssuerAssignedID>
      </ram:BuyerOrderReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>${paymentCode}</ram:TypeCode>${seller.iban ? `
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(seller.iban.replace(/\s/g, ''))}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>` : ''}${seller.bic ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>${esc(seller.bic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>
${taxXml}
      <ram:SpecifiedTradePaymentTerms>${doc.due_date ? `
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${d102(doc.due_date)}</udt:DateTimeString>
        </ram:DueDateDateTime>` : ''}
      </ram:SpecifiedTradePaymentTerms>${doc.source_number ? `
      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${esc(doc.source_number)}</ram:IssuerAssignedID>
      </ram:InvoiceReferencedDocument>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${centsToXml(totals.total_ht_cents)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${centsToXml(totals.total_ht_cents)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${currency}">${centsToXml(totals.total_vat_cents)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${centsToXml(totals.total_ttc_cents)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${centsToXml(prepaid)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${centsToXml(due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
