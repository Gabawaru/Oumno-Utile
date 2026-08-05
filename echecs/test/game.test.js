import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';

test('mat du berger => échec et mat', () => {
  const g = new Game();
  for (const mv of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) {
    assert.ok(g.move(mv), `coup ${mv}`);
  }
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.result, '1-0');
  assert.equal(r.reason, 'échec et mat');
  assert.equal(g.history.at(-1).san, 'Qxf7#');
});

test('pat => nulle', () => {
  const g = new Game('5k2/5P2/5K2/8/8/8/8/8 b - - 0 1');
  const r = g.result();
  assert.equal(r.over, true);
  assert.equal(r.reason, 'pat');
  assert.equal(r.result, '1/2-1/2');
});

test('matériel insuffisant', () => {
  assert.equal(new Game('4k3/8/8/8/8/8/8/4K3 w - - 0 1').result().reason, 'matériel insuffisant'); // R vs R
  assert.equal(new Game('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1').result().reason, 'matériel insuffisant'); // R+F vs R
  assert.equal(new Game('4k3/8/8/8/8/8/8/4KN2 w - - 0 1').result().reason, 'matériel insuffisant'); // R+C vs R
  // K+2C : pas de nulle automatique
  assert.equal(new Game('4k3/8/8/8/8/8/8/1N2K1N1 w - - 0 1').result().over, false);
  // Fous de couleurs opposées => pas insuffisant (mat possible)
  assert.equal(new Game('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1').result().over, false);
});

test('règle des 50 coups', () => {
  const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 100 60');
  assert.equal(g.result().reason, 'règle des 50 coups');
});

test('répétition triple', () => {
  const g = new Game();
  // Va-et-vient des cavaliers : la position de départ réapparaît.
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  for (let i = 0; i < 2; i++) for (const mv of cycle) g.move(mv);
  // Position de départ vue 3 fois (initiale + 2 retours).
  assert.ok(g.repetitionCount() >= 3);
  assert.equal(g.result().reason, 'répétition triple');
});

test('export PGN', () => {
  const g = new Game();
  for (const mv of ['e4', 'e5', 'Nf3', 'Nc6']) g.move(mv);
  const pgn = g.toPgn();
  assert.match(pgn, /\[Result "\*"\]/);
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6/);
});

test('undo restaure la position', () => {
  const g = new Game();
  g.move('e4'); g.move('c5');
  const fen = g.fen();
  g.move('Nf3');
  g.undo();
  assert.equal(g.fen(), fen);
  assert.equal(g.history.length, 2);
});
