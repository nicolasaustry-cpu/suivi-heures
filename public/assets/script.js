/* =========================================================
   Données locales partagées
   ========================================================= */

let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries   = JSON.parse(localStorage.getItem("salariesdata")   || "[]");
let heures     = JSON.parse(localStorage.getItem("heuresdata")     || "{}");

/* =========================================================
   ENTREPRISE
   ========================================================= */
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

/* =========================================================
   SALARIÉS
   ========================================================= */
function ajouterSalarie() {
  const prenom = document.getElementById("prenomEl").value.trim();
  const nom = document.getElementById("nomEl").value.trim();
  const dateEntree = document.getElementById("dateEntreeEl").value.trim();
  if (!prenom || !nom) return alert("Veuillez saisir un prénom et un nom.");

  const heuresParJour = {
    lundi: parseFloat(document.getElementById("hLun").value) || 0,
    mardi: parseFloat(document.getElementById("hMar").value) || 0,
    mercredi: parseFloat(document.getElementById("hMer").value) || 0,
    jeudi: parseFloat(document.getElementById("hJeu").value) || 0,
    vendredi: parseFloat(document.getElementById("hVen").value) || 0,
    samedi: parseFloat(document.getElementById("hSam").value) || 0,
    dimanche: 0
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
        <td>${h.lundi ?? 0}</td>
        <td>${h.mardi ?? 0}</td>
        <td>${h.mercredi ?? 0}</td>
        <td>${h.jeudi ?? 0}</td>
        <td>${h.vendredi ?? 0}</td>
        <td>${h.samedi ?? 0}</td>
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

/* =========================================================
   PLANNING
   ========================================================= */
function semainesDuMois(a, m) {
  const sem = [], debut = new Date(a, m, 1), fin = new Date(a, m + 1, 0);
  let l = new Date(debut);
  while (l.getDay() !== 1) l.setDate(l.getDate() - 1);
  while (l <= fin) {
    const s = new Date(l);
    s.setDate(l.getDate() + 5);
    if (s >= debut && l <= fin) sem.push({ lundi: new Date(l), samedi: s });
    l.setDate(l.getDate() + 7);
  }
  return sem;
}

function genererPlanning() {
  const v = document.getElementById("moisPlanning").value;
  if (!v) return;
  const [a, m] = v.split("-");
  const container = document.getElementById("planning-wrapper");
  container.innerHTML = "";

  const premierJour = new Date(+a, +m - 1, 1);
  const dernierJour = new Date(+a, +m, 0);
  const nomsJours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

  for (let d = new Date(premierJour); d <= dernierJour; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) genererBlocJour(new Date(d), container, nomsJours);
  }

  calculerTotaux();
}

function genererBlocJour(date, container, nomsJours) {
  const dateStr = date.toISOString().split("T")[0];
  const couleurFond = date.getDate() % 2 === 0 ? "#fff" : "#f8fafc";
  const nomJour = nomsJours[date.getDay()];
  const jourNom = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][date.getDay()];

  let html = `<h3 style="background:${couleurFond};padding:0.3rem;margin:0.5rem 0;">
      ${nomJour} ${date.toLocaleDateString("fr-FR")}
    </h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:0.5rem;">
      <thead>
        <tr style="background:#e8edf3;">
          <th style="border:1px solid #ccc;padding:4px;width:150px;">Salarié</th>
          <th style="border:1px solid #ccc;padding:4px;">Ch1</th>
          <th style="border:1px solid #ccc;padding:4px;">Ch2</th>
          <th style="border:1px solid #ccc;padding:4px;">Ch3</th>
          <th style="border:1px solid #ccc;padding:4px;">Ch4</th>
          <th style="border:1px solid #ccc;padding:4px;">Ch5</th>
          <th style="border:1px solid #ccc;padding:4px;width:80px;">Total</th>
          <th style="border:1px solid #ccc;padding:4px;width:80px;">Absences</th>
          <th style="border:1px solid #ccc;padding:4px;width:80px;">Prévu</th>
          <th style="border:1px solid #ccc;padding:4px;width:80px;">Écart</th>
        </tr>
      </thead>
      <tbody>`;

  salaries.forEach(salarie => {
    const entree = new Date(salarie.dateEntree);
    const sortie = salarie.dateSortie ? new Date(salarie.dateSortie) : null;
    if (date < entree || (sortie && date > sortie)) return;

    html += `<tr>
      <td style="font-weight:bold;border:1px solid #ccc;padding:3px;">${salarie.prenom} ${salarie.nom}</td>`;

    let totalJour = 0;
    for (let ch = 1; ch <= 5; ch++) {
      const key = `${salarie.id}${dateStr}ch${ch}`;
      const donnees = heures[key] || { chantier:"", heures:0 };
      totalJour += parseFloat(donnees.heures) || 0;

      html += `<td style="border:1px solid #ccc;padding:2px;">
        <input id="${key}ch" placeholder="Chantier" value="${donnees.chantier}"
               style="width:100px;margin-bottom:2px;"
               onchange="saveHeure('${key}', this.value, document.getElementById('${key}h').value)">
        <select id="${key}h" style="width:60px;"
                onchange="saveHeure('${key}', document.getElementById('${key}ch').value, this.value)">
          ${genOptionsHeures(donnees.heures)}
        </select>
      </td>`;
    }

    const keyAbs = `${salarie.id}${dateStr}abs`;
    const absVal = heures[keyAbs]?.heures || 0;

    const heuresPrevues = salarie.heuresParJour?.[jourNom] || 0;
    const prevuAjuste = totalJour > 0 ? Math.max(heuresPrevues - absVal, 0) : 0;
    const ecartVal = totalJour - prevuAjuste;

    html += `
      <td id="total${salarie.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${totalJour.toFixed(1)}</td>
      <td style="border:1px solid #ccc;text-align:center;">
        <select id="${keyAbs}h" style="width:60px;"
                onchange="saveHeure('${keyAbs}','absence',this.value)">
          ${genOptionsHeures(absVal)}
        </select>
      </td>
      <td id="prevu${salarie.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${prevuAjuste.toFixed(1)}</td>
      <td id="ecart${salarie.id}_${dateStr}" style="border:1px solid #ccc;text-align:center;color:${ecartVal < 0 ? "red" : "green"}">
        ${(ecartVal >= 0 ? "+" : "") + ecartVal.toFixed(1)}
      </td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML += html;
}

/* =========================================================
   OUTILS PLANNING : calculs totaux, jauge, options heures
   ========================================================= */

function genOptionsHeures(valeur) {
  let opt = "";
  for (let i = 0; i <= 10; i += 0.25) {
    const lbl = i.toFixed(2).replace(".00", "");
    const sel = Math.abs(i - parseFloat(valeur || 0)) < 0.001 ? "selected" : "";
    opt += `<option value="${i}" ${sel}>${lbl}</option>`;
  }
  return opt;
}

function saveHeure(key, chantier, h) {
  heures[key] = { chantier, heures: parseFloat(h) || 0 };
  localStorage.setItem("heuresdata", JSON.stringify(heures));
  majCelluleDuSalarié(key);
  calculerTotaux();
}

function majCelluleDuSalarié(key) {
  const parts = key.match(/^(\d+)(\d{4}-\d{2}-\d{2})/);
  if (!parts) return;
  const idSal = parts[1];
  const dateStr = parts[2];
  const jour = new Date(dateStr);
  const jourNom = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][jour.getDay()];
  const salarie = salaries.find(s => String(s.id) === String(idSal));
  if (!salarie) return;

  let totalJour = 0;
  for (let i = 1; i <= 5; i++) {
    const k = `${idSal}${dateStr}ch${i}`;
    totalJour += parseFloat(heures[k]?.heures || 0);
  }
  document.getElementById(`total${idSal}${dateStr}`)?.textContent = totalJour.toFixed(1);

  const keyAbs = `${idSal}${dateStr}abs`;
  const abs = parseFloat(heures[keyAbs]?.heures || 0);
  const prevuFiche = salarie.heuresParJour?.[jourNom] || 0;
  const prevuAjuste = totalJour > 0 ? Math.max(prevuFiche - abs, 0) : 0;
  document.getElementById(`prevu${idSal}${dateStr}`)?.textContent = prevuAjuste.toFixed(1);

  const ecart = totalJour - prevuAjuste;
  const cel = document.getElementById(`ecart${idSal}_${dateStr}`);
  if (cel) {
    cel.textContent = (ecart >= 0 ? "+" : "") + ecart.toFixed(1);
    cel.style.color = ecart < 0 ? "red" : "green";
  }
}

function calculerTotaux() {
  let totalHeures = 0, totalAbs = 0, totalPrev = 0;

  document.querySelectorAll('[id^="total"]').forEach(td => totalHeures += parseFloat(td.textContent) || 0);
  document.querySelectorAll('select[id$="absh"]').forEach(sel => totalAbs += parseFloat(sel.value) || 0);
  document.querySelectorAll('[id^="prevu"]').forEach(td => totalPrev += parseFloat(td.textContent) || 0);

  const totalEcart = totalHeures - totalPrev;

  const toTxt = v => v.toFixed(1);
  document.getElementById("tot-total")?.textContent = toTxt(totalHeures);
  document.getElementById("tot-abs")?.textContent = toTxt(totalAbs);
  document.getElementById("tot-prev")?.textContent = toTxt(totalPrev);
  document.getElementById("tot-ecart")?.textContent = toTxt(totalEcart);
  const col = document.getElementById("tot-ecart");
  if (col) col.style.color = totalEcart < 0 ? "red" : "green";

  // jauge
  const percent = totalPrev > 0 ? (totalHeures / totalPrev) * 100 : 0;
  const curseur = document.getElementById("curseur");
  const texte = document.getElementById("pourcentage");
  if (curseur && texte) {
    const largeur = curseur.parentElement.offsetWidth;
    curseur.style.left = (largeur * percent / 100 - 4) + "px";
    texte.textContent = Math.round(percent) + "%";
  }
}

/* =========================================================
   Lancement au chargement
   ========================================================= */
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

