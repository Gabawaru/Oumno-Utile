// Web Worker : exécute la recherche du moteur hors du fil principal, pour ne pas
// figer l'interface pendant la réflexion. Importe exactement les mêmes modules
// que ceux testés côté Node — le moteur est intégralement portable.

import { Board } from '/src/board.js';
import { initHash } from '/src/zobrist.js';
import { Engine } from '/src/search.js';
import { moveToSan } from '/src/san.js';
import { moveToUci } from '/src/moves.js';

const engine = new Engine();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'go') return;
  const board = Board.fromFen(msg.fen);
  initHash(board);
  const res = engine.search(board, { depth: msg.depth ?? 4, timeMs: msg.timeMs ?? 3000 });
  const san = res.move ? moveToSan(board, res.move) : null;
  self.postMessage({
    type: 'bestmove',
    uci: res.move ? moveToUci(res.move) : null,
    san,
    score: res.score,
    mate: res.mate,
    depth: res.depth,
    nodes: res.nodes,
    timeMs: res.timeMs,
  });
};
