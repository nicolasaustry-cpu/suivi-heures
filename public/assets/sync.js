/* =====================================================
   SYNC.JS – Synchronisation localStorage ↔ MongoDB
   Gestion licences Standard / Plus 
===================================================== */

const SYNC = (() => {

  const API = '';
  let _token    = null;
  let _clientId = null;
  let _type     = null; // "standard" ou "plus"
  let _syncTimer = null;
  let _deconnexionEnCours = false;
  const SYNC_DELAY = 2000;

  const CLES = ['entreprisedata', 'salariesdata', 'heuresdata', 'chantiersdata', 'previsionnel_data'];

  // Pages accessibles sans licence
  const PAGES_LIBRES = ['index.html', '/', ''];

  // Pages réservées Licence +
  // saisie.html est accessible sans licence (auth par PIN salarié)
  const PAGES_PLUS = ['realise.html'];
  // Pages totalement libres (pas de vérification licence)
  const PAGES_LIBRES_TOTAL = ['index.html', '/', '', 'saisie.html'];

  /* ── Intercepteur global fetch : détecte les 401/403 sur /api/* (hors saisie mobile)
     et déclenche une déconnexion propre. Ne fait rien pour les routes /api/saisies/*
     qui utilisent le code employé et non le JWT licence. ── */
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
      // Garder licenceCode pour pré-remplir le champ
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

    // Pages totalement libres : pas de vérification d'accès, mais si l'utilisateur
    // est déjà connecté (token présent), on met quand même à jour la nav et le badge
    // de licence pour refléter sa licence (Plus = Saisie mobile, Planning réalisé, …).
    if (PAGES_LIBRES_TOTAL.includes(pageActuelle())) {
      if (_token && _type) {
        majStatutLicence(true);
        majNav();
      }
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

      // Si on change de client, purger les anciennes données pour éviter qu'elles
      // restent affichées le temps que le nouveau client charge ses propres données.
      const ancienClient = localStorage.getItem('syncClientId');
      if (ancienClient && ancienClient !== d.clientId) {
        CLES.forEach(k => localStorage.removeItem(k));
      }

      _token    = d.token;
      _clientId = d.clientId;
      _type     = d.type || 'standard';
      localStorage.setItem('syncToken',    _token);
      localStorage.setItem('syncClientId', _clientId);
      localStorage.setItem('syncType',     _type);
      localStorage.setItem('licenceCode',  code);

      majStatutLicence(true);
      majNav();
      await chargerDonnees();
      // Forcer le rechargement de la page pour que tous les écrans
      // (rendus à partir du localStorage) repartent sur les bonnes données.
      if (ancienClient && ancienClient !== d.clientId) {
        location.reload();
        return true;
      }
      return true;
    } catch {
      majStatutLicence(true, 'local');
      return true;
    }
  }

  async function chargerDonnees() {
    try {
      const r = await fetch(API + '/api/data', {
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      const d = await r.json();
      if (!d.ok) return;

      const serveur = d.data;
      const aDesDonneesLocales = CLES.some(cle => {
        const local = localStorage.getItem(cle);
        if (!local) return false;
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed)) return parsed.length > 0;
        return Object.keys(parsed).length > 0;
      });
      const aDesDonneesServeur = serveur.salaries?.length > 0
        || Object.keys(serveur.heures || {}).length > 0;

      // Vérifier si on est en mode admin (consultation d'un client)
      const urlParams = new URLSearchParams(window.location.search);
      const modeAdmin = urlParams.get('admin') === '1';

      if (aDesDonneesLocales && !aDesDonneesServeur && !modeAdmin) {
        // Seulement sauvegarder si ce ne sont PAS des données d'un autre client
        const localClientId = localStorage.getItem('syncClientId');
        if (localClientId === _clientId) {
          await sauvegarderTout();
          afficherNotif('✔ Données synchronisées', '#16a34a');
        } else {
          // Données d'un autre client — ne pas écraser le serveur, charger depuis le serveur
          localStorage.setItem('entreprisedata',    JSON.stringify(serveur.entreprise || {}));
          localStorage.setItem('salariesdata',      JSON.stringify(serveur.salaries   || []));
          localStorage.setItem('heuresdata',        JSON.stringify(serveur.heures     || {}));
          localStorage.setItem('chantiersdata',     JSON.stringify(serveur.chantiers  || []));
          localStorage.setItem('previsionnel_data', JSON.stringify(serveur.previsionnel || {}));
          window.dispatchEvent(new Event('donnees-chargees'));
        }
      } else {
        // Toujours écraser le localStorage avec les données du serveur
        localStorage.setItem('entreprisedata',    JSON.stringify(serveur.entreprise || {}));
        localStorage.setItem('salariesdata',      JSON.stringify(serveur.salaries   || []));
        localStorage.setItem('heuresdata',        JSON.stringify(serveur.heures     || {}));
        localStorage.setItem('chantiersdata',     JSON.stringify(serveur.chantiers  || []));
        localStorage.setItem('previsionnel_data', JSON.stringify(serveur.previsionnel || {}));
        window.dispatchEvent(new Event('donnees-chargees'));
      }
    } catch {
      console.warn('Impossible de charger les données du serveur');
    }
  }

  function declencherSauvegarde() {
    if (!_token) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(sauvegarderTout, SYNC_DELAY);
  }

  async function sauvegarderTout() {
    if (!_token) return;
    try {
      const payload = {
        entreprise:   JSON.parse(localStorage.getItem('entreprisedata')    || '{}'),
        salaries:     JSON.parse(localStorage.getItem('salariesdata')      || '[]'),
        heures:       JSON.parse(localStorage.getItem('heuresdata')        || '{}'),
        chantiers:    JSON.parse(localStorage.getItem('chantiersdata')     || '[]'),
        previsionnel: JSON.parse(localStorage.getItem('previsionnel_data') || '{}'),
      };
      await fetch(API + '/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify(payload)
      });
    } catch {
      console.warn('Sauvegarde échouée');
    }
  }

  // Intercepter localStorage.setItem
  const _setItemOriginal = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(cle, valeur) {
    _setItemOriginal(cle, valeur);
    if (CLES.includes(cle)) declencherSauvegarde();
  };

  // Mettre à jour la navigation selon le type de licence
  function majNav() {
    const nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) return;

    // Supprimer les liens Plus existants pour éviter les doublons
    nav.querySelectorAll('.nav-plus').forEach(el => el.remove());

    const page = pageActuelle();

    if (_type === 'plus') {
      // Licence Plus : retirer Rapports de sa position actuelle et le remettre en fin
      const rapportsLink = nav.querySelector('a[href="rapports.html"]');
      if (rapportsLink) rapportsLink.remove();

      // Ajouter Saisie mobile + Planning réalisé + Rapports en fin
      const liens = [
        { href: 'saisie.html',  label: 'Saisie mobile' },
        { href: 'realise.html', label: 'Planning réalisé' },
        { href: 'rapports.html', label: 'Rapports' },
      ];
      liens.forEach(l => {
        const a = document.createElement('a');
        a.href = l.href;
        a.textContent = l.label;
        a.className = 'nav-plus';
        if (l.href === page) a.classList.add('active');
        nav.appendChild(a);
      });
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

  // Déconnexion : vide tout le cache local et revient à l'accueil.
  // Exposée via SYNC.seDeconnecter() pour être appelée depuis le bouton injecté.
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
    init, connecter, sauvegarderTout, declencherSauvegarde, afficherNotif, seDeconnecter,
    estConnecte: () => !!_token,
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

  if (modeAdmin && clientCode) {
    const clientToken = sessionStorage.getItem('clientToken');
    const clientId    = sessionStorage.getItem('clientId');
    const clientNom   = sessionStorage.getItem('clientNom') || clientCode;
    const clientType  = sessionStorage.getItem('clientType') || 'standard';
    if (clientToken && clientId) {
      // Vider localStorage et charger les données du client consulté
      const keysToKeep = ['admin_token'];
      Object.keys(localStorage).forEach(k => {
        if (!keysToKeep.includes(k)) localStorage.removeItem(k);
      });
      // Stocker le token du client dans localStorage pour cette session
      localStorage.setItem('syncToken',    clientToken);
      localStorage.setItem('syncClientId', clientId);
      localStorage.setItem('syncType',     clientType);
      localStorage.setItem('licenceCode',  clientCode);

      const banniere = document.createElement('div');
      banniere.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:0.85rem;';
      banniere.innerHTML = `👁 Mode consultation admin – Client : <strong>${clientNom}</strong> &nbsp;|&nbsp; <a href="/admin.html" style="color:#000;text-decoration:underline;">Retour admin</a>`;
      document.body.prepend(banniere);
    }
  }

  SYNC.init();
});
