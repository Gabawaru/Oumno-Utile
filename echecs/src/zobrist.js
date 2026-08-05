// Hachage de Zobrist — clé 64 bits d'une position, maintenue de façon
// incrémentale dans make/unmake (voir moves.js). Sert de clé pour la table de
// transposition et pour la détection de répétition.
//
// Générateur pseudo-aléatoire déterministe (splitmix64) : les clés sont donc
// stables d'une exécution à l'autre.

import { sq0x88, pieceType, pieceColor, WHITE } from './board.js';

const MASK64 = (1n << 64n) - 1n;
function splitmix64(seed) {
  let x = seed & MASK64;
  return () => {
    x = (x + 0x9e3779b97f4a7c15n) & MASK64;
    let z = x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
}
const rng = splitmix64(0x1234567890abcdefn);

// PIECE[pieceIndex 0..11][case 0..127]
export const PIECE = Array.from({ length: 12 }, () => {
  const a = new Array(128);
  for (let i = 0; i < 128; i++) a[i] = rng();
  return a;
});
export const SIDE = rng();               // XOR quand c'est aux Noirs
export const CASTLE = Array.from({ length: 16 }, () => rng()); // indexé par masque de roque
export const EP_FILE = Array.from({ length: 8 }, () => rng()); // par colonne de la case e.p.

// Index de pièce 0..11 à partir de la valeur signée (±1..±6).
export function pieceIndex(p) {
  return (pieceType(p) - 1) * 2 + (p > 0 ? 0 : 1);
}

/** Recalcule intégralement la clé d'une position (référence de vérification). */
export function computeHash(board) {
  let h = 0n;
  const s = board.squares;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = s[sq];
    if (p !== 0) h ^= PIECE[pieceIndex(p)][sq];
  }
  h ^= CASTLE[board.castling];
  if (board.ep >= 0) h ^= EP_FILE[board.ep & 7];
  if (board.turn !== WHITE) h ^= SIDE;
  return h;
}

/** Initialise board.hash. À appeler après avoir chargé une position. */
export function initHash(board) {
  board.hash = computeHash(board);
  return board.hash;
}
