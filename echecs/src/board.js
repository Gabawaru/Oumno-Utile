// Représentation du plateau en 0x88.
//
// Le plateau est un tableau de 128 cases (16×8). Une case est indexée par
// sq = rang*16 + colonne, avec le rang 0 = 1re rangée (côté blanc) et la
// colonne 0 = colonne « a ». L'astuce 0x88 : une case est HORS échiquier si
// (sq & 0x88) != 0, ce qui rend la détection de bord triviale et rapide.
//
// Pièces : entiers signés. Blanc positif, noir négatif.
//   Pion 1, Cavalier 2, Fou 3, Tour 4, Dame 5, Roi 6 ; 0 = case vide.

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;

export const pieceType = (p) => Math.abs(p);
export const pieceColor = (p) => (p > 0 ? WHITE : BLACK); // n'appeler que si p != 0
export const makePiece = (type, color) => (color === WHITE ? type : -type);

// Décalages 0x88 par direction.
const N = 16, S = -16, E = 1, W = -1, NE = 17, NW = 15, SE = -15, SW = -17;
export const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
export const KING_OFFSETS = [N, S, E, W, NE, NW, SE, SW];
export const BISHOP_DIRS = [NE, NW, SE, SW];
export const ROOK_DIRS = [N, S, E, W];
export const QUEEN_DIRS = [N, S, E, W, NE, NW, SE, SW];

// Droits de roque (masque de bits).
export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

// Indices de cases utiles.
export const sq0x88 = (file, rank) => rank * 16 + file;
export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 4;
export const onBoard = (sq) => (sq & 0x88) === 0;
export const squareName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export function parseSquare(name) {
  const f = 'abcdefgh'.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (f < 0 || r < 0 || r > 7) return -1;
  return sq0x88(f, r);
}

const PIECE_TO_CHAR = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const CHAR_TO_PIECE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

export function pieceToChar(p) {
  if (p === 0) return '.';
  const c = PIECE_TO_CHAR[Math.abs(p)];
  return p > 0 ? c : c.toLowerCase();
}

export class Board {
  constructor() {
    this.squares = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;          // case cible d'une prise en passant, ou -1
    this.halfmove = 0;     // règle des 50 coups (demi-coups depuis capture/pion)
    this.fullmove = 1;
    this.kings = [-1, -1]; // position des rois [blanc, noir], tenue à jour
    this.hash = 0n;        // hachage Zobrist (rempli par zobrist.js)
  }

  clone() {
    const b = new Board();
    b.squares.set(this.squares);
    b.turn = this.turn; b.castling = this.castling; b.ep = this.ep;
    b.halfmove = this.halfmove; b.fullmove = this.fullmove;
    b.kings = [...this.kings]; b.hash = this.hash;
    return b;
  }

  // ------------------------------------------------------------------- FEN
  static fromFen(fen) {
    const b = new Board();
    const parts = fen.trim().split(/\s+/);
    const [placement, turn, castling, ep, half, full] = parts;
    let rank = 7, file = 0;
    for (const ch of placement) {
      if (ch === '/') { rank--; file = 0; }
      else if (/\d/.test(ch)) file += Number(ch);
      else {
        const type = CHAR_TO_PIECE[ch.toLowerCase()];
        if (!type) throw new Error(`FEN invalide : pièce « ${ch} »`);
        const color = ch === ch.toUpperCase() ? WHITE : BLACK;
        const sq = sq0x88(file, rank);
        b.squares[sq] = makePiece(type, color);
        if (type === KING) b.kings[color] = sq;
        file++;
      }
    }
    b.turn = turn === 'b' ? BLACK : WHITE;
    b.castling = 0;
    if (castling && castling !== '-') {
      if (castling.includes('K')) b.castling |= CASTLE_WK;
      if (castling.includes('Q')) b.castling |= CASTLE_WQ;
      if (castling.includes('k')) b.castling |= CASTLE_BK;
      if (castling.includes('q')) b.castling |= CASTLE_BQ;
    }
    b.ep = ep && ep !== '-' ? parseSquare(ep) : -1;
    b.halfmove = half ? Number(half) : 0;
    b.fullmove = full ? Number(full) : 1;
    return b;
  }

  toFen() {
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.squares[sq0x88(file, rank)];
        if (p === 0) empty++;
        else { if (empty) { placement += empty; empty = 0; } placement += pieceToChar(p); }
      }
      if (empty) placement += empty;
      if (rank > 0) placement += '/';
    }
    let castling = '';
    if (this.castling & CASTLE_WK) castling += 'K';
    if (this.castling & CASTLE_WQ) castling += 'Q';
    if (this.castling & CASTLE_BK) castling += 'k';
    if (this.castling & CASTLE_BQ) castling += 'q';
    if (!castling) castling = '-';
    const ep = this.ep >= 0 ? squareName(this.ep) : '-';
    return `${placement} ${this.turn === WHITE ? 'w' : 'b'} ${castling} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  static startpos() {
    return Board.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  // --------------------------------------------------- détection d'attaque
  /**
   * La case `sq` est-elle attaquée par une pièce de couleur `byColor` ?
   * Sert pour la détection d'échec et la légalité du roque.
   */
  isAttacked(sq, byColor) {
    const s = this.squares;
    // Pions : un pion de byColor attaque en diagonale « vers l'avant ».
    // Un pion blanc en (sq-NE)/(sq-NW) attaque sq ; on regarde donc les cases
    // d'où un pion adverse pourrait frapper sq.
    if (byColor === WHITE) {
      if (onBoard(sq + SE) && s[sq + SE] === PAWN) return true;
      if (onBoard(sq + SW) && s[sq + SW] === PAWN) return true;
    } else {
      if (onBoard(sq + NE) && s[sq + NE] === -PAWN) return true;
      if (onBoard(sq + NW) && s[sq + NW] === -PAWN) return true;
    }
    // Cavaliers
    const knight = makePiece(KNIGHT, byColor);
    for (const off of KNIGHT_OFFSETS) {
      const t = sq + off;
      if (onBoard(t) && s[t] === knight) return true;
    }
    // Roi
    const king = makePiece(KING, byColor);
    for (const off of KING_OFFSETS) {
      const t = sq + off;
      if (onBoard(t) && s[t] === king) return true;
    }
    // Fous / dames (diagonales)
    for (const dir of BISHOP_DIRS) {
      let t = sq + dir;
      while (onBoard(t)) {
        const p = s[t];
        if (p !== 0) {
          if (pieceColor(p) === byColor) {
            const ty = pieceType(p);
            if (ty === BISHOP || ty === QUEEN) return true;
          }
          break;
        }
        t += dir;
      }
    }
    // Tours / dames (orthogonales)
    for (const dir of ROOK_DIRS) {
      let t = sq + dir;
      while (onBoard(t)) {
        const p = s[t];
        if (p !== 0) {
          if (pieceColor(p) === byColor) {
            const ty = pieceType(p);
            if (ty === ROOK || ty === QUEEN) return true;
          }
          break;
        }
        t += dir;
      }
    }
    return false;
  }

  /** Le roi de `color` est-il en échec ? */
  inCheck(color = this.turn) {
    return this.isAttacked(this.kings[color], color ^ 1);
  }

  pretty() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      out += (rank + 1) + ' ';
      for (let file = 0; file < 8; file++) out += pieceToChar(this.squares[sq0x88(file, rank)]) + ' ';
      out += '\n';
    }
    return out + '  a b c d e f g h\n';
  }
}
