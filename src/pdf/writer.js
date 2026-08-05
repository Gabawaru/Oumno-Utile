// Writer PDF écrit from scratch (aucune bibliothèque) produisant des fichiers
// alignés sur les exigences structurelles PDF/A-3B :
//  - polices TrueType intégralement embarquées (FontFile2) ;
//  - OutputIntent GTS_PDFA1 avec profil ICC sRGB embarqué ;
//  - métadonnées XMP non compressées, cohérentes avec le dictionnaire Info ;
//  - identifiant de fichier (/ID) dans le trailer, aucune fonctionnalité
//    interdite (chiffrement, JavaScript, contenus externes) ;
//  - pièce jointe "factur-x.xml" (AFRelationship /Data) + /AF au catalogue
//    pour les documents Factur-X.

import { deflateSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { encodeWinAnsi } from './font.js';
import { buildSrgbProfile } from './icc.js';
import { buildXmp } from './xmp.js';

const MM = 72 / 25.4; // millimètres -> points
const A4 = { w: 210 * MM, h: 297 * MM };

const n2 = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Chaîne littérale PDF depuis des octets WinAnsi. */
function litString(bytes) {
  let out = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += '\\' + b.toString(8).padStart(3, '0');
  }
  return out + ')';
}

/** Chaîne texte PDF en UTF-16BE (pour Info, /Desc…). */
function textString(str) {
  const buf = Buffer.from('﻿' + str, 'utf16le').swap16();
  return '<' + buf.toString('hex').toUpperCase() + '>';
}

function pdfDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}+00'00')`;
}

class Page {
  constructor(doc) {
    this.doc = doc;
    this.ops = [];
  }

  // x en mm depuis la gauche, y en mm depuis le HAUT de la page.
  #pt(x, y) {
    return [x * MM, A4.h - y * MM];
  }

  setFillColor([r, g, b]) {
    this.ops.push(`${n2(r)} ${n2(g)} ${n2(b)} rg`);
  }

  text(xMm, yMm, str, { font = 'F1', size = 10, color = [0, 0, 0] } = {}) {
    const [x, y] = this.#pt(xMm, yMm);
    this.doc.usedFonts.add(font);
    this.ops.push(
      `BT ${n2(color[0])} ${n2(color[1])} ${n2(color[2])} rg /${font} ${n2(size)} Tf ${n2(x)} ${n2(y)} Td ${litString(encodeWinAnsi(str))} Tj ET`
    );
  }

  textRight(xRightMm, yMm, str, opts = {}) {
    const font = this.doc.fonts[opts.font || 'F1'];
    const w = font.textWidth(str, opts.size || 10) / MM;
    this.text(xRightMm - w, yMm, str, opts);
  }

  textCenter(xCenterMm, yMm, str, opts = {}) {
    const font = this.doc.fonts[opts.font || 'F1'];
    const w = font.textWidth(str, opts.size || 10) / MM;
    this.text(xCenterMm - w / 2, yMm, str, opts);
  }

  textWidth(str, { font = 'F1', size = 10 } = {}) {
    return this.doc.fonts[font].textWidth(str, size) / MM;
  }

  /** Découpe un texte en lignes tenant dans maxWidthMm ; retourne les lignes. */
  wrap(str, maxWidthMm, opts = {}) {
    const words = String(str).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const attempt = cur ? cur + ' ' + w : w;
      if (this.textWidth(attempt, opts) <= maxWidthMm || !cur) cur = attempt;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  line(x1, y1, x2, y2, { width = 0.2, color = [0, 0, 0] } = {}) {
    const [ax, ay] = this.#pt(x1, y1);
    const [bx, by] = this.#pt(x2, y2);
    this.ops.push(
      `${n2(color[0])} ${n2(color[1])} ${n2(color[2])} RG ${n2(width * MM)} w ${n2(ax)} ${n2(ay)} m ${n2(bx)} ${n2(by)} l S`
    );
  }

  rect(xMm, yMm, wMm, hMm, { fill = null, stroke = null, lineWidth = 0.2 } = {}) {
    const [x, y] = this.#pt(xMm, yMm + hMm); // coin bas-gauche
    const parts = [];
    if (fill) parts.push(`${n2(fill[0])} ${n2(fill[1])} ${n2(fill[2])} rg`);
    if (stroke) parts.push(`${n2(stroke[0])} ${n2(stroke[1])} ${n2(stroke[2])} RG ${n2(lineWidth * MM)} w`);
    parts.push(`${n2(x)} ${n2(y)} ${n2(wMm * MM)} ${n2(hMm * MM)} re`);
    parts.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.ops.push(parts.join(' '));
  }

  content() {
    return Buffer.from(this.ops.join('\n'), 'latin1');
  }
}

export class PDFDocument {
  /**
   * @param {object} o
   * @param {Record<string, import('./font.js').TrueTypeFont>} o.fonts  ex. {F1: regular, F2: bold}
   * @param {string} o.title
   * @param {string} o.author
   * @param {Buffer|null} o.facturxXml  XML à embarquer (null pour un devis)
   * @param {string} o.facturxType
   * @param {Date} o.date
   */
  constructor({ fonts, title = '', author = '', producer = 'Facturier', facturxXml = null, facturxType = 'INVOICE', date = new Date() }) {
    this.fonts = fonts;
    this.title = title;
    this.author = author;
    this.producer = producer;
    this.facturxXml = facturxXml;
    this.facturxType = facturxType;
    this.date = date;
    this.pages = [];
    this.usedFonts = new Set();
  }

  addPage() {
    const p = new Page(this);
    this.pages.push(p);
    return p;
  }

  get pageWidthMm() { return 210; }
  get pageHeightMm() { return 297; }

  build() {
    const objects = []; // index 0 => objet 1
    const addObj = (body) => objects.push(body) /* length */;
    const ref = (i) => `${i} 0 R`;
    const addStream = (dict, data, { compress = true } = {}) => {
      const payload = compress ? deflateSync(data) : data;
      const filter = compress ? ' /Filter /FlateDecode' : '';
      const body = Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${payload.length}${filter} >>\nstream\n`, 'latin1'),
        payload,
        Buffer.from('\nendstream', 'latin1'),
      ]);
      return addObj(body);
    };

    // --- Polices ---
    const fontRefs = {};
    for (const [name, font] of Object.entries(this.fonts)) {
      const d = font.descriptor();
      const fileId = addStream(`/Length1 ${font.data.length}`, font.data);
      const descId = addObj(
        `<< /Type /FontDescriptor /FontName /${d.postScriptName} /Flags 32 ` +
          `/FontBBox [${d.bbox.join(' ')}] /ItalicAngle ${d.italicAngle} /Ascent ${d.ascent} ` +
          `/Descent ${d.descent} /CapHeight ${d.capHeight} /StemV 80 /FontFile2 ${ref(fileId)} >>`
      );
      const widths = font.widthsArray(32, 255);
      const fontId = addObj(
        `<< /Type /Font /Subtype /TrueType /BaseFont /${d.postScriptName} ` +
          `/FirstChar 32 /LastChar 255 /Widths [${widths.join(' ')}] ` +
          `/Encoding /WinAnsiEncoding /FontDescriptor ${ref(descId)} >>`
      );
      fontRefs[name] = fontId;
    }

    // --- Profil ICC + OutputIntent ---
    const iccId = addStream('/N 3', buildSrgbProfile());
    const outputIntentId = addObj(
      `<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB) ` +
        `/Info (sRGB IEC61966-2.1) /RegistryName (http://www.color.org) /DestOutputProfile ${ref(iccId)} >>`
    );

    // --- Métadonnées XMP (non compressées : exigence PDF/A) ---
    const dateIso = this.date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const xmp = buildXmp({
      title: this.title,
      author: this.author,
      producer: this.producer,
      dateIso,
      facturx: !!this.facturxXml,
      facturxType: this.facturxType,
    });
    const metadataId = addStream('/Type /Metadata /Subtype /XML', xmp, { compress: false });

    // --- Pièce jointe Factur-X ---
    let filespecId = null;
    if (this.facturxXml) {
      const efId = addStream(
        `/Type /EmbeddedFile /Subtype /text#2Fxml /Params << /ModDate ${pdfDate(this.date)} /Size ${this.facturxXml.length} >>`,
        this.facturxXml
      );
      filespecId = addObj(
        `<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) ` +
          `/Desc ${textString('Factur-X / EN 16931 invoice data')} /AFRelationship /Data ` +
          `/EF << /F ${ref(efId)} /UF ${ref(efId)} >> >>`
      );
    }

    // --- Pages ---
    const fontResource = Object.entries(fontRefs)
      .map(([name, id]) => `/${name} ${ref(id)}`)
      .join(' ');
    const pagesId = objects.length + this.pages.length * 2 + 1; // réservation
    const pageIds = [];
    for (const page of this.pages) {
      const contentId = addStream('', page.content());
      const pageId = addObj(
        `<< /Type /Page /Parent ${ref(pagesId)} /MediaBox [0 0 ${n2(A4.w)} ${n2(A4.h)}] ` +
          `/Resources << /Font << ${fontResource} >> /ProcSet [/PDF /Text] >> /Contents ${ref(contentId)} >>`
      );
      pageIds.push(pageId);
    }
    const realPagesId = addObj(
      `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`
    );
    if (realPagesId !== pagesId) throw new Error('Erreur interne : réservation d’objet Pages incohérente');

    // --- Catalogue ---
    let catalogExtra = '';
    if (filespecId) {
      const namesId = addObj(`<< /EmbeddedFiles << /Names [(factur-x.xml) ${ref(filespecId)}] >> >>`);
      catalogExtra = ` /AF [${ref(filespecId)}] /Names ${ref(namesId)}`;
    }
    const catalogId = addObj(
      `<< /Type /Catalog /Pages ${ref(pagesId)} /Metadata ${ref(metadataId)} ` +
        `/OutputIntents [${ref(outputIntentId)}]${catalogExtra} >>`
    );

    // --- Info (cohérent avec le XMP) ---
    const infoId = addObj(
      `<< /Title ${textString(this.title)} /Author ${textString(this.author)} ` +
        `/Producer ${textString(this.producer)} /CreationDate ${pdfDate(this.date)} /ModDate ${pdfDate(this.date)} >>`
    );

    // --- Sérialisation + xref ---
    const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let position = chunks[0].length;
    const offsets = [0];
    objects.forEach((body, i) => {
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
      const tail = Buffer.from('\nendobj\n', 'latin1');
      offsets.push(position);
      chunks.push(head, b, tail);
      position += head.length + b.length + tail.length;
    });

    const xrefPos = position;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    const idHex = createHash('md5')
      .update(this.title + dateIso)
      .update(randomBytes(8))
      .digest('hex')
      .toUpperCase();
    const trailer =
      `trailer\n<< /Size ${objects.length + 1} /Root ${ref(catalogId)} /Info ${ref(infoId)} ` +
      `/ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    chunks.push(Buffer.from(xref + trailer, 'latin1'));
    return Buffer.concat(chunks);
  }
}
