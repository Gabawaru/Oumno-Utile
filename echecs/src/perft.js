// Perft — dénombrement des nœuds de l'arbre de coups légaux à une profondeur
// donnée. C'est l'étalon de correction d'un générateur de coups : les nombres
// exacts pour des positions de référence sont publiés et connus.

import { generateLegalMoves } from './movegen.js';
import { makeMove, unmakeMove, moveToUci } from './moves.js';

export function perft(board, depth) {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(board);
  if (depth === 1) return moves.length; // petite optimisation
  let nodes = 0;
  for (const m of moves) {
    const undo = makeMove(board, m);
    nodes += perft(board, depth - 1);
    unmakeMove(board, undo);
  }
  return nodes;
}

/** perft avec détail par coup racine (utile pour localiser un écart). */
export function perftDivide(board, depth) {
  const out = {};
  for (const m of generateLegalMoves(board)) {
    const undo = makeMove(board, m);
    out[moveToUci(m)] = perft(board, depth - 1);
    unmakeMove(board, undo);
  }
  return out;
}
