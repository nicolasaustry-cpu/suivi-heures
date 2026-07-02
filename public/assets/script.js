/* ===========================================
   DONNÉES LOCALES
   =========================================== */
let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries   = JSON.parse(localStorage.getItem("salariesdata")   || "[]");
let heures     = JSON.parse(localStorage.getItem("heuresdata")     || "{}");

/* ===========================================
   LICENCE
   =========================================== */
function licenceOK() {
  const statusEl = document.getElementById("licence-status");
  if (!statusEl) return;

  const code = localStorage.getItem("licenceCode");
  if (!code) {
    statusEl.innerHTML = '<span style="color:#fca5a5;font-size:0.85rem;">⚠ Aucune licence</span>';
    return;
  }
  statusEl.innerHTML = '<span style="color:#86efac;font-size:0.85rem;">✔ Licence active</span>';
}

function activerLicence() {
  const code = document.getElementById("code-client")?.value.trim();
  if (!code) {
    alert("Veuillez saisir un code client.");
    return;
  }
  // Sauvegarde locale du code (la vérification serveur peut être ajoutée ici)
  localStorage.setItem("licenceCode", code);
  alert("Licence enregistrée avec succès !");
  licenceOK();
}

/* ===========================================
   ENTREPRISE
   =========================================== */
function initEntreprise() {
  const input = document.getElementById("nom-entreprise");
  if (input && entreprise.nom) input.value = entreprise.nom;
  const nomE = document.getElementById("entreprise-nom");
  if (nomE && entreprise.nom) nomE.textContent = entreprise.nom;
}

async function sauverEntreprise() {
  const nom  = document.getElementById("nom-entreprise")?.value.trim();
  const code = document.getElementById("code-employe")?.value.trim().toUpperCase();
  if (!nom) {
    alert("Veuillez saisir un nom d'entreprise.");
    return;
  }
  entreprise.nom = nom;
  if (code) entreprise.codeEmploye = code;
  localStorage.setItem("entreprisedata", JSON.stringify(entreprise));
  const nomE = document.getElementById("entreprise-nom");
  if (nomE) nomE.textContent = nom;

  // Sauvegarde immédiate sur le serveur (sans attendre le délai de 2s)
  if (typeof SYNC !== 'undefined' && SYNC.sauvegarderTout) {
    await SYNC.sauvegarderTout();
    alert("Informations enregistrées et synchronisées !");
  } else {
    alert("Informations enregistrées.");
  }
}

/* ===========================================
   SALARIÉS
   =========================================== */
let _filtrePresents = false;

function toggleFiltrePresents() {
  _filtrePresents = !_filtrePresents;
  const btn = document.getElementById('btn-filtre-presents');
  if (btn) {
    btn.textContent = _filtrePresents ? '👥 Tous les salariés' : '✅ Salariés présents';
    btn.style.background = _filtrePresents ? '#2563eb' : '#16a34a';
  }
  afficherSalaries();
}

/* Affiche une date stockée en ISO (AAAA-MM-JJ) au format français JJ/MM/AAAA. */
function fmtDateFr(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function afficherSalaries() {
  const tb = document.querySelector("#table-salaries tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const aujourd_hui = new Date();
  const liste = _filtrePresents
    ? salaries.filter(s => !s.dateSortie || new Date(s.dateSortie) >= aujourd_hui)
    : salaries;
  liste.forEach((s, i) => {
    const idx = salaries.indexOf(s);
    const h = (s.alternance ? s.heuresParJourA : s.heuresParJour) || {};
    const badgeAlt = s.alternance
      ? ' <span title="Alterne semaine A / B" style="background:#e0e7ff;color:#3730a3;border-radius:4px;padding:0 5px;font-size:0.7rem;font-weight:700;white-space:nowrap;">⇄ A/B</span>'
      : '';
    const badgeAdmin = s.administratif
      ? ' <span title="Poste administratif (sans horaires, accès Vue équipe)' + (s.planningPrevu ? ' — planning prévu activé' : '') + '" style="background:#dbeafe;color:#1e3a8a;border-radius:4px;padding:0 5px;font-size:0.7rem;font-weight:700;white-space:nowrap;">👤 Admin' + (s.planningPrevu ? ' 📋' : '') + '</span>'
      : '';
    const estAdmin = (typeof SYNC !== 'undefined' && SYNC.estAdmin && SYNC.estAdmin());
    const pinPose  = !!(s.pin && String(s.pin).trim());
    let pinCell;
    if (pinPose) {
      // PIN posé → verrouillé (lecture seule + cadenas). Œil pour révéler, Réinit. pour changer (patron).
      pinCell =
          `<input type="text" id="pin-${s.id}" value="${s.pin}" class="pin-input pin-masque" readonly disabled `
        + `style="background:#f3f4f6;cursor:not-allowed;width:64px;" title="PIN verrouillé">`
        + `<span title="PIN verrouillé" style="margin-left:3px;color:#9ca3af;">🔒</span>`
        + `<span id="oeil-${s.id}" onclick="togglePIN(${s.id})" title="Afficher/Masquer le PIN" style="cursor:pointer;font-size:1rem;margin-left:3px;color:#6b7280;user-select:none;">👁</span>`
        + (estAdmin ? '' :
            `<button onclick="reinitialiserPIN(${s.id})" title="Réinitialiser ce PIN" `
          + `style="margin-left:6px;background:#fff;color:#b45309;border:1px solid #fcd34d;border-radius:6px;padding:2px 7px;font-size:0.72rem;font-weight:600;cursor:pointer;white-space:nowrap;">↻ Réinit.</button>`);
    } else if (estAdmin) {
      pinCell = `<span style="color:#9ca3af;">(aucun)</span>`;
    } else {
      // PIN vide → saisissable (première pose uniquement)
      pinCell =
          `<input type="text" id="pin-${s.id}" maxlength="4" value="" placeholder="----" `
        + `autocomplete="off" name="pin_${s.id}_${Date.now()}" inputmode="numeric" `
        + `readonly onfocus="this.removeAttribute('readonly')" class="pin-input pin-masque" `
        + `onchange="majPIN(${s.id}, this.value)" data-pin="true">`
        + `<span id="oeil-${s.id}" onclick="togglePIN(${s.id})" title="Afficher/Masquer le PIN" style="cursor:pointer;font-size:1rem;margin-left:3px;color:#6b7280;user-select:none;">👁</span>`;
    }
    tb.innerHTML += `
      <tr>
        <td>${s.prenom}${badgeAlt}${badgeAdmin}</td>
        <td>${s.nom}</td>
        <td style="text-align:center;">
          <label class="switch-gerant" title="Gérant : accès à la page Planning équipe">
            <input type="checkbox" ${s.gerant ? 'checked' : ''} ${estAdmin ? 'disabled' : ''}
                   onchange="majGerant(${s.id}, this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td>${fmtDateFr(s.dateEntree)}</td>
        <td>
          <input type="date" value="${s.dateSortie || ""}"
                 onchange="majDateSortie(${s.id}, this.value)"
                 style="width:130px;">
        </td>
        <td id="h-lun-${s.id}" style="text-align:center;">${h.lun ?? 0}</td>
        <td id="h-mar-${s.id}" style="text-align:center;">${h.mar ?? 0}</td>
        <td id="h-mer-${s.id}" style="text-align:center;">${h.mer ?? 0}</td>
        <td id="h-jeu-${s.id}" style="text-align:center;">${h.jeu ?? 0}</td>
        <td id="h-ven-${s.id}" style="text-align:center;">${h.ven ?? 0}</td>
        <td id="h-sam-${s.id}" style="text-align:center;">${h.sam ?? 0}</td>
        <td style="white-space:nowrap;">${pinCell}</td>
        <td style="white-space:nowrap;">
          <button class="btn" title="Monter" style="padding:3px 7px;font-size:0.8rem;background:#eef2ff;color:#3730a3;" onclick="deplacerSalarie(${idx}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn" title="Descendre" style="padding:3px 7px;font-size:0.8rem;background:#eef2ff;color:#3730a3;" onclick="deplacerSalarie(${idx}, 1)" ${i === liste.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="btn btn-primary" style="padding:3px 8px;font-size:0.8rem;" onclick="ouvrirModifSalarie(${s.id})">✏</button>
          <button class="btn btn-danger" style="padding:3px 8px;font-size:0.8rem;" onclick="supprimerSalarie(${idx})">✖</button>
        </td>
      </tr>`;
  });
}

/* ── Apprenti / périodes d'école ── */
let _joursEcoleModif = [];
function toggleApprentiModif() {
  const actif = document.getElementById('modif-apprenti')?.checked;
  const bloc = document.getElementById('modif-bloc-apprenti');
  if (bloc) bloc.style.display = actif ? 'block' : 'none';
}
function ouvrirCalendrierEcoleModif(id) {
  const sal = salaries.find(s => s.id === id);
  const nom = sal ? ((sal.prenom || '') + ' ' + (sal.nom || '')).trim() : '';
  if (window.EcoleCal) {
    window.EcoleCal.ouvrir(_joursEcoleModif, nom, function (jours) {
      _joursEcoleModif = jours;
      const sp = document.getElementById('modif-compteur-ecole');
      if (sp) sp.textContent = jours.length ? (jours.length + ' jour' + (jours.length > 1 ? 's' : '') + " d'école") : 'Aucun jour';
    });
  }
}

/* ── Modale modification heures salarié ── */
function ouvrirModifSalarie(id) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  const jours = ['lun','mar','mer','jeu','ven','sam'];
  const hA = (sal.alternance ? sal.heuresParJourA : sal.heuresParJour) || {};
  const hB = sal.heuresParJourB || {};
  const alternance = !!sal.alternance;
  _joursEcoleModif = Array.isArray(sal.joursEcole) ? sal.joursEcole.slice() : [];

  let modale = document.getElementById('modale-modif-sal');
  if (!modale) {
    modale = document.createElement('div');
    modale.id = 'modale-modif-sal';
    modale.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modale);
  }

  // Génère une grille d'inputs (préfixe d'id : 'modif-' ou 'modifB-')
  function grilleInputs(prefixe, valeurs) {
    let html = '';
    jours.forEach(function(j) {
      const label = j.charAt(0).toUpperCase() + j.slice(1);
      const val   = valeurs[j] !== undefined ? valeurs[j] : 0;
      html += '<div style="text-align:center;">'
        + '<label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:3px;">' + label + '</label>'
        + '<input type="number" id="' + prefixe + j + '" value="' + val + '" min="0" max="12" step="0.5"'
        + ' style="width:100%;text-align:center;border:1px solid #d1d5db;border-radius:6px;padding:5px 2px;font-size:0.9rem;">'
        + '</div>';
    });
    return html;
  }

  modale.innerHTML = '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:520px;max-width:95vw;max-height:90vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);">'
    + '<h3 style="margin:0 0 1rem;color:#374151;">✏ Modifier ' + sal.prenom + ' ' + sal.nom + '</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1rem;">'
    + '<div><label style="font-size:0.8rem;font-weight:700;color:#374151;display:block;margin-bottom:3px;">Prénom</label>'
    + '<input type="text" id="modif-prenom" value="' + (sal.prenom || '').replace(/"/g, '&quot;') + '" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px;font-size:0.9rem;"></div>'
    + '<div><label style="font-size:0.8rem;font-weight:700;color:#374151;display:block;margin-bottom:3px;">Nom</label>'
    + '<input type="text" id="modif-nom" value="' + (sal.nom || '').replace(/"/g, '&quot;') + '" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px;font-size:0.9rem;"></div>'
    + '</div>'
    + (sal.administratif ? '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;font-weight:600;color:#0f3a8a;margin-bottom:0.8rem;"><input type="checkbox" id="modif-planning" ' + (sal.planningPrevu ? 'checked' : '') + ' style="width:auto;"> 📋 Autoriser un planning prévu <span style="font-weight:400;color:#6b7280;font-size:0.8rem;">(affecter des chantiers, même sans heures)</span></label>' : '')
    + '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;font-weight:600;margin-bottom:0.8rem;">'
    + '<input type="checkbox" id="modif-alt" ' + (alternance ? 'checked' : '') + ' onchange="toggleAltModif()" style="width:auto;"> Ce salarié alterne deux semaines (A / B)</label>'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">'
    + '<input type="checkbox" id="modif-apprenti" ' + (sal.apprenti ? 'checked' : '') + ' onchange="toggleApprentiModif()" style="width:auto;"> 🎓 Apprenti / alternant (périodes d\'école)</label>'
    + '<div id="modif-bloc-apprenti" style="display:' + (sal.apprenti ? 'block' : 'none') + ';margin-bottom:0.8rem;">'
    + '<button type="button" class="btn" onclick="ouvrirCalendrierEcoleModif(' + id + ')" style="background:#dbeafe;color:#1e40af;padding:5px 12px;font-size:0.82rem;">📅 Définir les périodes d\'école</button>'
    + '<span id="modif-compteur-ecole" style="font-size:0.8rem;color:#6b7280;margin-left:8px;">' + (_joursEcoleModif.length ? (_joursEcoleModif.length + ' jour(s) d\'école') : 'Aucun jour') + '</span></div>'
    + '<p id="modif-labelA" style="font-size:0.85rem;color:#6b7280;margin:0 0 0.5rem;">' + (alternance ? 'Semaine A' : 'Heures contractuelles par jour') + '</p>'
    + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:1rem;">'
    + grilleInputs('modif-', hA)
    + '</div>'
    + '<div id="modif-blocB" style="display:' + (alternance ? 'block' : 'none') + ';">'
    + '<p style="font-size:0.85rem;color:#6b7280;margin:0 0 0.5rem;">Semaine B</p>'
    + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:1rem;">'
    + grilleInputs('modifB-', hB)
    + '</div>'
    + '<p style="font-size:0.85rem;font-weight:600;color:#374151;margin:0 0 0.3rem;">Bascules d\'alternance</p>'
    + '<p style="font-size:0.78rem;color:#6b7280;margin:0 0 0.4rem;">À partir de chaque date (un lundi), la semaine indiquée s\'applique, puis l\'alternance se poursuit.</p>'
    + '<div id="modif-listeBascules"></div>'
    + '<button type="button" class="btn" onclick="ajouterBasculeModif()" style="background:#e0e7ff;color:#3730a3;padding:4px 10px;font-size:0.8rem;margin-top:0.3rem;">+ Ajouter une bascule</button>'
    + '</div>'
    + '<div style="display:flex;gap:0.8rem;justify-content:flex-end;margin-top:1.2rem;">'
    + '<button class="btn" onclick="document.getElementById(\'modale-modif-sal\').style.display=\'none\'" style="background:#f3f4f6;color:#374151;padding:7px 16px;">Annuler</button>'
    + '<button class="btn btn-success" onclick="sauverModifSalarie(' + id + ')" style="padding:7px 16px;">✔ Sauvegarder</button>'
    + '</div></div>';

  // Pré-remplir les bascules existantes
  const bascules = Array.isArray(sal.bascules) ? sal.bascules : [];
  if (bascules.length) {
    bascules.forEach(b => ajouterBasculeModif(b.date, b.semaine));
  } else if (alternance) {
    ajouterBasculeModif();
  }

  modale.style.display = 'flex';
  modale.onclick = function(e) { if (e.target === modale) modale.style.display = 'none'; };
}

// Affiche/masque la grille B + bascules dans la modale d'édition
function toggleAltModif() {
  const actif = document.getElementById('modif-alt')?.checked;
  document.getElementById('modif-blocB').style.display = actif ? 'block' : 'none';
  document.getElementById('modif-labelA').textContent = actif ? 'Semaine A' : 'Heures contractuelles par jour';
  if (actif && document.querySelectorAll('#modif-listeBascules .bascule-ligne').length === 0) {
    ajouterBasculeModif();
  }
}

// Ajoute une ligne de bascule dans la modale d'édition
function ajouterBasculeModif(date, semaine) {
  const cont = document.getElementById('modif-listeBascules');
  if (!cont) return;
  const div = document.createElement('div');
  div.className = 'bascule-ligne';
  div.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
  div.innerHTML =
    '<span style="font-size:0.8rem;color:#374151;">À partir du</span>'
    + '<input type="date" class="bascule-date" value="' + (date || '') + '" style="width:140px;">'
    + '<span style="font-size:0.8rem;color:#374151;">→ semaine</span>'
    + '<select class="bascule-semaine" style="width:60px;">'
    + '<option value="A"' + (semaine === 'B' ? '' : ' selected') + '>A</option>'
    + '<option value="B"' + (semaine === 'B' ? ' selected' : '') + '>B</option>'
    + '</select>'
    + '<button type="button" class="btn" onclick="this.parentElement.remove()" style="background:#fee2e2;color:#991b1b;padding:2px 8px;font-size:0.8rem;">✖</button>';
  cont.appendChild(div);
}

function sauverModifSalarie(id) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  // Prénom / Nom (modifiables)
  const nvPrenom = (document.getElementById('modif-prenom')?.value || '').trim();
  const nvNom    = (document.getElementById('modif-nom')?.value || '').trim();
  if (nvPrenom) sal.prenom = nvPrenom;
  sal.nom = nvNom;
  delete sal.sav;   // option SAV supprimée : le drapeau n'est jamais posé
  // Planning prévu pour un administratif (chantiers sans heures)
  if (document.getElementById('modif-planning')?.checked) sal.planningPrevu = true; else delete sal.planningPrevu;
  const jours = ['lun','mar','mer','jeu','ven','sam'];
  const lire = (prefixe) => {
    const g = {};
    jours.forEach(j => { g[j] = parseFloat(document.getElementById(prefixe + j)?.value) || 0; });
    return g;
  };

  const alternance = document.getElementById('modif-alt')?.checked || false;
  const grilleA = lire('modif-');

  if (alternance) {
    sal.alternance = true;
    sal.heuresParJourA = grilleA;
    sal.heuresParJourB = lire('modifB-');
    sal.heuresParJour  = grilleA; // compatibilité (= semaine A)
    const bascules = [];
    document.querySelectorAll('#modif-listeBascules .bascule-ligne').forEach(l => {
      const d = l.querySelector('.bascule-date')?.value;
      const s = l.querySelector('.bascule-semaine')?.value || 'A';
      if (d) bascules.push({ date: d, semaine: s });
    });
    bascules.sort((a, b) => a.date.localeCompare(b.date));
    sal.bascules = bascules;
  } else {
    // Salarié non alternant : on nettoie les éventuelles données d'alternance
    sal.alternance = false;
    sal.heuresParJour = grilleA;
    delete sal.heuresParJourA;
    delete sal.heuresParJourB;
    delete sal.bascules;
  }

  const estApprenti = document.getElementById('modif-apprenti')?.checked || false;
  if (estApprenti) {
    sal.apprenti = true;
    sal.joursEcole = Array.isArray(_joursEcoleModif) ? _joursEcoleModif.slice() : [];
  } else {
    delete sal.apprenti;
    delete sal.joursEcole;
  }

  localStorage.setItem('salariesdata', JSON.stringify(salaries));
  document.getElementById('modale-modif-sal').style.display = 'none';
  afficherSalaries();
}

function majDateSortie(id, nouvelleDate) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  sal.dateSortie = nouvelleDate || "";
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
  localStorage.setItem("majPlanning", Date.now().toString());
}

/* Change l'ordre d'un salarié : ▲ (sens = -1) le monte, ▼ (sens = +1) le descend.
   Le déplacement se fait par rapport à la liste VISIBLE (respecte le filtre « présents »). */
function deplacerSalarie(idx, sens) {
  const s = salaries[idx];
  if (!s) return;
  const auj = new Date();
  const visibles = _filtrePresents
    ? salaries.filter(x => !x.dateSortie || new Date(x.dateSortie) >= auj)
    : salaries.slice();
  const posV  = visibles.indexOf(s);
  const cible = visibles[posV + sens];
  if (!cible) return;                       // déjà tout en haut / tout en bas
  const i1 = salaries.indexOf(s);
  const i2 = salaries.indexOf(cible);
  salaries[i1] = cible;
  salaries[i2] = s;
  localStorage.setItem('salariesdata', JSON.stringify(salaries));
  afficherSalaries();
  localStorage.setItem('majPlanning', Date.now().toString());
}

/* Marque/démarque un salarié comme « gérant » (accès à la page Planning équipe).
   L'écriture dans salariesdata déclenche automatiquement la synchro serveur. */
function majGerant(id, checked) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  sal.gerant = !!checked;
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
}

function majPIN(id, pin) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  const v = (pin || '').trim();
  if (v === '') return;                     // case vide : on ne touche pas (pas d'effacement accidentel)
  if (!/^\d{4}$/.test(v)) { alert("Le PIN doit être composé de 4 chiffres."); return; }
  if (sal.pin && String(sal.pin).trim()) {  // déjà posé : verrouillé
    alert("Ce PIN est déjà posé et verrouillé. Utilisez « ↻ Réinit. » pour le changer.");
    afficherSalaries();
    return;
  }
  sal.pin = v;
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
}

/* Réinitialiser un PIN verrouillé (patron uniquement) : confirmation systématique,
   puis nouveau PIN (ou vide pour effacer) via la route serveur dédiée. */
async function reinitialiserPIN(id) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  const nom = `${sal.prenom || ''} ${sal.nom || ''}`.trim();
  if (!confirm(`Réinitialiser le PIN de ${nom} ?\nL'ancien code ne fonctionnera plus.`)) return;
  let nouveau = prompt(`Nouveau PIN à 4 chiffres pour ${nom}\n(laisser vide pour effacer le PIN) :`, '');
  if (nouveau === null) return;                          // annulé
  nouveau = (nouveau || '').trim();
  if (nouveau && !/^\d{4}$/.test(nouveau)) { alert("Le PIN doit comporter exactement 4 chiffres."); return; }
  try {
    const token = (typeof SYNC !== 'undefined' && SYNC.getToken) ? SYNC.getToken() : (localStorage.getItem('syncToken') || '');
    const r = await fetch('/api/data/reset-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ salarieId: id, pin: nouveau })
    });
    const d = await r.json();
    if (!d.ok) { alert('Échec de la réinitialisation : ' + (d.message || '')); return; }
    sal.pin = nouveau;
    localStorage.setItem('salariesdata', JSON.stringify(salaries));
    afficherSalaries();
    alert(nouveau ? '✔ PIN réinitialisé.' : '✔ PIN effacé.');
  } catch (e) {
    alert('Erreur réseau lors de la réinitialisation.');
  }
}

function togglePIN(id) {
  const input = document.getElementById('pin-' + id);
  if (!input) return;
  const icone = document.getElementById('oeil-' + id);
  if (input.classList.contains('pin-masque')) {
    input.classList.remove('pin-masque');
    if (icone) icone.textContent = '🙈';
  } else {
    input.classList.add('pin-masque');
    if (icone) icone.textContent = '👁';
  }
}

/* Enregistrer tous les PIN d'un coup : lit chaque case, valide les 4 chiffres,
   met à jour le tableau salaries[], pousse immédiatement au serveur. */
async function enregistrerTousPINs() {
  const btn = document.getElementById('btn-enregistrer-pins');
  if (!btn) return;
  const txtOrigine = btn.textContent;

  // Collecter et valider
  const inputs = document.querySelectorAll('input[data-pin="true"]');
  let nbValides = 0, nbVides = 0, nbInvalides = 0;
  inputs.forEach(input => {
    const id  = parseInt(input.id.replace('pin-', ''));
    const val = (input.value || '').trim();
    const sal = salaries.find(s => s.id === id);
    if (!sal) return;
    if (sal.pin && String(sal.pin).trim()) return;   // déjà posé : verrouillé, on ne touche pas
    if (val === '') {
      nbVides++;                                       // vide : on n'efface PAS
    } else if (/^\d{4}$/.test(val)) {
      sal.pin = val;
      nbValides++;
    } else {
      nbInvalides++;
    }
  });

  if (nbInvalides > 0) {
    alert(`⚠ ${nbInvalides} PIN incorrect(s) — un PIN doit comporter exactement 4 chiffres. Corrigez avant d'enregistrer.`);
    return;
  }

  // Sauvegarder localement et pousser au serveur sans attendre le debounce
  localStorage.setItem('salariesdata', JSON.stringify(salaries));

  btn.disabled = true;
  btn.textContent = '⏳ Enregistrement...';

  let ok = false;
  if (typeof SYNC !== 'undefined' && SYNC.sauvegarderTout) {
    try { await SYNC.sauvegarderTout(); ok = true; } catch (_) {}
  }

  btn.disabled = false;
  if (ok) {
    btn.textContent = `✔ ${nbValides} PIN enregistré${nbValides > 1 ? 's' : ''}`;
    btn.style.background = '#16a34a';
  } else {
    btn.textContent = '⚠ Erreur réseau';
    btn.style.background = '#dc2626';
  }
  setTimeout(() => {
    btn.textContent = txtOrigine;
    btn.style.background = '';
    afficherSalaries();
  }, 2200);
}

/* ===========================================
   AJOUT / SUPPRESSION DE SALARIÉ
   =========================================== */
/* Poste administratif : masque la grille d'horaires et les options (alternance/SAV)
   — un administratif n'a pas d'horaires. La case reste visible (hors des blocs masqués). */
function togglePosteAdmin() {
  const admin = document.getElementById("adminCheck")?.checked || false;
  if (admin) {
    const alt = document.getElementById("altCheck");
    if (alt && alt.checked) { alt.checked = false; if (typeof toggleAlternance === "function") toggleAlternance(); }
  }
  const blocOptions = document.getElementById("bloc-options");
  const blocHeures  = document.getElementById("bloc-heures");
  if (blocOptions) blocOptions.style.display = admin ? "none" : "";
  if (blocHeures)  blocHeures.style.display  = admin ? "none" : "";
  // Option « planning prévu » : visible uniquement pour un administratif
  const blocAdminPlanning = document.getElementById("bloc-admin-planning");
  if (blocAdminPlanning) blocAdminPlanning.style.display = admin ? "" : "none";
  if (!admin) { const pc = document.getElementById("planningCheck"); if (pc) pc.checked = false; }
}

function ajouterSalarie() {
  const prenom    = document.getElementById("prenomEl")?.value.trim();
  const nom       = document.getElementById("nomEl")?.value.trim();
  const dateEntree = document.getElementById("dateEntreeEl")?.value;

  if (!prenom || !nom || !dateEntree) {
    alert("Veuillez remplir tous les champs avant d'ajouter un salarié.");
    return;
  }

  const lireGrille = (suffixe) => ({
    lun: parseFloat(document.getElementById("hLun" + suffixe)?.value) || 0,
    mar: parseFloat(document.getElementById("hMar" + suffixe)?.value) || 0,
    mer: parseFloat(document.getElementById("hMer" + suffixe)?.value) || 0,
    jeu: parseFloat(document.getElementById("hJeu" + suffixe)?.value) || 0,
    ven: parseFloat(document.getElementById("hVen" + suffixe)?.value) || 0,
    sam: parseFloat(document.getElementById("hSam" + suffixe)?.value) || 0,
  });

  const alternance = document.getElementById("altCheck")?.checked || false;
  const administratif = document.getElementById("adminCheck")?.checked || false;

  const nouveau = {
    id: Date.now(),
    prenom,
    nom,
    dateEntree,
    dateSortie: "",
    heuresParJour: lireGrille(""),   // toujours renseigné (= semaine A si alternance)
  };

  if (administratif) {
    nouveau.administratif = true;   // poste administratif : sans horaires, accès Vue équipe
    if (document.getElementById("planningCheck")?.checked) nouveau.planningPrevu = true; // planning prévu autorisé (chantiers sans heures)
  }

  if (alternance) {
    nouveau.alternance     = true;
    nouveau.heuresParJourA = lireGrille("");
    nouveau.heuresParJourB = lireGrille("B");
    nouveau.bascules       = (typeof lireBascules === "function") ? lireBascules() : [];
  }

  const apprenti = document.getElementById("apprentiCheck")?.checked || false;
  if (apprenti) {
    nouveau.apprenti = true;
    nouveau.joursEcole = Array.isArray(window._joursEcoleAjout) ? window._joursEcoleAjout.slice() : [];
  }

  salaries.push(nouveau);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
  if (typeof majMessageVide === "function") majMessageVide();

  // Réinitialiser le formulaire
  ["prenomEl","nomEl","dateEntreeEl"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const adminCb = document.getElementById("adminCheck");
  if (adminCb) adminCb.checked = false;
  if (typeof togglePosteAdmin === "function") togglePosteAdmin();   // masque l'option planning + décoche planningCheck
  ["hLun","hMar","hMer","hJeu","hVen","hSam"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "0";
  });
  if (typeof window.resetApprentiAjout === "function") window.resetApprentiAjout();

  localStorage.setItem("majPlanning", Date.now().toString());
  alert("Salarié ajouté !");
}

function supprimerSalarie(index) {
  if (!confirm("Supprimer ce salarié ?")) return;
  const supprime = salaries.splice(index, 1)[0];
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
  if (typeof majMessageVide === "function") majMessageVide();

  // Supprime aussi ses heures associées
  const id = supprime.id;
  for (const k in heures) {
    if (k.startsWith(id.toString())) delete heures[k];
  }
  localStorage.setItem("heuresdata", JSON.stringify(heures));
  localStorage.setItem("majPlanning", Date.now().toString());
}

/* ===========================================
   LOGO VOLITIS (réutilisable sur toutes les pages)
   =========================================== */
function ajouterLogoVolitis() {
  // Désactivé depuis l'intégration du thème Volitis : le logo Suiv'Heures
  // figure désormais dans le header (vol-identite). Plus besoin d'ajouter
  // un second bloc "Outil créé par Volitis" à droite.
  document.getElementById("volitis-link")?.remove();
  return;
}

/* ===========================================
   CHARGEMENT INITIAL
   =========================================== */
window.addEventListener("DOMContentLoaded", () => {
  // Nom entreprise dans le header
  const nomE = document.getElementById("entreprise-nom");
  if (nomE && entreprise.nom) nomE.textContent = entreprise.nom;

  // Logo
  ajouterLogoVolitis();

  // Licence
  licenceOK();

  // Salariés
  afficherSalaries();
});

/* ===========================================
   SYNCHRONISATION ENTRE PAGES
   =========================================== */
window.addEventListener("storage", (e) => {
  if (e.key === "majPlanning") {
    if (typeof genererPlanning === "function") genererPlanning();
  }
  if (e.key === "salariesdata") {
    salaries = JSON.parse(localStorage.getItem("salariesdata") || "[]");
    afficherSalaries();
  }
});

/* Quand SYNC.chargerDonnees() finit (cas typique : on arrive sur la page avant
   que les données serveur soient là), on relit toutes les variables globales
   et on rafraîchit les vues. */
window.addEventListener("donnees-chargees", () => {
  entreprise   = JSON.parse(localStorage.getItem("entreprisedata")   || "{}");
  salaries     = JSON.parse(localStorage.getItem("salariesdata")     || "[]");
  if (typeof afficherSalaries === "function" && document.querySelector("#table-salaries")) {
    afficherSalaries();
  }
  if (typeof initEntreprise === "function" && document.getElementById("nom-entreprise")) {
    // Recharger nom + code employé sans réécrire les inputs si l'utilisateur tape
    const inpNom  = document.getElementById("nom-entreprise");
    const inpCode = document.getElementById("code-employe");
    if (inpNom  && !inpNom.matches(":focus")  && entreprise.nom)         inpNom.value  = entreprise.nom;
    if (inpCode && !inpCode.matches(":focus") && entreprise.codeEmploye) inpCode.value = entreprise.codeEmploye;
  }
});
