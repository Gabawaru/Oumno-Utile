// Notation algébrique standard (SAN) : génération et lecture.
// La génération s'appuie sur la liste des coups légaux pour la désambiguïsation
// et pour le suffixe échec (+) / mat (#).

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  pieceType, fileOf, rankOf, squareName,
} from './board.js';
import { generateLegalMoves } from './movegen.js';
import {
  makeMove, unmakeMove, moveFrom, moveTo, movePromo, isCapture,
  F_CASTLE_K, F_CASTLE_Q, F_PROMO, F_EP,
} from './moves.js';

const LETTER = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
const PROMO_LETTER = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q' };

/** SAN d'un coup légal `move` dans la position `board` (avant le coup). */
export function moveToSan(board, move, legalMoves = null) {
  if (move & F_CASTLE_K) return withCheck(board, move, 'O-O');
  if (move & F_CASTLE_Q) return withCheck(board, move, 'O-O-O');

  const from = moveFrom(move), to = moveTo(move);
  const piece = board.squares[from];
  const type = pieceType(piece);
  const capture = isCapture(move);
  let san = '';

  if (type === PAWN) {
    if (capture) san += 'abcdefgh'[fileOf(from)] + 'x';
    san += squareName(to);
    if (move & F_PROMO) san += '=' + PROMO_LETTER[movePromo(move)];
  } else {
    san += LETTER[type];
    san += disambiguation(board, move, type, from, to, legalMoves);
    if (capture) san += 'x';
    san += squareName(to);
  }
  return withCheck(board, move, san);
}

function disambiguation(board, move, type, from, to, legalMoves) {
  const moves = legalMoves || generateLegalMoves(board);
  const rivals = moves.filter((m) =>
    m !== move && moveTo(m) === to && pieceType(board.squares[moveFrom(m)]) === type);
  if (!rivals.length) return '';
  const sameFile = rivals.some((m) => fileOf(moveFrom(m)) === fileOf(from));
  const sameRank = rivals.some((m) => rankOf(moveFrom(m)) === rankOf(from));
  if (!sameFile) return 'abcdefgh'[fileOf(from)];
  if (!sameRank) return String(rankOf(from) + 1);
  return squareName(from);
}

function withCheck(board, move, san) {
  const undo = makeMove(board, move);
  let suffix = '';
  if (board.inCheck()) suffix = generateLegalMoves(board).length === 0 ? '#' : '+';
  unmakeMove(board, undo);
  return san + suffix;
}

/**
 * Lit un coup en SAN (ou en notation UCI type « e2e4 ») et retourne le coup
 * légal correspondant, ou 0 si aucun ne correspond.
 */
export function sanToMove(board, text) {
  const moves = generateLegalMoves(board);
  const clean = String(text).replace(/[+#!?]/g, '').replace(/0/g, 'O').trim();

  // Notation UCI : e2e4, e7e8q
  if (/^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(clean)) {
    for (const m of moves) {
      const uci = squareName(moveFrom(m)) + squareName(moveTo(m)) +
        (movePromo(m) ? 'nbrq'[movePromo(m) - 2] : '');
      if (uci === clean.toLowerCase()) return m;
    }
    return 0;
  }
  // SAN : on compare au SAN nettoyé de chaque coup légal.
  for (const m of moves) {
    if (moveToSan(board, m, moves).replace(/[+#]/g, '') === clean.replace(/[+#]/g, '')) return m;
  }
  return 0;
}
