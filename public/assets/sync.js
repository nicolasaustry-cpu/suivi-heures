/* =====================================================
   SYNC.JS – Synchronisation localStorage <-> MongoDB
   Règles (réécriture du 02/06/2026) :
   - Le SERVEUR fait référence. Toute modification d'une session client est
     poussée immédiatement au serveur ; les autres appareils lisent le serveur.
   - Sauvegarde fiable : envoi immédiat (faible coalescence) + envoi de sécurité
     avant que la page soit quittée/masquée (rien n'est perdu, PIN compris).
   - Au chargement, on ne remplace le local par le serveur QUE si aucune
     sauvegarde n'est en attente (jamais d'écrasement d'une saisie récente).
   - Cloisonnement strict par licence.
   - Session ADMIN = LECTURE SEULE : aucune écriture vers le serveur.
===================================================== */

const SYNC = (() => {

  // Version visible (pour savoir ce qui tourne réellement en ligne)
  const VERSION = 'v2026.06.19-sync5';

  const API = '';
  let _token    = null;
  let _clientId = null;
  let _type     = null;            // "standard" ou "plus"
  let _modeAdmin = false;          // true = consultation admin (lecture seule)
  let _syncTimer = null;
  let _pendingSave = false;        // une modification locale attend d'être poussée
  let _deconnexionEnCours = false;

  // Coalescence courte : regroupe quelques frappes rapprochées sans fragiliser.
  const SAVE_DELAY = 400;

  const CLES = ['entreprisedata', 'salariesdata', 'heuresdata', 'chantiersdata', 'previsionnel_data'];

  const PAGES_LIBRES = ['index.html', '/', ''];
  const PAGES_PLUS = ['realise.html', 'notes.html'];
  const PAGES_LIBRES_TOTAL = ['index.html', '/', '', 'saisie.html', 'planning-equipe.html'];

  /* ── Intercepteur global fetch : 401/403 sur /api/* (hors saisie mobile) → déconnexion propre ── */
  const _fetchOriginal = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const res = await _fetchOriginal(input, init);
    const estApi    = url.includes('/api/');
    const estSaisie = url.includes('/api/saisies/');
    if (estApi && !estSaisie && (res.status === 401 || res.status === 403) && !_deconnexionEnCours) {
      _deconnexionEnCours = true;
      console.warn('Session expirée → déconnexion');
      localStorage.removeItem('syncToken');
      localStorage.removeItem('syncClientId');
      localStorage.removeItem('syncType');
      if (!PAGES_LIBRES_TOTAL.includes(pageActuelle())) {
        afficherNotif('⚠ Session expirée, reconnectez-vous', '#dc2626');
        setTimeout(() => { window.location.href = '/index.html?erreur=licence'; }, 1500);
      }
    }
    return res;
  };

  function pageActuelle() {
    return window.location.pathname.split('/').pop() || 'index.html';
  }

  function redirigerVersAccueil() {
    const page = pageActuelle();
    if (!PAGES_LIBRES.includes(page) && !PAGES_LIBRES_TOTAL.includes(page)) {
      window.location.href = '/index.html?erreur=licence';
    }
  }

  function verifierAccesPlus() {
    const page = pageActuelle();
    if (PAGES_PLUS.includes(page) && _type !== 'plus') {
      window.location.href = '/index.html?erreur=plus';
    }
  }

  async function init() {
    _token    = localStorage.getItem('syncToken');
    _clientId = localStorage.getItem('syncClientId');
    _type     = localStorage.getItem('syncType');

    // Mode admin (consultation d'un client) = lecture seule.
    // Détecté via l'URL (1re page) OU via sessionStorage (pages suivantes du même onglet).
    const params = new URLSearchParams(window.location.search);
    _modeAdmin = params.get('admin') === '1'
              || sessionStorage.getItem('adminConsult') === '1';

    afficherVersion();

    if (PAGES_LIBRES_TOTAL.includes(pageActuelle())) {
      if (_token && _type) { majStatutLicence(true); majNav(); }
      return;
    }

    if (!_token || !_clientId) {
      const code = localStorage.getItem('licenceCode');
      if (code) {
        const ok = await connecter(code);
        if (!ok) redirigerVersAccueil();
      } else {
        redirigerVersAccueil();
      }
      return;
    }

    try {
      const r = await fetch(API + '/api/auth/verify', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      const d = await r.json();
      if (!d.ok) {
        const code = localStorage.getItem('licenceCode');
        if (code) {
          const ok = await connecter(code);
          if (!ok) redirigerVersAccueil();
        } else {
          localStorage.removeItem('syncToken');
          localStorage.removeItem('syncClientId');
          localStorage.removeItem('syncType');
          redirigerVersAccueil();
        }
        return;
      }
      _type = d.type || 'standard';
      localStorage.setItem('syncType', _type);
      if (d.nomClient) localStorage.setItem('syncNomClient', d.nomClient);
      verifierAccesPlus();
      majStatutLicence(true);
      majNav();
      await chargerDonnees();
    } catch {
      console.log('Suiv\'Heures : mode hors ligne');
    }
  }

  async function connecter(code) {
    try {
      const r = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const d = await r.json();
      if (!d.ok) {
        majStatutLicence(false, d.message);
        return false;
      }

      // Cloisonnement strict : si le client diffère de celui mémorisé (y compris
      // si aucun n'était mémorisé), on purge le local AVANT tout affichage.
      const ancienClient = localStorage.getItem('syncClientId');
      const changementClient = ancienClient !== d.clientId;
      if (changementClient) {
        CLES.forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('syncNomClient');
        _pendingSave = false;
      }

      _token    = d.token;
      _clientId = d.clientId;
      _type     = d.type || 'standard';
      localStorage.setItem('syncToken',    _token);
      localStorage.setItem('syncClientId', _clientId);
      localStorage.setItem('syncType',     _type);
      localStorage.setItem('licenceCode',  code);
      if (d.nomClient) localStorage.setItem('syncNomClient', d.nomClient);

      majStatutLicence(true);
      majNav();
      await chargerDonnees();

      if (changementClient) { location.reload(); return true; }
      return true;
    } catch {
      majStatutLicence(true, 'local');
      return true;
    }
  }

  /* ── Chargement depuis le serveur (référence) ──
     On NE remplace PAS le local si une sauvegarde est en attente (_pendingSave),
     afin de ne jamais écraser une saisie récente non encore synchronisée. */
  async function chargerDonnees() {
    try {
      const r = await fetch(API + '/api/data', {
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      const d = await r.json();
      if (!d.ok) return;
      const serveur = d.data || {};

      const aDesDonneesServeur = (serveur.salaries?.length > 0)
        || Object.keys(serveur.heures || {}).length > 0;
      const aDesDonneesLocales = CLES.some(cle => {
        const local = localStorage.getItem(cle);
        if (!local) return false;
        try {
          const parsed = JSON.parse(local);
          return Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0;
        } catch { return false; }
      });
      const localClientId = localStorage.getItem('syncClientId');

      // Cas 1 : une modification locale attend d'être poussée → on garde le local
      // (il est plus récent et sera envoyé au serveur). Pas d'écrasement.
      if (_pendingSave && !_modeAdmin) {
        window.dispatchEvent(new Event('donnees-chargees'));
        return;
      }

      // Cas 2 : le local a des données, le serveur est vide, même client, hors admin
      // → première synchronisation : on pousse le local vers le serveur.
      if (aDesDonneesLocales && !aDesDonneesServeur && !_modeAdmin && localClientId === _clientId) {
        await sauvegarderTout();
        afficherNotif('✔ Données synchronisées', '#16a34a');
        window.dispatchEvent(new Event('donnees-chargees'));
        return;
      }

      // Cas 3 (par défaut) : le SERVEUR fait référence → on remplace le local.
      const entServeur = serveur.entreprise || {};
      if (!entServeur.nom) {
        const nomClient = localStorage.getItem('syncNomClient');
        if (nomClient) entServeur.nom = nomClient;
      }
      ecrireLocalSansDeclencher('entreprisedata',    JSON.stringify(entServeur));
      ecrireLocalSansDeclencher('salariesdata',      JSON.stringify(serveur.salaries     || []));
      ecrireLocalSansDeclencher('heuresdata',        JSON.stringify(serveur.heures       || {}));
      ecrireLocalSansDeclencher('chantiersdata',     JSON.stringify(serveur.chantiers    || []));
      ecrireLocalSansDeclencher('previsionnel_data', JSON.stringify(serveur.previsionnel || {}));
      window.dispatchEvent(new Event('donnees-chargees'));
    } catch {
      console.warn('Impossible de charger les données du serveur');
    }
  }

  /* Écrit dans le localStorage SANS redéclencher une sauvegarde serveur
     (sinon le chargement depuis le serveur relancerait une écriture en boucle). */
  let _ecritureInterne = false;
  function ecrireLocalSansDeclencher(cle, valeur) {
    _ecritureInterne = true;
    _setItemOriginal(cle, valeur);
    _ecritureInterne = false;
  }

  /* ── Déclenchement d'une sauvegarde (immédiate, faible coalescence) ── */
  function declencherSauvegarde() {
    if (_modeAdmin) return;          // admin = lecture seule
    if (!_token) return;
    _pendingSave = true;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(sauvegarderTout, SAVE_DELAY);
  }

  function construirePayload() {
    return {
      entreprise:   JSON.parse(localStorage.getItem('entreprisedata')    || '{}'),
      salaries:     JSON.parse(localStorage.getItem('salariesdata')      || '[]'),
      heures:       JSON.parse(localStorage.getItem('heuresdata')        || '{}'),
      chantiers:    JSON.parse(localStorage.getItem('chantiersdata')     || '[]'),
      previsionnel: JSON.parse(localStorage.getItem('previsionnel_data') || '{}'),
    };
  }

  async function sauvegarderTout() {
    if (_modeAdmin) return;          // admin = lecture seule
    if (!_token) return;
    clearTimeout(_syncTimer);
    _syncTimer = null;
    try {
      const res = await fetch(API + '/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify(construirePayload())
      });
      if (res.ok) _pendingSave = false;
    } catch {
      console.warn('Sauvegarde échouée (sera retentée)');
    }
  }

  /* Envoi de sécurité avant de quitter/masquer la page : garantit qu'une saisie
     récente (ex. PIN) atteint le serveur même si on quitte avant la coalescence. */
  function flushSauvegarde() {
    if (_modeAdmin || !_token || !_pendingSave) return;
    clearTimeout(_syncTimer);
    _syncTimer = null;
    // sendBeacon : seul transport fiable au déchargement sur Safari/iOS.
    // Le jeton voyage dans le corps (sendBeacon n'autorise pas les en-têtes),
    // le serveur accepte ce repli via req.body._token.
    if (navigator.sendBeacon) {
      try {
        const corps = JSON.stringify(Object.assign({ _token: _token }, construirePayload()));
        const blob  = new Blob([corps], { type: 'application/json' });
        if (navigator.sendBeacon(API + '/api/data', blob)) { _pendingSave = false; return; }
      } catch (e) {}
    }
    // Repli : fetch keepalive (Chrome/Firefox).
    try {
      fetch(API + '/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify(construirePayload()),
        keepalive: true
      }).then(() => { _pendingSave = false; }).catch(() => {});
    } catch {}
  }
  window.addEventListener('pagehide', flushSauvegarde);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSauvegarde();
  });

  // Intercepter localStorage.setItem : toute écriture applicative déclenche une sauvegarde
  const _setItemOriginal = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(cle, valeur) {
    _setItemOriginal(cle, valeur);
    if (!_ecritureInterne && CLES.includes(cle)) declencherSauvegarde();
  };

  // Navigation selon le type de licence
  function majNav() {
    const nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) return;
    nav.querySelectorAll('.nav-plus').forEach(el => el.remove());
    const page = pageActuelle();
    if (_type === 'plus') {
      const rapportsLink = nav.querySelector('a[href="rapports.html"]');
      if (rapportsLink) rapportsLink.remove();

      // « Vue équipe » (vert) inséré juste après « Planning »
      const planningLink = nav.querySelector('a[href="planning.html"]');
      if (planningLink) {
        const ve = document.createElement('a');
        ve.href = 'planning-equipe.html';
        ve.textContent = 'Vue équipe';
        ve.className = 'nav-plus';
        if (page === 'planning-equipe.html') ve.classList.add('active');
        planningLink.insertAdjacentElement('afterend', ve);
      }

      const liens = [
        { href: 'saisie.html',  label: 'Saisie mobile' },
        { href: 'realise.html', label: 'Planning réalisé' },
        { href: 'notes.html',   label: 'Notes' },
        { href: 'rapports.html', label: 'Rapports' },
        { href: 'bev.html',     label: 'BEV' },
      ];
      liens.forEach(l => {
        const a = document.createElement('a');
        a.href = l.href; a.textContent = l.label; a.className = 'nav-plus';
        if (l.href === page) a.classList.add('active');
        nav.appendChild(a);
      });
    } else {
      // Standard : « Vue équipe » (planning seul) insérée juste après « Planning »
      if (!nav.querySelector('a[href="planning-equipe.html"]')) {
        const planningLink = nav.querySelector('a[href="planning.html"]');
        if (planningLink) {
          const ve = document.createElement('a');
          ve.href = 'planning-equipe.html';
          ve.textContent = 'Vue équipe';
          if (page === 'planning-equipe.html') ve.classList.add('active');
          planningLink.insertAdjacentElement('afterend', ve);
        }
      }
      // BEV accessible aussi (après Rapports)
      if (!nav.querySelector('a[href="bev.html"]')) {
        const a = document.createElement('a');
        a.href = 'bev.html'; a.textContent = 'BEV'; a.className = 'nav-plus';
        if (page === 'bev.html') a.classList.add('active');
        nav.appendChild(a);
      }
    }
    construireMenuLateral();
  }

  /* ─────────────────────────────────────────────────────────────
     Menu commun responsive (Brique 2)
     Grand écran souris (≥1100px) : menu latéral fixe à gauche, sous le bandeau.
     Sinon (tablette / téléphone / tactile) : barre existante.
     En Standard, les entrées Plus sont affichées en « teasing » :
     un clic ouvre un pop-up invitant à passer en licence Plus.
     ───────────────────────────────────────────────────────────── */
  var _menuListenersPoses = false;
  var _lateralPrec = null;

  // Pages où le menu latéral s'applique.
  var MENU_PAGES = ['index.html', 'salaries.html', 'chantiers.html', 'planning.html',
    'planning-equipe.html', 'rapports.html', 'realise.html', 'notes.html', 'bev.html'];

  // Structure canonique du menu (indépendante de la licence).
  var MENU_GROUPES = [
    { label: 'Gestion', items: [
      { href: 'index.html',     label: 'Entreprise' },
      { href: 'salaries.html',  label: 'Salariés' },
      { href: 'chantiers.html', label: 'Prévisionnel' }
    ] },
    { label: 'Planning', items: [
      { href: 'planning.html',         label: 'Planning' },
      { href: 'planning-equipe.html',  label: 'Vue équipe' },            // les deux licences
      { href: 'realise.html',          label: 'Planning réalisé', plus: true },
      { href: 'saisie.html',           label: 'Saisie mobile',    plus: true }
    ] },
    { label: 'Suivi', items: [
      { href: 'rapports.html', label: 'Rapports' },
      { href: 'notes.html',    label: 'Notes', plus: true },
      { href: 'bev.html',      label: 'BEV' }
    ] }
  ];

  function injecterStyleMenu() {
    if (document.getElementById('sh-menu-style')) return;
    const css =
      '.sh-rail{position:fixed;top:0;left:0;bottom:0;width:208px;background:#0f2747;' +
      'padding:14px 9px;overflow-y:auto;z-index:90;box-sizing:border-box;font-family:Arial,sans-serif;}' +
      '.sh-rail .sh-grp{font-size:0.72rem;color:#7e92b4;padding:11px 9px 4px;}' +
      '.sh-rail a.sh-i{display:block;color:#cdd8ea;text-decoration:none;font-size:0.9rem;' +
      'padding:8px 10px;border-radius:8px;margin-bottom:2px;}' +
      '.sh-rail a.sh-i:hover{background:#17335a;color:#fff;}' +
      '.sh-rail a.sh-i.active{background:#1d8cf0;color:#fff;}' +
      '.sh-rail a.sh-i.sh-lock{color:#8aa0c2;}' +
      '.sh-rail a.sh-i.sh-lock:hover{background:#17335a;color:#cdd8ea;}' +
      '.sh-rail .sh-plus{float:right;font-size:0.6rem;font-weight:700;background:#caa24a;' +
      'color:#241a06;border-radius:999px;padding:1px 7px;margin-left:6px;}' +
      'html.sh-lateral body{padding-left:208px;}' +
      'html.sh-lateral .nav{display:none !important;}' +
      'html.sh-lateral body > .main-header{margin-left:-208px;width:calc(100% + 208px);box-sizing:border-box;}';
    const st = document.createElement('style');
    st.id = 'sh-menu-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function popupPlus(label) {
    const ancien = document.getElementById('sh-plus-pop');
    if (ancien) ancien.remove();
    const ov = document.createElement('div');
    ov.id = 'sh-plus-pop';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,17,34,0.55);z-index:10050;' +
      'display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;max-width:430px;width:100%;border-radius:14px;' +
      'padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,0.3);color:#1f2937;box-sizing:border-box;';
    const safe = String(label || '').replace(/[&<>"']/g, m => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
    card.innerHTML =
      '<div style="margin-bottom:10px;"><span style="font-size:0.68rem;font-weight:700;letter-spacing:0.04em;' +
      'background:#caa24a;color:#241a06;border-radius:999px;padding:3px 10px;">LICENCE PLUS</span></div>' +
      '<h3 style="margin:0 0 8px;font-size:1.18rem;color:#0f2747;">« ' + safe + ' » fait partie de la licence Plus</h3>' +
      '<p style="margin:0 0 12px;font-size:0.9rem;color:#475569;line-height:1.5;">' +
      'Passez en Plus pour débloquer le suivi terrain complet :</p>' +
      '<ul style="margin:0 0 18px;padding-left:18px;font-size:0.9rem;color:#334155;line-height:1.7;">' +
      '<li><strong>Saisie mobile</strong> — vos salariés pointent depuis leur téléphone</li>' +
      '<li><strong>Planning réalisé</strong> — comparez le prévu et le réalisé d\'un coup d\'œil</li>' +
      '<li><strong>Notes</strong> — consignez les infos chantier par chantier</li>' +
      '</ul>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button type="button" id="sh-plus-later" style="background:#fff;border:1px solid #cbd5e1;color:#334155;' +
      'border-radius:8px;padding:8px 14px;font-size:0.88rem;font-weight:600;cursor:pointer;">Plus tard</button>' +
      '<button type="button" id="sh-plus-go" style="background:#0f2747;border:1px solid #0f2747;color:#fff;' +
      'border-radius:8px;padding:8px 14px;font-size:0.88rem;font-weight:600;cursor:pointer;">Découvrir la licence Plus</button>' +
      '</div>';
    ov.appendChild(card);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    const later = card.querySelector('#sh-plus-later');
    const go = card.querySelector('#sh-plus-go');
    if (later) later.addEventListener('click', () => ov.remove());
    if (go) go.addEventListener('click', () => {
      ov.remove();
      if (typeof window.ouvrirOffrePlus === 'function') { try { window.ouvrirOffrePlus(); } catch (_) {} }
    });
  }

  function construireMenuLateral() {
    const page = pageActuelle();
    if (!MENU_PAGES.includes(page)) return;
    injecterStyleMenu();

    const estPlus = (_type === 'plus');

    const ancien = document.getElementById('sh-rail');
    if (ancien) ancien.remove();

    const rail = document.createElement('nav');
    rail.id = 'sh-rail';
    rail.className = 'sh-rail';
    MENU_GROUPES.forEach(g => {
      const gl = document.createElement('div');
      gl.className = 'sh-grp';
      gl.textContent = g.label;
      rail.appendChild(gl);
      g.items.forEach(it => {
        const verrou = !!it.plus && !estPlus;   // Standard + page Plus → teasing
        const a = document.createElement('a');
        a.href = verrou ? '#' : it.href;
        a.className = 'sh-i' + (page === it.href ? ' active' : '') + (verrou ? ' sh-lock' : '');
        a.textContent = it.label;
        if (it.plus) {
          const b = document.createElement('span');
          b.className = 'sh-plus';
          b.textContent = 'Plus';
          a.appendChild(b);
        }
        if (verrou) {
          a.addEventListener('click', e => { e.preventDefault(); popupPlus(it.label); });
        }
        rail.appendChild(a);
      });
    });
    document.body.appendChild(rail);

    appliquerModeMenu();
    setTimeout(appliquerModeMenu, 0);     // recale une fois la page initialisée
    if (!_menuListenersPoses) {
      _menuListenersPoses = true;
      window.addEventListener('resize', appliquerModeMenu);
      if (window.matchMedia) {
        try { window.matchMedia('(pointer: coarse)').addEventListener('change', appliquerModeMenu); } catch (_) {}
      }
    }
  }

  function mesurerBandeau() {
    return document.querySelector('.top-bar')
        || document.querySelector('body > .main-header')
        || document.querySelector('.main-header');
  }

  function appliquerModeMenu() {
    const rail = document.getElementById('sh-rail');
    if (!rail) return;
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const lateral = (window.innerWidth >= 1100 && !coarse);
    document.documentElement.classList.toggle('sh-lateral', lateral);
    rail.style.display = lateral ? '' : 'none';
    if (lateral) {
      const bar = mesurerBandeau();
      rail.style.top = (bar ? bar.offsetHeight : 0) + 'px';   // démarrer sous le bandeau
    }
    const change = (lateral !== _lateralPrec);
    _lateralPrec = lateral;
    if (change) {
      // Laisser le CSS s'appliquer (nav masquée), puis demander à la page de recalculer son décalage.
      setTimeout(function () {
        const r = document.getElementById('sh-rail');
        if (r && lateral) {
          const bar = mesurerBandeau();
          r.style.top = (bar ? bar.offsetHeight : 0) + 'px';
        }
        try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      }, 0);
    }
  }

  function majStatutLicence(actif, message) {
    const el = document.getElementById('licence-status');
    if (!el) return;
    if (actif) {
      const badge = _type === 'plus' ? ' <span style="background:#fbbf24;color:#78350f;border-radius:999px;padding:1px 6px;font-size:0.7rem;font-weight:700;">PLUS</span>' : '';
      el.innerHTML =
        `<div><span style="color:#86efac;font-size:0.85rem;">✔ Licence active${badge}</span></div>` +
        `<button onclick="SYNC.seDeconnecter()" title="Se déconnecter et changer de licence" ` +
        `style="margin-top:6px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;padding:4px 12px;font-size:0.78rem;font-weight:600;cursor:pointer;">` +
        `⏻ Déconnexion</button>`;
    } else {
      el.innerHTML = `<span style="color:#fca5a5;font-size:0.85rem;">⚠ ${message || 'Licence invalide'}</span>`;
    }
  }

  // Petit indicateur de version, discret, en bas à gauche (présent sur toutes les pages)
  function afficherVersion() {
    if (document.getElementById('sync-version')) return;
    const ajoute = () => {
      if (!document.body || document.getElementById('sync-version')) return;
      const tag = document.createElement('div');
      tag.id = 'sync-version';
      tag.textContent = VERSION + (_modeAdmin ? ' (admin)' : '');
      tag.style.cssText = 'position:fixed;bottom:6px;left:6px;z-index:9997;font-size:12px;font-weight:700;color:#111827;background:rgba(255,255,255,0.92);padding:3px 8px;border-radius:8px;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-family:monospace;pointer-events:none;';
      document.body.appendChild(tag);
    };
    if (document.body) ajoute();
    else window.addEventListener('DOMContentLoaded', ajoute);
  }

  function seDeconnecter() {
    if (!confirm("Se déconnecter ?\n\nVos données serveur ne seront pas affectées.")) return;
    localStorage.clear();
    location.href = '/index.html';
  }

  function afficherNotif(texte, couleur = '#16a34a') {
    const div = document.createElement('div');
    div.textContent = texte;
    Object.assign(div.style, {
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      background: couleur, color: '#fff', padding: '10px 20px',
      borderRadius: '8px', fontWeight: '700', fontSize: '0.9rem',
      zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'opacity 0.5s'
    });
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
  }

  return {
    VERSION,
    init, connecter, sauvegarderTout, declencherSauvegarde, flushSauvegarde,
    afficherNotif, seDeconnecter,
    estConnecte: () => !!_token,
    estAdmin:    () => _modeAdmin,
    getClientId: () => _clientId,
    getType:     () => _type,
    getToken:    () => _token,
    estPlus:     () => _type === 'plus'
  };

})();

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const clientCode = params.get('client');
  const modeAdmin  = params.get('admin') === '1';

  // Entrée en consultation depuis l'admin (1re page, avec les paramètres d'URL)
  if (modeAdmin && clientCode) {
    const clientToken = sessionStorage.getItem('clientToken');
    const clientId    = sessionStorage.getItem('clientId');
    const clientNom   = sessionStorage.getItem('clientNom') || clientCode;
    const clientType  = sessionStorage.getItem('clientType') || 'standard';
    if (clientToken && clientId) {
      const keysToKeep = ['admin_token'];
      Object.keys(localStorage).forEach(k => {
        if (!keysToKeep.includes(k)) localStorage.removeItem(k);
      });
      localStorage.setItem('syncToken',    clientToken);
      localStorage.setItem('syncClientId', clientId);
      localStorage.setItem('syncType',     clientType);
      localStorage.setItem('licenceCode',  clientCode);
      // Mémoriser, pour CET onglet uniquement, qu'on est en consultation admin :
      // le bandeau et la lecture seule persisteront sur toutes les pages suivantes.
      sessionStorage.setItem('adminConsult', '1');
      sessionStorage.setItem('adminConsultNom', clientNom);
    }
  }

  // Bandeau orange de consultation : affiché sur TOUTES les pages tant que le flag
  // est présent dans cet onglet (évite toute confusion avec une session patron).
  if (sessionStorage.getItem('adminConsult') === '1') {
    afficherBanniereConsultation(sessionStorage.getItem('adminConsultNom') || '');
  }

  SYNC.init();
});

// Crée (sans doublon) le bandeau de consultation admin en haut de la page.
function afficherBanniereConsultation(clientNom) {
  if (document.getElementById('banniere-admin-consult')) return;
  const banniere = document.createElement('div');
  banniere.id = 'banniere-admin-consult';
  banniere.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:0.85rem;box-shadow:0 2px 6px rgba(0,0,0,0.25);';
  banniere.innerHTML = `👁 Mode consultation admin (lecture seule) – Client : <strong>${clientNom}</strong> &nbsp;|&nbsp; ` +
    `<a href="#" onclick="SYNC_quitterConsultation(event)" style="color:#000;text-decoration:underline;">Quitter la consultation</a> &nbsp;|&nbsp; ` +
    `<a href="/admin.html" style="color:#000;text-decoration:underline;">Retour admin</a>`;
  document.body.prepend(banniere);
}

// Quitter proprement la consultation : efface le mode pour cet onglet et revient à l'admin.
function SYNC_quitterConsultation(ev) {
  if (ev) ev.preventDefault();
  sessionStorage.removeItem('adminConsult');
  sessionStorage.removeItem('adminConsultNom');
  localStorage.clear();
  location.href = '/admin.html';
}
