/* =====================================================
   documents-chantier.js — Bloc « Documents joints (PDF) » d'un chantier
   Réutilisable dans la modale de note (PC) et sur mobile (Vue équipe / saisie).

   API :
     DocsChantier.monter(chantier, container, options)
       - chantier : nom du chantier (sera mis en MAJUSCULES côté serveur)
       - container : élément DOM où injecter le bloc
       - options :
           auth : { codeEmploye, salarieId }  → contexte mobile
                  (si absent, on utilise le jeton de licence via SYNC → contexte PC)
           peutModifier : bool (défaut true en PC ; à passer selon le rôle en mobile)
     DocsChantier.vider(container)   → vide le bloc (aucun chantier sélectionné)
   ===================================================== */
(function () {
  'use strict';

  var TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo

  function injecterStyle() {
    if (document.getElementById('dch-style')) return;
    var css =
      '.dch-wrap{border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:12px;background:#fbfdff;}' +
      '.dch-head{font-size:0.8rem;font-weight:700;color:#1e3a8a;margin-bottom:8px;}' +
      '.dch-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;margin-bottom:6px;font-size:0.84rem;}' +
      '.dch-item .dch-nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151;}' +
      '.dch-item .dch-taille{color:#9ca3af;font-size:0.75rem;white-space:nowrap;}' +
      '.dch-btn{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 9px;font-size:0.78rem;cursor:pointer;color:#374151;white-space:nowrap;}' +
      '.dch-btn:hover{background:#f1f5f9;}' +
      '.dch-btn.dch-suppr{border-color:#fecaca;color:#dc2626;}' +
      '.dch-add{border:1px dashed #93c5fd;background:#eff6ff;color:#1d4ed8;border-radius:7px;padding:8px 12px;font-size:0.82rem;font-weight:600;cursor:pointer;width:100%;box-sizing:border-box;}' +
      '.dch-add:hover{background:#dbeafe;}' +
      '.dch-add:disabled{opacity:0.5;cursor:not-allowed;}' +
      '.dch-vide{font-size:0.8rem;color:#9ca3af;margin-bottom:6px;}' +
      '.dch-msg{font-size:0.78rem;margin-top:6px;min-height:1em;}' +
      '.dch-msg.err{color:#dc2626;}.dch-msg.ok{color:#16a34a;}' +
      '.dch-preview{margin-top:8px;}' +
      '.dch-preview iframe{width:100%;height:60vh;border:1px solid #cbd5e1;border-radius:8px;background:#fff;}';
    var st = document.createElement('style');
    st.id = 'dch-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function fmtTaille(o) {
    if (!o) return '';
    if (o < 1024) return o + ' o';
    if (o < 1024 * 1024) return Math.round(o / 1024) + ' Ko';
    return (o / 1024 / 1024).toFixed(1) + ' Mo';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Construit l'appel : jeton PC (SYNC) OU codeEmploye/salarieId (mobile)
  function appel(path, extraBody, opts) {
    var headers = { 'Content-Type': 'application/json' };
    var body = Object.assign({}, extraBody || {});
    if (opts && opts.auth && opts.auth.codeEmploye) {
      body.codeEmploye = opts.auth.codeEmploye;
      body.salarieId = opts.auth.salarieId;
    } else {
      var t = (typeof SYNC !== 'undefined' && SYNC.getToken && SYNC.getToken()) || (function () { try { return localStorage.getItem('syncToken'); } catch (e) { return null; } })();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    return fetch('/api/documents/' + path, {
      method: 'POST', headers: headers, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function b64versBlob(b64, mime) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/pdf' });
  }

  function vider(container) {
    if (container) container.innerHTML = '';
  }

  function monter(chantier, container, options) {
    if (!container) return;
    injecterStyle();
    var opts = options || {};
    var peutModifier = (opts.peutModifier !== false); // défaut : oui (PC)
    chantier = String(chantier || '').trim();

    container.innerHTML =
      '<div class="dch-wrap">' +
        '<div class="dch-head">📎 Documents joints (PDF)</div>' +
        '<div class="dch-liste"><div class="dch-vide">Chargement…</div></div>' +
        (peutModifier
          ? '<button type="button" class="dch-add">+ Joindre un PDF</button>' +
            '<input type="file" accept="application/pdf,.pdf" class="dch-file" style="display:none">'
          : '') +
        '<div class="dch-preview"></div>' +
        '<div class="dch-msg"></div>' +
      '</div>';

    var elListe   = container.querySelector('.dch-liste');
    var elPreview = container.querySelector('.dch-preview');
    var elMsg     = container.querySelector('.dch-msg');
    var elAdd     = container.querySelector('.dch-add');
    var elFile    = container.querySelector('.dch-file');

    function msg(t, type) { elMsg.textContent = t || ''; elMsg.className = 'dch-msg ' + (type || ''); }

    function rendreListe(docs) {
      elPreview.innerHTML = '';
      if (!docs || !docs.length) {
        elListe.innerHTML = '<div class="dch-vide">Aucun document joint.</div>';
        return;
      }
      elListe.innerHTML = '';
      docs.forEach(function (d) {
        var row = document.createElement('div');
        row.className = 'dch-item';
        row.innerHTML =
          '<span class="dch-nom" title="' + esc(d.nom) + '">📄 ' + esc(d.nom) + '</span>' +
          '<span class="dch-taille">' + fmtTaille(d.taille) + '</span>' +
          '<button type="button" class="dch-btn dch-apercu">Aperçu</button>' +
          '<button type="button" class="dch-btn dch-dl">Télécharger</button>' +
          (peutModifier ? '<button type="button" class="dch-btn dch-suppr">Supprimer</button>' : '');
        elListe.appendChild(row);

        row.querySelector('.dch-apercu').addEventListener('click', function () { apercu(d); });
        row.querySelector('.dch-dl').addEventListener('click', function () { telecharger(d); });
        var sup = row.querySelector('.dch-suppr');
        if (sup) sup.addEventListener('click', function () { supprimer(d); });
      });
    }

    function charger() {
      appel('liste', { chantier: chantier }, opts).then(function (r) {
        if (!r.ok) { elListe.innerHTML = '<div class="dch-vide">' + esc(r.message || 'Erreur de chargement.') + '</div>'; return; }
        rendreListe(r.documents);
      }).catch(function () {
        elListe.innerHTML = '<div class="dch-vide">Erreur réseau.</div>';
      });
    }

    function estMobile() {
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
          || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    }

    function apercu(d) {
      var mobile = estMobile();
      // Sur mobile : ouvrir l'onglet MAINTENANT (dans le geste) pour éviter le blocage popup.
      var win = mobile ? window.open('', '_blank') : null;
      msg('Ouverture…', '');
      appel('lien', { id: d.id }, opts).then(function (r) {
        if (!r.ok) { msg(r.message || 'Impossible d’ouvrir le document.', 'err'); if (win) win.close(); return; }
        msg('', '');
        if (mobile) {
          if (win) { win.location.href = r.url; }
          else {
            // Popup bloqué : navigation via un lien (ouvre le lecteur PDF du téléphone)
            var a = document.createElement('a');
            a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
            document.body.appendChild(a); a.click(); a.remove();
          }
        } else {
          elPreview.innerHTML = '<iframe title="Aperçu PDF"></iframe>';
          elPreview.querySelector('iframe').src = r.url;
        }
      }).catch(function () { msg('Erreur réseau.', 'err'); if (win) win.close(); });
    }

    function telecharger(d) {
      msg('Préparation du téléchargement…', '');
      appel('contenu', { id: d.id }, opts).then(function (r) {
        if (!r.ok) { msg(r.message || 'Impossible d’ouvrir le document.', 'err'); return; }
        msg('', '');
        var url = URL.createObjectURL(b64versBlob(r.dataBase64, r.mime));
        var a = document.createElement('a');
        a.href = url; a.download = d.nom || 'document.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }).catch(function () { msg('Erreur réseau.', 'err'); });
    }

    function supprimer(d) {
      if (!confirm('Supprimer le document « ' + (d.nom || '') + ' » ?')) return;
      msg('Suppression…', '');
      appel('supprimer', { id: d.id }, opts).then(function (r) {
        if (!r.ok) { msg(r.message || 'Suppression impossible.', 'err'); return; }
        msg('Document supprimé.', 'ok');
        charger();
      }).catch(function () { msg('Erreur réseau.', 'err'); });
    }

    if (elAdd && elFile) {
      elAdd.addEventListener('click', function () { elFile.click(); });
      elFile.addEventListener('change', function () {
        var f = elFile.files && elFile.files[0];
        elFile.value = '';
        if (!f) return;
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { msg('Seuls les fichiers PDF sont acceptés.', 'err'); return; }
        if (f.size > TAILLE_MAX) { msg('PDF trop volumineux (max 2 Mo).', 'err'); return; }
        msg('Envoi de « ' + f.name + ' »…', '');
        elAdd.disabled = true;
        var lect = new FileReader();
        lect.onload = function () {
          appel('ajouter', { chantier: chantier, nom: f.name, dataBase64: lect.result }, opts).then(function (r) {
            elAdd.disabled = false;
            if (!r.ok) { msg(r.message || 'Envoi impossible.', 'err'); return; }
            msg('Document joint.', 'ok');
            charger();
          }).catch(function () { elAdd.disabled = false; msg('Erreur réseau.', 'err'); });
        };
        lect.onerror = function () { elAdd.disabled = false; msg('Lecture du fichier impossible.', 'err'); };
        lect.readAsDataURL(f);
      });
    }

    charger();
  }

  window.DocsChantier = { monter: monter, vider: vider };
})();
