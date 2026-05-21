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
  const SYNC_DELAY = 2000;

  const CLES = ['entreprisedata', 'salariesdata', 'heuresdata', 'chantiersdata', 'previsionnel_data'];

  // Pages accessibles sans licence
  const PAGES_LIBRES = ['index.html', '/', ''];

  // Pages réservées Licence +
  // saisie.html est accessible sans licence (auth par PIN salarié)
  const PAGES_PLUS = ['realise.html'];
  // Pages totalement libres (pas de vérification licence)
  const PAGES_LIBRES_TOTAL = ['index.html', '/', '', 'saisie.html'];

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

    // Pages totalement libres : pas de vérification
    if (PAGES_LIBRES_TOTAL.includes(pageActuelle())) return;

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

      if (aDesDonneesLocales && !aDesDonneesServeur) {
        await sauvegarderTout();
        afficherNotif('✔ Données synchronisées', '#16a34a');
      } else if (aDesDonneesServeur) {
        if (serveur.entreprise)   localStorage.setItem('entreprisedata',    JSON.stringify(serveur.entreprise));
        if (serveur.salaries)     localStorage.setItem('salariesdata',      JSON.stringify(serveur.salaries));
        if (serveur.heures)       localStorage.setItem('heuresdata',        JSON.stringify(serveur.heures));
        if (serveur.chantiers)    localStorage.setItem('chantiersdata',     JSON.stringify(serveur.chantiers));
        if (serveur.previsionnel) localStorage.setItem('previsionnel_data', JSON.stringify(serveur.previsionnel));
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

    if (_type === 'plus') {
      const page = pageActuelle();
      const liens = [
        { href: 'saisie.html',  label: 'Saisie mobile' },
        { href: 'realise.html', label: 'Planning réalisé' },
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
      el.innerHTML = `<span style="color:#86efac;font-size:0.85rem;">✔ Licence active${badge}</span>`;
    } else {
      el.innerHTML = `<span style="color:#fca5a5;font-size:0.85rem;">⚠ ${message || 'Licence invalide'}</span>`;
    }
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
    init, connecter, sauvegarderTout, afficherNotif,
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
    const clientNom   = sessionStorage.getItem('clientNom') || clientCode;
    if (clientToken) {
      const banniere = document.createElement('div');
      banniere.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:0.85rem;';
      banniere.innerHTML = `👁 Mode consultation admin – Client : <strong>${clientNom}</strong> &nbsp;|&nbsp; <a href="/admin.html" style="color:#000;text-decoration:underline;">Retour admin</a>`;
      document.body.prepend(banniere);
      return;
    }
  }

  SYNC.init();
});
