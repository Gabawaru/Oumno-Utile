// Moteur de calcul monétaire.
// Tous les montants circulent en CENTIMES (entiers) pour éviter les erreurs
// de flottants ; les quantités en MILLIÈMES (entiers, ex. 1.5 h => 1500).
// Règles d'arrondi alignées sur la norme EN 16931 : arrondi au centime par
// ligne, la TVA est calculée par taux sur la somme des bases (et non ligne
// par ligne), arrondie au centime.

/** Arrondi commercial (demi-centime vers le haut), gère les négatifs (avoirs). */
export function roundHalfUp(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Total HT d'une ligne en centimes. */
export function lineTotalCents(qtyMilli, unitPriceCents) {
  return roundHalfUp((qtyMilli * unitPriceCents) / 1000);
}

/**
 * Calcule les totaux d'un document.
 * @param {Array<{qty_milli:number, unit_price_cents:number, vat_rate:number}>} lines
 * @param {{vatExempt?: boolean}} opts — franchise en base : TVA à 0 partout.
 * @returns {{lines: Array, vatBreakdown: Array<{rate:number, basis_cents:number, tax_cents:number}>,
 *           total_ht_cents:number, total_vat_cents:number, total_ttc_cents:number}}
 */
export function computeTotals(lines, opts = {}) {
  const vatExempt = !!opts.vatExempt;
  const outLines = lines.map((l) => {
    const rate = vatExempt ? 0 : Number(l.vat_rate) || 0;
    const total = lineTotalCents(l.qty_milli, l.unit_price_cents);
    return { ...l, vat_rate: rate, total_ht_cents: total };
  });

  // Regroupement par taux (clé stable : taux ×100 pour supporter 5.5 / 2.1)
  const groups = new Map();
  for (const l of outLines) {
    const key = Math.round(l.vat_rate * 100);
    const g = groups.get(key) || { rate: l.vat_rate, basis_cents: 0, tax_cents: 0 };
    g.basis_cents += l.total_ht_cents;
    groups.set(key, g);
  }
  const vatBreakdown = [...groups.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((g) => ({
      rate: g.rate,
      basis_cents: g.basis_cents,
      tax_cents: roundHalfUp((g.basis_cents * g.rate) / 100),
    }));

  const total_ht_cents = vatBreakdown.reduce((s, g) => s + g.basis_cents, 0);
  const total_vat_cents = vatBreakdown.reduce((s, g) => s + g.tax_cents, 0);
  return {
    lines: outLines,
    vatBreakdown,
    total_ht_cents,
    total_vat_cents,
    total_ttc_cents: total_ht_cents + total_vat_cents,
  };
}

/** Formate des centimes en euros "1 234,56 €" (espace insécable fine). */
export function fmtEuros(cents, { symbol = true } = {}) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const c = String(abs % 100).padStart(2, '0');
  const int = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${sign}${int},${c}${symbol ? ' €' : ''}`;
}

/** "1234.56" pour le XML (point décimal, 2 décimales, signe conservé). */
export function centsToXml(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Quantité en millièmes -> chaîne lisible ("1,5" ; "3") */
export function fmtQty(qtyMilli) {
  const v = qtyMilli / 1000;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}

/** Quantité en millièmes -> "1.5" pour le XML (jusqu'à 3 décimales utiles). */
export function qtyToXml(qtyMilli) {
  const v = qtyMilli / 1000;
  return Number.isInteger(v) ? `${v}` : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Parse une saisie utilisateur "12,5" ou "12.5" en centimes (ou millièmes). */
export function parseDecimalTo(str, factor) {
  if (typeof str === 'number') return roundHalfUp(str * factor);
  const s = String(str ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === '' || s === '-') return null;
  return roundHalfUp(parseFloat(s) * factor);
}
