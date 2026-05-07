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
    wrapper.addEventListener("click", () => window.open("https://volitis.net/", "_blank"));
    header.appendChild(wrapper);
  }

  // affiche les salariés existants
  afficherSalaries();
});
/* ---------- Planning ---------- */
function semainesDuMois(a, m) {
  const sem = [], p1 = new Date(a, m, 1), pf = new Date(a, m + 1, 0);
  let l = new Date(p1);
  while (l.getDay() !== 1) l.setDate(l.getDate() - 1);
  while (l <= pf) {
    const s = new Date(l);
    s.setDate(l.getDate() + 5);
    if (s >= p1 && l <= pf) sem.push({ lundi: new Date(l), samedi: s });
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
  const nomsJours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  
  for (let d = new Date(premierJour); d <= dernierJour; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) { // Skip dimanche
      genererBlocJour(new Date(d), container, nomsJours);
    }
  }
}

function genererBlocJour(date, container, nomsJours) {
  const dateStr = date.toISOString().split('T')[0];
  const couleurFond = date.getDate() % 2 === 0 ? '#fff' : '#f8fafc';
  const nomJour = nomsJours[date.getDay()];
  
  let html = `<h3 style="background:${couleurFond};padding:0.3rem;margin:0.5rem 0;">
    ${nomJour} ${date.toLocaleDateString('fr-FR')}
  </h3>`;
  
  html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:0.5rem;">
    <thead>
      <tr style="background:#e8edf3;">
        <th style="border:1px solid #ccc;padding:4px;width:150px;">Salarié</th>
        <th style="border:1px solid #ccc;padding:4px;">Chantier 1</th>
        <th style="border:1px solid #ccc;padding:4px;">Chantier 2</th>
        <th style="border:1px solid #ccc;padding:4px;">Chantier 3</th>
        <th style="border:1px solid #ccc;padding:4px;">Chantier 4</th>
        <th style="border:1px solid #ccc;padding:4px;">Chantier 5</th>
        <th style="border:1px solid #ccc;padding:4px;width:80px;">Total</th>
      </tr>
    </thead>
    <tbody>`;

  // Pour chaque salarié
  salaries.forEach(salarie => {
    const entree = new Date(salarie.dateEntree);
    const sortie = salarie.dateSortie ? new Date(salarie.dateSortie) : null;
    
    // Vérifie si le salarié travaillait ce jour-là
    if (date < entree || (sortie && date > sortie)) return;

    html += `<tr>
      <td style="border:1px solid #ccc;padding:3px;font-weight:bold;">${salarie.prenom} ${salarie.nom}</td>`;
    
    let totalJour = 0;
    for (let ch = 1; ch <= 5; ch++) {
      const key = `${salarie.id}_${dateStr}_ch${ch}`;
      const donnees = heures[key] || { chantier: '', heures: 0 };
      totalJour += parseFloat(donnees.heures) || 0;
      
      html += `<td style="border:1px solid #ccc;padding:2px;">
        <input id="${key}_ch" placeholder="Chantier" value="${donnees.chantier}" 
               style="width:100px;margin-bottom:2px;"
               onchange="saveHeure('${key}', this.value, document.getElementById('${key}_h').value)">
        <select id="${key}_h" style="width:60px;" 
                onchange="saveHeure('${key}', document.getElementById('${key}_ch').value, this.value)">
          ${genOptionsHeures(donnees.heures)}
        </select>
      </td>`;
    }
    
    html += `<td style="border:1px solid #ccc;padding:3px;text-align:center;">
      ${totalJour.toFixed(1)}h
    </td></tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML += html;
}

function genOptionsHeures(valeur) {
  let options = '';
  for (let i = 0; i <= 10; i += 0.25) {
    const label = i.toFixed(2).replace('.00', '');
    const selected = Math.abs(i - parseFloat(valeur || 0)) < 0.001 ? 'selected' : '';
    options += `<option value="${i}" ${selected}>${label}</option>`;
  }
  return options;
}

window.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const mp = document.getElementById("moisPlanning");
  if (mp) {
    mp.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    mp.addEventListener("change", genererPlanning);
    genererPlanning();
  }
});
