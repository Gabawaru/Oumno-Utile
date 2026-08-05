// Encodage compact des coups (entier 32 bits) + application/annulation.
//
// bits 0-7   : case de départ (0x88)
// bits 8-15  : case d'arrivée
// bits 16-18 : type de pièce de promotion (2=C,3=F,4=T,5=D), 0 sinon
// bits 19-24 : drapeaux

import {
  Board, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  pieceType, pieceColor, makePiece, sq0x88, fileOf, rankOf,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
} from './board.js';
import { PIECE, SIDE, CASTLE as ZCASTLE, EP_FILE, pieceIndex } from './zobrist.js';

export const F_CAPTURE = 1 << 19;
export const F_EP = 1 << 20;
export const F_DOUBLE = 1 << 21;
export const F_CASTLE_K = 1 << 22;
export const F_CASTLE_Q = 1 << 23;
export const F_PROMO = 1 << 24;

export const encodeMove = (from, to, flags = 0, promo = 0) =>
  (from & 0xff) | ((to & 0xff) << 8) | ((promo & 7) << 16) | flags;

export const moveFrom = (m) => m & 0xff;
export const moveTo = (m) => (m >> 8) & 0xff;
export const movePromo = (m) => (m >> 16) & 7;
export const moveFlags = (m) => m & 0x1ff80000;
export const isCapture = (m) => (m & F_CAPTURE) !== 0;

// Masque : quand une case de départ ou d'arrivée est touchée, quels droits de
// roque disparaissent. (Roi bouge => les deux ; tour bouge/capturée => le sien.)
const CASTLE_MASK = new Int8Array(128).fill(~0);
CASTLE_MASK[sq0x88(4, 0)] = ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[sq0x88(0, 0)] = ~CASTLE_WQ;               // a1
CASTLE_MASK[sq0x88(7, 0)] = ~CASTLE_WK;               // h1
CASTLE_MASK[sq0x88(4, 7)] = ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[sq0x88(0, 7)] = ~CASTLE_BQ;               // a8
CASTLE_MASK[sq0x88(7, 7)] = ~CASTLE_BK;               // h8

/**
 * Applique un coup au plateau (mutation). Retourne un objet `undo` à repasser
 * à unmakeMove pour restaurer exactement l'état antérieur.
 */
export function makeMove(board, move) {
  const s = board.squares;
  const from = moveFrom(move), to = moveTo(move);
  const flags = move;
  const piece = s[from];
  const color = board.turn;
  const captured = s[to];
  const undo = {
    move,
    captured,
    castling: board.castling,
    ep: board.ep,
    halfmove: board.halfmove,
    fullmove: board.fullmove,
    kingFrom: -1,
    hash: board.hash,
  };

  let h = board.hash;
  // La pièce quitte `from` ; l'éventuelle pièce capturée quitte `to`.
  h ^= PIECE[pieceIndex(piece)][from];
  if (captured !== EMPTY) h ^= PIECE[pieceIndex(captured)][to];

  // Déplacement de base
  s[to] = piece;
  s[from] = EMPTY;

  // Compteur des 50 coups : remis à zéro sur poussée de pion ou capture.
  if (pieceType(piece) === PAWN || (flags & F_CAPTURE)) board.halfmove = 0;
  else board.halfmove++;

  // Prise en passant : le pion capturé n'est pas sur la case d'arrivée.
  if (flags & F_EP) {
    const capSq = to + (color === WHITE ? -16 : 16);
    undo.epCaptureSq = capSq;
    undo.epCaptured = s[capSq];
    h ^= PIECE[pieceIndex(s[capSq])][capSq];
    s[capSq] = EMPTY;
  }

  // La pièce arrive sur `to` (promue le cas échéant).
  const placed = (flags & F_PROMO) ? makePiece(movePromo(move), color) : piece;
  if (flags & F_PROMO) s[to] = placed;
  h ^= PIECE[pieceIndex(placed)][to];

  // Roque : déplacer aussi la tour (et mettre à jour le hachage).
  if (flags & F_CASTLE_K) {
    const rank = color === WHITE ? 0 : 7;
    const rFrom = sq0x88(7, rank), rTo = sq0x88(5, rank);
    s[rTo] = s[rFrom]; s[rFrom] = EMPTY;
    h ^= PIECE[pieceIndex(s[rTo])][rFrom] ^ PIECE[pieceIndex(s[rTo])][rTo];
  } else if (flags & F_CASTLE_Q) {
    const rank = color === WHITE ? 0 : 7;
    const rFrom = sq0x88(0, rank), rTo = sq0x88(3, rank);
    s[rTo] = s[rFrom]; s[rFrom] = EMPTY;
    h ^= PIECE[pieceIndex(s[rTo])][rFrom] ^ PIECE[pieceIndex(s[rTo])][rTo];
  }

  // Suivi de la position du roi.
  if (pieceType(piece) === KING) {
    undo.kingFrom = board.kings[color];
    board.kings[color] = to;
  }

  // Hachage : case e.p. (retrait de l'ancienne, ajout de la nouvelle).
  if (undo.ep >= 0) h ^= EP_FILE[undo.ep & 7];
  board.ep = (flags & F_DOUBLE) ? from + (color === WHITE ? 16 : -16) : -1;
  if (board.ep >= 0) h ^= EP_FILE[board.ep & 7];

  // Droits de roque (hachage : ancien masque retiré, nouveau ajouté).
  const newCastling = board.castling & CASTLE_MASK[from] & CASTLE_MASK[to];
  if (newCastling !== board.castling) h ^= ZCASTLE[board.castling] ^ ZCASTLE[newCastling];
  board.castling = newCastling;

  h ^= SIDE; // le trait change
  board.hash = h;

  if (color === BLACK) board.fullmove++;
  board.turn = color ^ 1;
  return undo;
}

/** Annule makeMove à l'aide de l'objet `undo`. */
export function unmakeMove(board, undo) {
  const s = board.squares;
  const move = undo.move;
  const from = moveFrom(move), to = moveTo(move);
  const color = board.turn ^ 1; // le camp qui avait joué

  board.turn = color;
  board.castling = undo.castling;
  board.ep = undo.ep;
  board.halfmove = undo.halfmove;
  board.fullmove = undo.fullmove;

  // Remettre la pièce d'origine (défait aussi la promotion).
  let piece = s[to];
  if (move & F_PROMO) piece = makePiece(PAWN, color);
  s[from] = piece;
  s[to] = undo.captured;

  if (move & F_EP) {
    s[undo.epCaptureSq] = undo.epCaptured;
    s[to] = EMPTY; // la case d'arrivée était vide (capture décalée)
  }

  if (move & F_CASTLE_K) {
    const rank = color === WHITE ? 0 : 7;
    s[sq0x88(7, rank)] = s[sq0x88(5, rank)];
    s[sq0x88(5, rank)] = EMPTY;
  } else if (move & F_CASTLE_Q) {
    const rank = color === WHITE ? 0 : 7;
    s[sq0x88(0, rank)] = s[sq0x88(3, rank)];
    s[sq0x88(3, rank)] = EMPTY;
  }

  if (undo.kingFrom >= 0) board.kings[color] = undo.kingFrom;
  board.hash = undo.hash;
}

export function moveToUci(m) {
  const from = moveFrom(m), to = moveTo(m);
  const name = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
  const promo = movePromo(m) ? 'nbrq'[movePromo(m) - 2] : '';
  return name(from) + name(to) + promo;
}
