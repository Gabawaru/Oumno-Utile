import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderDocumentPdf } from '../src/pdf/layout.js';
import { TrueTypeFont, encodeWinAnsi, winAnsiToUnicode } from '../src/pdf/font.js';
import { buildSrgbProfile } from '../src/pdf/icc.js';
import { computeTotals } from '../src/compute.js';
import { buildFacturX } from '../src/facturx.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf');

const seller = {
  company_name: 'Jeanne Martin', legal_form: 'EI', siret: '91234567800014',
  address_line1: '10 rue Oberkampf', postal_code: '75011', city: 'Paris',
  email: 'j@ex.fr', iban: 'FR76 3000 4000 0500 0012 3456 789',
  vat_exemption_mention: 'TVA non applicable, art. 293 B du CGI',
  late_penalty_rate: '3 fois le taux d’intérêt légal',
  mention_escompte: 'Pas d’escompte pour paiement anticipé',
};
const buyer = { name: 'ACME SAS', address_line1: '1 av. Foo', postal_code: '75001', city: 'Paris', siren: '532183181' };

function makePdf(nLines = 3, withXml = true) {
  const lines = Array.from({ length: nLines }, (_, i) => ({
    label: `Prestation n° ${i + 1} — développement`,
    description: i % 2 ? 'Description détaillée de la prestation avec suffisamment de texte pour forcer un retour à la ligne automatique dans le tableau.' : '',
    qty_milli: 1500, unit: 'j', unit_price_cents: 45000, vat_rate: 20,
  }));
  const totals = computeTotals(lines);
  const doc = {
    doc_type: 'invoice', number: 'F-2026-0007', issue_date: '2026-08-04',
    due_date: '2026-09-03', payment_means: 'transfer', vat_exempt: 0,
    subject: 'Test de génération', notes_public: 'Note publique — merci !', currency: 'EUR',
  };
  const facturxXml = withXml ? Buffer.from(buildFacturX(doc, seller, buyer, totals)) : null;
  return renderDocumentPdf({ doc, seller, buyer, totals, facturxXml });
}

test('parseur TrueType : métriques cohérentes', () => {
  const f = new TrueTypeFont(FONT);
  assert.equal(f.unitsPerEm, 2048);
  assert.ok(f.numGlyphs > 1000);
  assert.ok(f.cmap.get(0x41) > 0);                    // 'A'
  assert.ok(f.cmap.get(0xe9) > 0);                    // 'é'
  assert.ok(f.cmap.get(0x20ac) > 0);                  // '€'
  // Liberation Sans est métriquement compatible Arial : 'A' avance 1366/2048
  assert.equal(f.advanceForUnicode(0x41), Math.round((1366 * 1000) / 2048));
  const w = f.textWidth('AAA', 10);
  assert.ok(w > 19 && w < 21);
  const d = f.descriptor();
  assert.ok(d.ascent > 0 && d.descent < 0 && d.capHeight > 0);
});

test('encodage WinAnsi : français et symboles', () => {
  assert.deepEqual([...encodeWinAnsi('é€œ—')], [0xe9, 0x80, 0x9c, 0x97]);
  assert.equal(winAnsiToUnicode(0x80), 0x20ac);
  // caractère hors plage remplacé par '?'
  assert.deepEqual([...encodeWinAnsi('日')], [0x3f]);
});

test('profil ICC : en-tête et balises valides', () => {
  const p = buildSrgbProfile();
  assert.equal(p.readUInt32BE(0), p.length);
  assert.equal(p.toString('latin1', 12, 16), 'mntr');
  assert.equal(p.toString('latin1', 16, 20), 'RGB ');
  assert.equal(p.toString('latin1', 36, 40), 'acsp');
  const tagCount = p.readUInt32BE(128);
  assert.equal(tagCount, 9);
  // chaque balise pointe dans le fichier
  for (let i = 0; i < tagCount; i++) {
    const off = p.readUInt32BE(132 + i * 12 + 4);
    const size = p.readUInt32BE(132 + i * 12 + 8);
    assert.ok(off + size <= p.length);
  }
});

test('PDF : structure de base et marqueurs PDF/A-3', () => {
  const pdf = makePdf();
  const head = pdf.subarray(0, 8).toString('latin1');
  assert.match(head, /^%PDF-1\.7/);
  assert.match(pdf.subarray(-20).toString('latin1'), /%%EOF\s*$/);
  const raw = pdf.toString('latin1');
  assert.match(raw, /\/Type \/Catalog/);
  assert.match(raw, /\/OutputIntents/);
  assert.match(raw, /GTS_PDFA1/);
  assert.match(raw, /\/FontFile2/);
  assert.match(raw, /\/AF \[/);
  assert.match(raw, /factur-x\.xml/);
  assert.match(raw, /pdfaid:part>3</);
  assert.match(raw, /\/ID \[</);
  // le xref référence le bon nombre d'objets
  const m = raw.match(/xref\n0 (\d+)/);
  assert.ok(Number(m[1]) > 10);
});

test('PDF : offsets xref exacts', () => {
  const pdf = makePdf();
  const raw = pdf.toString('latin1');
  const xrefPos = Number(raw.match(/startxref\n(\d+)/)[1]);
  assert.equal(raw.slice(xrefPos, xrefPos + 4), 'xref');
  const lines = raw.slice(xrefPos).split('\n');
  const count = Number(lines[1].split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const off = Number(lines[2 + i].slice(0, 10));
    assert.match(raw.slice(off, off + 20), new RegExp(`^${i} 0 obj`), `objet ${i}`);
  }
});

test('PDF : XML Factur-X embarqué et récupérable', () => {
  const pdf = makePdf();
  const raw = pdf.toString('latin1');
  // retrouve le flux EmbeddedFile et le décompresse
  const dictIdx = raw.indexOf('/Type /EmbeddedFile');
  assert.ok(dictIdx > 0);
  const start = raw.indexOf('stream\n', dictIdx) + 'stream\n'.length;
  const end = raw.indexOf('\nendstream', start);
  const xml = inflateSync(pdf.subarray(start, end)).toString('utf8');
  assert.match(xml, /<rsm:CrossIndustryInvoice/);
  assert.match(xml, /F-2026-0007/);
});

test('PDF : pagination des longues factures', () => {
  const pdf = makePdf(40);
  const raw = pdf.toString('latin1');
  const pageCount = Number(raw.match(/\/Count (\d+)/)[1]);
  assert.ok(pageCount >= 2, `attendu ≥ 2 pages, obtenu ${pageCount}`);
});

test('PDF sans Factur-X (devis) : pas de pièce jointe', () => {
  const pdf = makePdf(2, false);
  const raw = pdf.toString('latin1');
  assert.doesNotMatch(raw, /\/EmbeddedFile/);
  assert.doesNotMatch(raw, /\/AF \[/);
});
