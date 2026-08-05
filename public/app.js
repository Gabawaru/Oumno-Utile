// Facturier — application monopage, vanilla JS (aucune dépendance).

/* ----------------------------------------------------------- utilitaires */

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtE = (cents) => {
  if (cents == null) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${String(abs % 100).padStart(2, '0')} €`;
};
const fmtD = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const todayIso = () => new Date().toISOString().slice(0, 10);

const parseAmount = (str, factor) => {
  const s = String(str ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === '' || s === '-') return null;
  return Math.sign(parseFloat(s)) * Math.round(Math.abs(parseFloat(s)) * factor);
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.includes('/login') && !path.includes('/setup')) {
    renderAuth();
    throw new Error('Session expirée');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

const STATUS_LABELS = {
  draft: 'Brouillon', issued: 'Émis', sent: 'Envoyé', accepted: 'Accepté',
  refused: 'Refusé', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée',
};
const TYPE_LABELS = { quote: 'Devis', invoice: 'Facture', credit_note: 'Avoir' };
const TYPE_PLURALS = { quote: 'Devis', invoice: 'Factures', credit_note: 'Avoirs' };
const PAYMENT_LABELS = {
  transfer: 'Virement', card: 'Carte bancaire', cheque: 'Chèque', cash: 'Espèces', direct_debit: 'Prélèvement',
};
const badge = (st) => `<span class="badge ${esc(st)}">${esc(STATUS_LABELS[st] || st)}</span>`;

/* -------------------------------------------------------------- coquille */

const NAV = [
  ['#/dashboard', 'Tableau de bord', '📊'],
  ['#/documents/quote', 'Devis', '📝'],
  ['#/documents/invoice', 'Factures', '🧾'],
  ['#/documents/credit_note', 'Avoirs', '↩️'],
  ['#/clients', 'Clients', '👥'],
  ['#/catalog', 'Catalogue', '📦'],
  ['#/settings', 'Paramètres', '⚙️'],
];

function shell(contentHtml, activeHash) {
  $app.innerHTML = `
    <nav class="sidebar">
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1d4ed8"/><text x="16" y="22" font-size="17" font-weight="bold" font-family="sans-serif" fill="white" text-anchor="middle">F</text></svg>
        Facturier
      </div>
      ${NAV.map(([href, label, icon]) =>
        `<a href="${href}" class="${activeHash.startsWith(href) ? 'active' : ''}"><span>${icon}</span>${label}</a>`).join('')}
      <div class="spacer"></div>
      <a href="#" id="nav-logout">🚪 Déconnexion</a>
      <div class="foot">Facturier v1.0<br>Factur-X · EN 16931</div>
    </nav>
    <main id="main">${contentHtml}</main>`;
  document.getElementById('nav-logout').onclick = async (e) => {
    e.preventDefault();
    await api('/api/logout', { method: 'POST' });
    renderAuth();
  };
}

/* -------------------------------------------------- connexion / création */

async function renderAuth() {
  const { configured } = await api('/api/setup-status');
  $app.innerHTML = `
    <div class="auth-wrap"><div class="card auth-card">
      <div class="brand">Facturier</div>
      <div class="tag">Devis, factures &amp; avoirs — Factur-X (EN 16931)</div>
      ${configured ? '' : `
        <p class="muted" style="font-size:0.88rem">Première utilisation : choisissez un mot de passe pour protéger votre espace.</p>
        <div class="field"><label>Nom de votre entreprise</label><input id="auth-company" placeholder="Ex. Jeanne Martin — EI"></div>`}
      <div class="field"><label>Mot de passe${configured ? '' : ' (8 caractères min.)'}</label>
        <input id="auth-password" type="password" autofocus></div>
      <button class="btn primary" id="auth-go" style="width:100%">${configured ? 'Se connecter' : 'Créer mon espace'}</button>
    </div></div>`;
  const go = async () => {
    try {
      const password = document.getElementById('auth-password').value;
      if (configured) await api('/api/login', { method: 'POST', body: { password } });
      else await api('/api/setup', { method: 'POST', body: { password, company_name: document.getElementById('auth-company').value } });
      location.hash = '#/dashboard';
      route();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('auth-go').onclick = go;
  $app.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
}

/* ------------------------------------------------------- tableau de bord */

async function viewDashboard() {
  const d = await api('/api/stats/dashboard');
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const byMonth = Object.fromEntries(d.monthly_ht.map((m) => [m.month, m.ht]));
  const series = months.map((_, i) => byMonth[`${d.year}-${String(i + 1).padStart(2, '0')}`] || 0);
  const max = Math.max(...series, 1);
  const pct = (r) => Math.min(100, Math.round(r * 100));
  const barCls = (r) => (r >= 0.95 ? 'danger' : r >= 0.8 ? 'warn' : '');

  shell(`
    <div class="page-head"><h1>Tableau de bord ${d.year}</h1><div class="grow"></div>
      <a class="btn" href="#/doc/new/quote">+ Devis</a>
      <a class="btn primary" href="#/doc/new/invoice">+ Facture</a></div>
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Chiffre d'affaires facturé (HT)</div>
        <div class="value">${fmtE(d.invoiced_ht_cents)}</div>
        <div class="sub">${d.invoice_count} facture(s) émise(s)</div></div>
      <div class="card stat"><div class="label">Encaissé (TTC)</div>
        <div class="value">${fmtE(d.collected_ttc_cents)}</div>
        <div class="sub">règlements reçus cette année</div></div>
      <div class="card stat"><div class="label">En attente de paiement</div>
        <div class="value">${fmtE(d.pending_cents)}</div>
        <div class="sub">${d.open_quotes} devis en cours</div></div>
      <div class="card stat ${d.overdue_count ? 'alert' : ''}"><div class="label">En retard</div>
        <div class="value">${fmtE(d.overdue_cents)}</div>
        <div class="sub">${d.overdue_count} facture(s) échue(s)</div></div>
    </div>
    <div class="grid cols-2 mt">
      <div class="card">
        <strong>CA facturé par mois (HT)</strong>
        <div class="chart-bars">${series.map((v) =>
          `<div class="bar" title="${fmtE(v)}"><i style="height:${Math.round((v / max) * 100)}%"></i></div>`).join('')}</div>
        <div class="chart-labels">${months.map((m) => `<span>${m}</span>`).join('')}</div>
      </div>
      <div class="card">
        <strong>Seuils (base : CA facturé HT ${d.year})</strong>
        <div class="mt">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem">
            <span>Franchise de TVA</span><span>${pct(d.thresholds.vat_ratio)} % de ${fmtE(d.thresholds.vat_cents)}</span></div>
          <div class="progress"><div class="${barCls(d.thresholds.vat_ratio)}" style="width:${pct(d.thresholds.vat_ratio)}%"></div></div>
        </div>
        <div class="mt">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem">
            <span>Plafond micro-entreprise</span><span>${pct(d.thresholds.micro_ratio)} % de ${fmtE(d.thresholds.micro_cents)}</span></div>
          <div class="progress"><div class="${barCls(d.thresholds.micro_ratio)}" style="width:${pct(d.thresholds.micro_ratio)}%"></div></div>
        </div>
        <p class="muted" style="font-size:0.78rem">Seuils paramétrables (Paramètres → Seuils). Vérifiez chaque année les
        montants en vigueur — ils évoluent avec les lois de finances.</p>
      </div>
    </div>`, '#/dashboard');
}

/* ------------------------------------------------------ liste documents */

async function viewDocuments(type) {
  const docs = await api(`/api/documents?type=${type}`);
  const rows = docs.map((doc) => `
    <tr class="row" data-id="${doc.id}">
      <td>${doc.number ? `<strong>${esc(doc.number)}</strong>` : '<span class="muted">brouillon</span>'}</td>
      <td>${esc(doc.client_name || '—')}</td>
      <td>${esc(doc.subject || '')}</td>
      <td>${fmtD(doc.issue_date)}</td>
      <td class="num">${fmtE(doc.total_ttc_cents)}</td>
      <td>${badge(doc.effective_status)}</td>
    </tr>`).join('');
  shell(`
    <div class="page-head"><h1>${TYPE_PLURALS[type]}</h1><div class="grow"></div>
      ${type !== 'credit_note' ? `<a class="btn primary" href="#/doc/new/${type}">+ Nouveau ${TYPE_LABELS[type].toLowerCase()}</a>` : ''}
    </div>
    <div class="card" style="padding:6px 10px">
      ${docs.length ? `<table class="list">
        <thead><tr><th>Numéro</th><th>Client</th><th>Objet</th><th>Émission</th><th class="num">Total TTC</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody></table>`
      : `<div class="empty">Aucun document pour l'instant.${type === 'credit_note' ? '<br>Un avoir se crée depuis une facture émise.' : ''}</div>`}
    </div>`, `#/documents/${type}`);
  document.querySelectorAll('tr.row').forEach((tr) =>
    tr.addEventListener('click', () => { location.hash = `#/doc/${tr.dataset.id}`; }));
}

/* ------------------------------------------------------ éditeur brouillon */

async function viewDocument(id) {
  const doc = await api(`/api/documents/${id}`);
  if (doc.status === 'draft') return editorView(doc);
  return readOnlyView(doc);
}

async function newDocument(type) {
  const doc = await api('/api/documents', { method: 'POST', body: { doc_type: type } });
  location.hash = `#/doc/${doc.id}`;
}

async function editorView(doc) {
  const [clients, catalog, settings] = await Promise.all([
    api('/api/clients'), api('/api/catalog'), api('/api/settings'),
  ]);
  const vatExempt = settings.vat_regime === 'franchise';
  // état local des lignes (montants en centimes / millièmes)
  const lines = doc.lines.length
    ? doc.lines.map((l) => ({ ...l }))
    : [{ label: '', description: '', qty_milli: 1000, unit: 'u', unit_price_cents: 0, vat_rate: settings.default_vat_rate }];

  const catalogOptions = catalog.map((c) =>
    `<option value="${esc(c.label)}" data-id="${c.id}"></option>`).join('');

  const lineRow = (l, i) => `
    <tr data-i="${i}">
      <td><input class="f-label" list="catalog-list" value="${esc(l.label)}" placeholder="Désignation">
          <input class="f-desc" value="${esc(l.description)}" placeholder="Détail (optionnel)" style="margin-top:4px;font-size:0.85rem"></td>
      <td class="qty"><input class="f-qty" value="${String(l.qty_milli / 1000).replace('.', ',')}"></td>
      <td class="unit"><input class="f-unit" value="${esc(l.unit)}"></td>
      <td class="price"><input class="f-price" value="${(l.unit_price_cents / 100).toFixed(2).replace('.', ',')}"></td>
      ${vatExempt ? '' : `<td class="vat"><select class="f-vat">
        ${[20, 10, 5.5, 2.1, 0].map((r) => `<option value="${r}" ${Number(l.vat_rate) === r ? 'selected' : ''}>${r} %</option>`).join('')}
      </select></td>`}
      <td class="line-total" data-total></td>
      <td class="rm"><button class="btn small danger f-rm" title="Supprimer la ligne">✕</button></td>
    </tr>`;

  shell(`
    <div class="page-head">
      <h1>${TYPE_LABELS[doc.doc_type]} <span class="muted">— brouillon</span></h1>
      <div class="grow"></div>
      <button class="btn danger" id="d-delete">Supprimer</button>
      <a class="btn" href="/api/documents/${doc.id}/pdf" target="_blank">Aperçu PDF</a>
      <button class="btn" id="d-save">Enregistrer</button>
      <button class="btn primary" id="d-issue">Émettre…</button>
    </div>
    <div class="card">
      <div class="field-row c3">
        <div class="field"><label>Client</label>
          <select id="d-client">
            <option value="">— choisir un client —</option>
            ${clients.map((c) => `<option value="${c.id}" ${doc.client_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <a class="plain" href="#/clients" style="font-size:0.8rem">Gérer les clients</a></div>
        <div class="field"><label>Objet</label><input id="d-subject" value="${esc(doc.subject)}" placeholder="Ex. Refonte du site — phase 1"></div>
        <div class="field"><label>Référence / bon de commande</label><input id="d-ref" value="${esc(doc.purchase_order_ref)}"></div>
      </div>
      <table class="lines-table">
        <thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>PU HT</th>${vatExempt ? '' : '<th>TVA</th>'}<th class="right">Total HT</th><th></th></tr></thead>
        <tbody id="d-lines">${lines.map(lineRow).join('')}</tbody>
      </table>
      <datalist id="catalog-list">${catalogOptions}</datalist>
      <button class="btn small mt" id="d-addline">+ Ajouter une ligne</button>
      <div class="totals-box" id="d-totals"></div>
      <div class="field-row c2 mt">
        <div class="field"><label>Notes (visibles sur le document)</label>
          <textarea id="d-notes" rows="2">${esc(doc.notes_public)}</textarea></div>
        <div class="field"><label>Moyen de paiement</label>
          <select id="d-pay">${Object.entries(PAYMENT_LABELS).map(([k, v]) =>
            `<option value="${k}" ${doc.payment_means === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      ${vatExempt ? `<p class="muted" style="font-size:0.8rem">Régime : franchise en base — « ${esc(settings.vat_exemption_mention)} » sera portée sur le document.</p>` : ''}
    </div>`, `#/documents/${doc.doc_type}`);

  const tbody = document.getElementById('d-lines');

  const readLines = () => [...tbody.querySelectorAll('tr')].map((tr) => ({
    label: tr.querySelector('.f-label').value,
    description: tr.querySelector('.f-desc').value,
    qty: tr.querySelector('.f-qty').value,
    unit: tr.querySelector('.f-unit').value,
    unit_price: tr.querySelector('.f-price').value,
    vat_rate: vatExempt ? 0 : Number(tr.querySelector('.f-vat').value),
  }));

  const refreshTotals = () => {
    let ht = 0;
    const vatGroups = new Map();
    tbody.querySelectorAll('tr').forEach((tr) => {
      const qty = parseAmount(tr.querySelector('.f-qty').value, 1000) ?? 0;
      const price = parseAmount(tr.querySelector('.f-price').value, 100) ?? 0;
      const rate = vatExempt ? 0 : Number(tr.querySelector('.f-vat').value);
      const total = Math.sign(qty * price) * Math.round(Math.abs(qty * price) / 1000);
      tr.querySelector('[data-total]').textContent = fmtE(total);
      ht += total;
      vatGroups.set(rate, (vatGroups.get(rate) || 0) + total);
    });
    let tva = 0;
    const vatRows = [...vatGroups.entries()].filter(([r]) => r > 0).sort((a, b) => a[0] - b[0])
      .map(([rate, basis]) => {
        const tax = Math.round((basis * rate) / 100);
        tva += tax;
        return `<div class="trow"><span>TVA ${rate} %</span><span>${fmtE(tax)}</span></div>`;
      }).join('');
    document.getElementById('d-totals').innerHTML = `
      <div class="trow"><span>Total HT</span><span>${fmtE(ht)}</span></div>${vatRows}
      <div class="trow big"><span>Total TTC</span><span>${fmtE(ht + tva)}</span></div>`;
  };

  const bindRow = (tr) => {
    tr.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', refreshTotals));
    tr.querySelector('.f-rm').onclick = () => {
      if (tbody.children.length > 1) tr.remove();
      else tr.querySelectorAll('input').forEach((i) => (i.value = ''));
      refreshTotals();
    };
    // auto-remplissage depuis le catalogue
    tr.querySelector('.f-label').addEventListener('change', (e) => {
      const item = catalog.find((c) => c.label === e.target.value);
      if (!item) return;
      tr.querySelector('.f-desc').value = item.description || '';
      tr.querySelector('.f-unit').value = item.unit;
      tr.querySelector('.f-price').value = (item.unit_price_cents / 100).toFixed(2).replace('.', ',');
      if (!vatExempt) tr.querySelector('.f-vat').value = String(item.vat_rate);
      refreshTotals();
    });
  };
  tbody.querySelectorAll('tr').forEach(bindRow);
  refreshTotals();

  document.getElementById('d-addline').onclick = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = lineRow({ label: '', description: '', qty_milli: 1000, unit: 'u', unit_price_cents: 0, vat_rate: settings.default_vat_rate }, tbody.children.length)
      .replace(/^\s*<tr[^>]*>|<\/tr>\s*$/g, '');
    tbody.appendChild(tr);
    bindRow(tr);
    refreshTotals();
  };

  const save = async () => {
    const body = {
      client_id: Number(document.getElementById('d-client').value) || null,
      subject: document.getElementById('d-subject').value,
      purchase_order_ref: document.getElementById('d-ref').value,
      notes_public: document.getElementById('d-notes').value,
      payment_means: document.getElementById('d-pay').value,
      lines: readLines(),
    };
    return api(`/api/documents/${doc.id}`, { method: 'PUT', body });
  };

  document.getElementById('d-save').onclick = async () => {
    try { await save(); toast('Brouillon enregistré'); } catch (e) { toast(e.message, true); }
  };

  document.getElementById('d-delete').onclick = async () => {
    if (!confirm('Supprimer ce brouillon ?')) return;
    await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    location.hash = `#/documents/${doc.doc_type}`;
  };

  document.getElementById('d-issue').onclick = async () => {
    try { await save(); } catch (e) { return toast(e.message, true); }
    const m = modal(`
      <h2>Émettre ce ${TYPE_LABELS[doc.doc_type].toLowerCase()}</h2>
      <p style="font-size:0.9rem">Un numéro séquentiel définitif va être attribué et le document deviendra
      <strong>inaltérable</strong> (exigence légale). Toute correction ultérieure passera par un avoir.</p>
      <div class="field"><label>Date d'émission</label><input type="date" id="m-date" value="${todayIso()}"></div>
      <div class="actions"><button class="btn" id="m-cancel">Annuler</button>
      <button class="btn primary" id="m-ok">Émettre</button></div>`);
    m.querySelector('#m-cancel').onclick = () => m.remove();
    m.querySelector('#m-ok').onclick = async () => {
      try {
        const updated = await api(`/api/documents/${doc.id}/issue`, {
          method: 'POST', body: { issue_date: m.querySelector('#m-date').value },
        });
        m.remove();
        toast(`${TYPE_LABELS[doc.doc_type]} ${updated.number} émis`);
        route();
      } catch (e) { toast(e.message, true); }
    };
  };
}

/* ----------------------------------------------------- vue document émis */

async function readOnlyView(doc) {
  const t = doc.totals;
  const rest = t.total_ttc_cents - doc.paid_cents;
  const actions = [];
  if (doc.doc_type === 'quote') {
    if (['issued', 'sent'].includes(doc.status)) {
      if (doc.status === 'issued') actions.push(['sent', 'Marquer envoyé']);
      actions.push(['accepted', 'Accepté'], ['refused', 'Refusé']);
    }
  } else if (doc.doc_type === 'invoice') {
    if (doc.status === 'issued') actions.push(['sent', 'Marquer envoyée']);
  } else if (doc.doc_type === 'credit_note' && doc.status === 'issued') {
    actions.push(['sent', 'Marquer envoyé']);
  }

  const linesRows = t.lines.map((l) => `
    <tr><td><strong>${esc(l.label)}</strong>${l.description ? `<div class="muted" style="font-size:0.83rem">${esc(l.description)}</div>` : ''}</td>
    <td class="num">${String(l.qty_milli / 1000).replace('.', ',')} ${esc(l.unit)}</td>
    <td class="num">${fmtE(l.unit_price_cents)}</td>
    ${doc.vat_exempt ? '' : `<td class="num">${l.vat_rate} %</td>`}
    <td class="num">${fmtE(l.total_ht_cents)}</td></tr>`).join('');

  const vatRows = doc.vat_exempt ? '' : t.vatBreakdown.map((g) =>
    `<div class="trow"><span>TVA ${g.rate} %</span><span>${fmtE(g.tax_cents)}</span></div>`).join('');

  shell(`
    <div class="page-head">
      <h1>${TYPE_LABELS[doc.doc_type]} ${esc(doc.number)}</h1>
      ${badge(doc.effective_status)}
      <div class="grow"></div>
      ${actions.map(([st, label]) => `<button class="btn" data-status="${st}">${label}</button>`).join('')}
      ${doc.doc_type === 'quote' && ['issued', 'sent', 'accepted'].includes(doc.status)
        ? '<button class="btn primary" id="d-convert">Facturer ce devis</button>' : ''}
      ${doc.doc_type === 'invoice' && doc.status !== 'draft'
        ? '<button class="btn" id="d-credit">Créer un avoir</button>' : ''}
      <button class="btn" id="d-dup">Dupliquer</button>
      ${doc.doc_type !== 'quote' ? `<a class="btn" href="/api/documents/${doc.id}/facturx.xml" target="_blank">XML</a>` : ''}
      <a class="btn primary" href="/api/documents/${doc.id}/pdf" target="_blank">PDF</a>
    </div>
    <div class="card">
      <div class="doc-meta">
        <div class="item"><div class="k">Client</div><div class="v">${esc(doc.client?.name || '—')}</div></div>
        <div class="item"><div class="k">Émission</div><div class="v">${fmtD(doc.issue_date)}</div></div>
        ${doc.doc_type === 'invoice' ? `<div class="item"><div class="k">Échéance</div><div class="v">${fmtD(doc.due_date)}</div></div>` : ''}
        ${doc.doc_type === 'quote' ? `<div class="item"><div class="k">Validité</div><div class="v">${fmtD(doc.validity_date)}</div></div>` : ''}
        ${doc.source_number ? `<div class="item"><div class="k">${doc.doc_type === 'credit_note' ? 'Sur facture' : 'Origine'}</div><div class="v">${esc(doc.source_number)}</div></div>` : ''}
        ${doc.subject ? `<div class="item"><div class="k">Objet</div><div class="v">${esc(doc.subject)}</div></div>` : ''}
      </div>
      <table class="list">
        <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th>${doc.vat_exempt ? '' : '<th class="num">TVA</th>'}<th class="num">Total HT</th></tr></thead>
        <tbody>${linesRows}</tbody>
      </table>
      <div class="totals-box">
        <div class="trow"><span>Total HT</span><span>${fmtE(t.total_ht_cents)}</span></div>
        ${vatRows}
        <div class="trow big"><span>Total TTC</span><span>${fmtE(t.total_ttc_cents)}</span></div>
        ${doc.paid_cents ? `<div class="trow"><span>Réglé</span><span>${fmtE(doc.paid_cents)}</span></div>
        <div class="trow"><span><strong>Reste dû</strong></span><span><strong>${fmtE(rest)}</strong></span></div>` : ''}
      </div>
    </div>
    ${doc.doc_type === 'invoice' && doc.status !== 'draft' ? `
    <div class="card mt">
      <strong>Règlements</strong>
      ${doc.payments.length ? `<table class="list mt"><thead><tr><th>Date</th><th>Moyen</th><th>Note</th><th class="num">Montant</th><th></th></tr></thead>
        <tbody>${doc.payments.map((p) => `<tr><td>${fmtD(p.paid_on)}</td><td>${PAYMENT_LABELS[p.method] || p.method}</td>
          <td>${esc(p.note)}</td><td class="num">${fmtE(p.amount_cents)}</td>
          <td class="right"><button class="btn small danger" data-rmpay="${p.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun règlement enregistré.</p>'}
      ${doc.status !== 'cancelled' && rest > 0 ? `
      <div class="field-row c3 mt">
        <div class="field"><label>Montant (€)</label><input id="p-amount" value="${(rest / 100).toFixed(2).replace('.', ',')}"></div>
        <div class="field"><label>Date</label><input type="date" id="p-date" value="${todayIso()}"></div>
        <div class="field"><label>Moyen</label><select id="p-method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      </div>
      <button class="btn primary" id="p-add">Enregistrer le règlement</button>` : ''}
    </div>` : ''}`, `#/documents/${doc.doc_type}`);

  document.querySelectorAll('[data-status]').forEach((b) => (b.onclick = async () => {
    try { await api(`/api/documents/${doc.id}/status`, { method: 'POST', body: { status: b.dataset.status } }); route(); }
    catch (e) { toast(e.message, true); }
  }));
  document.getElementById('d-convert')?.addEventListener('click', async () => {
    const inv = await api(`/api/documents/${doc.id}/convert`, { method: 'POST' });
    toast('Facture brouillon créée depuis le devis');
    location.hash = `#/doc/${inv.id}`;
  });
  document.getElementById('d-credit')?.addEventListener('click', async () => {
    const cn = await api(`/api/documents/${doc.id}/credit-note`, { method: 'POST' });
    toast('Avoir brouillon créé — ajustez les lignes puis émettez-le');
    location.hash = `#/doc/${cn.id}`;
  });
  document.getElementById('d-dup')?.addEventListener('click', async () => {
    const dup = await api(`/api/documents/${doc.id}/duplicate`, { method: 'POST' });
    location.hash = `#/doc/${dup.id}`;
  });
  document.getElementById('p-add')?.addEventListener('click', async () => {
    try {
      await api(`/api/documents/${doc.id}/payments`, {
        method: 'POST',
        body: {
          amount: document.getElementById('p-amount').value,
          paid_on: document.getElementById('p-date').value,
          method: document.getElementById('p-method').value,
        },
      });
      toast('Règlement enregistré');
      route();
    } catch (e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-rmpay]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Supprimer ce règlement ?')) return;
    await api(`/api/documents/${doc.id}/payments/${b.dataset.rmpay}`, { method: 'DELETE' });
    route();
  }));
}

/* -------------------------------------------------------------- clients */

function clientForm(c = {}) {
  return `
    <div class="field-row c2">
      <div class="field"><label>Type</label><select id="c-kind">
        <option value="company" ${c.kind !== 'individual' ? 'selected' : ''}>Professionnel</option>
        <option value="individual" ${c.kind === 'individual' ? 'selected' : ''}>Particulier</option></select></div>
      <div class="field"><label>Nom / raison sociale *</label><input id="c-name" value="${esc(c.name || '')}"></div>
    </div>
    <div class="field-row c2">
      <div class="field"><label>SIREN</label><input id="c-siren" value="${esc(c.siren || '')}"></div>
      <div class="field"><label>N° TVA intracom.</label><input id="c-vat" value="${esc(c.vat_number || '')}"></div>
    </div>
    <div class="field"><label>Adresse</label><input id="c-addr1" value="${esc(c.address_line1 || '')}"></div>
    <div class="field-row c3">
      <div class="field"><label>Code postal</label><input id="c-cp" value="${esc(c.postal_code || '')}"></div>
      <div class="field"><label>Ville</label><input id="c-city" value="${esc(c.city || '')}"></div>
      <div class="field"><label>Pays (code)</label><input id="c-country" value="${esc(c.country || 'FR')}"></div>
    </div>
    <div class="field-row c2">
      <div class="field"><label>E-mail</label><input id="c-email" value="${esc(c.email || '')}"></div>
      <div class="field"><label>Téléphone</label><input id="c-phone" value="${esc(c.phone || '')}"></div>
    </div>`;
}

function readClientForm(m) {
  const g = (id) => m.querySelector('#' + id).value;
  return {
    kind: g('c-kind'), name: g('c-name'), siren: g('c-siren'), vat_number: g('c-vat'),
    address_line1: g('c-addr1'), postal_code: g('c-cp'), city: g('c-city'),
    country: g('c-country'), email: g('c-email'), phone: g('c-phone'),
  };
}

async function viewClients() {
  const clients = await api('/api/clients');
  shell(`
    <div class="page-head"><h1>Clients</h1><div class="grow"></div>
      <button class="btn primary" id="c-new">+ Nouveau client</button></div>
    <div class="card" style="padding:6px 10px">
      ${clients.length ? `<table class="list">
        <thead><tr><th>Nom</th><th>Ville</th><th>SIREN</th><th>E-mail</th><th></th></tr></thead>
        <tbody>${clients.map((c) => `<tr>
          <td><strong>${esc(c.name)}</strong>${c.kind === 'individual' ? ' <span class="muted">(particulier)</span>' : ''}</td>
          <td>${esc(c.city)}</td><td>${esc(c.siren)}</td><td>${esc(c.email)}</td>
          <td class="right"><button class="btn small" data-edit="${c.id}">Modifier</button>
          <button class="btn small danger" data-del="${c.id}">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Aucun client. Créez le premier pour pouvoir facturer.</div>'}
    </div>`, '#/clients');

  const openForm = (c = null) => {
    const m = modal(`<h2>${c ? 'Modifier le client' : 'Nouveau client'}</h2>${clientForm(c || {})}
      <div class="actions"><button class="btn" id="m-cancel">Annuler</button>
      <button class="btn primary" id="m-save">Enregistrer</button></div>`);
    m.querySelector('#m-cancel').onclick = () => m.remove();
    m.querySelector('#m-save').onclick = async () => {
      try {
        const body = readClientForm(m);
        if (c) await api(`/api/clients/${c.id}`, { method: 'PUT', body });
        else await api('/api/clients', { method: 'POST', body });
        m.remove();
        viewClients();
      } catch (e) { toast(e.message, true); }
    };
  };
  document.getElementById('c-new').onclick = () => openForm();
  document.querySelectorAll('[data-edit]').forEach((b) =>
    (b.onclick = () => openForm(clients.find((c) => c.id === Number(b.dataset.edit)))));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Supprimer ce client ? (il sera archivé s’il a des documents)')) return;
    await api(`/api/clients/${b.dataset.del}`, { method: 'DELETE' });
    viewClients();
  }));
}

/* ------------------------------------------------------------- catalogue */

async function viewCatalog() {
  const items = await api('/api/catalog');
  shell(`
    <div class="page-head"><h1>Catalogue de prestations</h1><div class="grow"></div>
      <button class="btn primary" id="k-new">+ Nouvelle prestation</button></div>
    <div class="card" style="padding:6px 10px">
      ${items.length ? `<table class="list">
        <thead><tr><th>Libellé</th><th>Unité</th><th class="num">PU HT</th><th class="num">TVA</th><th></th></tr></thead>
        <tbody>${items.map((k) => `<tr>
          <td><strong>${esc(k.label)}</strong>${k.description ? `<div class="muted" style="font-size:0.83rem">${esc(k.description)}</div>` : ''}</td>
          <td>${esc(k.unit)}</td><td class="num">${fmtE(k.unit_price_cents)}</td><td class="num">${k.vat_rate} %</td>
          <td class="right"><button class="btn small" data-edit="${k.id}">Modifier</button>
          <button class="btn small danger" data-del="${k.id}">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Le catalogue accélère la saisie : vos prestations récurrentes, leur prix et leur unité.</div>'}
    </div>`, '#/catalog');

  const openForm = (k = null) => {
    const m = modal(`<h2>${k ? 'Modifier la prestation' : 'Nouvelle prestation'}</h2>
      <div class="field"><label>Libellé *</label><input id="k-label" value="${esc(k?.label || '')}"></div>
      <div class="field"><label>Description</label><input id="k-desc" value="${esc(k?.description || '')}"></div>
      <div class="field-row c3">
        <div class="field"><label>Unité</label><input id="k-unit" value="${esc(k?.unit || 'j')}"></div>
        <div class="field"><label>PU HT (€)</label><input id="k-price" value="${k ? (k.unit_price_cents / 100).toFixed(2).replace('.', ',') : ''}"></div>
        <div class="field"><label>TVA %</label><select id="k-vat">${[20, 10, 5.5, 2.1, 0].map((r) =>
          `<option value="${r}" ${(k?.vat_rate ?? 20) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></div>
      </div>
      <div class="actions"><button class="btn" id="m-cancel">Annuler</button>
      <button class="btn primary" id="m-save">Enregistrer</button></div>`);
    m.querySelector('#m-cancel').onclick = () => m.remove();
    m.querySelector('#m-save').onclick = async () => {
      try {
        const body = {
          label: m.querySelector('#k-label').value, description: m.querySelector('#k-desc').value,
          unit: m.querySelector('#k-unit').value, unit_price: m.querySelector('#k-price').value,
          vat_rate: Number(m.querySelector('#k-vat').value),
        };
        if (k) await api(`/api/catalog/${k.id}`, { method: 'PUT', body });
        else await api('/api/catalog', { method: 'POST', body });
        m.remove();
        viewCatalog();
      } catch (e) { toast(e.message, true); }
    };
  };
  document.getElementById('k-new').onclick = () => openForm();
  document.querySelectorAll('[data-edit]').forEach((b) =>
    (b.onclick = () => openForm(items.find((k) => k.id === Number(b.dataset.edit)))));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    await api(`/api/catalog/${b.dataset.del}`, { method: 'DELETE' });
    viewCatalog();
  }));
}

/* ------------------------------------------------------------ paramètres */

async function viewSettings() {
  const s = await api('/api/settings');
  const f = (id, label, value, attrs = '') =>
    `<div class="field"><label>${label}</label><input id="${id}" value="${esc(value ?? '')}" ${attrs}></div>`;
  const euros = (c) => (c / 100).toFixed(0);

  shell(`
    <div class="page-head"><h1>Paramètres</h1><div class="grow"></div>
      <a class="btn" href="/api/export/documents.csv">Export CSV</a>
      <a class="btn" href="/api/backup">Sauvegarde (.db)</a>
      <button class="btn primary" id="s-save">Enregistrer</button></div>
    <div class="card">
      <fieldset><legend>Identité</legend>
        <div class="field-row c2">
          ${f('s-company_name', 'Nom / raison sociale *', s.company_name)}
          ${f('s-legal_form', 'Forme juridique', s.legal_form)}
        </div>
        <div class="field-row c3">
          ${f('s-siren', 'SIREN', s.siren)}
          ${f('s-siret', 'SIRET', s.siret)}
          ${f('s-ape_code', 'Code APE', s.ape_code)}
        </div>
        <div class="field">${f('s-address_line1', 'Adresse', s.address_line1)}</div>
        <div class="field-row c3">
          ${f('s-postal_code', 'Code postal', s.postal_code)}
          ${f('s-city', 'Ville', s.city)}
          ${f('s-country', 'Pays', s.country)}
        </div>
        <div class="field-row c2">
          ${f('s-email', 'E-mail', s.email)}
          ${f('s-phone', 'Téléphone', s.phone)}
        </div>
      </fieldset>
      <fieldset><legend>TVA</legend>
        <div class="field-row c3">
          <div class="field"><label>Régime</label><select id="s-vat_regime">
            <option value="franchise" ${s.vat_regime === 'franchise' ? 'selected' : ''}>Franchise en base (pas de TVA)</option>
            <option value="normal" ${s.vat_regime === 'normal' ? 'selected' : ''}>Assujetti à la TVA</option></select></div>
          ${f('s-vat_number', 'N° TVA intracom.', s.vat_number)}
          <div class="field"><label>Taux par défaut</label><select id="s-default_vat_rate">
            ${[20, 10, 5.5, 2.1, 0].map((r) => `<option value="${r}" ${Number(s.default_vat_rate) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></div>
        </div>
        ${f('s-vat_exemption_mention', 'Mention d’exonération', s.vat_exemption_mention)}
      </fieldset>
      <fieldset><legend>Paiement &amp; mentions</legend>
        <div class="field-row c2">
          ${f('s-iban', 'IBAN', s.iban)}
          ${f('s-bic', 'BIC', s.bic)}
        </div>
        <div class="field-row c2">
          ${f('s-payment_terms_days', 'Délai de paiement (jours)', s.payment_terms_days, 'type="number" min="0"')}
          ${f('s-quote_validity_days', 'Validité des devis (jours)', s.quote_validity_days, 'type="number" min="0"')}
        </div>
        ${f('s-late_penalty_rate', 'Taux des pénalités de retard', s.late_penalty_rate)}
        ${f('s-mention_escompte', 'Mention escompte', s.mention_escompte)}
        ${f('s-footer_note', 'Mention libre en pied de page', s.footer_note)}
      </fieldset>
      <fieldset><legend>Numérotation <span class="muted" style="font-weight:400;font-size:0.8rem">— {YYYY} année, {SEQ:4} compteur. Attribuée à l'émission, sans trou.</span></legend>
        <div class="field-row c3">
          ${f('s-number_format_invoice', 'Factures', s.number_format_invoice)}
          ${f('s-number_format_quote', 'Devis', s.number_format_quote)}
          ${f('s-number_format_credit_note', 'Avoirs', s.number_format_credit_note)}
        </div>
      </fieldset>
      <fieldset><legend>Activité &amp; seuils <span class="muted" style="font-weight:400;font-size:0.8rem">— montants en euros, à jour de votre situation</span></legend>
        <div class="field-row c3">
          <div class="field"><label>Nature d'activité</label><select id="s-activity_kind">
            <option value="services" ${s.activity_kind !== 'sales' ? 'selected' : ''}>Prestations de services</option>
            <option value="sales" ${s.activity_kind === 'sales' ? 'selected' : ''}>Ventes de marchandises</option></select></div>
          ${f('s-threshold_vat', 'Seuil franchise TVA (€)', euros(s.activity_kind === 'sales' ? s.threshold_vat_sales_cents : s.threshold_vat_services_cents), 'type="number"')}
          ${f('s-threshold_micro', 'Plafond micro (€)', euros(s.activity_kind === 'sales' ? s.threshold_micro_sales_cents : s.threshold_micro_services_cents), 'type="number"')}
        </div>
      </fieldset>
      <fieldset><legend>Sécurité</legend>
        <div class="field-row c3">
          <div class="field"><label>Mot de passe actuel</label><input id="pw-cur" type="password"></div>
          <div class="field"><label>Nouveau mot de passe</label><input id="pw-new" type="password"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" id="pw-go">Changer le mot de passe</button></div>
        </div>
      </fieldset>
    </div>`, '#/settings');

  document.getElementById('s-save').onclick = async () => {
    const g = (id) => document.getElementById(id).value;
    const body = {};
    for (const key of ['company_name', 'legal_form', 'siren', 'siret', 'ape_code', 'address_line1',
      'postal_code', 'city', 'country', 'email', 'phone', 'vat_regime', 'vat_number',
      'vat_exemption_mention', 'iban', 'bic', 'late_penalty_rate', 'mention_escompte', 'footer_note',
      'number_format_invoice', 'number_format_quote', 'number_format_credit_note', 'activity_kind']) {
      body[key] = g('s-' + key);
    }
    body.default_vat_rate = Number(g('s-default_vat_rate'));
    body.payment_terms_days = Number(g('s-payment_terms_days')) || 0;
    body.quote_validity_days = Number(g('s-quote_validity_days')) || 0;
    const vatCents = (Number(g('s-threshold_vat')) || 0) * 100;
    const microCents = (Number(g('s-threshold_micro')) || 0) * 100;
    if (body.activity_kind === 'sales') {
      body.threshold_vat_sales_cents = vatCents;
      body.threshold_micro_sales_cents = microCents;
    } else {
      body.threshold_vat_services_cents = vatCents;
      body.threshold_micro_services_cents = microCents;
    }
    try {
      await api('/api/settings', { method: 'PUT', body });
      toast('Paramètres enregistrés');
    } catch (e) { toast(e.message, true); }
  };

  document.getElementById('pw-go').onclick = async () => {
    try {
      await api('/api/password', {
        method: 'POST',
        body: { current: document.getElementById('pw-cur').value, next: document.getElementById('pw-new').value },
      });
      toast('Mot de passe modifié');
    } catch (e) { toast(e.message, true); }
  };
}

/* --------------------------------------------------------------- routeur */

async function route() {
  const hash = location.hash || '#/dashboard';
  try {
    let m;
    if (hash === '#/dashboard') await viewDashboard();
    else if ((m = hash.match(/^#\/documents\/(quote|invoice|credit_note)$/))) await viewDocuments(m[1]);
    else if ((m = hash.match(/^#\/doc\/new\/(quote|invoice)$/))) await newDocument(m[1]);
    else if ((m = hash.match(/^#\/doc\/(\d+)$/))) await viewDocument(m[1]);
    else if (hash === '#/clients') await viewClients();
    else if (hash === '#/catalog') await viewCatalog();
    else if (hash === '#/settings') await viewSettings();
    else { location.hash = '#/dashboard'; }
  } catch (e) {
    if (e.message !== 'Session expirée') toast(e.message, true);
  }
}

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    await api('/api/me');
    route();
  } catch {
    /* renderAuth déjà déclenché par api() sur 401 */
  }
})();
