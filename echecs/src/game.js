// État de partie au-dessus du moteur : historique, détection des fins de partie
// (mat, pat, nulles : 50 coups, répétition triple, matériel insuffisant) et
// export PGN. C'est l'objet manipulé par l'interface et l'API.

import { Board, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, pieceType, pieceColor, fileOf, rankOf } from './board.js';
import { generateLegalMoves } from './movegen.js';
import { makeMove, moveToUci } from './moves.js';
import { initHash } from './zobrist.js';
import { moveToSan, sanToMove } from './san.js';

export class Game {
  constructor(fen) {
    this.board = fen ? Board.fromFen(fen) : Board.startpos();
    initHash(this.board);
    this.startFen = this.board.toFen();
    this.history = [];                 // [{san, uci, fenAfter, move}]
    this.hashes = [this.board.hash];   // pour la répétition (position incluse)
  }

  legalMoves() { return generateLegalMoves(this.board); }

  legalMovesFrom(sq) {
    return this.legalMoves().filter((m) => (m & 0xff) === sq);
  }

  /** Joue un coup (SAN, UCI, ou entier codé). Retourne l'entrée d'historique ou null. */
  move(input) {
    const mv = typeof input === 'number' ? input : sanToMove(this.board, input);
    if (!mv) return null;
    const legal = this.legalMoves();
    if (!legal.includes(mv)) return null;
    const san = moveToSan(this.board, mv, legal);
    makeMove(this.board, mv);
    const entry = { san, uci: moveToUci(mv), move: mv, fenAfter: this.board.toFen() };
    this.history.push(entry);
    this.hashes.push(this.board.hash);
    return entry;
  }

  turn() { return this.board.turn; }
  inCheck() { return this.board.inCheck(); }
  fen() { return this.board.toFen(); }

  /** Nombre d'occurrences de la position courante dans l'historique. */
  repetitionCount() {
    const h = this.board.hash;
    return this.hashes.filter((x) => x === h).length;
  }

  /** Matériel manifestement insuffisant pour mater (cas usuels). */
  insufficientMaterial() {
    const pieces = [];
    const s = this.board.squares;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = s[sq];
      if (p !== 0 && pieceType(p) !== KING) pieces.push({ type: pieceType(p), color: pieceColor(p), sq });
    }
    if (pieces.length === 0) return true;                       // R vs R
    if (pieces.length === 1) return pieces[0].type === KNIGHT || pieces[0].type === BISHOP; // R+mineur vs R
    if (pieces.length === 2 && pieces.every((p) => p.type === BISHOP)) {
      // Deux fous : nulle s'ils sont de même couleur de case.
      const color = (sq) => (fileOf(sq) + rankOf(sq)) & 1;
      return color(pieces[0].sq) === color(pieces[1].sq);
    }
    return false;
  }

  /**
   * Résultat de la partie.
   * @returns {{over:boolean, result:'*'|'1-0'|'0-1'|'1/2-1/2', reason:string}}
   */
  result() {
    const legal = this.legalMoves();
    if (legal.length === 0) {
      if (this.board.inCheck()) {
        const winner = this.board.turn === WHITE ? '0-1' : '1-0';
        return { over: true, result: winner, reason: 'échec et mat' };
      }
      return { over: true, result: '1/2-1/2', reason: 'pat' };
    }
    if (this.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'matériel insuffisant' };
    if (this.board.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'règle des 50 coups' };
    if (this.repetitionCount() >= 3) return { over: true, result: '1/2-1/2', reason: 'répétition triple' };
    return { over: false, result: '*', reason: '' };
  }

  undo() {
    if (!this.history.length) return null;
    const last = this.history.pop();
    this.hashes.pop();
    // Reconstruction depuis la position de départ (simple et sûr).
    const b = Board.fromFen(this.startFen); initHash(b);
    this.board = b;
    const moves = this.history;
    this.history = [];
    this.hashes = [b.hash];
    for (const e of moves) this.move(e.move);
    return last;
  }

  /** Export PGN minimal mais valide. */
  toPgn(headers = {}) {
    const tags = {
      Event: 'Partie Échiquier', Site: 'Échiquier', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      Round: '-', White: 'Blancs', Black: 'Noirs', ...headers,
    };
    const res = this.result();
    tags.Result = res.result;
    let pgn = Object.entries(tags).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n';
    if (this.startFen !== Board.startpos().toFen()) {
      pgn += `[SetUp "1"]\n[FEN "${this.startFen}"]\n`;
    }
    pgn += '\n';
    let line = '';
    this.history.forEach((e, i) => {
      if (i % 2 === 0) line += `${i / 2 + 1}. `;
      line += e.san + ' ';
    });
    line += res.result;
    // Repli des lignes à 80 colonnes.
    pgn += line.replace(/(.{1,79})(\s|$)/g, '$1\n').trim() + '\n';
    return pgn;
  }
}
