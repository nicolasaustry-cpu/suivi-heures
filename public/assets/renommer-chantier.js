/* renommer-chantier.js — action « Renommer un chantier » (migration complète côté serveur).
   API : window.RenommerChantier.ouvrir(ancienNom, onDone) */
(function () {
  'use strict';

  var _onDone = null;

  function _construire() {
    if (document.getElementById('rc-modal')) return;
    var st = document.createElement('style');
    st.textContent =
      '#rc-modal{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.5);display:none;align-items:center;justify-content:center;padding:16px;}' +
      '#rc-modal.on{display:flex;}' +
      '#rc-modal .rc{background:#fff;border-radius:14px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.35);font-family:inherit;}' +
      '#rc-modal .rc-h{background:#0f3a8a;color:#fff;padding:12px 16px;border-bottom:3px solid #f59e0b;display:flex;justify-content:space-between;align-items:center;}' +
      '#rc-modal .rc-h b{font-size:.95rem;}' +
      '#rc-modal .rc-x{background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:1rem;}' +
      '#rc-modal .rc-b{padding:14px 16px;}' +
      '#rc-modal label{display:block;font-size:.76rem;font-weight:600;color:#475569;margin:0 0 4px;}' +
      '#rc-modal input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:.95rem;font-family:inherit;text-transform:uppercase;}' +
      '#rc-modal input[readonly]{background:#f1f5f9;color:#64748b;}' +
      '#rc-modal .rc-warn{margin:12px 0 2px;font-size:.8rem;line-height:1.45;color:#92400e;background:#fef6e7;border:1px solid #f7dda6;border-radius:8px;padding:9px 11px;}' +
      '#rc-modal .rc-f{display:flex;gap:8px;padding:12px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;}' +
      '#rc-modal .rc-f button{flex:1;border:none;border-radius:8px;padding:10px;font-weight:700;font-size:.86rem;cursor:pointer;}' +
      '#rc-modal .rc-ok{background:#16a34a;color:#fff;}#rc-modal .rc-ok:disabled{background:#cbd5e1;cursor:not-allowed;}' +
      '#rc-modal .rc-an{background:#e2e8f0;color:#334155;}';
    document.head.appendChild(st);

    var m = document.createElement('div');
    m.id = 'rc-modal';
    m.innerHTML =
      '<div class="rc"><div class="rc-h"><b>✏️ Renommer le chantier</b>' +
      '<button type="button" class="rc-x" onclick="RenommerChantier.fermer()">✕</button></div>' +
      '<div class="rc-b">' +
      '<label>Nom actuel</label><input id="rc-ancien" readonly>' +
      '<div style="height:10px"></div>' +
      '<label>Nouveau nom</label><input id="rc-nouveau" placeholder="Nouveau nom du chantier">' +
      '<div class="rc-warn">⚠️ Cette action met à jour le chantier <b>partout</b> : planning, heures réalisées, prévisionnel, coordonnées, notes et ordre mobile. Si un chantier porte déjà le nouveau nom, les deux seront fusionnés. La page sera rechargée ensuite.</div>' +
      '</div>' +
      '<div class="rc-f"><button type="button" class="rc-an" onclick="RenommerChantier.fermer()">Annuler</button>' +
      '<button type="button" class="rc-ok" id="rc-ok" onclick="RenommerChantier.confirmer()">Renommer partout</button></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m) fermer(); });
    document.body.appendChild(m);
  }

  function ouvrir(ancienNom, onDone) {
    ancienNom = (ancienNom || '').trim();
    if (!ancienNom) { alert('Aucun chantier sélectionné.'); return; }
    _construire();
    _onDone = (typeof onDone === 'function') ? onDone : null;
    document.getElementById('rc-ancien').value = ancienNom.toUpperCase();
    document.getElementById('rc-nouveau').value = '';
    document.getElementById('rc-ok').disabled = false;
    document.getElementById('rc-modal').classList.add('on');
    setTimeout(function () { var i = document.getElementById('rc-nouveau'); if (i) i.focus(); }, 50);
  }

  function fermer() { var m = document.getElementById('rc-modal'); if (m) m.classList.remove('on'); }

  async function confirmer() {
    var ancien  = (document.getElementById('rc-ancien').value  || '').trim().toUpperCase();
    var nouveau = (document.getElementById('rc-nouveau').value || '').trim().toUpperCase();
    if (!nouveau) { alert('Saisissez le nouveau nom.'); return; }
    if (nouveau === ancien) { alert('Le nouveau nom est identique à l\'ancien.'); return; }

    var token = (typeof SYNC !== 'undefined' && SYNC.getToken && SYNC.getToken()) || localStorage.getItem('syncToken');
    if (!token) { alert('⚠️ Session non authentifiée. Reconnectez-vous puis réessayez.'); return; }

    var btn = document.getElementById('rc-ok');
    btn.disabled = true; btn.textContent = 'Renommage…';
    try {
      var r = await fetch('/api/data/renommer-chantier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ ancien: ancien, nouveau: nouveau })
      });
      var d = await r.json();
      if (d && d.ok) {
        alert('✔ Chantier renommé : « ' + ancien +' » → « ' + nouveau + ' ».\n\nLa page va se recharger pour afficher les données à jour.');
        if (_onDone) { try { _onDone(); } catch (_) {} }
        location.reload();
      } else {
        btn.disabled = false; btn.textContent = 'Renommer partout';
        alert('⚠️ Renommage impossible : ' + ((d && d.message) || 'erreur serveur') + '. Rien n\'a été modifié.');
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Renommer partout';
      alert('⚠️ Renommage impossible (connexion ?). Rien n\'a été modifié. Réessayez.');
    }
  }

  window.RenommerChantier = { ouvrir: ouvrir, fermer: fermer, confirmer: confirmer };
})();
