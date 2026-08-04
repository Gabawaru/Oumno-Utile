import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals, lineTotalCents, fmtEuros, centsToXml, qtyToXml, parseDecimalTo,
} from '../src/compute.js';

test('total de ligne : arrondi au centime', () => {
  // 1,5 × 120,50 € = 180,75 €
  assert.equal(lineTotalCents(1500, 12050), 18075);
  // 0,333 × 100,00 € = 33,30 €
  assert.equal(lineTotalCents(333, 10000), 3330);
  // arrondi demi-centime : 1,5 × 0,01 € = 0,015 € => 0,02 €
  assert.equal(lineTotalCents(1500, 1), 2);
});

test('TVA calculée par taux sur la somme des bases (EN 16931)', () => {
  const { vatBreakdown, total_ht_cents, total_vat_cents, total_ttc_cents } = computeTotals([
    { qty_milli: 1000, unit_price_cents: 1005, vat_rate: 20 },
    { qty_milli: 1000, unit_price_cents: 1005, vat_rate: 20 },
    { qty_milli: 2000, unit_price_cents: 9000, vat_rate: 5.5 },
  ]);
  // base 20 % = 20,10 € ; TVA = 4,02 € (et non 2 × round(2,01))
  assert.deepEqual(vatBreakdown, [
    { rate: 5.5, basis_cents: 18000, tax_cents: 990 },
    { rate: 20, basis_cents: 2010, tax_cents: 402 },
  ]);
  assert.equal(total_ht_cents, 20010);
  assert.equal(total_vat_cents, 1392);
  assert.equal(total_ttc_cents, 21402);
});

test('franchise en base : TVA forcée à zéro', () => {
  const t = computeTotals(
    [{ qty_milli: 1000, unit_price_cents: 10000, vat_rate: 20 }],
    { vatExempt: true }
  );
  assert.equal(t.total_vat_cents, 0);
  assert.equal(t.total_ttc_cents, 10000);
  assert.equal(t.lines[0].vat_rate, 0);
});

test('montants négatifs (lignes de remise)', () => {
  const t = computeTotals([
    { qty_milli: 1000, unit_price_cents: 50000, vat_rate: 20 },
    { qty_milli: 1000, unit_price_cents: -5000, vat_rate: 20 },
  ]);
  assert.equal(t.total_ht_cents, 45000);
  assert.equal(t.total_vat_cents, 9000);
});

test('formatage euros français', () => {
  assert.equal(fmtEuros(123456), '1\u00a0234,56 €');
  assert.equal(fmtEuros(-950), '-9,50 €');
  assert.equal(fmtEuros(5), '0,05 €');
});

test('sérialisation XML des montants et quantités', () => {
  assert.equal(centsToXml(123456), '1234.56');
  assert.equal(centsToXml(-50), '-0.50');
  assert.equal(qtyToXml(1500), '1.5');
  assert.equal(qtyToXml(3000), '3');
  assert.equal(qtyToXml(333), '0.333');
});

test('parsing des saisies décimales françaises', () => {
  assert.equal(parseDecimalTo('12,5', 100), 1250);
  assert.equal(parseDecimalTo('1 234,56', 100), 123456);
  assert.equal(parseDecimalTo('3', 1000), 3000);
  assert.equal(parseDecimalTo('abc', 100), null);
  assert.equal(parseDecimalTo('', 100), null);
});
