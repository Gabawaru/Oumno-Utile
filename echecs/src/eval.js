// Évaluation statique d'une position, en centipions, du point de vue du camp
// au trait (convention négamax : score positif = favorable au joueur qui doit
// jouer). Matériel + tables pièce-case + bonus de la paire de fous.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  pieceType, pieceColor, fileOf, rankOf,
} from './board.js';

export const PIECE_VALUE = { 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 0 };

// Tables pièce-case (point de vue des Blancs, index = rang*8 + colonne, rang 0
// = 1re rangée). Valeurs classiques de type « simplified evaluation ».
const PST = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -10, 5, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  [KING]: [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

// Table du roi en finale (il doit se centraliser).
const KING_ENDGAME = [
  -50, -30, -30, -30, -30, -30, -30, -50,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -50, -40, -30, -20, -20, -30, -40, -50,
];

const idx64 = (sq) => rankOf(sq) * 8 + fileOf(sq);
const mirror = (i) => i ^ 56; // miroir vertical (point de vue noir)

/** Score en centipions du point de vue du camp au trait. */
export function evaluate(board) {
  const s = board.squares;
  let score = 0;          // du point de vue des Blancs
  let bishops = [0, 0];
  let nonPawnMaterial = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = s[sq];
    if (p === 0) continue;
    const type = pieceType(p);
    const color = pieceColor(p);
    if (type === BISHOP) bishops[color]++;
    if (type !== PAWN && type !== KING) nonPawnMaterial += PIECE_VALUE[type];
  }
  const endgame = nonPawnMaterial <= 1300; // ~ deux tours ou moins de chaque côté

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = s[sq];
    if (p === 0) continue;
    const type = pieceType(p);
    const color = pieceColor(p);
    const i = color === WHITE ? idx64(sq) : mirror(idx64(sq));
    let v = PIECE_VALUE[type];
    v += type === KING && endgame ? KING_ENDGAME[i] : PST[type][i];
    score += color === WHITE ? v : -v;
  }

  if (bishops[WHITE] >= 2) score += 30;
  if (bishops[BLACK] >= 2) score -= 30;

  // Retour du point de vue du camp au trait.
  return board.turn === WHITE ? score : -score;
}
