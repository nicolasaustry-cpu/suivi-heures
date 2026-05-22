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
    const h = s.heuresParJour || {};
    tb.innerHTML += `
      <tr>
        <td>${s.prenom}</td>
        <td>${s.nom}</td>
        <td>${s.dateEntree || ""}</td>
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
        <td style="white-space:nowrap;">
          <input type="password" id="pin-${s.id}" maxlength="4" value="${s.pin || ''}" placeholder="----"
            style="width:56px;text-align:center;border:1px solid #ccc;border-radius:4px;padding:3px 4px;font-size:0.9rem;"
            onchange="majPIN(${s.id}, this.value)">
          <span onclick="togglePIN(${s.id})" title="Afficher/Masquer le PIN"
            style="cursor:pointer;font-size:1rem;margin-left:3px;color:#6b7280;user-select:none;">👁</span>
        </td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary" style="padding:3px 8px;font-size:0.8rem;" onclick="ouvrirModifSalarie(${s.id})">✏</button>
          <button class="btn btn-danger" style="padding:3px 8px;font-size:0.8rem;" onclick="supprimerSalarie(${idx})">✖</button>
        </td>
      </tr>`;
  });
}

/* ── Modale modification heures salarié ── */
function ouvrirModifSalarie(id) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  const h = sal.heuresParJour || {};
  const jours = ['lun','mar','mer','jeu','ven','sam'];

  let modale = document.getElementById('modale-modif-sal');
  if (!modale) {
    modale = document.createElement('div');
    modale.id = 'modale-modif-sal';
    modale.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modale);
  }

  // Construire les inputs sans template imbriqué
  let inputsHTML = '';
  jours.forEach(function(j) {
    const label = j.charAt(0).toUpperCase() + j.slice(1);
    const val   = h[j] !== undefined ? h[j] : 0;
    inputsHTML += '<div style="text-align:center;">'
      + '<label style="font-size:0.78rem;font-weight:700;color:#374151;display:block;margin-bottom:3px;">' + label + '</label>'
      + '<input type="number" id="modif-' + j + '" value="' + val + '" min="0" max="12" step="0.5"'
      + ' style="width:100%;text-align:center;border:1px solid #d1d5db;border-radius:6px;padding:5px 2px;font-size:0.9rem;">'
      + '</div>';
  });

  modale.innerHTML = '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:420px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.2);">'
    + '<h3 style="margin:0 0 1rem;color:#374151;">✏ Modifier ' + sal.prenom + ' ' + sal.nom + '</h3>'
    + '<p style="font-size:0.85rem;color:#6b7280;margin-bottom:0.8rem;">Heures contractuelles par jour</p>'
    + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:1rem;">'
    + inputsHTML
    + '</div>'
    + '<div style="display:flex;gap:0.8rem;justify-content:flex-end;">'
    + '<button class="btn" onclick="document.getElementById(\'modale-modif-sal\').style.display=\'none\'"'
    + ' style="background:#f3f4f6;color:#374151;padding:7px 16px;">Annuler</button>'
    + '<button class="btn btn-success" onclick="sauverModifSalarie(' + id + ')" style="padding:7px 16px;">✔ Sauvegarder</button>'
    + '</div></div>';

  modale.style.display = 'flex';
  modale.onclick = function(e) { if (e.target === modale) modale.style.display = 'none'; };
}

function sauverModifSalarie(id) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  if (!sal.heuresParJour) sal.heuresParJour = {};
  ['lun','mar','mer','jeu','ven','sam'].forEach(j => {
    const val = parseFloat(document.getElementById('modif-' + j)?.value) || 0;
    sal.heuresParJour[j] = val;
  });
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

function majPIN(id, pin) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  if (pin && !/^\d{4}$/.test(pin)) { alert("Le PIN doit être composé de 4 chiffres."); return; }
  sal.pin = pin;
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
}

function togglePIN(id) {
  const input = document.getElementById('pin-' + id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

/* ===========================================
   AJOUT / SUPPRESSION DE SALARIÉ
   =========================================== */
function ajouterSalarie() {
  const prenom    = document.getElementById("prenomEl")?.value.trim();
  const nom       = document.getElementById("nomEl")?.value.trim();
  const dateEntree = document.getElementById("dateEntreeEl")?.value;

  if (!prenom || !nom || !dateEntree) {
    alert("Veuillez remplir tous les champs avant d'ajouter un salarié.");
    return;
  }

  const nouveau = {
    id: Date.now(),
    prenom,
    nom,
    dateEntree,
    dateSortie: "",
    heuresParJour: {
      lun: parseFloat(document.getElementById("hLun").value) || 0,
      mar: parseFloat(document.getElementById("hMar").value) || 0,
      mer: parseFloat(document.getElementById("hMer").value) || 0,
      jeu: parseFloat(document.getElementById("hJeu").value) || 0,
      ven: parseFloat(document.getElementById("hVen").value) || 0,
      sam: parseFloat(document.getElementById("hSam").value) || 0,
    },
  };

  salaries.push(nouveau);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();

  // Réinitialiser le formulaire
  ["prenomEl","nomEl","dateEntreeEl"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["hLun","hMar","hMer","hJeu","hVen"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "8";
  });
  const hSam = document.getElementById("hSam");
  if (hSam) hSam.value = "0";

  localStorage.setItem("majPlanning", Date.now().toString());
  alert("Salarié ajouté !");
}

function supprimerSalarie(index) {
  if (!confirm("Supprimer ce salarié ?")) return;
  const supprime = salaries.splice(index, 1)[0];
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();

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
  const header = document.querySelector("header");
  if (!header) return;
  document.getElementById("volitis-link")?.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "volitis-link";
  Object.assign(wrapper.style, {
    display: "flex", alignItems: "center", gap: "0.5rem",
    marginLeft: "1rem", cursor: "pointer", userSelect: "none"
  });

  const logoContainer = document.createElement("div");
  Object.assign(logoContainer.style, {
    background: "white", borderRadius: "50%",
    width: "42px", height: "42px",
    display: "flex", alignItems: "center", justifyContent: "center"
  });

  const img = document.createElement("img");
  img.src = "assets/volitis-logo.png";
  img.alt = "Logo Volitis";
  img.style.height = "30px";
  img.style.width = "auto";
  logoContainer.appendChild(img);

  const text = document.createElement("span");
  text.textContent = "Outil créé par Volitis";
  Object.assign(text.style, { fontSize: "0.8rem", color: "white", whiteSpace: "nowrap" });

  wrapper.append(logoContainer, text);
  wrapper.addEventListener("click", () => window.open("https://volitis.net/", "_blank"));
  header.appendChild(wrapper);
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
