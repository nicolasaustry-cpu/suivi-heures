/* coordonnees.js — encart de saisie + affichage des coordonnées d'un chantier.
   Stockage : localStorage 'coordonneesChantiersdata' = { "NOM MAJ": {adresse,ville,mobile,fixe} }
   Persistance serveur : /api/data/coordonnees-chantier (token PC) ou
   /api/saisies/coordonnees-chantier (codeEmploye mobile, gérant/admin).
   API publique : window.Coord.{ ouvrir, fermer, enregistrer, get, html, aDesCoordonnees } */
(function () {
  'use strict';

  function _lire()  { try { return JSON.parse(localStorage.getItem('coordonneesChantiersdata') || '{}') || {}; } catch (_) { return {}; } }
  function _ecrire(o){ try { localStorage.setItem('coordonneesChantiersdata', JSON.stringify(o)); } catch (_) {} }
  function get(nom) { return _lire()[(nom || '').toUpperCase()] || null; }
  function aDesCoordonnees(nom) { const c = get(nom); return !!(c && (c.adresse || c.ville || c.mobile || c.fixe)); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function _tel(n) { return String(n || '').replace(/[^0-9+]/g, ''); }

  /* Lien « itinéraire » Google Maps construit depuis l'adresse + la ville.
     Format universel : ouvre l'application Maps sur Android comme sur iPhone,
     et bascule sur le navigateur si elle n'est pas installée. */
  function _mapsUrl(c) {
    var dest = [c.adresse, c.ville].filter(Boolean).join(', ')
      .replace(/[\r\n]+/g, ', ')      // l'adresse est saisie dans un textarea
      .replace(/\s{2,}/g, ' ')
      .trim();
    return dest ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) : '';
  }

  /* Style du bouton Itinéraire — injecté dès le chargement, car le bloc
     d'affichage peut être rendu sans que le modal d'édition ait jamais servi
     (cas de la saisie mobile, où le salarié ne fait que lire les coordonnées). */
  function _styleItin() {
    if (!document.head || document.getElementById('coord-itin-style')) return;
    var st = document.createElement('style');
    st.id = 'coord-itin-style';
    st.textContent =
      '.chip-coord .coord-haut{display:flex;align-items:center;gap:10px;}' +
      '.chip-coord .coord-adr{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;}' +
      '.chip-coord .coord-tels{margin-top:3px;}' +
      '.chip-coord .coord-itin{flex:0 0 auto;display:inline-block;margin:0;padding:6px 12px;' +
      'border:1px solid #c7d7f5;border-radius:8px;background:#eef4fd;color:#0f3a8a;' +
      'text-decoration:none;font-weight:700;font-size:.78rem;line-height:1.25;white-space:nowrap;}' +
      '.chip-coord .coord-itin:active{background:#dbe7fb;}';
    document.head.appendChild(st);
  }
  _styleItin();  // <head> existe déjà : le script est chargé en fin de <body>
  if (!document.getElementById('coord-itin-style')) document.addEventListener('DOMContentLoaded', _styleItin);

  /* Bloc d'affichage « en clair » à insérer dans une carte de chantier.
     L'adresse et le bouton Itinéraire tiennent sur une même rangée,
     les téléphones sur la ligne du dessous. */
  function html(nom) {
    const c = get(nom);
    if (!c || (!c.adresse && !c.ville && !c.mobile && !c.fixe)) return '';
    let l = '';
    if (c.adresse || c.ville) {
      let adr = '';
      if (c.adresse) adr += _esc(c.adresse) + (c.ville ? '<br>' : '');
      if (c.ville)   adr += _esc(c.ville);
      const itin = _mapsUrl(c);
      l += '<div class="coord-haut"><div class="coord-adr">📍 ' + adr + '</div>'
         + (itin ? '<a class="coord-itin" href="' + _esc(itin) + '" target="_blank" rel="noopener">🗺 Itinéraire</a>' : '')
         + '</div>';
    }
    const tels = [];
    if (c.mobile) tels.push('📱 <a href="tel:' + _tel(c.mobile) + '">' + _esc(c.mobile) + '</a>');
    if (c.fixe)   tels.push('☎ <a href="tel:' + _tel(c.fixe) + '">' + _esc(c.fixe) + '</a>');
    if (tels.length) l += '<div class="coord-tels">' + (l ? '' : '📍 ') + tels.join(' · ') + '</div>';
    return '<div class="chip-coord">' + l + '</div>';
  }

  /* ─ Modal d'édition ─ */
  var _nom = null, _onDone = null;

  function _construireModal() {
    if (document.getElementById('coord-modal')) return;
    var st = document.createElement('style');
    st.textContent =
      '#coord-modal{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.5);display:none;align-items:center;justify-content:center;padding:16px;}' +
      '#coord-modal.on{display:flex;}' +
      '#coord-modal .cm{background:#fff;border-radius:14px;width:100%;max-width:360px;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.35);font-family:inherit;}' +
      '#coord-modal .cm-h{background:#0f3a8a;color:#fff;padding:12px 16px;border-bottom:3px solid #f59e0b;display:flex;justify-content:space-between;align-items:center;}' +
      '#coord-modal .cm-h b{font-size:.95rem;}#coord-modal .cm-sub{font-size:.74rem;color:#bfdbfe;margin-top:2px;}' +
      '#coord-modal .cm-x{background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:1rem;}' +
      '#coord-modal .cm-b{padding:14px 16px;}#coord-modal .cm-ch{margin-bottom:11px;}' +
      '#coord-modal label{display:block;font-size:.76rem;font-weight:600;color:#475569;margin-bottom:4px;}' +
      '#coord-modal input,#coord-modal textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:.9rem;font-family:inherit;}' +
      '#coord-modal textarea{resize:vertical;min-height:50px;}#coord-modal .cm-2{display:flex;gap:10px;}#coord-modal .cm-2 .cm-ch{flex:1;}' +
      '#coord-modal .cm-f{display:flex;gap:8px;padding:12px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;}' +
      '#coord-modal .cm-f button{flex:1;border:none;border-radius:8px;padding:10px;font-weight:700;font-size:.86rem;cursor:pointer;}' +
      '#coord-modal .cm-ok{background:#16a34a;color:#fff;}#coord-modal .cm-an{background:#e2e8f0;color:#334155;}' +
      '.chip-coord{margin-top:5px;padding-top:5px;border-top:1px dashed rgba(0,0,0,.18);font-size:.8rem;line-height:1.5;color:#334155;overflow-wrap:anywhere;}' +
      '.chip-coord a{color:#1d4ed8;text-decoration:none;font-weight:600;}';
    document.head.appendChild(st);

    var m = document.createElement('div');
    m.id = 'coord-modal';
    m.innerHTML =
      '<div class="cm"><div class="cm-h"><div><b>📍 Coordonnées du chantier</b><div class="cm-sub" id="coord-sub"></div></div>' +
      '<button type="button" class="cm-x" onclick="Coord.fermer()">✕</button></div>' +
      '<div class="cm-b">' +
      '<div class="cm-ch"><label>Adresse</label><textarea id="coord-adresse" placeholder="N°, rue, complément…"></textarea></div>' +
      '<div class="cm-ch"><label>Ville</label><input id="coord-ville" placeholder="Code postal et ville"></div>' +
      '<div class="cm-2"><div class="cm-ch"><label>Tél. mobile</label><input id="coord-mobile" type="tel"></div>' +
      '<div class="cm-ch"><label>Tél. fixe</label><input id="coord-fixe" type="tel"></div></div>' +
      '</div><div class="cm-f"><button type="button" class="cm-an" onclick="Coord.fermer()">Annuler</button>' +
      '<button type="button" class="cm-ok" onclick="Coord.enregistrer()">Enregistrer</button></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m) fermer(); });
    document.body.appendChild(m);
  }

  function ouvrir(nom, onDone) {
    nom = (nom || '').trim();
    if (!nom) { alert('Indiquez d\'abord le nom du chantier.'); return; }
    _construireModal();
    _nom = nom; _onDone = (typeof onDone === 'function') ? onDone : null;
    var c = get(nom) || {};
    document.getElementById('coord-sub').textContent = nom;
    document.getElementById('coord-adresse').value = c.adresse || '';
    document.getElementById('coord-ville').value   = c.ville   || '';
    document.getElementById('coord-mobile').value  = c.mobile  || '';
    document.getElementById('coord-fixe').value    = c.fixe    || '';
    document.getElementById('coord-modal').classList.add('on');
  }

  function fermer() { var m = document.getElementById('coord-modal'); if (m) m.classList.remove('on'); }

  async function enregistrer() {
    var coord = {
      adresse: (document.getElementById('coord-adresse').value || '').trim(),
      ville:   (document.getElementById('coord-ville').value   || '').trim(),
      mobile:  (document.getElementById('coord-mobile').value  || '').trim(),
      fixe:    (document.getElementById('coord-fixe').value    || '').trim()
    };
    var nomU = _nom.toUpperCase();
    var o = _lire();
    if (!coord.adresse && !coord.ville && !coord.mobile && !coord.fixe) delete o[nomU]; else o[nomU] = coord;
    _ecrire(o);

    // Choix du canal : TOKEN en priorité (PC / gérant licence), code employé seulement à défaut (vrai mobile).
    var token = (typeof SYNC !== 'undefined' && SYNC.getToken && SYNC.getToken()) || localStorage.getItem('syncToken');
    var codeEmploye = localStorage.getItem('saisie_codeEmploye');
    var url, opts;
    if (token) {
      url = '/api/data/coordonnees-chantier';
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ chantier: nomU, coordonnees: coord }) };
    } else if (codeEmploye) {
      var salarieId = null; try { salarieId = JSON.parse(localStorage.getItem('saisie_salarie') || 'null')?.id; } catch (_) {}
      url = '/api/saisies/coordonnees-chantier';
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeEmploye: codeEmploye, salarieId: salarieId, chantier: nomU, coordonnees: coord }) };
    } else {
      alert('⚠️ Enregistrement impossible : session non authentifiée. Reconnectez-vous puis réessayez (vos données saisies restent affichées).');
      return; // on garde le modal ouvert, rien n'est perdu
    }

    var okServeur = false;
    try {
      var r = await fetch(url, opts);
      var d = await r.json();
      okServeur = !!(d && d.ok);
    } catch (_) { okServeur = false; }

    if (!okServeur) {
      // Échec serveur : on NE ferme PAS, on prévient — évite toute perte silencieuse à la synchro suivante.
      alert('⚠️ Les coordonnées n\'ont PAS pu être enregistrées sur le serveur (connexion ?).\n\nElles restent affichées à l\'écran. Recliquez sur « Enregistrer » une fois la connexion rétablie pour les sauvegarder définitivement.');
      return;
    }

    fermer();
    if (_onDone) _onDone();
  }

  window.Coord = { ouvrir: ouvrir, fermer: fermer, enregistrer: enregistrer, get: get, html: html, aDesCoordonnees: aDesCoordonnees };
})();
