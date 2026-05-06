/* ------------------- Données partagées ------------------- */
let salaries = JSON.parse(localStorage.getItem("salaries_data") || "[]");
let heures = JSON.parse(localStorage.getItem("heures_data") || "{}");
let licence = JSON.parse(localStorage.getItem("licence_data") || "null");
let entreprise = JSON.parse(localStorage.getItem("entreprise_data") || "{}");

/* --- URL du serveur Render --- */
const API_BASE = "[suivi-heures-v2.onrender.com](https://suivi-heures-v2.onrender.com)";

/* ---------- Licence ---------- */
function licenceOK() {
  const msg = document.getElementById("licence-status");

  // --- si aucune licence anciennement enregistrée ---
  if (!licence) {
    if (msg) msg.textContent = "Licence non activée";
    document.body.classList.add("readonly");
    return false;
  }

  // --- licence expirée ---
const exp = new Date(licence.expiration || licence.dateExpiration);
  const now = new Date();
  if (now > exp) {
    if (msg) msg.textContent = "Licence expirée";
    document.body.classList.add("readonly");
    return false;
  }

  // --- licence encore valide ---
  if (msg) {
    msg.textContent = "✔️ Active jusqu’au " + exp.toLocaleDateString("fr-FR");
  }
  document.body.classList.remove("readonly");

  // Optionnel : remet le pointeur normal sur les champs
  document.querySelectorAll("input, button, select, textarea").forEach(el => {
    el.disabled = false;
    el.style.pointerEvents = "auto";
    el.style.opacity = "1";
  });

  return true;
}

/* ---------- Entreprise ---------- */
function initEntreprise() {
  if (entreprise.nom) {
    document.getElementById("nom-entreprise").value = entreprise.nom;
    // ✅ Ajoute cette ligne pour afficher le nom dans le header
    const headerNom = document.getElementById("entreprise-nom");
    if (headerNom) {
      headerNom.textContent = entreprise.nom;
    }
  }
}

/* ---------- Salariés ---------- */
function ajouterSalarie() {
  const prenom = document.getElementById("prenomEl").value.trim();
  const nom = document.getElementById("nomEl").value.trim();
  const dateEntree = document.getElementById("dateEntreeEl").value.trim();

  if (!prenom || !nom) {
    alert("Veuillez saisir un prénom et un nom.");
    return;
  }

  const heuresParJour = {
    lun: parseFloat(document.getElementById("hLun").value) || 0,
    mar: parseFloat(document.getElementById("hMar").value) || 0,
    mer: parseFloat(document.getElementById("hMer").value) || 0,
    jeu: parseFloat(document.getElementById("hJeu").value) || 0,
    ven: parseFloat(document.getElementById("hVen").value) || 0,
    sam: parseFloat(document.getElementById("hSam").value) || 0
  };

  const nouvelId = Date.now();
  const salarie = { id: nouvelId, prenom, nom, dateEntree, heuresParJour };

  // Ajout à la liste et sauvegarde locale
  salaries.push(salarie);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));

  // 🔄 Synchronisation serveur (optionnelle)
  fetch(`${API_BASE}/api/data/saveSalaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(salaries)
  }).catch(console.error);

  // Réinitialise le formulaire
  document.getElementById("prenomEl").value = "";
  document.getElementById("nomEl").value = "";
  document.getElementById("dateEntreeEl").value = "";

  // Recharge la liste
  if (typeof afficherSalaries === "function") afficherSalaries();

  alert("Salarié ajouté !");
}

// 🔄 Synchronisation serveur
fetch(`${API_BASE}/api/data/saveSalaries`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(salaries)
}).catch(console.error);

function afficherSalaries() {
  const tb = document.querySelector("#table-salaries tbody");
  if (!tb) return;
  tb.innerHTML = "";
  salaries.forEach((s, index) => {
    const h = s.heuresParJour || {};
    tb.innerHTML += `
      <tr>
        <td><input value="${s.prenom}" onchange="majSalarie(${index}, 'prenom', this.value)"></td>
        <td><input value="${s.nom}" onchange="majSalarie(${index}, 'nom', this.value)"></td>
        <td><input type="date" value="${s.dateEntree || ''}" onchange="majSalarie(${index}, 'dateEntree', this.value)"></td>
        <td><input type="date" value="${s.dateSortie || ''}" onchange="majSalarie(${index}, 'dateSortie', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.lundi ?? 0}" onchange="majHeuresJour(${index}, 'lundi', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.mardi ?? 0}" onchange="majHeuresJour(${index}, 'mardi', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.mercredi ?? 0}" onchange="majHeuresJour(${index}, 'mercredi', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.jeudi ?? 0}" onchange="majHeuresJour(${index}, 'jeudi', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.vendredi ?? 0}" onchange="majHeuresJour(${index}, 'vendredi', this.value)"></td>
        <td><input type="number" step="0.1" value="${h.samedi ?? 0}" onchange="majHeuresJour(${index}, 'samedi', this.value)"></td>
        <td><button class="btn btn-danger" onclick="supprimerSalarie(${s.id})">Suppr.</button></td>
      </tr>`;
  });
}

/* --- Fonctions locales --- */
function majSalarie(index, champ, valeur) {
  salaries[index][champ] = valeur;
  localStorage.setItem("salaries_data", JSON.stringify(salaries));
}
function supprimerSalarie(id) {
  if (!confirm("Supprimer ce salarié ?")) return;
  salaries = salaries.filter(s => s.id != id);
  localStorage.setItem("salaries_data", JSON.stringify(salaries));
  afficherSalaries();
}
function majHeuresJour(index, jour, valeur) {
  if (!salaries[index].heuresParJour) salaries[index].heuresParJour = {};
  salaries[index].heuresParJour[jour] = parseFloat(valeur) || 0;
  localStorage.setItem("salaries_data", JSON.stringify(salaries));
}
function saveHeure(key, chantier, h) {
  heures[key] = { chantier, heures: parseFloat(h) || 0 };
  localStorage.setItem("heures_data", JSON.stringify(heures));
}

/* --- Logo Volitis + affichage du nom d’entreprise + vérification licence au chargement --- */
window.addEventListener("DOMContentLoaded", () => {
  // ✅ Affiche le nom de l’entreprise à gauche dans le header
  const headerNom = document.getElementById("entreprise-nom");
  if (headerNom && entreprise.nom) {
    headerNom.textContent = entreprise.nom;
  }

  // ✅ Construit le bloc Volitis à droite
  const header = document.querySelector("header");
  if (!header) return;

  document.getElementById("volitis-link")?.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "volitis-link";
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "0.5rem";
  wrapper.style.marginLeft = "1rem";

  const logoContainer = document.createElement("div");
  logoContainer.style.background = "white";
  logoContainer.style.borderRadius = "50%";
  logoContainer.style.width = "42px";
  logoContainer.style.height = "42px";
  logoContainer.style.display = "flex";
  logoContainer.style.alignItems = "center";
  logoContainer.style.justifyContent = "center";

  const img = document.createElement("img");
  img.src = "assets/volitis-logo.png";
  img.alt = "Logo Volitis";
  img.style.height = "30px";
  img.style.width = "auto";
  logoContainer.appendChild(img);

  const text = document.createElement("span");
  text.textContent = "Outil créé par Volitis";
  text.style.fontSize = "0.8rem";
  text.style.color = "white";
  text.style.whiteSpace = "nowrap";

  wrapper.append(logoContainer, text);
  wrapper.addEventListener("click", () => window.open("[volitis.net](https://volitis.net/)", "_blank"));

  const status = document.getElementById("licence-status");
  (status || header).insertAdjacentElement("afterend", wrapper);

  // ✅ Vérifie la licence automatiquement au chargement
  licenceOK();
});

/* --- Ajuster automatiquement la marge sous le bandeau --- */
window.addEventListener("load", () => {
  const topFixed = document.getElementById("top-fixed");
  const planningContainer = document.querySelector("#planning-wrapper")?.parentElement;

  if (topFixed && planningContainer) {
    const h = topFixed.getBoundingClientRect().height;
    planningContainer.style.marginTop = (h + 20) + "px";
    console.log("Décalage planning appliqué :", h + 20, "px");
  }
});

