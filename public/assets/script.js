/* ===========================================
   DONNÉES LOCALES
   =========================================== */
let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries   = JSON.parse(localStorage.getItem("salariesdata")   || "[]");
let heures     = JSON.parse(localStorage.getItem("heuresdata")     || "{}");

/* ===========================================
   ENTREPRISE
   =========================================== */
function initEntreprise() {
  const input = document.getElementById("nom-entreprise");
  if (entreprise.nom && input) {
    input.value = entreprise.nom;
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

/* ===========================================
   SALARIÉS
   =========================================== */
function ajouterSalarie() {
  const prenom = document.getElementById("prenomEl").value.trim();
  const nom = document.getElementById("nomEl").value.trim();
  const dateEntree = document.getElementById("dateEntreeEl").value.trim();
  if (!prenom || !nom) return alert("Veuillez saisir un prénom et un nom.");

  const heuresParJour = {
    lun: parseFloat(document.getElementById("hLun").value) || 0,
    mar: parseFloat(document.getElementById("hMar").value) || 0,
    mer: parseFloat(document.getElementById("hMer").value) || 0,
    jeu: parseFloat(document.getElementById("hJeu").value) || 0,
    ven: parseFloat(document.getElementById("hVen").value) || 0,
    sam: parseFloat(document.getElementById("hSam").value) || 0
  };

  const id = Date.now();
  const salarie = { id, prenom, nom, dateEntree, heuresParJour };
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

function supprimerSalarie(i) {
  if (!confirm("Supprimer ce salarié ?")) return;
  salaries.splice(i, 1);
  localStorage.setItem("salariesdata", JSON.stringify(salaries));
  afficherSalaries();
}

/* ===========================================
   PLANNING
   =========================================== */
function genererPlanning() {
  const v = document.getElementById("moisPlanning").value;
  if (!v) return;
  const [a, m] = v.split("-");
  const container = document.getElementById("planning-wrapper");
  container.innerHTML = "";

  const premierJour = new Date(+a, +m - 1, 1);
  const dernierJour = new Date(+a, +m, 0);
  const nomsJours = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

  for (let d = new Date(premierJour); d <= dernierJour; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) genererBlocJour(new Date(d), container, nomsJours);
  }

  calculerTotaux();
}

function genererBlocJour(date, container, nomsJours) {
  const dateStr = date.toISOString().split("T")[0];
  const couleur = date.getDate() % 2 === 0 ? "#fff" : "#f8fafc";
  const nomJour = nomsJours[date.getDay()];

  let html = `
    <h3 style="background:${couleur};padding:0.3rem;margin:0.5rem 0;">
      ${nomJour} ${date.toLocaleDateString("fr-FR")}
    </h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:0.5rem;">
      <thead>
        <tr style="background:#e8edf3;">
          <th class="col-salarie" style="border:1px solid #ccc;padding:4px;">Salarié</th>
          <th class="col-ch">Ch1</th>
          <th class="col-ch">Ch2</th>
          <th class="col-ch">Ch3</th>
          <th class="col-ch">Ch4</th>
          <th class="col-ch">Ch5</th>
          <th class="col-total">Total</th>
          <th class="col-abs">Abs.</th>
          <th class="col-prevu">Prévu</th>
          <th class="col-ecart">Écart</th>
        </tr>
      </thead><tbody>`;

  salaries.forEach(s => {
    const entree = new Date(s.dateEntree);
    const sortie = s.dateSortie ? new Date(s.dateSortie) : null;
    if (date < entree || (sortie && date > sortie)) return;

    let tot = 0;
    html += `<tr>
      <td style="font-weight:bold;border:1px solid #ccc;">${s.prenom} ${s.nom}</td>`;

    for (let i = 1; i <= 5; i++) {
      const k = `${s.id}${dateStr}ch${i}`;
      const data = heures[k] || { chantier: "", heures: 0 };
      tot += parseFloat(data.heures) || 0;

      html += `
        <td style="border:1px solid #ccc;padding:2px;">
          <input id="${k}chant" value="${data.chantier}" placeholder="Chantier"
                 style="width:100px;margin-bottom:2px;"
                 onchange="saveHeure('${k}', this.value, document.getElementById('${k}h').value)">
          <select id="${k}h" style="width:60px;"
                  onchange="saveHeure('${k}', document.getElementById('${k}chant').value, this.value)">
            ${genOptionsHeures(data.heures)}
          </select>
        </td>`;
    }

    const keyAbs = `${s.id}${dateStr}abs`;
    const abs = heures[keyAbs]?.heures || 0;

    const jourNom = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][date.getDay()];
    const heuresPrevues = s.heuresParJour?.[jourNom.slice(0, 3)] || 0;
    const prevuAdj = tot > 0 ? Math.max(heuresPrevues - abs, 0) : 0;
    const ecart = tot - prevuAdj;

    html += `
      <td id="total${s.id}${dateStr}" class="col-total" style="border:1px solid #ccc;text-align:center;">${tot.toFixed(1)}</td>
      <td class="col-abs" style="border:1px solid #ccc;text-align:center;">
        <select id="${keyAbs}h" style="width:60px;"
                onchange="saveHeure('${keyAbs}','absence',this.value)">
          ${genOptionsHeures(abs)}
        </select>
      </td>
      <td id="prevu${s.id}${dateStr}" class="col-prevu" style="border:1px solid #ccc;text-align:center;">${prevuAdj.toFixed(1)}</td>
      <td id="ecart${s.id}${dateStr}" class="col-ecart" style="border:1px solid #ccc;text-align:center;color:${ecart < 0 ? "red" : "green"}">
        ${(ecart >= 0 ? "+" : "") + ecart.toFixed(1)}
      </td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML += html;
}

/* ===========================================
   OUTILS
   =========================================== */
function genOptionsHeures(v) {
  let opt = "";
  for (let i = 0; i <= 10; i += 0.25) {
    const lbl = i.toFixed(2).replace(".00", "");
    const sel = Math.abs(i - parseFloat(v || 0)) < 0.001 ? "selected" : "";
    opt += `<option value="${i}" ${sel}>${lbl}</option>`;
  }
  return opt;
}

function saveHeure(key, chantier, h) {
  // sauvegarde locale
  heures[key] = { chantier, heures: parseFloat(h) || 0 };
  localStorage.setItem("heuresdata", JSON.stringify(heures));

  // recalcul immédiat de la ligne salarié + totaux/mois
  setTimeout(() => {
    majTotalLigne(key);
    calculerTotaux();
  }, 100);
}
function majTotalLigne(key) {
  // clé type : 1715000000000-2026-05-07ch1
  const m = key.match(/^(\d+)(\d{4}-\d{2}-\d{2})/);
  if (!m) return;
  const idSal = m[1];
  const dateStr = m[2];

  // somme des 5 chantiers du jour
  let totalJour = 0;
  for (let i = 1; i <= 5; i++) {
    const k = `${idSal}${dateStr}ch${i}`;
    totalJour += parseFloat(heures[k]?.heures || 0);
  }

  const totalCell = document.getElementById(`total${idSal}${dateStr}`);
  if (totalCell) totalCell.textContent = totalJour.toFixed(1);

  // absences
  const absKey = `${idSal}${dateStr}abs`;
  const abs = parseFloat(heures[absKey]?.heures || 0);

  // heures prévues selon la fiche salarié
  const jour = new Date(dateStr);
  const jourNom = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][jour.getDay()];
  const salarie = salaries.find(s => String(s.id) === String(idSal));
  const prevuFiche = salarie?.heuresParJour?.[jourNom.slice(0,3)] || 0;

  // si aucun chantier => prévu=0 ; sinon heures contrats - absences
  const prevuAjuste = totalJour === 0 ? 0 : Math.max(prevuFiche - abs, 0);
  const prevuCell = document.getElementById(`prevu${idSal}${dateStr}`);
  if (prevuCell) prevuCell.textContent = prevuAjuste.toFixed(1);

  // écart
  const ecart = totalJour - prevuAjuste;
  const ecartCell = document.getElementById(`ecart${idSal}${dateStr}`);
  if (ecartCell) {
    ecartCell.textContent = (ecart >= 0 ? "+" : "") + ecart.toFixed(1);
    ecartCell.style.color = ecart < 0 ? "red" : "green";
  }
}

function calculerTotaux() {
  let totalHeures = 0, totalAbsences = 0, totalPrevus = 0;
  document.querySelectorAll('select[id$="h"]').forEach(sel => {
    const val = parseFloat(sel.value) || 0;
    if (sel.id.includes("abs")) totalAbsences += val;
    else totalHeures += val;
  });
  document.querySelectorAll('[id^="prevu"]').forEach(td =>
    totalPrevus += parseFloat(td.textContent) || 0);

  const totalEcart = totalHeures - totalPrevus;
  const fix = v => v.toFixed(1);

  document.getElementById("tot-total").textContent = fix(totalHeures);
  document.getElementById("tot-abs").textContent   = fix(totalAbsences);
  document.getElementById("tot-prev").textContent  = fix(totalPrevus);
  document.getElementById("tot-ecart").textContent = fix(totalEcart);
  document.getElementById("tot-ecart").style.color = totalEcart < 0 ? "red" : "green";

  // mise à jour de la jauge
  const pourc = totalPrevus > 0 ? (totalHeures / totalPrevus) * 100 : 0;
  const curseur = document.getElementById("curseur");
  const texte   = document.getElementById("pourcentage");
  if (curseur && texte) {
    const l = curseur.parentElement.offsetWidth;
    curseur.style.left = (l * pourc / 100 - 4) + "px";
    texte.textContent = Math.round(pourc) + "%";
  }
}

/* ===========================================
   AU CHARGEMENT
   =========================================== */
window.addEventListener("DOMContentLoaded", () => {
  const headerNom = document.getElementById("entreprise-nom");
  if (headerNom && entreprise.nom) headerNom.textContent = entreprise.nom;
  afficherSalaries();

  const now = new Date();
  const mp = document.getElementById("moisPlanning");
  if (mp) {
    mp.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    mp.addEventListener("change", genererPlanning);
    genererPlanning();
  }
});

