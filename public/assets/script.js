/* ===========================================
   DONNÉES LOCALES
   =========================================== */
let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries   = JSON.parse(localStorage.getItem("salariesdata")   || "[]");
let heures     = JSON.parse(localStorage.getItem("heuresdata")     || "{}");

/* ===========================================
   SALARIÉS / ENTREPRISE
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

  // 🔄 actualise l'affichage
  afficherSalaries();

  // 🔁 signale la maj du planning (pour actualiser les jours actifs)
  localStorage.setItem("majPlanning", Date.now().toString());
}


/* ===========================================
   AJOUT / SUPPRESSION DE SALARIÉ
   =========================================== */
function ajouterSalarie() {
  const prenom = document.getElementById("prenomEl")?.value.trim();
  const nom = document.getElementById("nomEl")?.value.trim();
  const dateEntree = document.getElementById("dateEntreeEl")?.value;

  if (!prenom || !nom || !dateEntree) {
    alert("Veuillez remplir tous les champs avant d’ajouter un salarié.");
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

  // 🔄 Met à jour automatiquement le planning si ouvert
  window.actualiserFiltreSalaries?.();
  localStorage.setItem("majPlanning", Date.now().toString());

  alert("Salarié ajouté et intégré au planning !");
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
   CHARGEMENT INITIAL
   =========================================== */
window.addEventListener("DOMContentLoaded", () => {
  const nomE = document.getElementById("entreprise-nom");
  if (nomE && entreprise.nom) nomE.textContent = entreprise.nom;
  afficherSalaries();
});

/* ===========================================
   SYNCHRONISATION ENTRE PAGES
   =========================================== */
window.addEventListener("storage", (e) => {
  if (e.key === "majPlanning") {
    // Actualisation automatique si le planning est ouvert dans un autre onglet
    if (typeof genererPlanning === "function") genererPlanning();
  }
});
