import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { initHash } from '../src/zobrist.js';
import { generateLegalMoves } from '../src/movegen.js';
import { makeMove } from '../src/moves.js';
import { moveToSan, sanToMove } from '../src/san.js';

test('SAN aller-retour sur des parties aléatoires', () => {
  for (let game = 0; game < 60; game++) {
    const b = Board.startpos(); initHash(b);
    for (let ply = 0; ply < 40; ply++) {
      const legal = generateLegalMoves(b);
      if (!legal.length) break;
      const m = legal[(game * 5 + ply * 11) % legal.length];
      const san = moveToSan(b, m, legal);
      assert.equal(sanToMove(b, san), m, `SAN « ${san} »`);
      makeMove(b, m);
    }
  }
});

test('notations spéciales', () => {
  // Petit roque
  let b = Board.fromFen('rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  initHash(b);
  assert.equal(moveToSan(b, sanToMove(b, 'O-O')), 'O-O');
  // Promotion (roi noir en h7 : la promotion en a8 n'est pas un échec).
  b = Board.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1'); initHash(b);
  const promo = generateLegalMoves(b).map((m) => moveToSan(b, m));
  assert.ok(promo.includes('a8=Q'), promo.join(' '));
  assert.ok(promo.includes('a8=N'), promo.join(' '));
});

test('désambiguïsation', () => {
  // Deux cavaliers peuvent aller en d2 (b1 et f3) => Nbd2 / Nfd2
  const b = Board.fromFen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
  initHash(b);
  const sans = generateLegalMoves(b).map((m) => moveToSan(b, m));
  assert.ok(sans.includes('Nbd2'), sans.join(' '));
  assert.ok(sans.includes('Nfd2'), sans.join(' '));
});

test('échec et mat noté #', () => {
  // Position juste avant le mat du berger (fou en c4 qui défend f7).
  const b = Board.fromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  initHash(b);
  assert.equal(moveToSan(b, sanToMove(b, 'Qxf7#')), 'Qxf7#');
});
