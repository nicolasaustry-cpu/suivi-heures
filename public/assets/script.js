/* ------------------- Données locales ------------------- */
// données sauvegardées dans le navigateur
let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries = JSON.parse(localStorage.getItem("salariesdata") || "[]");
let heures = JSON.parse(localStorage.getItem("heuresdata") || "{}");

/* ---------- Entreprise ---------- */
function initEntreprise() {
  const nomInput = document.getElementById("nom-entreprise");
  if (entreprise.nom && nomInput) {
    nomInput.value = entreprise.nom;
    const headerNom = document.getElementById("entreprise-nom");
    if (headerNom) headerNom.textContent = entreprise.nom;
  }
}

function sauverEntreprise() {
  const nom = document.getElementById("nom-entreprise").value.trim();
  if (!nom) return alert("Veuillez saisir un nom d’entreprise.");
  entreprise.nom = nom;
  localStorage.setItem("entreprisedata", JSON.stringify(entreprise));
  alert("Informations enregistrées.");
  const headerNom = document.getElementById("entreprise-nom");
  if (headerNom) headerNom.textContent = entreprise.nom;
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

  salaries.push(salarie);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));

  document.getElementById("prenomEl").value = "";
  document.getElementById("nomEl").value = "";
  document.getElementById("dateEntreeEl").value = "";

  afficherSalaries();
  alert("Salarié ajouté !");
}

function afficherSalaries() {
  const tb = document.querySelector("#table-salaries tbody");
  if (!tb) return;
  tb.innerHTML = "";
  salaries.forEach((s, i) => {
    const h = s.heuresParJour || {};
    tb.innerHTML += `
      <tr>
        <td>${s.prenom}</td>
        <td>${s.nom}</td>
        <td>${s.dateEntree || ""}</td>
        <td>${s.dateSortie || ""}</td>
        <td>${h.lun ?? 0}</td>
        <td>${h.mar ?? 0}</td>
        <td>${h.mer ?? 0}</td>
        <td>${h.jeu ?? 0}</td>
        <td>${h.ven ?? 0}</td>
        <td>${h.sam ?? 0}</td>
        <td><button class="btn btn-danger" onclick="supprimerSalarie(${i})">✖</button></td>
      </tr>`;
  });
}

function supprimerSalarie(index) {
  if (!confirm("Supprimer ce salarié ?")) return;
  salaries.splice(index, 1);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
}

/* ---------- Heures / planification ---------- */
function saveHeure(key, chantier, h) {
  heures[key] = { chantier, heures: parseFloat(h) || 0 };
  localStorage.setItem("heuresdata", JSON.stringify(heures));
}

/* ---------- Header Volitis + chargement ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const headerNom = document.getElementById("entreprise-nom");
  if (headerNom && entreprise.nom) headerNom.textContent = entreprise.nom;

  const header = document.querySelector("header");
  if (header) {
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
    logoContainer.appendChild(img);
    const text = document.createElement("span");
    text.textContent = "Outil créé par Volitis";
    text.style.fontSize = "0.8rem";
    text.style.color = "white";
    text.style.whiteSpace = "nowrap";
    wrapper.append(logoContainer, text);
    wrapper.addEventListener("click", () => window.open("[volitis.net](https://volitis.net/)", "_blank"));
    header.appendChild(wrapper);
  }

  // affiche les salariés existants
  afficherSalaries();
});

