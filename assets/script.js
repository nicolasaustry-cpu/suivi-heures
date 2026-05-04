/* --- Données partagées --- */
let salaries=JSON.parse(localStorage.getItem('salaries_data')||'[]');
let heures=JSON.parse(localStorage.getItem('heures_data')||'{}');
let licence=JSON.parse(localStorage.getItem('licence_data')||'null');
let entreprise=JSON.parse(localStorage.getItem('entreprise_data')||'{}');

/* --- Licence --- */
function activerLicence(){
  const code=document.getElementById('code-client').value.trim();
  if(!code)return alert('Saisir un code client');
  const now=new Date();const exp=new Date(now);exp.setMonth(now.getMonth()+6);
  licence={code,activation:now.toISOString(),expiration:exp.toISOString()};
  localStorage.setItem('licence_data',JSON.stringify(licence));
  alert('Licence activée jusqu’au '+exp.toLocaleDateString('fr-FR'));
  location.reload();
}
function licenceOK(){
  const msg=document.getElementById('licence-status');
  if(!licence){msg.textContent='Licence non activée';document.body.classList.add('readonly');return false;}
  const exp=new Date(licence.expiration),now=new Date();
  if(now>exp){msg.textContent='Licence expirée';document.body.classList.add('readonly');return false;}
  msg.textContent='Active jusqu’au '+exp.toLocaleDateString('fr-FR');
  document.body.classList.remove('readonly');
  return true;
}

/* --- Entreprise --- */
function initEntreprise(){
  // Affiche le nom de l’entreprise s’il existe déjà dans le stockage
  if (entreprise.nom) {
    document.getElementById('nom-entreprise').value = entreprise.nom;
    document.getElementById('entreprise-nom').textContent = entreprise.nom;
  }

  // Supprimer tout ancien logo éventuellement enregistré
  if (entreprise.logo) {
    delete entreprise.logo;
    localStorage.setItem('entreprise_data', JSON.stringify(entreprise));
  }
}


/* --- Salariés --- */
function ajouterSalarie() {
  const prenom = document.getElementById('prenomEl').value.trim();
  const nom = document.getElementById('nomEl').value.trim();
  const date = document.getElementById('dateEntreeEl').value;
  if (!prenom || !nom || !date) return alert('Tous les champs sont requis.');

  const heuresParJour = {
    lundi: parseFloat(document.getElementById('hLun').value) || 0,
    mardi: parseFloat(document.getElementById('hMar').value) || 0,
    mercredi: parseFloat(document.getElementById('hMer').value) || 0,
    jeudi: parseFloat(document.getElementById('hJeu').value) || 0,
    vendredi: parseFloat(document.getElementById('hVen').value) || 0,
    samedi: parseFloat(document.getElementById('hSam').value) || 0
  };

  salaries.push({
    id: Date.now(),
    prenom,
    nom,
    dateEntree: date,
    heuresParJour
  });

  localStorage.setItem('salaries_data', JSON.stringify(salaries));
  afficherSalaries();

  // réinitialisation du formulaire
  ['prenomEl','nomEl','dateEntreeEl','hLun','hMar','hMer','hJeu','hVen','hSam']
    .forEach(id => {
      const el = document.getElementById(id);
      if (['hLun','hMar','hMer','hJeu','hVen'].includes(id)) el.value = 8;
      else if (id === 'hSam') el.value = 0;
      else el.value = '';
    });
}
function afficherSalaries() {
  const tb = document.querySelector('#table-salaries tbody');
  tb.innerHTML = '';

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
      </tr>
    `;
  });
}
function majSalarie(index, champ, valeur) {
  salaries[index][champ] = valeur;
  localStorage.setItem('salaries_data', JSON.stringify(salaries));
}
function supprimerSalarie(id) {
  if (!confirm("Supprimer ce salarié ?")) return;
  // Supprime le salarié du tableau principal
  salaries = salaries.filter(s => s.id != id);
  // Sauvegarde dans le stockage local
  localStorage.setItem('salaries_data', JSON.stringify(salaries));
  // Recharge l’affichage
  afficherSalaries();
}
function majHeuresJour(index, jour, valeur) {
  if (!salaries[index].heuresParJour) salaries[index].heuresParJour = {};
  salaries[index].heuresParJour[jour] = parseFloat(valeur) || 0;
  localStorage.setItem('salaries_data', JSON.stringify(salaries));
}

/* --- Heures --- */
function saveHeure(key,chantier,h){heures[key]={chantier,heures:parseFloat(h)||0};localStorage.setItem('heures_data',JSON.stringify(heures));}

/* --- Jauge --- */
function majCouleurs(){
 const r=parseInt(document.getElementById('limiteRouge').value)||33;
 const o=parseInt(document.getElementById('limiteOrange').value)||66;
 document.getElementById('gauge-red').style.width=r+'%';
 document.getElementById('gauge-orange').style.width=(o-r)+'%';
 document.getElementById('gauge-green').style.width=(100-o)+'%';
}
function majJauge(reel,prev){
 const val=prev>0?Math.min(100,(reel/prev)*100):0;
 const bar=document.querySelector('.gauge-bar');
 const cur=document.getElementById('gauge-cursor');
 const txt=document.getElementById('gauge-value');
 const pos=(val/100)*bar.offsetWidth;
 cursor.style.left = `calc(${pos}px - 10px)`;txt.textContent=val.toFixed(0)+'%';
}
// === Logo + mention Volitis (corrigé : lien absolu sûr) ===
window.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('header');
  if (!header) return;

  // Supprime une éventuelle version précédente
  document.getElementById('volitis-link')?.remove();

  const wrapper = document.createElement('div');
  wrapper.id = 'volitis-link';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '0.5rem';
  wrapper.style.marginLeft = '1rem';
  wrapper.style.cursor = 'pointer';
  wrapper.style.userSelect = 'none';
  wrapper.style.zIndex = '1000';

  // Cercle blanc pour le logo
  const logoContainer = document.createElement('div');
  logoContainer.style.background = 'white';
  logoContainer.style.borderRadius = '50%';
  logoContainer.style.width = '42px';
  logoContainer.style.height = '42px';
  logoContainer.style.display = 'flex';
  logoContainer.style.alignItems = 'center';
  logoContainer.style.justifyContent = 'center';

  const img = document.createElement('img');
  img.src = 'assets/volitis-logo.png';
  img.alt = 'Logo Volitis';
  img.style.height = '30px';
  img.style.width = 'auto';
  logoContainer.appendChild(img);

  const text = document.createElement('span');
  text.textContent = 'Outil créé par Volitis';
  text.style.fontSize = '0.8rem';
  text.style.fontWeight = 'normal';
  text.style.color = 'white';
  text.style.whiteSpace = 'nowrap';

  wrapper.append(logoContainer, text);

  // ✅ Redirection fiable (pas de crochets, pas de Markdown)
wrapper.addEventListener('click', () => {
  window.open('https://volitis.net/', '_blank', 'noopener');
});

  const status = document.getElementById('licence-status');
  (status || header).insertAdjacentElement('afterend', wrapper);
});
