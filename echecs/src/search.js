// Recherche : négamax avec élagage alpha-bêta, approfondissement itératif,
// recherche de quiescence, table de transposition (clé Zobrist) et
// ordonnancement des coups (coup de la table, MVV-LVA, tueurs, historique).

import { WHITE, pieceType } from './board.js';
import { generateLegalMoves, generatePseudoMoves } from './movegen.js';
import {
  makeMove, unmakeMove, moveFrom, moveTo, movePromo, isCapture, F_EP,
} from './moves.js';
import { evaluate, PIECE_VALUE } from './eval.js';

export const MATE = 30000;
const MATE_THRESHOLD = MATE - 1000;
const INF = 40000;

// Bornes de la table de transposition.
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

export class Engine {
  constructor() {
    this.tt = new Map();          // hash(BigInt) -> {depth, score, flag, move}
    this.killers = [];            // [ply] -> [m1, m2]
    this.history = new Int32Array(128 * 128);
    this.nodes = 0;
    this.stopAt = Infinity;
    this.stopped = false;
  }

  /**
   * Cherche le meilleur coup.
   * @param {Board} board
   * @param {{depth?:number, timeMs?:number}} opts
   * @returns {{move, score, depth, nodes, pv, mate:number|null, timeMs}}
   */
  search(board, { depth = 4, timeMs = Infinity } = {}) {
    this.nodes = 0;
    this.stopped = false;
    this.killers = Array.from({ length: 128 }, () => [0, 0]);
    this.history.fill(0);
    const start = Date.now();
    this.stopAt = timeMs === Infinity ? Infinity : start + timeMs;

    let best = { move: 0, score: 0, pv: [] };
    const rootMoves = generateLegalMoves(board);
    if (!rootMoves.length) {
      return { move: 0, score: board.inCheck() ? -MATE : 0, depth: 0, nodes: 0, pv: [], mate: null, timeMs: 0 };
    }

    // Approfondissement itératif : chaque profondeur réutilise la TT et améliore
    // l'ordonnancement, et permet d'arrêter net quand le temps est écoulé.
    for (let d = 1; d <= depth; d++) {
      const res = this.#searchRoot(board, d, rootMoves);
      if (this.stopped) break;
      best = res;
      // Mat trouvé : inutile d'aller plus profond.
      if (Math.abs(best.score) > MATE_THRESHOLD) break;
    }

    let mate = null;
    if (Math.abs(best.score) > MATE_THRESHOLD) {
      const plies = MATE - Math.abs(best.score);
      mate = (best.score > 0 ? 1 : -1) * Math.ceil(plies / 2);
    }
    return { ...best, depth, nodes: this.nodes, mate, timeMs: Date.now() - start };
  }

  #searchRoot(board, depth, rootMoves) {
    let alpha = -INF, beta = INF;
    let bestMove = rootMoves[0], bestScore = -INF, bestPv = [];
    const ordered = this.#orderMoves(board, rootMoves, 0, this.#ttMove(board));
    for (const m of ordered) {
      const undo = makeMove(board, m);
      const line = [];
      const score = -this.#negamax(board, depth - 1, -beta, -alpha, 1, line);
      unmakeMove(board, undo);
      if (this.stopped) break;
      if (score > bestScore) {
        bestScore = score; bestMove = m; bestPv = [m, ...line];
        if (score > alpha) alpha = score;
      }
    }
    this.tt.set(board.hash, { depth, score: bestScore, flag: TT_EXACT, move: bestMove });
    return { move: bestMove, score: bestScore, depth, pv: bestPv };
  }

  #negamax(board, depth, alpha, beta, ply, pv) {
    if ((this.nodes & 2047) === 0 && Date.now() >= this.stopAt) { this.stopped = true; return 0; }
    this.nodes++;

    const alphaOrig = alpha;
    const entry = this.tt.get(board.hash);
    if (entry && entry.depth >= depth) {
      let s = entry.score;
      if (s > MATE_THRESHOLD) s -= ply; else if (s < -MATE_THRESHOLD) s += ply; // dé-ajuste le mat
      if (entry.flag === TT_EXACT) { pv.length = 0; return s; }
      if (entry.flag === TT_LOWER && s > alpha) alpha = s;
      else if (entry.flag === TT_UPPER && s < beta) beta = s;
      if (alpha >= beta) return s;
    }

    if (depth <= 0) return this.#quiescence(board, alpha, beta, ply);

    const moves = generatePseudoMoves(board);
    const ordered = this.#orderMoves(board, moves, ply, entry?.move || 0);
    const color = board.turn;
    let bestScore = -INF, bestMove = 0, legal = 0;

    for (const m of ordered) {
      const undo = makeMove(board, m);
      if (board.isAttacked(board.kings[color], color ^ 1)) { unmakeMove(board, undo); continue; }
      legal++;
      const line = [];
      const score = -this.#negamax(board, depth - 1, -beta, -alpha, ply + 1, line);
      unmakeMove(board, undo);
      if (this.stopped) return 0;

      if (score > bestScore) { bestScore = score; bestMove = m; }
      if (score > alpha) {
        alpha = score;
        pv.length = 0; pv.push(m, ...line);
      }
      if (alpha >= beta) {
        // Coup « tueur » et historique pour améliorer l'ordonnancement.
        if (!isCapture(m)) {
          const k = this.killers[ply];
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          this.history[moveFrom(m) * 128 + moveTo(m)] += depth * depth;
        }
        break;
      }
    }

    if (legal === 0) {
      // Aucun coup légal : mat (échec) ou pat (score nul).
      return board.inCheck(color) ? -MATE + ply : 0;
    }

    // Enregistrement en table de transposition.
    let store = bestScore;
    if (store > MATE_THRESHOLD) store += ply; else if (store < -MATE_THRESHOLD) store -= ply;
    const flag = bestScore <= alphaOrig ? TT_UPPER : bestScore >= beta ? TT_LOWER : TT_EXACT;
    this.tt.set(board.hash, { depth, score: store, flag, move: bestMove });
    return bestScore;
  }

  // Recherche de quiescence : ne prolonge que les captures pour éviter l'effet
  // d'horizon (ne pas s'arrêter au milieu d'un échange).
  #quiescence(board, alpha, beta, ply) {
    if ((this.nodes & 2047) === 0 && Date.now() >= this.stopAt) { this.stopped = true; return 0; }
    this.nodes++;
    const standPat = evaluate(board);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const color = board.turn;
    const caps = generatePseudoMoves(board, true);
    for (const m of this.#orderCaptures(board, caps)) {
      const undo = makeMove(board, m);
      if (board.isAttacked(board.kings[color], color ^ 1)) { unmakeMove(board, undo); continue; }
      const score = -this.#quiescence(board, -beta, -alpha, ply + 1);
      unmakeMove(board, undo);
      if (this.stopped) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  #ttMove(board) {
    return this.tt.get(board.hash)?.move || 0;
  }

  // Ordonnancement : coup de la TT, puis captures (MVV-LVA), puis tueurs, puis
  // historique. Un bon ordre maximise les coupures alpha-bêta.
  #orderMoves(board, moves, ply, ttMove) {
    const s = board.squares;
    const killers = this.killers[ply] || [0, 0];
    const scored = moves.map((m) => {
      let sc = 0;
      if (m === ttMove) sc = 1_000_000;
      else if (isCapture(m)) {
        const victim = (m & F_EP) ? PIECE_VALUE[1] : PIECE_VALUE[pieceType(s[moveTo(m)])] || 0;
        const attacker = PIECE_VALUE[pieceType(s[moveFrom(m)])] || 0;
        sc = 100_000 + victim * 10 - attacker;
      } else if (m === killers[0]) sc = 90_000;
      else if (m === killers[1]) sc = 80_000;
      else sc = this.history[moveFrom(m) * 128 + moveTo(m)];
      return { m, sc };
    });
    scored.sort((a, b) => b.sc - a.sc);
    return scored.map((x) => x.m);
  }

  #orderCaptures(board, caps) {
    const s = board.squares;
    return caps.map((m) => {
      const victim = (m & F_EP) ? PIECE_VALUE[1] : PIECE_VALUE[pieceType(s[moveTo(m)])] || 0;
      const attacker = PIECE_VALUE[pieceType(s[moveFrom(m)])] || 0;
      return { m, sc: victim * 10 - attacker };
    }).sort((a, b) => b.sc - a.sc).map((x) => x.m);
  }
}

/** API simple : meilleur coup pour une position. */
export function bestMove(board, opts) {
  return new Engine().search(board, opts);
}
