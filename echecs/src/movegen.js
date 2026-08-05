// Génération des coups. On génère d'abord les coups pseudo-légaux, puis on
// filtre ceux qui laissent son propre roi en échec (make → test → unmake).
// La validation perft garantit l'exactitude, coups spéciaux compris.

import {
  EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  pieceType, pieceColor, makePiece, onBoard, sq0x88, fileOf, rankOf,
  KNIGHT_OFFSETS, KING_OFFSETS, BISHOP_DIRS, ROOK_DIRS, QUEEN_DIRS,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
} from './board.js';
import {
  encodeMove, makeMove, unmakeMove, moveTo, moveFrom,
  F_CAPTURE, F_EP, F_DOUBLE, F_CASTLE_K, F_CASTLE_Q, F_PROMO,
} from './moves.js';

const PROMO_TYPES = [QUEEN, ROOK, BISHOP, KNIGHT];

/** Coups pseudo-légaux (peuvent laisser le roi en échec). */
export function generatePseudoMoves(board, capturesOnly = false) {
  const s = board.squares;
  const color = board.turn;
  const them = color ^ 1;
  const moves = [];
  const forward = color === WHITE ? 16 : -16;
  const startRank = color === WHITE ? 1 : 6;
  const promoRank = color === WHITE ? 7 : 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; } // saute les colonnes hors-plateau
    const p = s[sq];
    if (p === 0 || pieceColor(p) !== color) continue;
    const type = pieceType(p);

    if (type === PAWN) {
      // Poussée simple
      const one = sq + forward;
      if (!capturesOnly && onBoard(one) && s[one] === EMPTY) {
        if (rankOf(one) === promoRank) for (const pr of PROMO_TYPES) moves.push(encodeMove(sq, one, F_PROMO, pr));
        else {
          moves.push(encodeMove(sq, one));
          // Poussée double
          if (rankOf(sq) === startRank) {
            const two = one + forward;
            if (s[two] === EMPTY) moves.push(encodeMove(sq, two, F_DOUBLE));
          }
        }
      }
      // Captures diagonales
      for (const diag of [forward + 1, forward - 1]) {
        const t = sq + diag;
        if (!onBoard(t)) continue;
        if (s[t] !== EMPTY && pieceColor(s[t]) === them) {
          if (rankOf(t) === promoRank) for (const pr of PROMO_TYPES) moves.push(encodeMove(sq, t, F_CAPTURE | F_PROMO, pr));
          else moves.push(encodeMove(sq, t, F_CAPTURE));
        } else if (t === board.ep) {
          moves.push(encodeMove(sq, t, F_CAPTURE | F_EP));
        }
      }
    } else if (type === KNIGHT) {
      for (const off of KNIGHT_OFFSETS) addStep(s, moves, sq, sq + off, them, color, capturesOnly);
    } else if (type === KING) {
      for (const off of KING_OFFSETS) addStep(s, moves, sq, sq + off, them, color, capturesOnly);
      if (!capturesOnly) addCastling(board, moves, color);
    } else {
      const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : QUEEN_DIRS;
      for (const dir of dirs) {
        let t = sq + dir;
        while (onBoard(t)) {
          const q = s[t];
          if (q === EMPTY) { if (!capturesOnly) moves.push(encodeMove(sq, t)); }
          else { if (pieceColor(q) === them) moves.push(encodeMove(sq, t, F_CAPTURE)); break; }
          t += dir;
        }
      }
    }
  }
  return moves;
}

function addStep(s, moves, from, to, them, color, capturesOnly) {
  if (!onBoard(to)) return;
  const q = s[to];
  if (q === EMPTY) { if (!capturesOnly) moves.push(encodeMove(from, to)); }
  else if (pieceColor(q) === them) moves.push(encodeMove(from, to, F_CAPTURE));
}

function addCastling(board, moves, color) {
  const s = board.squares;
  const rank = color === WHITE ? 0 : 7;
  const kSq = sq0x88(4, rank);
  if (board.kings[color] !== kSq) return;
  const them = color ^ 1;
  if (board.isAttacked(kSq, them)) return; // pas de roque en échec

  const canK = color === WHITE ? CASTLE_WK : CASTLE_BK;
  const canQ = color === WHITE ? CASTLE_WQ : CASTLE_BQ;

  // Petit roque : cases f,g vides ; roi ne traverse/n'arrive pas sur case attaquée.
  if (board.castling & canK) {
    const f = sq0x88(5, rank), g = sq0x88(6, rank);
    if (s[f] === EMPTY && s[g] === EMPTY && !board.isAttacked(f, them) && !board.isAttacked(g, them)) {
      moves.push(encodeMove(kSq, g, F_CASTLE_K));
    }
  }
  // Grand roque : cases b,c,d vides ; roi traverse d,c non attaquées (b peut l'être).
  if (board.castling & canQ) {
    const d = sq0x88(3, rank), c = sq0x88(2, rank), bsq = sq0x88(1, rank);
    if (s[d] === EMPTY && s[c] === EMPTY && s[bsq] === EMPTY && !board.isAttacked(d, them) && !board.isAttacked(c, them)) {
      moves.push(encodeMove(kSq, c, F_CASTLE_Q));
    }
  }
}

/** Coups strictement légaux. */
export function generateLegalMoves(board, capturesOnly = false) {
  const color = board.turn;
  const pseudo = generatePseudoMoves(board, capturesOnly);
  const legal = [];
  for (const m of pseudo) {
    const undo = makeMove(board, m);
    // Après le coup, le roi qui vient de jouer ne doit pas être en prise.
    if (!board.isAttacked(board.kings[color], color ^ 1)) legal.push(m);
    unmakeMove(board, undo);
  }
  return legal;
}

/** Vrai s'il existe au moins un coup légal (plus rapide que tout générer). */
export function hasLegalMove(board) {
  const color = board.turn;
  for (const m of generatePseudoMoves(board)) {
    const undo = makeMove(board, m);
    const ok = !board.isAttacked(board.kings[color], color ^ 1);
    unmakeMove(board, undo);
    if (ok) return true;
  }
  return false;
}
