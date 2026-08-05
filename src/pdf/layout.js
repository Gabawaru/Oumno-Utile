// Mise en page A4 des documents (facture, devis, avoir) — typographie sobre,
// tableau paginé, totaux par taux de TVA et mentions légales françaises.

import { TrueTypeFont } from './font.js';
import { PDFDocument } from './writer.js';
import { fmtEuros, fmtQty } from '../compute.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
let cachedFonts = null;
function loadFonts() {
  cachedFonts ??= {
    F1: new TrueTypeFont(join(FONT_DIR, 'LiberationSans-Regular.ttf')),
    F2: new TrueTypeFont(join(FONT_DIR, 'LiberationSans-Bold.ttf')),
  };
  return cachedFonts;
}

const INK = [0.13, 0.15, 0.19];
const MUTED = [0.45, 0.48, 0.53];
const ACCENT = [0.11, 0.29, 0.65];
const LIGHT = [0.94, 0.95, 0.97];
const RULE = [0.8, 0.82, 0.86];

const TITLES = { invoice: 'FACTURE', quote: 'DEVIS', credit_note: 'AVOIR' };

const M = 18;          // marge (mm)
const W = 210 - 2 * M; // largeur utile
const FOOT_Y = 272;    // début de la zone pied de page

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const PAYMENT_LABELS = {
  transfer: 'Virement bancaire', card: 'Carte bancaire', cheque: 'Chèque',
  cash: 'Espèces', direct_debit: 'Prélèvement',
};

/**
 * @param {object} p
 * @param {object} p.doc        document (number, doc_type, dates, subject, notes…)
 * @param {object} p.seller     settings émetteur
 * @param {object} p.buyer      snapshot client
 * @param {object} p.totals     computeTotals(...)
 * @param {number} p.paidCents  somme des règlements enregistrés
 * @param {Buffer|null} p.facturxXml  XML à embarquer (factures/avoirs émis)
 * @returns {Buffer} PDF
 */
export function renderDocumentPdf({ doc, seller, buyer, totals, paidCents = 0, facturxXml = null }) {
  const fonts = loadFonts();
  const title = TITLES[doc.doc_type] || 'DOCUMENT';
  const pdf = new PDFDocument({
    fonts,
    title: `${title} ${doc.number || '(brouillon)'}`,
    author: seller.company_name || 'Facturier',
    producer: 'Facturier 1.0',
    facturxXml,
    facturxType: 'INVOICE',
    date: doc.issue_date ? new Date(doc.issue_date + 'T12:00:00Z') : new Date(),
  });

  const vatExempt = !!doc.vat_exempt;
  // Colonnes du tableau : [libellé, largeur mm, alignement]
  const cols = vatExempt
    ? [['Désignation', W - 78], ['Qté', 16, 'r'], ['Unité', 16], ['PU HT', 23, 'r'], ['Total HT', 23, 'r']]
    : [['Désignation', W - 92], ['Qté', 14, 'r'], ['Unité', 14], ['PU HT', 23, 'r'], ['TVA', 18, 'r'], ['Total HT', 23, 'r']];
  const colX = [];
  let acc = M;
  for (const [, w] of cols) { colX.push(acc); acc += w; }

  let page = null;
  let y = 0;

  const drawStaticHeader = (first) => {
    page = pdf.addPage();
    if (first) {
      // Bandeau émetteur
      page.text(M, 22, seller.company_name || '—', { font: 'F2', size: 15, color: INK });
      let sy = 28;
      const sellerLines = [
        seller.legal_form,
        [seller.address_line1, seller.address_line2].filter(Boolean).join(', '),
        [seller.postal_code, seller.city].filter(Boolean).join(' '),
        seller.siret ? `SIRET ${seller.siret}` : seller.siren ? `SIREN ${seller.siren}` : '',
        seller.ape_code ? `Code APE ${seller.ape_code}` : '',
        !vatExempt && seller.vat_number ? `TVA ${seller.vat_number}` : '',
        [seller.email, seller.phone].filter(Boolean).join('  ·  '),
      ].filter(Boolean);
      for (const l of sellerLines) { page.text(M, sy, l, { size: 8, color: MUTED }); sy += 3.8; }

      // Titre + numéro + dates
      page.textRight(210 - M, 24, title, { font: 'F2', size: 22, color: ACCENT });
      page.textRight(210 - M, 30.5, doc.number || 'BROUILLON — sans valeur comptable', {
        font: 'F2', size: doc.number ? 11 : 8.5, color: doc.number ? INK : [0.72, 0.2, 0.2],
      });
      let dy = 37;
      const meta = [];
      meta.push([`Date d'émission`, fmtDate(doc.issue_date) || '—']);
      if (doc.doc_type === 'quote') meta.push(['Valable jusqu’au', fmtDate(doc.validity_date) || '—']);
      else if (doc.due_date) meta.push([`Échéance`, fmtDate(doc.due_date)]);
      if (doc.purchase_order_ref) meta.push(['Référence', doc.purchase_order_ref]);
      if (doc.source_number) {
        meta.push([doc.doc_type === 'credit_note' ? 'Sur facture' : 'Suivant devis', doc.source_number]);
      }
      for (const [k, v] of meta) {
        page.textRight(210 - M - 30, dy, k, { size: 8.5, color: MUTED });
        page.textRight(210 - M, dy, v, { size: 8.5, color: INK });
        dy += 4.4;
      }

      // Encadré client
      const boxY = Math.max(sy, dy) + 6;
      const boxW = 82;
      const boxX = 210 - M - boxW;
      const buyerLines = [
        [buyer.address_line1, buyer.address_line2].filter(Boolean).join(', '),
        [buyer.postal_code, buyer.city].filter(Boolean).join(' '),
        buyer.country && buyer.country !== 'FR' ? buyer.country : '',
        buyer.siren ? `SIREN ${buyer.siren}` : '',
        buyer.vat_number ? `TVA ${buyer.vat_number}` : '',
      ].filter(Boolean);
      const boxH = 14 + buyerLines.length * 4;
      page.rect(boxX, boxY, boxW, boxH, { fill: LIGHT });
      page.text(boxX + 4, boxY + 5.5, doc.doc_type === 'quote' ? 'Adressé à' : 'Facturé à', { size: 7.5, color: MUTED });
      page.text(boxX + 4, boxY + 10.5, buyer.name || '—', { font: 'F2', size: 10, color: INK });
      let by = boxY + 15;
      for (const l of buyerLines) { page.text(boxX + 4, by, l, { size: 8, color: INK }); by += 4; }

      y = boxY + boxH + 8;
      if (doc.subject) {
        page.text(M, y, 'Objet : ', { font: 'F2', size: 9.5, color: INK });
        page.text(M + page.textWidth('Objet : ', { font: 'F2', size: 9.5 }), y, doc.subject, { size: 9.5, color: INK });
        y += 7;
      }
    } else {
      page.text(M, 18, seller.company_name || '', { font: 'F2', size: 10, color: MUTED });
      page.textRight(210 - M, 18, `${title} ${doc.number || ''} (suite)`, { size: 9, color: MUTED });
      y = 26;
    }
    drawTableHead();
  };

  const drawTableHead = () => {
    page.rect(M, y, W, 7, { fill: ACCENT });
    cols.forEach(([label, w, align], i) => {
      if (align === 'r') page.textRight(colX[i] + w - 2, y + 4.8, label, { font: 'F2', size: 8, color: [1, 1, 1] });
      else page.text(colX[i] + 2, y + 4.8, label, { font: 'F2', size: 8, color: [1, 1, 1] });
    });
    y += 9.5;
  };

  const ensureRoom = (needed) => {
    if (y + needed > FOOT_Y - 4) drawStaticHeader(false);
  };

  drawStaticHeader(true);

  // ---- Lignes ----
  for (const l of totals.lines) {
    const labelW = cols[0][1] - 4;
    const labelLines = page.wrap(l.label, labelW, { font: 'F2', size: 9 });
    const descLines = l.description ? page.wrap(l.description, labelW, { size: 8 }) : [];
    const rowH = labelLines.length * 4.2 + descLines.length * 3.8 + 3.5;
    ensureRoom(rowH);
    let ly = y;
    for (const t of labelLines) { page.text(M + 2, ly + 3.2, t, { font: 'F2', size: 9, color: INK }); ly += 4.2; }
    for (const t of descLines) { page.text(M + 2, ly + 3, t, { size: 8, color: MUTED }); ly += 3.8; }
    const mid = y + 3.2;
    const cells = vatExempt
      ? [null, fmtQty(l.qty_milli), l.unit, fmtEuros(l.unit_price_cents), fmtEuros(l.total_ht_cents)]
      : [null, fmtQty(l.qty_milli), l.unit, fmtEuros(l.unit_price_cents), `${l.vat_rate} %`, fmtEuros(l.total_ht_cents)];
    cells.forEach((v, i) => {
      if (v === null) return;
      const [, w, align] = cols[i];
      if (align === 'r') page.textRight(colX[i] + w - 2, mid, v, { size: 8.5, color: INK });
      else page.text(colX[i] + 2, mid, v, { size: 8.5, color: INK });
    });
    y += rowH;
    page.line(M, y - 1.5, 210 - M, y - 1.5, { width: 0.1, color: RULE });
  }

  // ---- Totaux ----
  const totalsRows = [];
  totalsRows.push(['Total HT', fmtEuros(totals.total_ht_cents), false]);
  if (!vatExempt) {
    for (const g of totals.vatBreakdown) {
      totalsRows.push([`TVA ${g.rate} % (base ${fmtEuros(g.basis_cents)})`, fmtEuros(g.tax_cents), false]);
    }
  }
  totalsRows.push([doc.doc_type === 'credit_note' ? 'Total TTC à créditer' : 'Total TTC', fmtEuros(totals.total_ttc_cents), true]);
  if (paidCents > 0 && doc.doc_type === 'invoice') {
    totalsRows.push(['Déjà réglé', fmtEuros(-paidCents), false]);
    totalsRows.push(['Net à payer', fmtEuros(totals.total_ttc_cents - paidCents), true]);
  }
  const totalsH = totalsRows.reduce((s, [, , strong]) => s + (strong ? 7 : 5.2), 0) + 6;
  ensureRoom(totalsH + (vatExempt ? 6 : 0) + 4);
  y += 2;
  const totX = 210 - M - 78;
  for (const [label, value, strong] of totalsRows) {
    if (strong) {
      page.rect(totX, y - 1, 78, 6.6, { fill: LIGHT });
      page.text(totX + 3, y + 3.6, label, { font: 'F2', size: 9.5, color: INK });
      page.textRight(210 - M - 3, y + 3.6, value, { font: 'F2', size: 9.5, color: INK });
      y += 7;
    } else {
      page.text(totX + 3, y + 3.2, label, { size: 8.5, color: MUTED });
      page.textRight(210 - M - 3, y + 3.2, value, { size: 8.5, color: INK });
      y += 5.2;
    }
  }
  if (vatExempt) {
    page.textRight(210 - M, y + 3.5, seller.vat_exemption_mention || 'TVA non applicable, art. 293 B du CGI', {
      size: 8, color: MUTED,
    });
    y += 6;
  }

  // ---- Règlement / notes / signature ----
  y += 4;
  const payLines = [];
  if (doc.doc_type !== 'quote') {
    payLines.push(['Moyen de paiement', PAYMENT_LABELS[doc.payment_means] || 'Virement bancaire']);
    if (seller.iban) payLines.push(['IBAN', seller.iban]);
    if (seller.bic) payLines.push(['BIC', seller.bic]);
    if (doc.due_date && doc.doc_type === 'invoice') payLines.push(['Date limite de paiement', fmtDate(doc.due_date)]);
  }
  const noteLines = doc.notes_public ? page.wrap(doc.notes_public, W - 90, { size: 8.5 }) : [];
  const blockH = Math.max(payLines.length * 4.6 + 8, noteLines.length * 4 + 8, doc.doc_type === 'quote' ? 34 : 0);
  ensureRoom(blockH);
  const blockTop = y;
  if (payLines.length) {
    page.text(M, y + 4, 'Règlement', { font: 'F2', size: 9, color: ACCENT });
    let py = y + 9.5;
    for (const [k, v] of payLines) {
      page.text(M, py, `${k} : `, { size: 8.5, color: MUTED });
      page.text(M + page.textWidth(`${k} : `, { size: 8.5 }), py, v, { size: 8.5, color: INK });
      py += 4.6;
    }
  }
  if (noteLines.length) {
    let ny = blockTop + 4;
    page.text(M + 95, ny, 'Notes', { font: 'F2', size: 9, color: ACCENT });
    ny += 5.5;
    for (const t of noteLines) { page.text(M + 95, ny, t, { size: 8.5, color: INK }); ny += 4; }
  }
  if (doc.doc_type === 'quote') {
    const sigX = 210 - M - 70;
    page.rect(sigX, blockTop, 70, 30, { stroke: RULE, lineWidth: 0.3 });
    page.text(sigX + 3, blockTop + 5, 'Bon pour accord', { font: 'F2', size: 8.5, color: INK });
    page.text(sigX + 3, blockTop + 9.5, 'Date et signature du client :', { size: 7.5, color: MUTED });
  }

  // ---- Pied de page légal (sur chaque page) ----
  const legal = [];
  if (doc.doc_type === 'invoice') {
    legal.push(
      `En cas de retard de paiement, pénalités exigibles au taux de ${seller.late_penalty_rate || '3 fois le taux d’intérêt légal'} (art. L441-10 C. com.).` +
        (seller.mention_recovery_indemnity !== false
          ? ' Indemnité forfaitaire pour frais de recouvrement : 40 € (art. D441-5 C. com.).'
          : '')
    );
    if (seller.mention_escompte) legal.push(`${seller.mention_escompte}.`);
  }
  if (doc.doc_type === 'quote') {
    legal.push('Devis gratuit. Toute somme éventuellement versée à la commande constitue un acompte.');
  }
  if (vatExempt) legal.push(`${seller.vat_exemption_mention || 'TVA non applicable, art. 293 B du CGI'}.`);
  if (seller.footer_note) legal.push(seller.footer_note);
  const identity = [
    seller.company_name,
    seller.legal_form,
    seller.siret ? `SIRET ${seller.siret}` : '',
    seller.ape_code ? `APE ${seller.ape_code}` : '',
    [seller.address_line1, seller.postal_code, seller.city].filter(Boolean).join(', '),
    seller.email,
  ].filter(Boolean).join(' — ');

  pdf.pages.forEach((pg, i) => {
    let fy = FOOT_Y + 3;
    pg.line(M, FOOT_Y, 210 - M, FOOT_Y, { width: 0.15, color: RULE });
    for (const text of legal) {
      for (const l of pg.wrap(text, W, { size: 6.6 })) {
        pg.text(M, fy + 2.4, l, { size: 6.6, color: MUTED });
        fy += 3.1;
      }
    }
    for (const l of pg.wrap(identity, W - 20, { size: 6.6 })) {
      pg.text(M, fy + 2.6, l, { size: 6.6, color: [0.55, 0.58, 0.62] });
      fy += 3.1;
    }
    pg.textRight(210 - M, 293, `Page ${i + 1} / ${pdf.pages.length}`, { size: 7, color: MUTED });
  });

  return pdf.build();
}
