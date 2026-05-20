/* =====================================================
   SYNC.JS – Synchronisation localStorage ↔ MongoDB
   À inclure dans toutes les pages après script.js
   ===================================================== */

const SYNC = (() => {

  /* ── Configuration ── */
  const API = '';  // même domaine
  let _token    = null;
  let _clientId = null;
  let _syncTimer = null;
  const SYNC_DELAY = 2000; // ms avant sauvegarde après modification

  /* ── Clés localStorage à synchroniser ── */
  const CLES = ['entreprisedata', 'salariesdata', 'heuresdata', 'chantiersdata', 'previsionnel_data'];

  /* ─────────────────────────────────────────
     INITIALISATION
  ───────────────────────────────────────── */
  async function init() {
    _token    = localStorage.getItem('syncToken');
    _clientId = localStorage.getItem('syncClientId');

    if (!_token || !_clientId) {
      // Pas connecté → vérifier s'il y a un code licence
      const code = localStorage.getItem('licenceCode');
      if (code) await connecter(code);
      return;
    }

    // Vérifier que le token est encore valide
    try {
      const r = await fetch(API + '/api/auth/verify', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      const d = await r.json();
      if (!d.ok) {
        // Token expiré → reconnecter
        const code = localStorage.getItem('licenceCode');
        if (code) await connecter(code);
        return;
      }
      // Token valide → charger les données
      await chargerDonnees();
    } catch {
      // Hors ligne → continuer avec localStorage
      console.log('Suiv\'Heures : mode hors ligne');
    }
  }

  /* ─────────────────────────────────────────
     CONNEXION PAR CODE LICENCE
  ───────────────────────────────────────── */
  async function connecter(code) {
    try {
      const r = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const d = await r.json();
      if (!d.ok) {
        console.warn('Licence invalide ou expirée :', d.message);
        majStatutLicence(false, d.message);
        return false;
      }

      _token    = d.token;
      _clientId = d.clientId;
      localStorage.setItem('syncToken',    _token);
      localStorage.setItem('syncClientId', _clientId);
      localStorage.setItem('licenceCode',  code);

      majStatutLicence(true);

      // Charger les données depuis le serveur
      await chargerDonnees();
      return true;
    } catch {
      console.warn('Serveur inaccessible, mode local activé');
      majStatutLicence(true, 'local');
      return true;
    }
  }

  /* ─────────────────────────────────────────
     CHARGEMENT DONNÉES DEPUIS MONGODB
  ───────────────────────────────────────── */
  async function chargerDonnees() {
    try {
      const r = await fetch(API + '/api/data', {
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      const d = await r.json();
      if (!d.ok) return;

      const serveur = d.data;

      // Vérifier si le client a des données locales à migrer
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
        // Migration : données locales → serveur
        console.log('Migration des données locales vers le serveur...');
        await sauvegarderTout();
        afficherNotif('✔ Données synchronisées avec le serveur', '#16a34a');
      } else if (aDesDonneesServeur) {
        // Charger les données du serveur dans localStorage
        if (serveur.entreprise)   localStorage.setItem('entreprisedata',    JSON.stringify(serveur.entreprise));
        if (serveur.salaries)     localStorage.setItem('salariesdata',      JSON.stringify(serveur.salaries));
        if (serveur.heures)       localStorage.setItem('heuresdata',        JSON.stringify(serveur.heures));
        if (serveur.chantiers)    localStorage.setItem('chantiersdata',     JSON.stringify(serveur.chantiers));
        if (serveur.previsionnel) localStorage.setItem('previsionnel_data', JSON.stringify(serveur.previsionnel));

        // Recharger la page pour afficher les nouvelles données
        // (uniquement si des données ont été chargées)
        console.log('Données chargées depuis le serveur');
        // Déclencher un event pour que les pages se rafraîchissent
        window.dispatchEvent(new Event('donnees-chargees'));
      }
    } catch {
      console.warn('Impossible de charger les données du serveur');
    }
  }

  /* ─────────────────────────────────────────
     SAUVEGARDE AUTOMATIQUE (déclenchée après modif)
  ───────────────────────────────────────── */
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + _token
        },
        body: JSON.stringify(payload)
      });
    } catch {
      console.warn('Sauvegarde échouée, données conservées localement');
    }
  }

  /* ─────────────────────────────────────────
     INTERCEPTER LES MODIFICATIONS localStorage
  ───────────────────────────────────────── */
  const _setItemOriginal = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(cle, valeur) {
    _setItemOriginal(cle, valeur);
    if (CLES.includes(cle)) {
      declencherSauvegarde();
    }
  };

  /* ─────────────────────────────────────────
     AFFICHAGE STATUT LICENCE
  ───────────────────────────────────────── */
  function majStatutLicence(actif, message) {
    const el = document.getElementById('licence-status');
    if (!el) return;
    if (actif) {
      el.innerHTML = '<span style="color:#86efac;font-size:0.85rem;">✔ Licence active</span>';
    } else {
      el.innerHTML = `<span style="color:#fca5a5;font-size:0.85rem;">⚠ ${message || 'Licence invalide'}</span>`;
    }
  }

  /* ─────────────────────────────────────────
     NOTIFICATION VISUELLE
  ───────────────────────────────────────── */
  function afficherNotif(texte, couleur = '#16a34a') {
    const div = document.createElement('div');
    div.textContent = texte;
    Object.assign(div.style, {
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      background: couleur, color: '#fff', padding: '10px 20px',
      borderRadius: '8px', fontWeight: '700', fontSize: '0.9rem',
      zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      transition: 'opacity 0.5s'
    });
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 3000);
  }

  /* ─────────────────────────────────────────
     API PUBLIQUE
  ───────────────────────────────────────── */
  return {
    init,
    connecter,
    sauvegarderTout,
    afficherNotif,
    estConnecte: () => !!_token,
    getClientId: () => _clientId
  };

})();

/* ── Initialisation automatique au chargement ── */
window.addEventListener('DOMContentLoaded', () => {
  // Détecter si on vient de l'interface admin (mode consultation)
  const params = new URLSearchParams(window.location.search);
  const clientCode = params.get('client');
  const modeAdmin  = params.get('admin') === '1';

  if (modeAdmin && clientCode) {
    // Récupérer le token client stocké par la page admin
    const clientToken = sessionStorage.getItem('clientToken');
    const clientNom   = sessionStorage.getItem('clientNom') || clientCode;

    if (clientToken) {
      // Afficher une bannière "mode consultation admin"
      const banniere = document.createElement('div');
      banniere.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:0.85rem;';
      banniere.innerHTML = `👁 Mode consultation admin – Client : <strong>${clientNom}</strong> (${clientCode}) &nbsp;|&nbsp; <a href="/admin.html" style="color:#000;text-decoration:underline;">Retour admin</a>`;
      document.body.prepend(banniere);

      // Utiliser le token client pour charger ses données
      _token    = clientToken;
      _clientId = clientCode;
      chargerDonnees().then(() => {
        window.dispatchEvent(new Event('donnees-chargees'));
      });
      return;
    }
  }

  SYNC.init();
});
