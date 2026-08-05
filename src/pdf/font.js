// Parseur TrueType minimal — extrait d'un fichier .ttf tout ce qu'il faut
// pour l'embarquer dans un PDF (exigence PDF/A) : métriques globales
// (FontDescriptor), largeurs d'avance par caractère (table /Widths) et
// correspondance Unicode -> glyphe (tables cmap format 4/12 + hmtx).

import { readFileSync } from 'node:fs';

// Encodage WinAnsi (CP1252) : code PDF -> point de code Unicode.
// 0x20-0x7E = ASCII ; 0xA0-0xFF = Latin-1 ; plage 0x80-0x9F ci-dessous.
const WINANSI_EXTRA = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

export function winAnsiToUnicode(code) {
  if (code >= 0xa0 || (code >= 0x20 && code <= 0x7e)) return code;
  return WINANSI_EXTRA[code] ?? null;
}

const UNICODE_TO_WINANSI = (() => {
  const m = new Map();
  for (let c = 0x20; c <= 0x7e; c++) m.set(c, c);
  for (let c = 0xa0; c <= 0xff; c++) m.set(c, c);
  for (const [code, uni] of Object.entries(WINANSI_EXTRA)) m.set(uni, Number(code));
  return m;
})();

/** Encode une chaîne JS en octets WinAnsi ; caractères hors plage -> '?'. */
export function encodeWinAnsi(str) {
  const out = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = UNICODE_TO_WINANSI.get(str.codePointAt(i)) ?? 0x3f;
  }
  return out;
}

export class TrueTypeFont {
  /** @param {string} path chemin du .ttf */
  constructor(path) {
    const buf = readFileSync(path);
    this.data = buf;
    const numTables = buf.readUInt16BE(4);
    this.tables = {};
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = buf.toString('latin1', off, off + 4);
      this.tables[tag] = { offset: buf.readUInt32BE(off + 8), length: buf.readUInt32BE(off + 12) };
    }
    this.#parseHead();
    this.#parseHhea();
    this.#parseMaxp();
    this.#parseHmtx();
    this.#parseCmap();
    this.#parseOs2();
    this.#parsePost();
    this.#parseName();
  }

  #t(tag) {
    const t = this.tables[tag];
    if (!t) throw new Error(`Table TTF manquante : ${tag}`);
    return t.offset;
  }

  #parseHead() {
    const o = this.#t('head');
    this.unitsPerEm = this.data.readUInt16BE(o + 18);
    this.bbox = [
      this.data.readInt16BE(o + 36), this.data.readInt16BE(o + 38),
      this.data.readInt16BE(o + 40), this.data.readInt16BE(o + 42),
    ];
  }

  #parseHhea() {
    const o = this.#t('hhea');
    this.ascent = this.data.readInt16BE(o + 4);
    this.descent = this.data.readInt16BE(o + 6);
    this.numberOfHMetrics = this.data.readUInt16BE(o + 34);
  }

  #parseMaxp() {
    this.numGlyphs = this.data.readUInt16BE(this.#t('maxp') + 4);
  }

  #parseHmtx() {
    const o = this.#t('hmtx');
    this.advances = new Uint16Array(this.numGlyphs);
    let last = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      if (g < this.numberOfHMetrics) last = this.data.readUInt16BE(o + g * 4);
      this.advances[g] = last;
    }
  }

  #parseCmap() {
    const o = this.#t('cmap');
    const n = this.data.readUInt16BE(o + 2);
    let best = null; // préférence : (3,10) format 12 > (3,1) format 4 > (0,x)
    for (let i = 0; i < n; i++) {
      const rec = o + 4 + i * 8;
      const platform = this.data.readUInt16BE(rec);
      const encoding = this.data.readUInt16BE(rec + 2);
      const offset = o + this.data.readUInt32BE(rec + 4);
      const score =
        platform === 3 && encoding === 10 ? 3 :
        platform === 3 && encoding === 1 ? 2 :
        platform === 0 ? 1 : 0;
      if (!best || score > best.score) best = { offset, score };
    }
    if (!best) throw new Error('Aucune sous-table cmap exploitable');
    this.cmap = new Map();
    const fo = best.offset;
    const format = this.data.readUInt16BE(fo);
    if (format === 4) this.#parseCmap4(fo);
    else if (format === 12) this.#parseCmap12(fo);
    else throw new Error(`Format cmap non géré : ${format}`);
  }

  #parseCmap4(fo) {
    const segCount = this.data.readUInt16BE(fo + 6) / 2;
    const endAt = fo + 14;
    const startAt = endAt + segCount * 2 + 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = this.data.readUInt16BE(endAt + s * 2);
      const start = this.data.readUInt16BE(startAt + s * 2);
      const delta = this.data.readInt16BE(deltaAt + s * 2);
      const rangeOffset = this.data.readUInt16BE(rangeAt + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const idx = rangeAt + s * 2 + rangeOffset + (c - start) * 2;
          if (idx + 1 >= this.data.length) continue;
          gid = this.data.readUInt16BE(idx);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) this.cmap.set(c, gid);
      }
    }
  }

  #parseCmap12(fo) {
    const nGroups = this.data.readUInt32BE(fo + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = fo + 16 + g * 12;
      const start = this.data.readUInt32BE(rec);
      const end = this.data.readUInt32BE(rec + 4);
      const startGid = this.data.readUInt32BE(rec + 8);
      for (let c = start; c <= end && c - start < 0x10000; c++) {
        this.cmap.set(c, startGid + (c - start));
      }
    }
  }

  #parseOs2() {
    const t = this.tables['OS/2'];
    this.capHeight = 0;
    if (t) {
      const version = this.data.readUInt16BE(t.offset);
      if (version >= 2 && t.length >= 90) this.capHeight = this.data.readInt16BE(t.offset + 88);
    }
    if (!this.capHeight) this.capHeight = Math.round(this.ascent * 0.9);
  }

  #parsePost() {
    const t = this.tables['post'];
    this.italicAngle = t ? this.data.readInt32BE(t.offset + 4) / 65536 : 0;
  }

  #parseName() {
    this.postScriptName = 'Embedded';
    const t = this.tables['name'];
    if (!t) return;
    const o = t.offset;
    const count = this.data.readUInt16BE(o + 2);
    const storage = o + this.data.readUInt16BE(o + 4);
    for (let i = 0; i < count; i++) {
      const rec = o + 6 + i * 12;
      const nameId = this.data.readUInt16BE(rec + 6);
      if (nameId !== 6) continue; // 6 = nom PostScript
      const platform = this.data.readUInt16BE(rec);
      const len = this.data.readUInt16BE(rec + 8);
      const off = storage + this.data.readUInt16BE(rec + 10);
      if (platform === 3) {
        // UTF-16BE
        let s = '';
        for (let j = 0; j < len; j += 2) s += String.fromCharCode(this.data.readUInt16BE(off + j));
        this.postScriptName = s;
        return;
      }
      this.postScriptName = this.data.toString('latin1', off, off + len);
    }
  }

  /** Échelle une valeur en unités de fonte vers l'espace 1000 du PDF. */
  scale(v) {
    return Math.round((v * 1000) / this.unitsPerEm);
  }

  /** Largeur d'avance (espace 1000) pour un point de code Unicode. */
  advanceForUnicode(cp) {
    const gid = this.cmap.get(cp) ?? 0;
    return this.scale(this.advances[gid] ?? this.advances[0]);
  }

  /** Table /Widths pour l'encodage WinAnsi, codes first..last. */
  widthsArray(first = 32, last = 255) {
    const w = [];
    for (let code = first; code <= last; code++) {
      const uni = winAnsiToUnicode(code);
      w.push(uni === null ? 0 : this.advanceForUnicode(uni));
    }
    return w;
  }

  /** Largeur d'un texte (en points) pour une taille donnée. */
  textWidth(str, size) {
    let units = 0;
    for (const ch of str) units += this.advanceForUnicode(ch.codePointAt(0));
    return (units * size) / 1000;
  }

  /** Métriques pour le FontDescriptor PDF. */
  descriptor() {
    return {
      ascent: this.scale(this.ascent),
      descent: this.scale(this.descent),
      capHeight: this.scale(this.capHeight),
      bbox: this.bbox.map((v) => this.scale(v)),
      italicAngle: this.italicAngle,
      postScriptName: this.postScriptName.replace(/[^\x21-\x7e]/g, ''),
    };
  }
}
