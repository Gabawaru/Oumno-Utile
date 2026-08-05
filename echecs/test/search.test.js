import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { initHash } from '../src/zobrist.js';
import { Engine, MATE } from '../src/search.js';
import { moveToSan } from '../src/san.js';

function search(fen, depth) {
  const b = Board.fromFen(fen); initHash(b);
  const r = new Engine().search(b, { depth, timeMs: 3000 });
  return { ...r, san: r.move ? moveToSan(b, r.move) : null };
}

test('trouve un mat en 1', () => {
  const a = search('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 3); // Ra8#
  assert.equal(a.mate, 1);
  assert.equal(a.san, 'Ra8#');

  const b = search('6k1/8/6K1/8/8/8/8/7Q w - - 0 1', 3); // mat en 1 (Qa8#/Qh8#)
  assert.equal(b.mate, 1);
  assert.match(b.san, /#/);
});

test('capture une pièce en prise (dame gratuite)', () => {
  const r = search('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 4); // exd5 gagne la dame
  assert.equal(r.san, 'exd5');
});

test('gagne une tour en prise directe', () => {
  // Les tours se font face sur la colonne d : Rxd5 gagne une tour entière.
  const r = search('4k3/8/8/3r4/8/8/8/3RK3 w - - 0 1', 4);
  assert.equal(r.san, 'Rxd5');
  assert.ok(r.score > 300, `score attendu > 300, obtenu ${r.score}`);
});

test('le mat rapporte un score proche de MATE et diminue avec la distance', () => {
  const m1 = search('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 3);
  assert.ok(m1.score > MATE - 10);
});

test('position sans coup légal : mat détecté à la racine', () => {
  // Mat du fou de l’écolier déjà consommé (les Noirs sont matés, trait aux Noirs).
  const b = Board.fromFen('r1bqkbnr/pppp1Qpp/2n5/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');
  initHash(b);
  const r = new Engine().search(b, { depth: 2 });
  assert.equal(r.move, 0);
  assert.equal(r.score, -MATE);
});
