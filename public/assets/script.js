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

function sauverEntreprise() {
  const nom = document.getElementById("nom-entreprise")?.value.trim();
  if (!nom) {
    alert("Veuillez saisir un nom d'entreprise.");
    return;
  }
  entreprise.nom = nom;
  localStorage.setItem("entreprisedata", JSON.stringify(entreprise));
  const nomE = document.getElementById("entreprise-nom");
  if (nomE) nomE.textContent = nom;
  alert("Informations enregistrées.");
}

/* ===========================================
   SALARIÉS
   =========================================== */
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
        <td>
          <input type="date" value="${s.dateSortie || ""}"
                 onchange="majDateSortie(${s.id}, this.value)"
                 style="width:130px;">
        </td>
        <td>${h.lun ?? 0}</td>
        <td>${h.mar ?? 0}</td>
        <td>${h.mer ?? 0}</td>
        <td>${h.jeu ?? 0}</td>
        <td>${h.ven ?? 0}</td>
        <td>${h.sam ?? 0}</td>
        <td>
          <button class="btn btn-danger" onclick="supprimerSalarie(${i})">✖</button>
        </td>
      </tr>`;
  });
}

function majDateSortie(id, nouvelleDate) {
  const sal = salaries.find(s => s.id === id);
  if (!sal) return;
  sal.dateSortie = nouvelleDate || "";
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
  localStorage.setItem("majPlanning", Date.now().toString());
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
