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
  const VERSION = 'v2026.08.18-sync9';

  const API = '';
  let _token    = null;
  let _clientId = null;
  let _type     = null;            // "standard" ou "plus"
  let _modeAdmin = false;          // true = consultation admin (lecture seule)
  let _syncTimer = null;
  let _pendingSave = false;        // une modification locale attend d'être poussée
  let _deconnexionEnCours = false;

  // Isolation inter-onglets : identifiant unique de CET onglet (change à chaque
  // rechargement) + drapeau « un autre client est actif dans un autre onglet ».
  let _tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let _verrouilleAutreClient = false;

  // Coalescence courte : regroupe quelques frappes rapprochées sans fragiliser.
  const SAVE_DELAY = 400;

  const CLES = ['entreprisedata', 'salariesdata', 'heuresdata', 'chantiersdata', 'previsionnel_data', 'coordonneesChantiersdata'];

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

  /* Un jeton de consultation PRESCRIPTEUR porte le marqueur lectureSeule.
     Le jeton de consultation ADMIN, lui, est identique à un jeton client
     normal : il n'est donc PAS distinguable ici — la lecture seule admin
     repose sur le drapeau de session 'adminConsult', posé à l'entrée. */
  function jetonLectureSeule() {
    try {
      const t = _token || localStorage.getItem('syncToken');
      if (!t) return false;
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !!(p && p.lectureSeule === true);
    } catch (_) { return false; }
  }

  /* Page d'ouverture de l'outil.
     Sur l'adresse nue (« / »), le gérant connecté arrive désormais sur le
     tableau de bord. On ne touche PAS à /index.html, qui reste la page
     Entreprise et le point d'activation de la licence — les redirections
     existantes vers '/index.html?erreur=...' continuent donc de fonctionner.
     Une session salarié mobile (code employé sans jeton de licence) n'est
     jamais redirigée : le tableau de bord ne lui est pas destiné. */
  function ouvrirSurTableauDeBord() {
    try {
      /* Marqueur d'onglet, posé sur TOUTE page de l'outil et lu avant d'être
         écrit. Il doit l'être avant le filtre sur le chemin : sinon quelqu'un
         qui entre directement sur le planning, puis clique sur « Entreprise »,
         serait détourné vers le tableau de bord. */
      const dejaDansOutil = sessionStorage.getItem('shOnglet') === '1';
      sessionStorage.setItem('shOnglet', '1');

      /* Pages d'entrée de l'outil : l'adresse nue et index.html, qui sert de
         page de démarrage aux raccourcis et à l'application installée. */
      const chemin = window.location.pathname;
      if (chemin !== '/' && chemin !== '/index.html') return false;

      /* index.html est AUSSI la page Entreprise du menu : on ne détourne que
         la PREMIÈRE page chargée dans l'onglet — raccourci, application
         installée, nouvel onglet. Dès qu'on navigue à l'intérieur de l'outil,
         « Entreprise » et le retour arrière atterrissent normalement.
         Ce marqueur remplace document.referrer, que les navigateurs vident ou
         tronquent dans trop de situations pour qu'on s'y fie. */
      if (dejaDansOutil) return false;

      /* Un paramètre dans l'adresse signale un renvoi de l'outil lui-même
         (?erreur=licence, ?erreur=plus) : cette page doit rester affichée
         pour que la licence puisse être réactivée. */
      if (window.location.search) return false;

      if (sessionStorage.getItem('adminConsult') === '1') return false;

      /* Le jeton n'existe qu'après une première activation réussie : à la
         toute première venue, on reste sur index.html pour saisir la licence. */
      if (!localStorage.getItem('syncToken')) return false;

      window.location.replace('/tableau-de-bord.html');
      return true;
    } catch (_) { return false; }
  }

  async function init() {
    if (ouvrirSurTableauDeBord()) return;

    _token    = localStorage.getItem('syncToken');
    _clientId = localStorage.getItem('syncClientId');
    _type     = localStorage.getItem('syncType');

    // Consultation d'un client (admin ou prescripteur) = lecture seule.
    // On NE se fie PLUS au simple ?admin=1 dans l'URL : un client qui aurait ce
    // paramètre (lien partagé, marque-page) serait injustement bloqué en lecture
    // seule et perdrait ses saisies EN SILENCE. La lecture seule ne s'active que
    // sur le VRAI marqueur de session de consultation ('adminConsult', posé
    // uniquement par l'entrée légitime avec jeton pré-placé) OU sur un jeton
    // prescripteur 'lectureSeule'. Un client connecté avec son propre code ne
    // peut donc jamais tomber en lecture seule.
    _modeAdmin = sessionStorage.getItem('adminConsult') === '1'
              || jetonLectureSeule();

    afficherVersion();

    if (PAGES_LIBRES_TOTAL.includes(pageActuelle())) {
      if (_token && _type) { majStatutLicence(true); majNav(); revendiquerOngletActif(); }
      else if (['index.html', '/', ''].includes(pageActuelle())) {
        // Page Entreprise (accueil) sans licence active : on affiche quand même
        // la barre latérale, pour la cohérence visuelle avec les autres pages,
        // et le bouton Connexion là où apparaît Déconnexion une fois connecté.
        majNav();
        afficherBoutonConnexion();
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
      if (d.nomClient) localStorage.setItem('syncNomClient', d.nomClient);
      verifierAccesPlus();
      revendiquerOngletActif();   // cet onglet devient la session active du navigateur
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
        localStorage.removeItem('syncMarquePartenaire');
        localStorage.removeItem('syncLogoPartenaire');
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

      revendiquerOngletActif();   // cet onglet devient la session active du navigateur
      majStatutLicence(true);
      majNav();
      await chargerDonnees();

      if (changementClient) {
        const cible = sessionStorage.getItem('shRedirectApresConnexion');
        if (cible) { sessionStorage.removeItem('shRedirectApresConnexion'); location.href = cible; }
        else { location.reload(); }
        return true;
      }
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

      // Marque blanche : mémoriser le flag + logo du prescripteur (livrés par /api/data
      // à chaque chargement, donc toujours à jour). Clés hors CLES → pas de sauvegarde déclenchée.
      try {
        localStorage.setItem('syncMarquePartenaire', d.marquePartenaire ? '1' : '0');
        if (typeof d.logoPartenaire === 'string' && d.logoPartenaire)
          localStorage.setItem('syncLogoPartenaire', d.logoPartenaire);
        else
          localStorage.removeItem('syncLogoPartenaire');
      } catch (e) {}
      if (typeof majMarqueBlanche === 'function') majMarqueBlanche();

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

      // Cas 2 bis : une saisie non synchronisée persiste d'une page précédente
      // (drapeau syncDirty en localStorage). Typiquement un envoi au déchargement
      // abandonné par le navigateur (Safari/iOS). On NE remplace PAS le local :
      // on le re-pousse au serveur, pour ne jamais perdre une saisie récente.
      if (!_modeAdmin && localStorage.getItem('syncDirty') === '1'
          && aDesDonneesLocales && localClientId === _clientId) {
        _pendingSave = true;
        await sauvegarderTout();
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
      ecrireLocalSansDeclencher('notesChantiersdata', JSON.stringify(serveur.notesChantiers || {}));
      ecrireLocalSansDeclencher('coordonneesChantiersdata', JSON.stringify(serveur.coordonneesChantiers || {}));
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
    if (_verrouilleAutreClient) return;   // un autre client est actif dans ce navigateur
    if (!_token) return;
    _pendingSave = true;
    try { localStorage.setItem('syncDirty', '1'); } catch (e) {}   // persiste au changement de page
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(sauvegarderTout, SAVE_DELAY);
  }

  /* Garde-fou anti-mélange de clients : le jeton en mémoire (_token/_clientId)
     doit correspondre au client actif dans le localStorage. Si un AUTRE onglet
     a changé de client entre-temps, ces deux valeurs divergent : on refuse alors
     d'écrire, pour ne jamais sauvegarder les données d'un client sous le jeton
     d'un autre. */
  function identiteCoherente() {
    return !!_token
        && !_verrouilleAutreClient
        && localStorage.getItem('syncToken')    === _token
        && localStorage.getItem('syncClientId') === _clientId
        && !autreClientActif();               // barrière dure : un autre client est l'onglet actif
  }

  function construirePayload() {
    return {
      // Client auquel APPARTIENNENT ces données (revérifié côté serveur).
      clientIdAttendu: localStorage.getItem('syncClientId') || _clientId || '',
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
    if (!identiteCoherente()) {      // anti-mélange : client changé dans un autre onglet
      console.warn('Sauvegarde annulée : le client actif a changé dans un autre onglet.');
      return;
    }
    clearTimeout(_syncTimer);
    _syncTimer = null;
    try {
      const res = await fetch(API + '/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify(construirePayload())
      });
      if (res.ok) { _pendingSave = false; try { localStorage.removeItem('syncDirty'); } catch (e) {} }
    } catch {
      console.warn('Sauvegarde échouée (sera retentée)');
    }
  }

  /* Envoi de sécurité avant de quitter/masquer la page : garantit qu'une saisie
     récente (ex. PIN) atteint le serveur même si on quitte avant la coalescence. */
  function flushSauvegarde() {
    if (_modeAdmin || !_token || !_pendingSave) return;
    if (!identiteCoherente()) return;   // anti-mélange : ne jamais flusher avec le jeton d'un autre client
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
      }).then(() => { _pendingSave = false; try { localStorage.removeItem('syncDirty'); } catch (e) {} }).catch(() => {});
    } catch {}
  }
  window.addEventListener('pagehide', flushSauvegarde);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSauvegarde();
  });

  /* ─────────────────────────────────────────────────────────────
     Détection Safari strict : sur certains Mac, Safari bloque l'écriture
     localStorage avec « SecurityError: the operation is insecure », même sans
     mode privé actif. Symptôme utilisateur : « mes saisies disparaissent après
     rechargement ». On détecte le problème à l'ouverture et, si l'écriture est
     bloquée, on bascule en mode dégradé :
     - un cache mémoire remplace le localStorage pour les clés applicatives ;
     - la sync serveur reste opérationnelle (le payload est reconstruit depuis
       ce cache mémoire au lieu du localStorage) ;
     - un bandeau explique la situation à l'utilisateur.
     ───────────────────────────────────────────────────────────── */
  let _localStorageBloque = false;
  const _cacheMemoire = {};   // { cle: valeurString } quand localStorage est HS

  // Test simple à l'ouverture : essayer d'écrire puis effacer une clé témoin.
  (function detecterLocalStorageBloque() {
    try {
      const cleTest = '__sh_test_' + Math.random();
      localStorage.setItem(cleTest, '1');
      localStorage.removeItem(cleTest);
    } catch (e) {
      _localStorageBloque = true;
      console.warn('localStorage bloqué par le navigateur (mode dégradé activé). Raison :', e && e.message);
    }
  })();

  // Intercepter localStorage.setItem : toute écriture applicative déclenche une sauvegarde.
  // Protection SecurityError : si l'écriture disque échoue, on retombe sur un cache mémoire
  // pour ne rien perdre, et on force l'envoi serveur (source de vérité).
  const _setItemOriginal = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(cle, valeur) {
    let echecEcriture = false;
    try {
      _setItemOriginal(cle, valeur);
    } catch (e) {
      // Safari peut lever SecurityError, QuotaExceededError, InvalidStateError…
      echecEcriture = true;
      _localStorageBloque = true;
      _cacheMemoire[cle] = String(valeur);
      afficherBanniereStockageBloque();
    }
    if (!_ecritureInterne && CLES.includes(cle)) {
      // Si l'écriture disque a échoué, la sauvegarde serveur est ESSENTIELLE :
      // c'est la seule copie fiable du travail de l'utilisateur.
      if (echecEcriture) sauvegarderTout();   // envoi immédiat
      else declencherSauvegarde();            // envoi coalescé standard
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Filet de sécurité : détecter si la surcharge de localStorage.setItem
     a été acceptée par le navigateur. Sur certains Mac (Safari en mode
     durci, extensions de confidentialité, sécurité entreprise), Safari
     REFUSE SILENCIEUSEMENT la réassignation des méthodes natives.
     Symptôme : le patch ci-dessus est en place, mais localStorage.setItem
     reste la méthode native. Résultat : les écritures locales fonctionnent
     mais AUCUNE sync ne se déclenche → « mes saisies disparaissent au
     rechargement ». La détection ci-dessous compare la fonction courante
     avec la fonction native. Si la surcharge n'a pas pris, on active un
     POLLING léger (toutes les 2 s) qui compare les valeurs actuelles des
     clés applicatives à leur dernier hash connu, et déclenche la sync
     serveur si un changement est détecté. Plus lent qu'une interception
     directe, mais garantit que les saisies sont TOUJOURS synchronisées.
     ───────────────────────────────────────────────────────────── */
  const _surchargeSetItemAcceptee = (function() {
    try {
      // Une méthode native contient « [native code] » dans sa représentation string.
      // Notre remplaçante ne le contient pas. Si Safari a refusé la surcharge,
      // la méthode courante EST encore la native.
      return !/\[native code\]/.test(String(localStorage.setItem));
    } catch (_) { return false; }
  })();

  if (!_surchargeSetItemAcceptee) {
    console.warn('Surcharge localStorage refusée par le navigateur → activation du filet polling (2 s).');
    // Empreinte du contenu actuel des clés applicatives (hash simple = longueur + 4 caractères clés)
    const _empreinte = {};
    function calculerEmpreinte(cle) {
      let v = '';
      try { v = localStorage.getItem(cle) || ''; } catch (_) { v = ''; }
      // hash très simple mais suffisant pour détecter tout changement de contenu
      return v.length + '|' + v.substring(0, 32) + '|' + v.substring(Math.max(0, v.length - 32));
    }
    // Initialiser les empreintes au démarrage (état de départ, ne déclenche pas de sauvegarde)
    CLES.forEach(cle => { _empreinte[cle] = calculerEmpreinte(cle); });

    // Polling toutes les 2 secondes : compare l'état actuel aux empreintes,
    // déclenche une sauvegarde si un changement est détecté.
    setInterval(() => {
      if (_modeAdmin || !_token || _verrouilleAutreClient) return;
      let changement = false;
      CLES.forEach(cle => {
        const emp = calculerEmpreinte(cle);
        if (emp !== _empreinte[cle]) {
          _empreinte[cle] = emp;
          changement = true;
        }
      });
      if (changement) declencherSauvegarde();
    }, 2000);
  }

  // Interception symétrique de getItem : servir depuis la mémoire si présent
  // (utile quand l'écriture disque a échoué mais qu'on relit la valeur juste après).
  const _getItemOriginal = localStorage.getItem.bind(localStorage);
  localStorage.getItem = function(cle) {
    if (_localStorageBloque && Object.prototype.hasOwnProperty.call(_cacheMemoire, cle)) {
      return _cacheMemoire[cle];
    }
    try { return _getItemOriginal(cle); }
    catch (e) { return _cacheMemoire[cle] != null ? _cacheMemoire[cle] : null; }
  };

  // Bandeau informatif si le stockage local est bloqué (une seule fois par session).
  let _banniereStockageAffichee = false;
  function afficherBanniereStockageBloque() {
    if (_banniereStockageAffichee) return;
    _banniereStockageAffichee = true;
    const poser = () => {
      if (!document.body || document.getElementById('sh-storage-bloque')) return;
      const b = document.createElement('div');
      b.id = 'sh-storage-bloque';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#dc2626;color:#fff;text-align:center;padding:8px 14px;font-weight:700;font-size:0.88rem;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:Arial,sans-serif;';
      b.innerHTML = '⚠ Votre navigateur bloque le stockage local. ' +
        'Les saisies sont envoyées directement au serveur (sauvegarde garantie), mais pour un fonctionnement optimal, ' +
        '<u>autorisez les cookies et le stockage pour ce site</u> dans les réglages navigateur, ou utilisez Chrome. ' +
        '<a href="#" onclick="document.getElementById(\'sh-storage-bloque\').remove();return false;" style="color:#fff;margin-left:8px;">×</a>';
      document.body.prepend(b);
    };
    if (document.body) poser(); else window.addEventListener('DOMContentLoaded', poser);
  }

  /* ─────────────────────────────────────────────────────────────
     Isolation inter-onglets : UN SEUL client « actif en écriture »
     par navigateur. Le localStorage étant partagé entre tous les onglets
     d'un même navigateur, deux sessions clients ouvertes en parallèle
     pouvaient se marcher dessus (mélange de comptes). On empêche cela :
       • chaque onglet, quand il devient la session utilisée, « revendique »
         l'activité (clé partagée syncActiveTab = { tabId, clientId }) ;
       • si un AUTRE onglet revendique l'activité pour un client DIFFÉRENT,
         cet onglet-ci passe en lecture seule (bandeau) et n'enregistre plus ;
       • au moment exact d'un enregistrement, on revérifie de façon synchrone
         qu'aucun autre client n'est l'onglet actif (barrière dure, sans course).
     Deux onglets du MÊME client restent autorisés (pas de risque de mélange).
     ───────────────────────────────────────────────────────────── */
  const CLE_ONGLET_ACTIF = 'syncActiveTab';

  // Un client DIFFÉRENT est-il l'onglet actif de ce navigateur ? (lecture synchrone)
  function autreClientActif() {
    try {
      const raw = localStorage.getItem(CLE_ONGLET_ACTIF);
      if (!raw) return false;
      const rec = JSON.parse(raw);
      if (!rec || rec.tabId === _tabId) return false;        // absent ou c'est moi
      return (rec.clientId || '') !== (_clientId || '');      // autre onglet + autre client
    } catch (_) { return false; }
  }

  // Cet onglet (re)devient la session active du navigateur.
  function revendiquerOngletActif() {
    if (_modeAdmin || !_clientId) return;   // la consultation admin n'écrit jamais
    try {
      _setItemOriginal(CLE_ONGLET_ACTIF, JSON.stringify({ tabId: _tabId, clientId: _clientId, ts: Date.now() }));
    } catch (_) {}
    if (_verrouilleAutreClient) { _verrouilleAutreClient = false; retirerBanniereVerrou(); }
  }

  // Un AUTRE onglet a revendiqué l'activité → on verrouille si c'est un autre client.
  function surChangementOngletActif(rec) {
    if (_modeAdmin || !_clientId || !rec) return;
    if (rec.tabId === _tabId) return;
    if ((rec.clientId || '') === (_clientId || '')) return;   // même client → aucun risque
    _verrouilleAutreClient = true;
    _pendingSave = false;
    clearTimeout(_syncTimer); _syncTimer = null;
    afficherBanniereVerrou(rec.clientId);
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== CLE_ONGLET_ACTIF || !e.newValue) return;
    let rec = null; try { rec = JSON.parse(e.newValue); } catch (_) { return; }
    surChangementOngletActif(rec);
  });

  function afficherBanniereVerrou(autreClient) {
    if (document.getElementById('sh-verrou-onglet')) return;
    const safe = String(autreClient || '').replace(/[&<>"']/g, '');
    const poser = () => {
      if (!document.body || document.getElementById('sh-verrou-onglet')) return;
      const b = document.createElement('div');
      b.id = 'sh-verrou-onglet';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#dc2626;color:#fff;text-align:center;padding:9px 14px;font-weight:700;font-size:0.9rem;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:Arial,sans-serif;';
      b.innerHTML = '⛔ Une autre session client' + (safe ? ' (' + safe + ')' : '') +
        ' est ouverte dans ce navigateur. Cette page est en <u>lecture seule</u> pour éviter tout mélange de données. ' +
        '<a href="#" onclick="location.reload();return false;" style="color:#fff;text-decoration:underline;">Recharger pour reprendre cette session</a>.';
      document.body.prepend(b);
    };
    if (document.body) poser(); else window.addEventListener('DOMContentLoaded', poser);
  }
  function retirerBanniereVerrou() {
    const b = document.getElementById('sh-verrou-onglet');
    if (b) b.remove();
  }

  // Navigation selon le type de licence
  function majNav() {
    const nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) return;
    nav.querySelectorAll('.nav-plus').forEach(el => el.remove());
    const page = pageActuelle();
    const _planLien = nav.querySelector('a[href="planning.html"]');
    if (_planLien) _planLien.textContent = 'Planning prévu';
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
        { href: 'bev.html',     label: 'Éléments Pointage Paie' },
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
      // Éléments Pointage Paie accessible aussi (après Rapports)
      if (!nav.querySelector('a[href="bev.html"]')) {
        const a = document.createElement('a');
        a.href = 'bev.html'; a.textContent = 'Éléments Pointage Paie'; a.className = 'nav-plus';
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
  var MENU_PAGES = ['tableau-de-bord.html', 'index.html', 'salaries.html', 'chantiers.html', 'planning.html',
    'planning-equipe.html', 'planning-synthese.html', 'rapports.html', 'realise.html', 'notes.html', 'bev.html', 'saisie.html', 'suivi-entretiens.html', 'masques-intervention.html'];

  // Structure canonique du menu (indépendante de la licence).
  // Le premier groupe n'a pas d'intitulé : le tableau de bord est la page
  // d'accueil, il se lit au-dessus des rubriques et non dans l'une d'elles.
  var MENU_GROUPES = [
    { label: '', items: [
      { href: 'tableau-de-bord.html', label: 'Tableau de bord' }
    ] },
    { label: 'Gestion', items: [
      { href: 'index.html',     label: 'Entreprise' },
      { href: 'salaries.html',  label: 'Salariés' },
      { href: 'chantiers.html', label: 'Prévisionnel' },
      { href: 'masques-intervention.html', label: "Bons d'intervention" }
    ] },
    { label: 'Planning', items: [
      { href: 'planning.html',         label: 'Planning prévu' },
      { href: 'planning-equipe.html',  label: 'Vue équipe' },            // les deux licences
      { href: 'realise.html',          label: 'Planning réalisé', plus: true },
      { href: 'saisie.html',           label: 'Saisie mobile',    plus: true }
    ] },
    { label: 'Suivi', items: [
      { href: 'rapports.html', label: 'Rapports' },
      { href: 'notes.html',    label: 'Notes', plus: true },
      { href: 'suivi-entretiens.html', label: 'Suivi des entretiens', requiert: 'suiviEntretien' },
      { href: 'bev.html',      label: 'Éléments Pointage Paie' }
    ] },
    { label: 'Contrat', items: [
      { href: 'tarifs.html', label: 'Tarifs' }
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
      'html.sh-menu-on .nav{display:none !important;}' +
      'html.sh-lateral .main-header,html.sh-lateral .header-desktop{margin-left:-208px;width:calc(100% + 208px);box-sizing:border-box;}' +
      'html.sh-lateral .top-bar .main-header{margin-left:0;width:100%;}' +
      'html.sh-lateral .header-desktop .main-header{margin-left:0;width:100%;}' +
      '@media print{.sh-rail,.sh-topbar{display:none !important;}html.sh-lateral body{padding-left:0 !important;}html.sh-lateral .main-header,html.sh-lateral .header-desktop,html.sh-lateral .top-bar .main-header{margin-left:0 !important;width:100% !important;}}' +
      // Barre du haut groupée (tablette / écran étroit)
      '.sh-topbar{display:flex;align-items:center;gap:4px;background:#0f2747;padding:6px 10px;' +
      'overflow-x:auto;white-space:nowrap;font-family:Arial,sans-serif;}' +
      '.sh-topbar .sh-tb-brand{color:#fff;font-weight:700;font-size:0.95rem;margin-right:10px;}' +
      '.sh-topbar .sh-tb-btn{background:transparent;border:none;color:#cdd8ea;font-size:0.9rem;' +
      'font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;}' +
      '.sh-topbar .sh-tb-btn:hover{background:#17335a;color:#fff;}' +
      '.sh-topbar .sh-tb-btn.active{color:#fff;}' +
      '.sh-topbar .sh-tb-btn.ouvert{background:#1d8cf0;color:#fff;}' +
      '.sh-topbar .sh-caret{font-size:0.7rem;}' +
      '.sh-dropdown{background:#fff;border:1px solid #e2e8f0;border-radius:10px;' +
      'box-shadow:0 12px 32px rgba(0,0,0,0.18);padding:6px;min-width:200px;font-family:Arial,sans-serif;}' +
      '.sh-dropdown a.sh-dd-i{display:block;color:#1f2937;text-decoration:none;font-size:0.9rem;padding:8px 10px;border-radius:7px;}' +
      '.sh-dropdown a.sh-dd-i:hover{background:#eef2f7;}' +
      '.sh-dropdown a.sh-dd-i.active{background:#1d8cf0;color:#fff;}' +
      '.sh-dropdown a.sh-dd-i.sh-lock{color:#64748b;}' +
      '.sh-dropdown .sh-plus{float:right;font-size:0.6rem;font-weight:700;background:#caa24a;' +
      'color:#241a06;border-radius:999px;padding:1px 7px;margin-left:6px;}';
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

  /* Certaines entrées de menu dépendent d'une case à cocher activée depuis la
     page Entreprise (ex. entreprisedata.suiviEntretien) — elles ne s'affichent
     dans aucun menu (latéral ou barre du haut) tant que ce n'est pas activé. */
  function _featureActive(nomChamp) {
    try { return !!JSON.parse(localStorage.getItem('entreprisedata') || '{}')[nomChamp]; }
    catch (e) { return false; }
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
      if (g.label) {
        const gl = document.createElement('div');
        gl.className = 'sh-grp';
        gl.textContent = g.label;
        rail.appendChild(gl);
      }
      g.items.forEach(it => {
        if (it.requiert && !_featureActive(it.requiert)) return;
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

    // ── Barre du haut groupée (tablette / écran étroit) ──
    construireTopbar();
    document.documentElement.classList.add('sh-menu-on');

    appliquerModeMenu();
    setTimeout(appliquerModeMenu, 0);     // recale une fois la page initialisée
    if (!_menuListenersPoses) {
      _menuListenersPoses = true;
      window.addEventListener('resize', appliquerModeMenu);
      window.addEventListener('resize', fermerDropdown);
      document.addEventListener('click', fermerDropdown);
      if (window.matchMedia) {
        try { window.matchMedia('(pointer: coarse)').addEventListener('change', appliquerModeMenu); } catch (_) {}
      }
    }
  }

  function construireTopbar() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const ancien = document.getElementById('sh-topbar');
    if (ancien) ancien.remove();
    const estPlus = (_type === 'plus');
    const page = pageActuelle();
    const bar = document.createElement('nav');
    bar.id = 'sh-topbar';
    bar.className = 'sh-topbar';
    const brand = document.createElement('span');
    brand.className = 'sh-tb-brand';
    brand.textContent = "Suiv'Heures";
    bar.appendChild(brand);
    MENU_GROUPES.forEach(g => {
      const actif = g.items.some(it => it.href === page);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sh-tb-btn' + (actif ? ' active' : '');
      // Groupe sans intitulé et à une seule entrée (le tableau de bord) :
      // bouton d'accès direct, sans menu déroulant ni chevron.
      if (!g.label && g.items.length === 1) {
        const it = g.items[0];
        btn.appendChild(document.createTextNode(it.label));
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          fermerDropdown();
          window.location.href = it.href;
        });
        bar.appendChild(btn);
        return;
      }
      btn.appendChild(document.createTextNode(g.label + ' '));
      const car = document.createElement('span');
      car.className = 'sh-caret';
      car.textContent = '▾';
      btn.appendChild(car);
      btn.addEventListener('click', function (e) { e.stopPropagation(); ouvrirDropdown(btn, g); });
      bar.appendChild(btn);
    });
    nav.parentNode.insertBefore(bar, nav);
  }

  function fermerDropdown() {
    const d = document.getElementById('sh-dropdown');
    if (d) d.remove();
    document.querySelectorAll('.sh-tb-btn.ouvert').forEach(b => b.classList.remove('ouvert'));
  }

  function ouvrirDropdown(btn, g) {
    const dejaOuvert = btn.classList.contains('ouvert');
    fermerDropdown();
    if (dejaOuvert) return;               // re-clic sur le même bouton = fermeture
    btn.classList.add('ouvert');
    const estPlus = (_type === 'plus');
    const page = pageActuelle();
    const dd = document.createElement('div');
    dd.id = 'sh-dropdown';
    dd.className = 'sh-dropdown';
    g.items.forEach(it => {
      if (it.requiert && !_featureActive(it.requiert)) return;
      const verrou = !!it.plus && !estPlus;
      const a = document.createElement('a');
      a.href = verrou ? '#' : it.href;
      a.className = 'sh-dd-i' + (page === it.href ? ' active' : '') + (verrou ? ' sh-lock' : '');
      a.textContent = it.label;
      if (it.plus) {
        const b = document.createElement('span');
        b.className = 'sh-plus';
        b.textContent = 'Plus';
        a.appendChild(b);
      }
      if (verrou) a.addEventListener('click', e => { e.preventDefault(); fermerDropdown(); popupPlus(it.label); });
      dd.appendChild(a);
    });
    dd.addEventListener('click', e => e.stopPropagation());
    document.body.appendChild(dd);
    const r = btn.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.zIndex = '10040';
    let left = r.left;
    const maxLeft = window.innerWidth - dd.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    dd.style.top = (r.bottom + 4) + 'px';
    dd.style.left = left + 'px';
  }

  function mesurerBandeau() {
    return document.querySelector('.top-bar')
        || document.querySelector('body > .header-desktop')
        || document.querySelector('body > .main-header')
        || document.querySelector('.main-header');
  }

  function appliquerModeMenu() {
    const rail = document.getElementById('sh-rail');
    const tb = document.getElementById('sh-topbar');
    if (!rail && !tb) return;
    // ≥1000px : menu latéral. Sinon : barre du haut groupée.
    const lateral = (window.innerWidth >= 1000);
    // Vue équipe : sur mobile, aucune barre de menu (la page n'affiche que la grille).
    if (pageActuelle() === 'planning-equipe.html' && !lateral) {
      document.documentElement.classList.remove('sh-lateral');
      if (rail) rail.style.display = 'none';
      if (tb) tb.style.display = 'none';
      fermerDropdown();
      _lateralPrec = lateral;
      return;
    }
    document.documentElement.classList.toggle('sh-lateral', lateral);
    if (rail) rail.style.display = lateral ? '' : 'none';
    if (tb) tb.style.display = lateral ? 'none' : '';
    fermerDropdown();
    if (lateral && rail) {
      const bar = mesurerBandeau();
      rail.style.top = (bar ? bar.offsetHeight : 0) + 'px';   // démarrer sous le bandeau
    }
    const change = (lateral !== _lateralPrec);
    _lateralPrec = lateral;
    if (change) {
      // Laisser le CSS s'appliquer, puis demander à la page de recalculer son décalage.
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
    afficherBadgeLicence(actif, message);
    const el = document.getElementById('licence-status');
    if (!el) return;
    el.style.cssText = 'background:none !important;border:none !important;padding:0 !important;margin:0 !important;border-radius:0 !important;box-shadow:none !important;';
    if (actif) {
      el.innerHTML =
        `<button onclick="SYNC.seDeconnecter()" title="Se déconnecter et changer de licence" ` +
        `style="background:#64748b;border:none;color:#fff;border-radius:6px;padding:6px 14px;font-size:0.85rem;font-weight:700;cursor:pointer;">` +
        `⏻ Déconnexion</button>`;
    } else {
      el.innerHTML = '';
    }
  }

  /* ── Badge de type de licence (Standard / Plus) ──
     Indicateur d'abonnement, sans rapport avec l'action Connexion/Déconnexion :
     posé à part dans la têtière, avant le nom de l'entreprise. */
  function afficherBadgeLicence(actif, message) {
    let el = document.getElementById('sync-badge-licence');
    if (!el) {
      const droite = document.querySelector('.vol-droite');
      const conteneur = droite && droite.parentElement;
      if (!conteneur || !droite) return;
      el = document.createElement('div');
      el.id = 'sync-badge-licence';
      el.style.cssText = 'font-size:0.85rem;text-align:right;align-self:center;';
      conteneur.insertBefore(el, droite);
    }
    if (actif) {
      const badge = _type === 'plus' ? ' <span style="background:#fbbf24;color:#78350f;border-radius:999px;padding:1px 6px;font-size:0.7rem;font-weight:700;">PLUS</span>' : '';
      el.innerHTML = `<span style="color:#86efac;">✔ Licence active${badge}</span>`;
    } else {
      el.innerHTML = message ? `<span style="color:#fca5a5;">⚠ ${message}</span>` : '';
    }
  }

  /* ── Bouton et fenêtre de connexion (page Entreprise, avant toute licence active) ──
     Miroir du bouton Déconnexion : même emplacement en haut à droite, pour que
     « se connecter » et « se déconnecter » soient le même geste, avant/après.
     Le formulaire « Code client / Activer la licence » de la page Entreprise
     reste inchangé et fonctionne toujours en parallèle. */
  function afficherBoutonConnexion() {
    const el = document.getElementById('licence-status');
    if (!el) return;
    el.style.cssText = 'background:none !important;border:none !important;padding:0 !important;margin:0 !important;border-radius:0 !important;box-shadow:none !important;';
    el.innerHTML =
      `<button onclick="SYNC.ouvrirModalConnexion()" ` +
      `style="background:#f59e0b;border:none;color:#0f172a;border-radius:6px;padding:6px 14px;font-size:0.85rem;font-weight:700;cursor:pointer;">` +
      `🔑 Connexion</button>`;
  }

  function styleModalConnexion() {
    if (document.getElementById('sync-modal-connexion-style')) return;
    const s = document.createElement('style');
    s.id = 'sync-modal-connexion-style';
    s.textContent =
      '#sync-modal-connexion-overlay{display:none;position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);align-items:center;justify-content:center;padding:16px;}' +
      '#sync-modal-connexion{background:#fff;border-radius:16px;max-width:380px;width:100%;padding:28px 26px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:Arial,Helvetica,sans-serif;position:relative;}' +
      '#sync-modal-connexion h3{margin:0 0 6px;font-size:19px;color:#0f172a;}' +
      '#sync-modal-connexion p{margin:0 0 16px;font-size:14px;color:#475569;line-height:1.5;}' +
      '#sync-modal-connexion input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;}' +
      '#sync-modal-connexion .sync-mc-erreur{color:#b91c1c;font-size:13px;margin:-2px 0 10px;min-height:16px;}' +
      '#sync-modal-connexion .sync-mc-actions{display:flex;gap:10px;justify-content:flex-end;}' +
      '#sync-modal-connexion button.sync-mc-annuler{background:none;border:none;color:#64748b;font-size:14px;cursor:pointer;padding:10px 8px;}' +
      '#sync-modal-connexion button.sync-mc-valider{background:#0f3a8a;border:none;color:#fff;border-radius:8px;padding:10px 20px;font-size:15px;font-weight:700;cursor:pointer;}' +
      '#sync-modal-connexion button.sync-mc-valider:disabled{opacity:.6;cursor:default;}' +
      '#sync-modal-connexion button.sync-mc-fermer{position:absolute;top:10px;right:14px;background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer;line-height:1;}';
    document.head.appendChild(s);
  }

  function construireModalConnexion() {
    if (document.getElementById('sync-modal-connexion-overlay')) return;
    styleModalConnexion();
    const overlay = document.createElement('div');
    overlay.id = 'sync-modal-connexion-overlay';
    overlay.innerHTML =
      '<div id="sync-modal-connexion">' +
        '<button class="sync-mc-fermer" onclick="SYNC.fermerModalConnexion()" aria-label="Fermer">&times;</button>' +
        '<h3>Connexion</h3>' +
        '<p>Saisissez votre code client pour accéder à votre espace.</p>' +
        '<input id="sync-mc-code" placeholder="XXXX-YYYY-ZZZZ" autocomplete="off">' +
        '<div class="sync-mc-erreur" id="sync-mc-erreur"></div>' +
        '<div class="sync-mc-actions">' +
          '<button class="sync-mc-annuler" onclick="SYNC.fermerModalConnexion()">Annuler</button>' +
          '<button class="sync-mc-valider" id="sync-mc-valider" onclick="SYNC.validerModalConnexion()">Se connecter</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fermerModalConnexion(); });
    const input = document.getElementById('sync-mc-code');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') validerModalConnexion(); });
  }

  function ouvrirModalConnexion() {
    construireModalConnexion();
    const overlay = document.getElementById('sync-modal-connexion-overlay');
    const input   = document.getElementById('sync-mc-code');
    const erreur  = document.getElementById('sync-mc-erreur');
    if (erreur) erreur.textContent = '';
    if (input) input.value = localStorage.getItem('licenceCode') || '';
    overlay.style.display = 'flex';
    setTimeout(() => input && input.focus(), 50);
  }

  function fermerModalConnexion() {
    const overlay = document.getElementById('sync-modal-connexion-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function validerModalConnexion() {
    const input  = document.getElementById('sync-mc-code');
    const erreur = document.getElementById('sync-mc-erreur');
    const btn    = document.getElementById('sync-mc-valider');
    const code   = input ? input.value.trim() : '';
    if (!code) { if (erreur) erreur.textContent = 'Veuillez saisir un code client.'; return; }
    if (erreur) erreur.textContent = '';
    if (btn) { btn.textContent = 'Vérification…'; btn.disabled = true; }
    sessionStorage.setItem('shRedirectApresConnexion', '/tableau-de-bord.html');
    const ok = await connecter(code);
    if (btn) { btn.textContent = 'Se connecter'; btn.disabled = false; }
    if (ok) {
      sessionStorage.removeItem('shRedirectApresConnexion');
      fermerModalConnexion();
      afficherNotif('✔ Connexion réussie !');
      setTimeout(() => { location.href = '/tableau-de-bord.html'; }, 400);
    } else {
      if (erreur) erreur.textContent = 'Code licence invalide ou expiré.';
    }
  }

  // Petit indicateur de version, discret, en bas à gauche (présent sur toutes les pages)
  function afficherVersion() {
    if (document.getElementById('sync-version')) return;
    const ajoute = () => {
      if (!document.body || document.getElementById('sync-version')) return;
      const tag = document.createElement('div');
      tag.id = 'sync-version';
      tag.className = 'no-print';
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
    ouvrirModalConnexion, fermerModalConnexion, validerModalConnexion,
    rafraichirMenu: () => { construireMenuLateral(); },
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
  majMarqueBlanche();
});

/* ── Marque blanche ──────────────────────────────────────────────────────
   Si la licence est en "marque partenaire", masque le nom "VOLITIS" et insère
   le logo du partenaire entre l'identité (Suiv'Heures) et le titre de la page.
   La config est lue dans le localStorage (alimentée par /api/data à chaque
   chargement), donc appelée au boot ET après chaque chargement de données. */
function majMarqueBlanche() {
  const actif = localStorage.getItem('syncMarquePartenaire') === '1';
  const logo  = localStorage.getItem('syncLogoPartenaire') || '';

  // 1) Masquer / réafficher le nom "VOLITIS" (les liens Volitis restent intacts)
  document.querySelectorAll('.vol-marque').forEach(el => {
    el.style.display = actif ? 'none' : '';
  });

  // 2) Logo partenaire entre l'identité et le titre de page
  document.querySelectorAll('.main-header').forEach(header => {
    let img = header.querySelector('.vol-logo-partenaire');
    if (actif && logo) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'vol-logo-partenaire';
        img.alt = 'Logo partenaire';
        const identite = header.querySelector('.vol-identite');
        if (identite) identite.insertAdjacentElement('afterend', img);
        else header.insertBefore(img, header.firstChild);
      }
      if (img.getAttribute('src') !== logo) img.setAttribute('src', logo);
      img.style.display = '';
    } else if (img) {
      img.remove();
    }
  });
}

// Crée (sans doublon) le bandeau de consultation admin en haut de la page.
function afficherBanniereConsultation(clientNom) {
  if (document.getElementById('banniere-admin-consult')) return;
  const banniere = document.createElement('div');
  banniere.id = 'banniere-admin-consult';
  banniere.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:0.85rem;box-shadow:0 2px 6px rgba(0,0,0,0.25);';
  banniere.innerHTML = `👁 Mode consultation admin (lecture seule) – Client : <strong>${clientNom}</strong> &nbsp;|&nbsp; ` +
    `<a href="#" onclick="SYNC_quitterConsultation(event)" style="color:#000;text-decoration:underline;">Fermer la consultation</a>`;
  document.body.prepend(banniere);
}

// Quitter la consultation : purge les données du client consulté et FERME l'onglet.
// L'onglet de consultation est ouvert par l'admin (fenêtre nommée) : le refermer évite
// d'empiler des onglets qui afficheraient des données périmées d'un autre client.
function SYNC_quitterConsultation(ev) {
  if (ev) ev.preventDefault();
  sessionStorage.removeItem('adminConsult');
  sessionStorage.removeItem('adminConsultNom');
  localStorage.clear();
  window.close();
  // Repli : si le navigateur refuse de fermer l'onglet (ouvert manuellement),
  // on revient à l'admin dans CE même onglet plutôt que d'en créer un nouveau.
  setTimeout(() => { location.replace('/admin.html'); }, 150);
}
