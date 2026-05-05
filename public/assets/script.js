/* ------------------- Données partagées ------------------- */
let salaries = JSON.parse(localStorage.getItem("salaries_data") || "[]");
let heures = JSON.parse(localStorage.getItem("heures_data") || "{}");
let licence = JSON.parse(localStorage.getItem("licence_data") || "null");
let entreprise = JSON.parse(localStorage.getItem("entreprise_data") || "{}");

/* --- URL du serveur Render --- */
const API_BASE ="https://suivi-heures-v2.onrender.com";

/* ---------- Fonctions réseau ---------- */

// Enregistrer les données de l’entreprise sur MongoDB
async function sauvegarderEntrepriseServeur(data) {
  try {
    const res = await fetch(`${API_BASE}/api/data/saveEntreprise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Erreur sauvegarde entreprise");
  } catch (err) {
    console.error("Erreur de communication serveur :", err);
  }
}

// Récupérer les données de l’entreprise à la connexion
async function chargerEntrepriseServeur() {
  try {
    const res = await fetch(`${API_BASE}/api/data/getEntreprise`);
    if (!res.ok) throw new Error("Réponse invalide");
    const data = await res.json();
    if (data && data.nom) {
      entreprise = data;
      localStorage.setItem("entreprise_data", JSON.stringify(data));
    }
  } catch (err) {
    console.error("Erreur de chargement entreprise :", err);
  }
}

/* ---------- Licence ---------- */
function activerLicence() {
  const code = document.getElementById("code-client").value.trim();
  if (!code) return alert("Saisir un code client");
  const now = new Date();
  const exp = new Date(now);
  exp.setMonth(now.getMonth() + 6);
  licence = { code, activation: now.toISOString(), expiration: exp.toISOString() };
  localStorage.setItem("licence_data", JSON.stringify(licence));
  alert("Licence activée jusqu’au " + exp.toLocaleDateString("fr-FR"));
  location.reload();
}
function licenceOK() {
  const msg = document.getElementById("licence-status");
  if (!licence) {
    msg.textContent = "Licence non activée";
    document.body.classList.add("readonly");
    return false;
  }
  const exp = new Date(licence.expiration),
    now = new Date();
  if (now > exp) {
    msg.textContent = "Licence expirée";
    document.body.classList.add("readonly");
    return false;
  }
  msg.textContent = "Active jusqu’au " + exp.toLocaleDateString("fr-FR");
  document.body.classList.remove("readonly");
  return true;
}

/* ---------- Entreprise ---------- */
function initEntreprise() {
  if (entreprise.nom) {
    document.getElementById("nom-entreprise").value = entreprise.nom;
    document.getElementById("entreprise-nom").textContent = entreprise.nom;
  }
}

/* ---------- Salariés ---------- */
function ajouterSalarie() {
  const prenom = document.getElementById("prenomEl").value.trim();
  const nom = document.getElementById("nomEl").value.trim();
  const date = document.getElementById("dateEntreeEl").value;
  if (!prenom || !nom || !date) return alert("Tous les champs sont requis.");

  const heuresParJour = {
    lundi: parseFloat(document.getElementById("hLun").value) || 0,
    mardi: parseFloat(document.getElementById("hMar").value) || 0,
    mercredi: parseFloat(document.getElementById("hMer").value) || 0,
    jeudi: parseFloat(document.getElementById("hJeu").value) || 0,
    vendredi: parseFloat(document.getElementById("hVen").value) || 0,
    samedi: parseFloat(document.getElementById("hSam").value) || 0
  };

  salaries.push({ id: Date.now(), prenom, nom, dateEntree: date, heuresParJour });
  localStorage.setItem("salaries_data", JSON.stringify(salaries));
  afficherSalaries();

  // Réinitialise le formulaire
  ["prenomEl", "nomEl", "dateEntreeEl", "hLun", "hMar", "hMer", "hJeu", "hVen", "hSam"].forEach(id => {
    const el = document.getElementById(id);
    if (["hLun", "hMar", "hMer", "hJeu", "hVen"].includes(id)) el.value = 8;
    else if (id === "hSam") el.value = 0;
    else el.value = "";
  });

  // 🔄 Enregistrer sur le serveur
  fetch(`${API_BASE}/api/data/saveSalaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(salaries)
  }).catch(console.error);
}

function afficherSalaries() {
  const tb = document.querySelector("#table-salaries tbody");
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

/* --- Autres fonctions locales (inchangées) --- */
function majSalarie(index, champ, valeur) { salaries[index][champ] = valeur; localStorage.setItem("salaries_data", JSON.stringify(salaries)); }
function supprimerSalarie(id) { if (!confirm("Supprimer ce salarié ?")) return; salaries = salaries.filter(s => s.id != id); localStorage.setItem("salaries_data", JSON.stringify(salaries)); afficherSalaries(); }
function majHeuresJour(index, jour, valeur) { if (!salaries[index].heuresParJour) salaries[index].heuresParJour = {}; salaries[index].heuresParJour[jour] = parseFloat(valeur) || 0; localStorage.setItem("salaries_data", JSON.stringify(salaries)); }
function saveHeure(key, chantier, h) { heures[key] = { chantier, heures: parseFloat(h) || 0 }; localStorage.setItem("heures_data", JSON.stringify(heures)); }

/* --- Logo Volitis --- */
window.addEventListener("DOMContentLoaded", () => {
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

  // 🔗 lien cliquable vers Volitis (corrigé)
  wrapper.addEventListener("click", () => window.open("[volitis.net](https://volitis.net/)", "_blank"));

  const status = document.getElementById("licence-status");
  (status || header).insertAdjacentElement("afterend", wrapper);
}); // ✅ <-- on ferme bien ici le premier listener


/* --- Ajuster automatiquement la marge sous le bandeau --- */
window.addEventListener("load", () => {
  const topFixed = document.getElementById("top-fixed");
  const planningContainer = document.querySelector("#planning-wrapper")?.parentElement;

  if (topFixed && planningContainer) {
    // attendre le calcul réel de la hauteur une fois le rendu complet
    const h = topFixed.getBoundingClientRect().height;
    planningContainer.style.marginTop = (h + 20) + "px";
    console.log("Décalage planning appliqué :", h + 20, "px");
  }
});


