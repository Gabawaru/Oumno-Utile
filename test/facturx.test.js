import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFacturX } from '../src/facturx.js';
import { computeTotals } from '../src/compute.js';

const seller = {
  company_name: 'Jeanne Martin', siren: '912345678', vat_number: 'FR32912345678',
  address_line1: '10 rue Oberkampf', postal_code: '75011', city: 'Paris', country: 'FR',
  email: 'j@ex.fr', iban: 'FR7630004000050000123456789', bic: 'BNPAFRPP',
  vat_exemption_mention: 'TVA non applicable, art. 293 B du CGI',
};
const buyer = {
  name: 'ACME & Fils <SAS>', siren: '532183181', address_line1: '1 av. Foo',
  postal_code: '75001', city: 'Paris', country: 'FR',
};

function makeDoc(overrides = {}) {
  return {
    doc_type: 'invoice', number: 'F-2026-0042', issue_date: '2026-08-04',
    due_date: '2026-09-03', currency: 'EUR', payment_means: 'transfer',
    vat_exempt: 0, ...overrides,
  };
}

test('structure CII : en-têtes, parties, totaux', () => {
  const totals = computeTotals([
    { label: 'Dev', qty_milli: 2000, unit: 'j', unit_price_cents: 45000, vat_rate: 20 },
  ]);
  const xml = buildFacturX(makeDoc(), seller, buyer, totals);
  assert.match(xml, /<rsm:CrossIndustryInvoice/);
  assert.match(xml, /urn:cen\.eu:en16931:2017/);
  assert.match(xml, /<ram:ID>F-2026-0042<\/ram:ID>/);
  assert.match(xml, /<ram:TypeCode>380<\/ram:TypeCode>/);
  assert.match(xml, /format="102">20260804</);
  assert.match(xml, /schemeID="0002">912345678</); // SIREN vendeur
  assert.match(xml, /schemeID="VA">FR32912345678</);
  assert.match(xml, /<ram:GrandTotalAmount>1080.00<\/ram:GrandTotalAmount>/);
  assert.match(xml, /<ram:TaxTotalAmount currencyID="EUR">180.00<\/ram:TaxTotalAmount>/);
  assert.match(xml, /<ram:DuePayableAmount>1080.00<\/ram:DuePayableAmount>/);
  assert.match(xml, /<ram:IBANID>FR7630004000050000123456789<\/ram:IBANID>/);
  // échappement XML
  assert.match(xml, /ACME &amp; Fils &lt;SAS&gt;/);
  assert.doesNotMatch(xml, /<SAS>/);
});

test('avoir : TypeCode 381', () => {
  const totals = computeTotals([{ qty_milli: 1000, unit_price_cents: 10000, vat_rate: 20 }]);
  const xml = buildFacturX(makeDoc({ doc_type: 'credit_note', number: 'A-2026-0001' }), seller, buyer, totals);
  assert.match(xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
});

test('franchise en base : catégorie E + motif d’exonération', () => {
  const totals = computeTotals(
    [{ qty_milli: 1000, unit_price_cents: 10000, vat_rate: 20 }],
    { vatExempt: true }
  );
  const xml = buildFacturX(makeDoc({ vat_exempt: 1 }), seller, buyer, totals);
  assert.match(xml, /<ram:CategoryCode>E<\/ram:CategoryCode>/);
  assert.match(xml, /TVA non applicable, art\. 293 B du CGI/);
  // pas de numéro de TVA vendeur en franchise
  assert.doesNotMatch(xml, /schemeID="VA">FR32912345678</);
});

test('unités converties en codes UN\/ECE Rec 20', () => {
  const totals = computeTotals([
    { qty_milli: 1000, unit: 'h', unit_price_cents: 9000, vat_rate: 20 },
    { qty_milli: 1000, unit: 'j', unit_price_cents: 9000, vat_rate: 20 },
    { qty_milli: 1000, unit: 'truc', unit_price_cents: 9000, vat_rate: 20 },
  ]);
  const xml = buildFacturX(makeDoc(), seller, buyer, totals);
  assert.match(xml, /unitCode="HUR"/);
  assert.match(xml, /unitCode="DAY"/);
  assert.match(xml, /unitCode="C62"/);
});

test('un devis ne produit pas de Factur-X', () => {
  const totals = computeTotals([{ qty_milli: 1000, unit_price_cents: 100, vat_rate: 0 }]);
  assert.throws(() => buildFacturX(makeDoc({ doc_type: 'quote' }), seller, buyer, totals));
});
