// Interface principale — rendu de l'échiquier, interaction, dialogue avec le
// Web Worker (moteur). Toute la logique d'échecs (coups légaux, SAN, fins de
// partie) vient des mêmes modules que ceux testés côté Node.

import { Game } from '/src/game.js';
import {
  WHITE, BLACK, pieceType, pieceColor, fileOf, rankOf, sq0x88, squareName,
} from '/src/board.js';
import { moveFrom, moveTo, movePromo } from '/src/moves.js';

const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
const boardEl = document.getElementById('board');
const panelEl = document.getElementById('panel');

const state = {
  game: new Game(),
  humanColor: WHITE,
  flipped: false,
  selected: -1,
  targets: [],          // coups légaux depuis la case sélectionnée
  depth: 3,
  timeMs: 1500,
  thinking: false,
  lastMove: null,       // {from,to}
  over: false,
};

const worker = new Worker('/engine-worker.js', { type: 'module' });
worker.onmessage = (e) => { if (e.data.type === 'bestmove') onEngineMove(e.data); };

// ------------------------------------------------------------ rendu
function render() {
  const g = state.game;
  const s = g.board.squares;
  const ranks = state.flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = state.flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const checkSq = g.inCheck() ? g.board.kings[g.turn()] : -1;
  boardEl.innerHTML = '';
  for (const r of ranks) {
    for (const f of files) {
      const sq = sq0x88(f, r);
      const div = document.createElement('div');
      const dark = (f + r) % 2 === 0;
      div.className = 'sq ' + (dark ? 'dark' : 'light');
      div.dataset.sq = sq;
      if (sq === state.selected) div.classList.add('sel');
      if (state.lastMove && (sq === state.lastMove.from || sq === state.lastMove.to)) div.classList.add('last');
      if (sq === checkSq) div.classList.add('check');
      const p = s[sq];
      if (p !== 0) {
        const span = document.createElement('span');
        span.className = 'piece ' + (pieceColor(p) === WHITE ? 'w' : 'b');
        span.textContent = GLYPH[pieceType(p)];
        div.appendChild(span);
      }
      // pastilles de coups légaux
      const tgt = state.targets.find((m) => moveTo(m) === sq);
      if (tgt) {
        const mark = document.createElement('div');
        mark.className = p !== 0 ? 'ring' : 'dot';
        div.appendChild(mark);
      }
      // coordonnées sur les bords
      if (f === (state.flipped ? 7 : 0)) {
        const c = document.createElement('span'); c.className = 'coord rank'; c.textContent = r + 1; div.appendChild(c);
      }
      if (r === (state.flipped ? 7 : 0)) {
        const c = document.createElement('span'); c.className = 'coord file'; c.textContent = 'abcdefgh'[f]; div.appendChild(c);
      }
      div.onclick = () => onSquare(sq);
      boardEl.appendChild(div);
    }
  }
  renderPanel();
}

function renderPanel() {
  const g = state.game;
  const res = g.result();
  const turnTxt = g.turn() === WHITE ? 'aux Blancs' : 'aux Noirs';
  const hist = g.history;
  let movesHtml = '';
  for (let i = 0; i < hist.length; i += 2) {
    movesHtml += `<tr><td class="no">${i / 2 + 1}.</td><td class="mv">${hist[i].san}</td><td class="mv">${hist[i + 1] ? hist[i + 1].san : ''}</td></tr>`;
  }
  panelEl.innerHTML = `
    <div class="status">${state.over ? 'Partie terminée' : `Trait ${turnTxt}${g.inCheck() ? ' — échec !' : ''}`}</div>
    <div class="eval" id="eval"></div>
    <div class="thinking ${state.thinking ? 'show' : ''}" id="thinking">Le moteur réfléchit…</div>
    <div class="banner ${bannerClass(res)}" id="banner">${bannerText(res)}</div>
    <div class="row" style="margin-top:14px">
      <label>Vous jouez&nbsp;</label>
      <select id="side"><option value="w">les Blancs</option><option value="b">les Noirs</option></select>
      <label>Niveau&nbsp;</label>
      <select id="level">
        <option value="1">Débutant</option><option value="2">Facile</option>
        <option value="3">Moyen</option><option value="4">Avancé</option><option value="5">Fort</option>
      </select>
    </div>
    <div class="controls">
      <button class="btn primary" id="new">Nouvelle partie</button>
      <button class="btn" id="undo">Annuler</button>
      <button class="btn" id="flip">Retourner</button>
      <button class="btn" id="hint">Indice</button>
    </div>
    <div class="moves"><table><tbody>${movesHtml || '<tr><td class="small" style="padding:10px">Les coups apparaîtront ici.</td></tr>'}</tbody></table></div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="copyfen">Copier la FEN</button>
      <button class="btn" id="pgn">Exporter le PGN</button>
      <button class="btn" id="loadfen">Charger une FEN</button>
    </div>
    <div class="small" id="enginfo"></div>`;

  document.getElementById('side').value = state.humanColor === WHITE ? 'w' : 'b';
  document.getElementById('level').value = String(state.depth);
  document.getElementById('side').onchange = (e) => { state.humanColor = e.target.value === 'w' ? WHITE : BLACK; state.flipped = state.humanColor === BLACK; newGame(); };
  document.getElementById('level').onchange = (e) => {
    state.depth = Number(e.target.value);
    state.timeMs = [0, 300, 800, 1500, 2500, 4000][state.depth];
  };
  document.getElementById('new').onclick = newGame;
  document.getElementById('undo').onclick = undo;
  document.getElementById('flip').onclick = () => { state.flipped = !state.flipped; render(); };
  document.getElementById('hint').onclick = hint;
  document.getElementById('copyfen').onclick = () => navigator.clipboard?.writeText(g.fen()).then(() => flash('FEN copiée'));
  document.getElementById('pgn').onclick = exportPgn;
  document.getElementById('loadfen').onclick = loadFen;
  updateEval();
}

function bannerClass(res) {
  if (!res.over) return '';
  if (res.result === '1/2-1/2') return 'draw show';
  const humanWon = (res.result === '1-0') === (state.humanColor === WHITE);
  return (humanWon ? 'win' : 'lose') + ' show';
}
function bannerText(res) {
  if (!res.over) return '';
  const map = { '1-0': 'Les Blancs gagnent', '0-1': 'Les Noirs gagnent', '1/2-1/2': 'Partie nulle' };
  return `${map[res.result]} — ${res.reason}`;
}

// ------------------------------------------------------------ interaction
function onSquare(sq) {
  if (state.over || state.thinking) return;
  const g = state.game;
  if (g.turn() !== state.humanColor) return;

  // Clic sur une cible => jouer le coup.
  const target = state.targets.find((m) => moveTo(m) === sq);
  if (target !== undefined) {
    const promos = state.targets.filter((m) => moveTo(m) === sq && movePromo(m));
    if (promos.length) return askPromotion(promos);
    playHuman(target);
    return;
  }
  // Sinon (re)sélectionner une pièce du joueur.
  const p = g.board.squares[sq];
  if (p !== 0 && pieceColor(p) === state.humanColor) {
    state.selected = sq;
    state.targets = g.legalMovesFrom(sq);
  } else {
    state.selected = -1; state.targets = [];
  }
  render();
}

function playHuman(move) {
  const entry = state.game.move(move);
  state.selected = -1; state.targets = [];
  state.lastMove = { from: moveFrom(move), to: moveTo(move) };
  afterMove();
  if (!state.over && state.game.turn() !== state.humanColor) requestEngine();
}

function askPromotion(promos) {
  const back = document.createElement('div');
  back.className = 'promo-back';
  const color = state.humanColor === WHITE ? 'w' : 'b';
  back.innerHTML = `<div class="promo">${promos.map((m) =>
    `<button data-move="${m}"><span class="piece ${color}">${GLYPH[movePromo(m)]}</span></button>`).join('')}</div>`;
  back.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { back.remove(); playHuman(Number(b.dataset.move)); }
    else if (e.target === back) back.remove();
  };
  document.body.appendChild(back);
}

function afterMove() {
  const res = state.game.result();
  state.over = res.over;
  render();
}

// ------------------------------------------------------------ moteur
function requestEngine() {
  state.thinking = true;
  render();
  worker.postMessage({ type: 'go', fen: state.game.fen(), depth: state.depth, timeMs: state.timeMs });
}

function onEngineMove(data) {
  state.thinking = false;
  // Mode indice : on surligne le coup suggéré sans le jouer.
  if (state.hintPending) {
    state.hintPending = false;
    if (data.uci) {
      const mv = state.game.legalMoves().find((m) =>
        (squareName(moveFrom(m)) + squareName(moveTo(m))) === data.uci.slice(0, 4));
      if (mv) { state.selected = moveFrom(mv); state.targets = [mv]; }
    }
    render();
    return;
  }
  if (state.over || !data.uci) { render(); return; }
  const entry = state.game.move(data.uci);
  if (entry) {
    state.lastMove = { from: moveFrom(entry.move), to: moveTo(entry.move) };
    state.lastEngine = data;
  }
  afterMove();
}

function updateEval() {
  const el = document.getElementById('eval');
  const info = document.getElementById('enginfo');
  if (!el) return;
  const d = state.lastEngine;
  if (!d) { el.innerHTML = '<div class="bar"><i style="width:0"></i></div>'; return; }
  // Score du point de vue des Blancs pour la barre.
  let cp = d.score;
  // Le score renvoyé est du point de vue du camp qui vient de jouer (le moteur).
  const enginePlaysWhite = state.humanColor === BLACK;
  let whiteCp = enginePlaysWhite ? cp : -cp;
  const clamped = Math.max(-800, Math.min(800, whiteCp));
  const pctFromCenter = (clamped / 800) * 50;
  const left = whiteCp >= 0 ? 50 : 50 + pctFromCenter;
  const width = Math.abs(pctFromCenter);
  let label = d.mate ? `Mat en ${Math.abs(d.mate)}` : `${(whiteCp / 100).toFixed(2)}`;
  el.innerHTML = `Évaluation : ${label} <div class="bar"><i style="left:${left}%;width:${width}%"></i></div>`;
  if (info) info.textContent = `profondeur ${d.depth} · ${d.nodes.toLocaleString('fr-FR')} nœuds · ${d.timeMs} ms`;
}

// ------------------------------------------------------------ commandes
function newGame() {
  state.game = new Game();
  state.selected = -1; state.targets = []; state.lastMove = null; state.over = false; state.lastEngine = null;
  render();
  if (state.game.turn() !== state.humanColor) requestEngine();
}

function undo() {
  if (state.thinking) return;
  // Annuler le coup du moteur puis le sien pour rendre la main au joueur.
  state.game.undo();
  if (state.game.turn() !== state.humanColor && state.game.history.length) state.game.undo();
  const last = state.game.history.at(-1);
  state.lastMove = last ? { from: moveFrom(last.move), to: moveTo(last.move) } : null;
  state.selected = -1; state.targets = []; state.over = false;
  render();
}

function hint() {
  if (state.over || state.thinking || state.game.turn() !== state.humanColor) return;
  state.hintPending = true;
  state.thinking = true;
  render();
  worker.postMessage({ type: 'go', fen: state.game.fen(), depth: state.depth, timeMs: state.timeMs });
}

function exportPgn() {
  const pgn = state.game.toPgn({ White: state.humanColor === WHITE ? 'Joueur' : 'Échiquier', Black: state.humanColor === BLACK ? 'Joueur' : 'Échiquier' });
  download('partie.pgn', pgn);
}

function loadFen() {
  const fen = prompt('Collez une position FEN :', state.game.fen());
  if (!fen) return;
  try {
    const g = new Game(fen.trim());
    g.legalMoves(); // validation implicite
    state.game = g; state.selected = -1; state.targets = []; state.lastMove = null; state.over = g.result().over; state.lastEngine = null;
    render();
    if (!state.over && state.game.turn() !== state.humanColor) requestEngine();
  } catch (e) { flash('FEN invalide'); }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let flashTimer = null;
function flash(msg) {
  const info = document.getElementById('enginfo');
  if (!info) return;
  info.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(updateEval, 1500);
}

state.timeMs = [0, 300, 800, 1500, 2500, 4000][state.depth];
render();
