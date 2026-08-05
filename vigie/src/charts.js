// Graphiques SVG générés à la main (aucune bibliothèque). Deux formats :
//   - barres d'uptime « 90 jours » (une barre par jour, couleur = disponibilité) ;
//   - courbe de latence sur une fenêtre temporelle.
// Le SVG est autonome et s'adapte au thème via currentColor / variables.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function barColor(uptime) {
  if (uptime == null) return '#d1d5db';       // pas de données
  if (uptime >= 0.999) return '#16a34a';       // vert
  if (uptime >= 0.98) return '#65a30d';        // vert-jaune
  if (uptime >= 0.9) return '#d97706';         // orange
  return '#dc2626';                            // rouge
}

/**
 * Barres d'uptime type page de statut.
 * @param {Array<{day,uptime,down_seconds,has_data}>} history  (ancien -> récent)
 */
export function uptimeBars(history, { width = 760, height = 42, gap = 2 } = {}) {
  const n = history.length || 1;
  const barW = Math.max(2, (width - (n - 1) * gap) / n);
  let bars = '';
  history.forEach((d, i) => {
    const x = i * (barW + gap);
    const pct = d.uptime == null ? '—' : `${(d.uptime * 100).toFixed(2)} %`;
    const title = `${d.day} · ${pct}${d.down_seconds ? ` · ${fmtDuration(d.down_seconds)} indispo.` : ''}`;
    bars += `<rect x="${x.toFixed(1)}" y="0" width="${barW.toFixed(1)}" height="${height}" rx="1.5" fill="${barColor(d.uptime)}"><title>${esc(title)}</title></rect>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Historique de disponibilité">${bars}</svg>`;
}

/**
 * Courbe de latence.
 * @param {Array<{ts,up,latency_ms}>} points
 */
export function latencyChart(points, { width = 760, height = 200, pad = 30, color = '#2563eb' } = {}) {
  const usable = points.filter((p) => p.latency_ms != null);
  if (usable.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-family="system-ui" font-size="13">Pas assez de données</text></svg>`;
  }
  const t0 = usable[0].ts, t1 = usable[usable.length - 1].ts || t0 + 1;
  const maxL = Math.max(...usable.map((p) => p.latency_ms), 1);
  const niceMax = niceCeil(maxL);
  const X = (ts) => pad + ((ts - t0) / (t1 - t0 || 1)) * (width - pad - 6);
  const Y = (l) => height - pad - (l / niceMax) * (height - pad - 10);

  // Grille horizontale + libellés (0, moitié, max)
  let grid = '';
  for (const frac of [0, 0.5, 1]) {
    const val = Math.round(niceMax * frac);
    const y = Y(val);
    grid += `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${width - 6}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
    grid += `<text x="${pad - 5}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-family="system-ui" font-size="10">${val}</text>`;
  }

  // Aire + ligne ; segments rouges là où le service était down.
  let line = '';
  let area = `M ${X(usable[0].ts).toFixed(1)} ${Y(usable[0].latency_ms).toFixed(1)}`;
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1], b = usable[i];
    const stroke = (!a.up || !b.up) ? '#dc2626' : color;
    line += `<line x1="${X(a.ts).toFixed(1)}" y1="${Y(a.latency_ms).toFixed(1)}" x2="${X(b.ts).toFixed(1)}" y2="${Y(b.latency_ms).toFixed(1)}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>`;
    area += ` L ${X(b.ts).toFixed(1)} ${Y(b.latency_ms).toFixed(1)}`;
  }
  area += ` L ${X(usable[usable.length - 1].ts).toFixed(1)} ${(height - pad).toFixed(1)} L ${X(usable[0].ts).toFixed(1)} ${(height - pad).toFixed(1)} Z`;

  const startLabel = new Date(t0).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const endLabel = new Date(t1).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Latence">
    ${grid}
    <path d="${area}" fill="${color}" fill-opacity="0.08"/>
    ${line}
    <text x="${pad}" y="${height - 8}" fill="#94a3b8" font-family="system-ui" font-size="10">${esc(startLabel)}</text>
    <text x="${width - 6}" y="${height - 8}" text-anchor="end" fill="#94a3b8" font-family="system-ui" font-size="10">${esc(endLabel)}</text>
    <text x="${width - 6}" y="14" text-anchor="end" fill="#64748b" font-family="system-ui" font-size="11">ms</text>
  </svg>`;
}

function niceCeil(v) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function fmtDuration(sec) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} j`;
}
