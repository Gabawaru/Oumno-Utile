// Client Supabase minimal, réduit à ce dont l'application se sert.
//
// Volontairement pas de dépendance chargée depuis un CDN : si le réseau du
// visiteur bloque ce CDN, la page entière resterait blanche. Ici tout est servi
// depuis le même domaine que la page.
//
// La clé publique circule dans le navigateur : c'est son usage prévu. Ce sont
// les politiques de sécurité au niveau des lignes qui protègent les données.

const TOK = "ciel.session";

export function creerClient(url, cle) {
  let session = charger();
  const abonnes = [];

  function charger() {
    try {
      const s = JSON.parse(localStorage.getItem(TOK) || "null");
      return s && s.access_token ? s : null;
    } catch { return null; }
  }
  function retenir(s) {
    session = s && s.access_token ? s : null;
    try {
      if (session) localStorage.setItem(TOK, JSON.stringify(session));
      else localStorage.removeItem(TOK);
    } catch {}
  }
  function prevenir(evt) { abonnes.forEach((f) => { try { f(evt, session); } catch {} }); }

  const entetes = (auth = true) => {
    const h = { apikey: cle, "Content-Type": "application/json" };
    h.Authorization = `Bearer ${auth && session ? session.access_token : cle}`;
    return h;
  };

  async function appelAuth(chemin, corps, methode = "POST") {
    const r = await fetch(`${url}/auth/v1/${chemin}`, {
      method: methode, headers: entetes(), body: corps ? JSON.stringify(corps) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { data: null, error: { message: d.msg || d.error_description || d.message || `Erreur ${r.status}`, code: d.error_code || d.code } };
    return { data: d, error: null };
  }

  /** Renouvelle le jeton quand il est expiré ou sur le point de l'être. */
  async function rafraichir() {
    if (!session?.refresh_token) return false;
    const { data, error } = await appelAuth("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    if (error || !data?.access_token) { retenir(null); return false; }
    retenir(data);
    return true;
  }
  function expire() {
    if (!session?.expires_at) return false;
    return Date.now() / 1000 > session.expires_at - 60;
  }

  const auth = {
    async getSession() {
      if (session && expire()) await rafraichir();
      return { data: { session }, error: null };
    },
    async signUp({ email, password, options = {} }) {
      const { data, error } = await appelAuth("signup", {
        email, password, data: options.data, redirect_to: options.emailRedirectTo,
      });
      if (error) return { data: null, error };
      if (data.access_token) { retenir(data); prevenir("SIGNED_IN"); }
      return { data: { session: data.access_token ? data : null, user: data.user || data }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const { data, error } = await appelAuth("token?grant_type=password", { email, password });
      if (error) return { data: null, error };
      retenir(data); prevenir("SIGNED_IN");
      return { data: { session: data }, error: null };
    },
    async signOut() {
      if (session) await appelAuth("logout", {}).catch(() => {});
      retenir(null); prevenir("SIGNED_OUT");
      return { error: null };
    },
    async resetPasswordForEmail(email, opts = {}) {
      const q = opts.redirectTo ? `recover?redirect_to=${encodeURIComponent(opts.redirectTo)}` : "recover";
      return appelAuth(q, { email });
    },
    async updateUser(champs) {
      const { data, error } = await appelAuth("user", champs, "PUT");
      return { data, error };
    },
    onAuthStateChange(fn) {
      abonnes.push(fn);
      return { data: { subscription: { unsubscribe() { const i = abonnes.indexOf(fn); if (i >= 0) abonnes.splice(i, 1); } } } };
    },
    /** Reprend la session déposée par le lien de réinitialisation reçu par courriel. */
    async recupererDepuisUrl() {
      const h = new URLSearchParams(location.hash.slice(1));
      if (!h.get("access_token")) return null;
      const s = {
        access_token: h.get("access_token"),
        refresh_token: h.get("refresh_token"),
        expires_at: Number(h.get("expires_at")) || Math.floor(Date.now() / 1000) + 3600,
        token_type: h.get("token_type"),
      };
      retenir(s);
      history.replaceState(null, "", location.pathname + location.search);
      const type = h.get("type");
      prevenir(type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN");
      return type;
    },
    get session() { return session; },
  };

  /** Requête sur une table, style PostgREST. */
  function from(table) {
    const f = [];
    let colonnes = "*", tri = "", limite = "", unique = false;
    const q = {
      select(c = "*") { colonnes = c; return q; },
      eq(col, val) { f.push(`${col}=eq.${encodeURIComponent(val)}`); return q; },
      order(col, o = {}) { tri = `order=${col}.${o.ascending === false ? "desc" : "asc"}`; return q; },
      limit(n) { limite = `limit=${n}`; return q; },
      maybeSingle() { unique = true; return q.then(undefined); },
      async then(res, rej) {
        const p = executer();
        return p.then(res, rej);
      },
      async insert(corps) { return ecrire("POST", corps); },
      async update(corps) { q._maj = corps; return q; },
    };
    async function executer() {
      const parts = [`select=${colonnes}`, ...f, tri, limite].filter(Boolean);
      if (q._maj) return ecrire("PATCH", q._maj);
      const r = await requete(`${url}/rest/v1/${table}?${parts.join("&")}`, { headers: entetes() });
      if (r.error) return r;
      return { data: unique ? (r.data?.[0] ?? null) : r.data, error: null };
    }
    async function ecrire(methode, corps) {
      const parts = f.filter(Boolean);
      const r = await requete(`${url}/rest/v1/${table}${parts.length ? "?" + parts.join("&") : ""}`, {
        method: methode,
        headers: { ...entetes(), Prefer: "return=minimal" },
        body: JSON.stringify(corps),
      });
      return { data: null, error: r.error };
    }
    return q;
  }

  /** Un seul renvoi automatique après renouvellement du jeton. */
  async function requete(u, init, reessai = true) {
    let r;
    try { r = await fetch(u, init); }
    catch { return { data: null, error: { message: "Réseau indisponible" } }; }
    if (r.status === 401 && reessai && (await rafraichir())) {
      return requete(u, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` } }, false);
    }
    const txt = await r.text();
    const d = txt ? JSON.parse(txt) : null;
    if (!r.ok) return { data: null, error: { message: d?.message || d?.msg || `Erreur ${r.status}`, code: d?.code } };
    return { data: d, error: null };
  }

  return { auth, from };
}
