import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generateLegalMoves } from '../src/movegen.js';
import { makeMove, unmakeMove } from '../src/moves.js';
import { initHash, computeHash } from '../src/zobrist.js';
import { sanToMove } from '../src/san.js';

test('le hachage incrémental correspond au recalcul complet', () => {
  let checked = 0;
  for (let game = 0; game < 120; game++) {
    const b = Board.startpos();
    initHash(b);
    for (let ply = 0; ply < 40; ply++) {
      assert.equal(b.hash, computeHash(b), `partie ${game} coup ${ply}`);
      checked++;
      const moves = generateLegalMoves(b);
      if (!moves.length) break;
      makeMove(b, moves[(game * 7 + ply * 13) % moves.length]);
    }
  }
  assert.ok(checked > 3000);
});

test('unmake restaure exactement le hachage', () => {
  const b = Board.startpos();
  initHash(b);
  const h0 = b.hash;
  const undos = [];
  for (let i = 0; i < 6; i++) undos.push(makeMove(b, generateLegalMoves(b)[0]));
  while (undos.length) unmakeMove(b, undos.pop());
  assert.equal(b.hash, h0);
});

test('deux chemins vers la même position donnent le même hachage', () => {
  // 1. Nf3 Nf6 2. Ng1 Ng8  ⇒ retour à la position de départ (même clé).
  const start = Board.startpos(); initHash(start);
  const b = Board.startpos(); initHash(b);
  for (const mv of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) makeMove(b, sanToMove(b, mv));
  assert.equal(b.hash, start.hash);
});
