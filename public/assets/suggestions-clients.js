/* ═══════════════════════════════════════════════════════════════════════
   SUGGESTIONS DE LA BASE CLIENTS AU FIL DE LA FRAPPE
   Utilisé par la Vue équipe (planning-equipe.html, « + chantier ») et par l'agenda
   du dirigeant (agenda.html, titre du RDV) — même règle que « Ajouter un chantier »
   de la saisie mobile (saisie.html).

   Sources (comme la page Clients) :
     • fiches clients / chantiers de Suiv'Heures (coordonneesChantiersdata, sur le
       téléphone) — prioritaires ;
     • liste de clients importée (copie de l'export Henrri, si l'entreprise l'a importée
       et que l'option est active), via /api/saisies/clients-noms (nom + ville) ;
     • noms propres à la page (extras), ex. chantiers du planning pour l'agenda.
   La liste serveur est mémorisée sur le téléphone ('clientsBaseMobile', par code
   entreprise — même clé que la saisie mobile) pour fonctionner hors connexion.

   API :
     SuggClients.attacher(input, { extras: () => [noms], onChoix: cli => {} })
       → affiche la liste sous le champ ; cli = { nom, ville, src: 'fiche'|'henrri'|'extra', id }
     SuggClients.choix(input)   → dernière suggestion touchée pour ce champ (ou null si
                                   le texte a été retapé depuis)
     SuggClients.fiche(cli, { apercu })
       → coordonnées d'un client de la liste importée : { adresse, ville, mobile, fixe, email }
         apercu=true : lecture seule ; sinon la fiche du chantier est créée (jamais écrasée)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const CLE = 'clientsBaseMobile';
  const MAX = 8;

  function lsJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } }
  function norm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function code() { return (localStorage.getItem('saisie_codeEmploye') || '').trim().toUpperCase(); }
  function salarieId() { const s = lsJSON('saisie_salarie', null); return s && s.id; }

  /* ── Styles (injectés une fois) ── */
  function styles() {
    if (document.getElementById('sgc-style')) return;
    const st = document.createElement('style');
    st.id = 'sgc-style';
    st.textContent =
      '.sgc-liste{margin:-6px 0 12px;border:1px solid #dbe3ec;border-radius:10px;background:#fff;overflow:hidden;box-shadow:0 4px 14px rgba(15,58,138,.08);max-height:42vh;overflow-y:auto}' +
      '.sgc-liste:empty{display:none}' +
      '.sgc-titre{font-size:.7rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;padding:7px 10px 3px}' +
      '.sgc-item{display:flex;align-items:center;gap:8px;width:100%;border:0;border-top:1px solid #eef2f7;background:#fff;padding:10px;text-align:left;font:inherit;font-size:.9rem;color:#0f172a;cursor:pointer}' +
      '.sgc-item:first-of-type{border-top:0}' +
      '.sgc-item:active,.sgc-item:hover{background:#f5f8ff;color:#0f3a8a}' +
      '.sgc-nom{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-weight:600}' +
      '.sgc-nom mark{background:#fde68a;color:inherit;border-radius:2px;padding:0}' +
      '.sgc-ville{flex:0 0 auto;font-size:.75rem;color:#64748b;font-weight:400;max-width:45%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    document.head.appendChild(st);
  }

  /* ── Base locale : fiches du téléphone (prioritaires) + liste mémorisée ── */
  function base(extras) {
    const parCle = new Map(), fiches = new Set();
    const co = lsJSON('coordonneesChantiersdata', {}) || {};
    Object.keys(co).forEach(n => {
      const k = String(n).trim().toUpperCase();
      if (!k || fiches.has(k) || k === 'TEMPS NON AFFECTE') return;
      fiches.add(k);
      parCle.set(k, { nom: k, ville: String((co[n] && co[n].ville) || '').replace(/\s*\n\s*/g, ' ').trim(), src: 'fiche' });
    });
    const c = lsJSON(CLE, null);
    if (c && c.code === code() && Array.isArray(c.clients)) c.clients.forEach(x => {
      if (!x || !x.nom) return;
      const k = String(x.nom).toUpperCase();
      if (x.src === 'fiche') { if (!fiches.has(k)) { fiches.add(k); parCle.set(k, { nom: k, ville: x.ville || '', src: 'fiche' }); } return; }
      if (fiches.has(k)) return;
      const cle = k + '|' + String(x.ville || '').toUpperCase();
      if (!parCle.has(cle)) parCle.set(cle, { nom: k, ville: x.ville || '', src: 'henrri', id: x.id || '' });
    });
    (extras || []).forEach(n => {
      const k = String(n || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!k || k === 'TEMPS NON AFFECTE' || fiches.has(k) || [...parCle.values()].some(v => v.nom === k)) return;
      parCle.set(k, { nom: k, ville: '', src: 'extra' });
    });
    return [...parCle.values()].map(x => Object.assign(x, { _n: norm(x.nom) }));
  }

  /* ── Rafraîchissement depuis le serveur (en fond, une fois par minute au plus) ── */
  let _dernierChargement = 0, _enCours = null;
  function charger() {
    const ce = code(), sid = salarieId();
    if (!ce || !sid || navigator.onLine === false) return Promise.resolve(false);
    if (_enCours) return _enCours;
    if (Date.now() - _dernierChargement < 60000) return Promise.resolve(false);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const minuteur = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    _enCours = fetch('/api/saisies/clients-noms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codeEmploye: ce, salarieId: sid }), signal: ctrl ? ctrl.signal : undefined
    }).then(r => r.json()).then(d => {
      if (!d || !d.ok || !Array.isArray(d.clients)) return false;
      try { localStorage.setItem(CLE, JSON.stringify({ code: ce, le: Date.now(), clients: d.clients })); } catch (_) {}
      _dernierChargement = Date.now();
      return true;
    }).catch(() => false).finally(() => { if (minuteur) clearTimeout(minuteur); _enCours = null; });
    return _enCours;
  }

  /* ── Classement : nom qui commence par la saisie, puis un mot qui commence par la
     saisie ; saisie trouvée en milieu de mot seulement à défaut de mieux. ── */
  function chercher(liste, brut) {
    const q = norm(brut);
    if (!q) return [];
    const mots = q.split(' ');
    const res = [];
    for (const c of liste) {
      if (!mots.every(m => c._n.includes(m))) continue;
      let rang = 2;
      if (c._n.startsWith(q)) rang = 0;
      else if (mots.every(m => c._n.split(/[ \-']/).some(w => w.startsWith(m)))) rang = 1;
      res.push({ c, rang });
      if (res.length > 400) break;
    }
    res.sort((a, b) => a.rang - b.rang || a.c.nom.localeCompare(b.c.nom, 'fr'));
    const top = (res.some(r => r.rang < 2) ? res.filter(r => r.rang < 2) : res).slice(0, MAX).map(r => r.c);
    if (top.length === 1 && top[0]._n === q) return [];      // nom déjà tapé en entier
    return top;
  }
  function surligner(nom, brut) {
    const mots = norm(brut).split(' ').filter(Boolean);
    const n = norm(nom), zones = [];
    mots.forEach(m => { const i = n.indexOf(m); if (i >= 0) zones.push([i, i + m.length]); });
    zones.sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    zones.forEach(([a, b]) => { if (a < pos) return; out += esc(nom.slice(pos, a)) + '<mark>' + esc(nom.slice(a, b)) + '</mark>'; pos = b; });
    return out + esc(nom.slice(pos));
  }

  const _choix = new WeakMap();
  function attacher(input, opts) {
    if (!input || input._sgc) return;
    opts = opts || {};
    styles();
    input._sgc = true;
    input.setAttribute('autocomplete', 'off');
    input.removeAttribute('list');                    // remplace une éventuelle <datalist>
    const liste = document.createElement('div');
    liste.className = 'sgc-liste';
    input.insertAdjacentElement('afterend', liste);
    let cache = null;
    const extras = () => { try { return typeof opts.extras === 'function' ? opts.extras() : []; } catch (_) { return []; } };
    const rendre = () => {
      if (!cache) cache = base(extras());
      const brut = input.value;
      const top = chercher(cache, brut);
      liste.innerHTML = top.length
        ? '<div class="sgc-titre">Clients connus</div>' + top.map((c, i) =>
            '<button type="button" class="sgc-item" data-i="' + i + '"><span aria-hidden="true">👤</span><span class="sgc-nom">' + surligner(c.nom, brut) + '</span>'
            + (c.ville ? '<span class="sgc-ville">' + esc(c.ville) + '</span>' : '') + '</button>').join('')
        : '';
      liste._top = top;
    };
    input.addEventListener('focus', () => {
      cache = null;
      charger().then(ok => { if (ok) { cache = null; if (document.activeElement === input) rendre(); } });
    });
    input.addEventListener('input', e => {
      if (e && e._sgc) return;                        // valeur posée par une suggestion
      _choix.delete(input);
      rendre();
    });
    // pointerdown : garde le focus du champ le temps de choisir (pas de clavier qui se ferme)
    liste.addEventListener('pointerdown', e => { if (e.target.closest('.sgc-item')) e.preventDefault(); });
    liste.addEventListener('click', e => {
      const b = e.target.closest('.sgc-item');
      if (!b || !liste._top) return;
      const cli = liste._top[+b.getAttribute('data-i')];
      if (!cli) return;
      input.value = cli.nom;
      _choix.set(input, { nom: cli.nom, ville: cli.ville, src: cli.src, id: cli.id || '' });
      liste.innerHTML = '';
      // Prévient la page (ex. agenda : reprise des coordonnées d'une fiche existante)
      ['input', 'change'].forEach(t => { const ev = new Event(t, { bubbles: true }); ev._sgc = true; input.dispatchEvent(ev); });
      if (typeof opts.onChoix === 'function') { try { opts.onChoix(_choix.get(input)); } catch (_) {} }
    });
    // Champ vidé / page refermée : liste effacée
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) liste.innerHTML = ''; }, 150));
  }
  function choix(input) {
    const c = _choix.get(input);
    return (c && String(input.value || '').trim().toUpperCase() === c.nom) ? c : null;
  }

  /* Coordonnées d'un client de la liste importée (apercu = sans rien enregistrer). */
  async function fiche(cli, o) {
    if (!cli || cli.src !== 'henrri') return null;
    const ce = code(), sid = salarieId();
    if (!ce || !sid) return null;
    try {
      const r = await fetch('/api/saisies/client-fiche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeEmploye: ce, salarieId: sid, nom: cli.nom, id: cli.id || '', apercu: !!(o && o.apercu) })
      });
      const d = await r.json();
      if (!d || !d.ok || !d.coordonnees) return null;
      if (!(o && o.apercu)) {
        const co = lsJSON('coordonneesChantiersdata', {}) || {};
        co[cli.nom] = d.coordonnees;
        try { localStorage.setItem('coordonneesChantiersdata', JSON.stringify(co)); } catch (_) {}
      }
      return Object.assign({ cree: !!d.cree }, d.coordonnees);
    } catch (_) { return null; }
  }

  window.SuggClients = { attacher, choix, fiche, charger };
})();
