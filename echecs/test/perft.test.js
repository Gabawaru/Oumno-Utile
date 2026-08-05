// Perft — l'étalon de correction de la génération de coups. Les nombres de
// nœuds sont ceux publiés par le Chess Programming Wiki pour ces positions
// (position de départ, « Kiwipete », positions 3 à 6). Une correspondance
// exacte valide roque, prise en passant, clouages, promotions, etc.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { perft } from '../src/perft.js';

const CASES = [
  ['position de départ', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [1, 20, 400, 8902, 197281, 4865609]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [1, 48, 2039, 97862, 4085603]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [1, 14, 191, 2812, 43238, 674624]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [1, 6, 264, 9467, 422333]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [1, 44, 1486, 62379]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [1, 46, 2079, 89890]],
];

for (const [name, fen, expected] of CASES) {
  test(`perft — ${name}`, () => {
    for (let d = 1; d < expected.length; d++) {
      const b = Board.fromFen(fen);
      assert.equal(perft(b, d), expected[d], `${name} perft(${d})`);
    }
  });
}

test('FEN aller-retour', () => {
  for (const [, fen] of CASES) {
    assert.equal(Board.fromFen(fen).toFen(), fen);
  }
});
