/===========================================
   DONNÉES LOCALES
  ===========================================/
let entreprise = JSON.parse(localStorage.getItem("entreprisedata") || "{}");
let salaries   = JSON.parse(localStorage.getItem("salariesdata")   || "[]");
let heures     = JSON.parse(localStorage.getItem("heuresdata")     || "{}");

/===========================================
   SALARIÉS / ENTREPRISE
  ===========================================/
function afficherSalaries(){
  const tb = document.querySelector("#table-salaries tbody");
  if(!tb) return;
  tb.innerHTML = "";
  salaries.forEach((s,i)=>{
    const h = s.heuresParJour || {};
    tb.innerHTML += `
      <tr>
        <td>${s.prenom}</td><td>${s.nom}</td>
        <td>${s.dateEntree||""}</td><td>${s.dateSortie||""}</td>
        <td>${h.lun??0}</td><td>${h.mar??0}</td><td>${h.mer??0}</td>
        <td>${h.jeu??0}</td><td>${h.ven??0}</td><td>${h.sam??0}</td>
        <td><button class="btn btn-danger" onclick="supprimerSalarie(${i})">✖</button></td>
      </tr>`;
  });
}

/===========================================
   PLANNING
  ===========================================/
function genererPlanning(){
  const v = document.getElementById("moisPlanning").value;
  if(!v) return;
  const [a,m] = v.split("-");
  const c = document.getElementById("planning-wrapper");
  c.innerHTML = "";

  const p = new Date(+a,+m-1,1);
  const dL = new Date(+a,+m,0);
  const jours = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

  for(let d = new Date(p); d <= dL; d.setDate(d.getDate()+1)){
    if(d.getDay() !== 0) genererBlocJour(new Date(d), c, jours);
  }
  calculerTotaux();
}

function genererBlocJour(date,c,jours){
  const dateStr = date.toISOString().split("T")[0];
  const coul = date.getDate()%2===0 ? "#fff" : "#f8fafc";
  const nom = jours[date.getDay()];

  let html = `
    <h3 style="background:${coul};padding:0.3rem;margin:0.5rem 0;">${nom} ${date.toLocaleDateString("fr-FR")}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:0.5rem;">
      <thead><tr style="background:#e8edf3;">
        <th style="border:1px solid #ccc;padding:4px;width:150px;">Salarié</th>
        <th>Ch1</th><th>Ch2</th><th>Ch3</th><th>Ch4</th><th>Ch5</th>
        <th>Total</th><th>Abs.</th><th>Prévu</th><th>Écart</th>
      </tr></thead><tbody>`;
  
  salaries.forEach(s=>{
    const e = new Date(s.dateEntree);
    const srt = s.dateSortie ? new Date(s.dateSortie) : null;
    if(date < e || (srt && date > srt)) return;
    let tot = 0;
    html += `<tr><td style="font-weight:bold;border:1px solid #ccc;">${s.prenom} ${s.nom}</td>`;
    for(let i=1;i<=5;i++){
      const k = `${s.id}${dateStr}ch${i}`;
      const dta = heures[k] || {chantier:"",heures:0};
      tot += parseFloat(dta.heures) || 0;
      html += `
        <td style="border:1px solid #ccc;padding:2px;">
          <input id="${k}chant" value="${dta.chantier}" placeholder="Chantier"
            style="width:100px;margin-bottom:2px;"
            onchange="saveHeure('${k}',this.value,document.getElementById('${k}h').value)">
          <select id="${k}h" style="width:60px;"
            onchange="saveHeure('${k}',document.getElementById('${k}chant').value,this.value)">
            ${genOptionsHeures(dta.heures)}
          </select>
        </td>`;
    }

    const absK = `${s.id}${dateStr}abs`;
    const abs = heures[absK]?.heures || 0;
    const jN = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][date.getDay()];
    const hPrev = s.heuresParJour?.[jN.slice(0,3)] || 0;
    const prevu = tot>0 ? Math.max(hPrev-abs,0) : 0;
    const ec = tot - prevu;

    html += `
      <td id="total${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${tot.toFixed(1)}</td>
      <td style="border:1px solid #ccc;text-align:center;">
        <select id="${absK}h" style="width:60px;"
          onchange="saveHeure('${absK}','absence',this.value)">
          ${genOptionsHeures(abs)}
        </select>
      </td>
      <td id="prevu${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${prevu.toFixed(1)}</td>
      <td id="ecart${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;color:${ec<0?"red":"green"}">
        ${(ec>=0?"+":"")+ec.toFixed(1)}
      </td></tr>`;
  });
  html += "</tbody></table>";
  c.innerHTML += html;
}

function genererPlanningFiltres(salariesFiltres){
  const v = document.getElementById("moisPlanning").value;
  if(!v) return;
  const [a,m] = v.split("-");
  const c = document.getElementById("planning-wrapper");
  c.innerHTML = "";
  const p = new Date(+a,+m-1,1);
  const dL = new Date(+a,+m,0);
  const jours = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  for(let d=new Date(p); d<=dL; d.setDate(d.getDate()+1)){
    if(d.getDay()!==0) genererBlocJourFiltre(new Date(d),c,jours,salariesFiltres);
  }
  calculerTotaux();
}

function genererBlocJourFiltre(date, c, jours, salariesFiltres){
  const dateStr = date.toISOString().split("T")[0];
  const coul = date.getDate()%2===0?"#fff":"#f8fafc";
  const nom = jours[date.getDay()];
  let html = `
    <h3 style="background:${coul};padding:0.3rem;margin:0.5rem 0;">${nom} ${date.toLocaleDateString("fr-FR")}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:0.5rem;">
      <thead><tr style="background:#e8edf3;">
        <th style="border:1px solid #ccc;padding:4px;width:150px;">Salarié</th>
        <th>Ch1</th><th>Ch2</th><th>Ch3</th><th>Ch4</th><th>Ch5</th>
        <th>Total</th><th>Abs.</th><th>Prévu</th><th>Écart</th>
      </tr></thead><tbody>`;
  
  salariesFiltres.forEach(s=>{
    const e=new Date(s.dateEntree);
    const srt=s.dateSortie?new Date(s.dateSortie):null;
    if(date<e||(srt&&date>srt))return;
    let tot=0;
    html+=`<tr><td style="font-weight:bold;border:1px solid #ccc;">${s.prenom} ${s.nom}</td>`;
    for(let i=1;i<=5;i++){
      const k=`${s.id}${dateStr}ch${i}`;
      const dta=heures[k]||{chantier:"",heures:0};
      tot+=parseFloat(dta.heures)||0;
      html+=`
        <td style="border:1px solid #ccc;padding:2px;">
          <input id="${k}chant" value="${dta.chantier}" placeholder="Chantier"
                 style="width:100px;margin-bottom:2px;"
                 onchange="saveHeure('${k}',this.value,document.getElementById('${k}h').value)">
          <select id="${k}h" style="width:60px;"
                  onchange="saveHeure('${k}',document.getElementById('${k}chant').value,this.value)">
            ${genOptionsHeures(dta.heures)}
          </select>
        </td>`;
    }
    const absK=`${s.id}${dateStr}abs`;
    const abs=heures[absK]?.heures||0;
    const jN=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][date.getDay()];
    const hPrev=s.heuresParJour?.[jN.slice(0,3)]||0;
    const prevu=tot>0?Math.max(hPrev-abs,0):0;
    const ec=tot-prevu;
    html+=`
      <td id="total${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${tot.toFixed(1)}</td>
      <td style="border:1px solid #ccc;text-align:center;">
        <select id="${absK}h" style="width:60px;"
                onchange="saveHeure('${absK}','absence',this.value)">
          ${genOptionsHeures(abs)}
        </select>
      </td>
      <td id="prevu${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;">${prevu.toFixed(1)}</td>
      <td id="ecart${s.id}${dateStr}" style="border:1px solid #ccc;text-align:center;color:${ec<0?"red":"green"}">
        ${(ec>=0?"+":"")+ec.toFixed(1)}
      </td></tr>`;
  });
  html += "</tbody></table>";
  c.innerHTML += html;
}

/===========================================
   CALCULS ET AJOUT HEURES
  ===========================================/
function genOptionsHeures(v){
  let o="";
  for(let i=0;i<=10;i+=0.25){
    const lbl=i.toFixed(2).replace(".00","");
    const s=Math.abs(i-parseFloat(v||0))<0.001?"selected":"";
    o+=`<option value="${i}" ${s}>${lbl}</option>`;
  }
  return o;
}

function saveHeure(k,ch,h){
  heures[k]={chantier:ch,heures:parseFloat(h)||0};
  localStorage.setItem("heuresdata",JSON.stringify(heures));
  setTimeout(()=>{majTotalLigne(k);calculerTotaux();},100);
}

function majTotalLigne(k){
  const m=k.match(/^(\d+)(\d{4}-\d{2}-\d{2})/);
  if(!m)return;
  const id=m[1],dS=m[2];
  let tot=0;for(let i=1;i<=5;i++){const kc=`${id}${dS}ch${i}`;
    tot+=parseFloat(heures[kc]?.heures||0);}
  const abs=parseFloat(heures[`${id}${dS}abs`]?.heures||0);
  const cT=document.getElementById(`total${id}${dS}`);
  if(cT)cT.textContent=tot.toFixed(1);
  const j=new Date(dS);
  const jn=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][j.getDay()].slice(0,3);
  const s=salaries.find(x=>String(x.id)===id);
  const hP=s?.heuresParJour?.[jn]||0;
  const prev=tot===0?0:Math.max(hP-abs,0);
  const cP=document.getElementById(`prevu${id}${dS}`);
  if(cP)cP.textContent=prev.toFixed(1);
  const ec=tot-prev;
  const cE=document.getElementById(`ecart${id}${dS}`);
  if(cE){
    cE.textContent=`${ec>=0?"+":""}${ec.toFixed(1)}`;
    cE.style.color=ec<0?"red":"green";
  }
}

function calculerTotaux(){
  let h=0,a=0,p=0;
  document.querySelectorAll('select[id$="h"]').forEach(sel=>{
    const v=parseFloat(sel.value)||0;
    if(sel.id.includes("abs"))a+=v;else h+=v;
  });
  document.querySelectorAll('[id^="prevu"]').forEach(td=>p+=parseFloat(td.textContent)||0);
  const e=h-p,fix=v=>v.toFixed(1);
  document.getElementById("tot-total").textContent=fix(h);
  document.getElementById("tot-abs").textContent=fix(a);
  document.getElementById("tot-prev").textContent=fix(p);
  document.getElementById("tot-ecart").textContent=fix(e);
  document.getElementById("tot-ecart").style.color=e<0?"red":"green";
  const pour=p>0?(h/p)*100:0;
  const c=document.getElementById("curseur"),t=document.getElementById("pourcentage");
  if(c&&t){
    const L=c.parentElement.offsetWidth;
    c.style.left=(L*pour/100-4)+"px";
    t.textContent=Math.round(pour)+"%";
  }
}

/===========================================
   PARAMÉTRAGE DE LA JAUGE
  ===========================================/
function majZonesJauge(){
  const sOrange=parseFloat(document.getElementById("seuil-orange")?.value)||80;
  const sVert=parseFloat(document.getElementById("seuil-vert")?.value)||100;
  const rouge=document.getElementById("zone-rouge");
  const orange=document.getElementById("zone-orange");
  const vert=document.getElementById("zone-verte");
  if(!rouge||!orange||!vert)return;

  const wRouge=Math.min(sOrange,100);
  const wOrange=Math.max(Math.min(sVert-sOrange,100-wRouge),0);
  const wVert=Math.max(100-(wRouge+wOrange),0);

  rouge.style.left="0%";
  rouge.style.width=wRouge+"%";
  orange.style.left=wRouge+"%";
  orange.style.width=wOrange+"%";
  vert.style.left=(wRouge+wOrange)+"%";
  vert.style.width=wVert+"%";

  localStorage.setItem("configJauge",JSON.stringify({
    sOrange,sVert,figer:document.getElementById("figer-param")?.checked
  }));
}
function majEtatFiger(){
  const chk=document.getElementById("figer-param");
  const inputs=[document.getElementById("seuil-orange"),document.getElementById("seuil-vert")];
  const disabled=chk?.checked;
  inputs.forEach(inp=>{if(inp)inp.disabled=disabled;});
  const conf=JSON.parse(localStorage.getItem("configJauge")||"{}");
  conf.figer=!!disabled;
  localStorage.setItem("configJauge",JSON.stringify(conf));
}

/===========================================
   AU CHARGEMENT
  ===========================================/
window.addEventListener("DOMContentLoaded",()=>{
  const nomE=document.getElementById("entreprise-nom");
  if(nomE&&entreprise.nom)nomE.textContent=entreprise.nom;
  afficherSalaries();

  const now=new Date();
  const mp=document.getElementById("moisPlanning");
  if(mp){
    mp.value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    mp.addEventListener("change",genererPlanning);
    genererPlanning();
  }

  // --- Restauration jauge ---
  const conf=JSON.parse(localStorage.getItem("configJauge")||"{}");
  if(document.getElementById("seuil-orange")){
    if(conf.sOrange)document.getElementById("seuil-orange").value=conf.sOrange;
    if(conf.sVert)document.getElementById("seuil-vert").value=conf.sVert;
    if(conf.figer){
      document.getElementById("figer-param").checked=true;
      document.getElementById("seuil-orange").disabled=true;
      document.getElementById("seuil-vert").disabled=true;
    }
    majZonesJauge();
    document.getElementById("seuil-orange").addEventListener("change",majZonesJauge);
    document.getElementById("seuil-vert").addEventListener("change",majZonesJauge);
    document.getElementById("figer-param").addEventListener("change",majEtatFiger);
  }

  // --- Filtre salariés : menu déroulant multi‑sélection ---
  const zone=document.getElementById("filtre-salaries");
  const btn=document.getElementById("btn-filtre");
  const liste=document.getElementById("liste-salaries");

  if(zone&&btn&&liste){
    const remplirListe=()=>{
      liste.innerHTML="";
      const optAll=document.createElement("div");
      optAll.innerHTML=`<label style="display:block;padding:2px 6px;">
        <input type="checkbox" id="chk-all" checked> Tous
      </label>`;
      liste.appendChild(optAll);
      salaries.forEach(s=>{
        const div=document.createElement("div");
        div.innerHTML=`<label style="display:block;padding:2px 6px;">
          <input type="checkbox" class="chk-sal" value="${s.id}" checked>
          ${s.prenom} ${s.nom}
        </label>`;
        liste.appendChild(div);
      });
    };
    remplirListe();

    btn.addEventListener("click",e=>{
      e.stopPropagation();
      liste.style.display=(liste.style.display==="none"||!liste.style.display)?"block":"none";
    });
    document.addEventListener("click",e=>{
      if(!zone.contains(e.target))liste.style.display="none";
    });

    liste.addEventListener("change",e=>{
      const chkAll=document.getElementById("chk-all");
      const chks=Array.from(liste.querySelectorAll(".chk-sal"));
      const selectedIds=chks.filter(c=>c.checked).map(c=>c.value);

      if(e.target.id==="chk-all"){
        chks.forEach(c=>c.checked=chkAll.checked);
        genererPlanning();
        return;
      }

      chkAll.checked=selectedIds.length===chks.length;
      const actifs=salaries.filter(s=>selectedIds.includes(String(s.id)));
      if(chkAll.checked||actifs.length===0)genererPlanning();
      else genererPlanningFiltres(actifs);
    });

    window.actualiserFiltreSalaries=function(){ remplirListe(); };
  }
});
