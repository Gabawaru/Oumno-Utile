// Construction programmatique d'un profil ICC v2 sRGB (matrice + courbes).
// PDF/A exige un OutputIntent avec profil ICC embarqué : plutôt que
// d'embarquer un binaire opaque, on le génère — profil « display » RGB
// minimal, primaires sRGB adaptées D50 (Bradford), gamma 2.2.

function s15Fixed16(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(Math.round(v * 65536));
  return b;
}

function tagXYZ(x, y, z) {
  return Buffer.concat([
    Buffer.from('XYZ '), Buffer.alloc(4),
    s15Fixed16(x), s15Fixed16(y), s15Fixed16(z),
  ]);
}

function tagCurveGamma(gamma) {
  const b = Buffer.alloc(14);
  b.write('curv', 0, 'latin1');
  b.writeUInt32BE(1, 8);                      // 1 valeur => gamma u8.8
  b.writeUInt16BE(Math.round(gamma * 256), 12);
  return b;
}

function tagText(str) {
  return Buffer.concat([Buffer.from('text'), Buffer.alloc(4), Buffer.from(str + '\0', 'latin1')]);
}

function tagDesc(str) {
  const ascii = Buffer.from(str + '\0', 'latin1');
  const b = Buffer.alloc(8 + 4 + ascii.length + 4 + 4 + 2 + 1 + 67);
  b.write('desc', 0, 'latin1');
  b.writeUInt32BE(ascii.length, 8);
  ascii.copy(b, 12);
  return b;
}

export function buildSrgbProfile() {
  const tags = [
    ['desc', tagDesc('sRGB (generated)')],
    ['cprt', tagText('Public domain — generated profile')],
    ['wtpt', tagXYZ(0.9642, 1.0, 0.8249)],   // point blanc D50
    ['rXYZ', tagXYZ(0.4360, 0.2225, 0.0139)],
    ['gXYZ', tagXYZ(0.3851, 0.7169, 0.0971)],
    ['bXYZ', tagXYZ(0.1431, 0.0606, 0.7141)],
    ['rTRC', tagCurveGamma(2.2)],
    ['gTRC', tagCurveGamma(2.2)],
    ['bTRC', tagCurveGamma(2.2)],
  ];

  const header = Buffer.alloc(128);
  header.writeUInt32BE(0x02200000, 8);        // version 2.2
  header.write('mntr', 12, 'latin1');         // classe : display
  header.write('RGB ', 16, 'latin1');
  header.write('XYZ ', 20, 'latin1');
  const now = new Date();
  header.writeUInt16BE(now.getUTCFullYear(), 24);
  header.writeUInt16BE(now.getUTCMonth() + 1, 26);
  header.writeUInt16BE(now.getUTCDate(), 28);
  header.write('acsp', 36, 'latin1');
  // Illuminant PCS D50 (valeurs normatives ICC)
  header.writeUInt32BE(0x0000f6d6, 68);
  header.writeUInt32BE(0x00010000, 72);
  header.writeUInt32BE(0x0000d32d, 76);

  const tagTableSize = 4 + tags.length * 12;
  let offset = 128 + tagTableSize;
  const table = Buffer.alloc(tagTableSize);
  table.writeUInt32BE(tags.length, 0);
  const bodies = [];
  tags.forEach(([sig, body], i) => {
    // alignement 4 octets exigé par la spec ICC
    const padded = body.length % 4 ? Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]) : body;
    table.write(sig, 4 + i * 12, 'latin1');
    table.writeUInt32BE(offset, 4 + i * 12 + 4);
    table.writeUInt32BE(body.length, 4 + i * 12 + 8);
    bodies.push(padded);
    offset += padded.length;
  });

  const profile = Buffer.concat([header, table, ...bodies]);
  profile.writeUInt32BE(profile.length, 0);
  return profile;
}
