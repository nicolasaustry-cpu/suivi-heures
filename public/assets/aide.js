/* =======================================================
   Suiv'Heures — Widget d'aide (bulle « ? » en bas à droite)
   Lit les questions/réponses depuis /api/faq (gérées par l'admin).
   À inclure sur les pages patron : <script src="assets/aide.js"></script>
   ======================================================= */
(function () {
  // Couleurs cohérentes avec le thème Volitis
  const BLEU = '#2563eb';
  const BLEU_FONCE = '#1e40af';

  let _faqs = [];
  let _charge = false;

  // ── Tuto par page : chaque page ouvre sa section du mode d'emploi ──
  const GUIDE_ANCRES = {
    'index.html': 'e1',            // Entreprise
    'salaries.html': 'e2',         // Salariés
    'chantiers.html': 'e3',        // Prévisionnel
    'planning.html': 'e4',         // Planning prévu
    'planning-equipe.html': 'e5',  // Vue équipe
    'saisie.html': 'e6',           // Saisie mobile
    'bev.html': 'e7'               // BEV
  };
  function _pageActuelle() {
    return (window.location.pathname.split('/').pop() || 'index.html');
  }
  function _ouvrirGuide(ancre) {
    const url = 'mode-emploi.html' + (ancre ? '#' + ancre : '');
    const w = window.open(url, 'guideSuivHeures',
      'width=920,height=820,resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no');
    if (w) { try { w.focus(); if (ancre) w.location.hash = ancre; } catch (e) {} }
  }

  // ── Recherche intelligente : normalisation, mots vides, synonymes ──
  // Minuscules, sans accents, ponctuation remplacée par des espaces.
  function _norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  // Mots vides ignorés (ne portent pas de sens pour la recherche).
  const _STOP = new Set(('a au aux de des du la le les un une et ou est sont il elle je tu on nous vous ils elles ' +
    'comment quoi que qui quel quelle quels quelles pour par sur dans en ce cet cette ces mon ma mes ton ta tes son sa ses ' +
    'se faire fait puis y c qu quand avec sans plus moins nos vos leur leurs si ne pas mettre').split(' '));
  // Groupes de synonymes propres au vocabulaire de l'application.
  const _SYN = [
    ['ajouter', 'creer', 'nouveau', 'nouvelle', 'enregistrer', 'inscrire', 'saisir', 'ajout', 'creation'],
    ['supprimer', 'retirer', 'effacer', 'enlever', 'desactiver', 'suppression'],
    ['modifier', 'changer', 'editer', 'corriger', 'ajuster', 'modification', 'mettre a jour'],
    ['salarie', 'employe', 'ouvrier', 'collaborateur', 'personnel'],
    ['chantier', 'projet', 'affaire', 'chantiers'],
    ['planning', 'planifier', 'planification', 'prevu', 'agenda'],
    ['realise', 'pointage', 'pointer', 'effectue', 'realises'],
    ['imprimer', 'impression', 'imprime', 'papier'],
    ['exporter', 'export', 'telecharger', 'excel', 'pdf', 'extraire'],
    ['connexion', 'connecter', 'identifier', 'login', 'licence', 'activer'],
    ['pin', 'code'],
    ['rdv', 'rendez vous', 'rendezvous', 'rendez'],
    ['note', 'commentaire', 'remarque', 'notes'],
    ['heure', 'heures', 'temps'],
    ['jauge', 'seuil', 'couleur', 'indicateur', 'jauges', 'seuils'],
    ['mobile', 'telephone', 'portable', 'smartphone'],
    ['previsionnel', 'devis', 'prevoir'],
    ['photo', 'photos', 'image', 'images'],
    ['absence', 'conge', 'ferie', 'maladie', 'rtt', 'evenement', 'absent'],
    ['gantt', 'diagramme', 'barres']
  ];
  // Index : chaque mot pointe vers son groupe de synonymes.
  const _SYNIDX = (function () {
    const m = {};
    _SYN.forEach(g => g.forEach(w => { m[w] = g; }));
    return m;
  })();
  // Découpe la requête en groupes de mots (chaque groupe = un mot + ses synonymes).
  function _tokensRequete(q) {
    return _norm(q).split(' ')
      .filter(w => w.length > 1 && !_STOP.has(w))
      .map(w => _SYNIDX[w] || [w]);
  }
  // Un groupe de synonymes est-il présent dans un texte déjà normalisé ?
  function _groupePresent(groupe, texte) {
    return groupe.some(w => texte.indexOf(w) !== -1);
  }

  // ── Styles injectés une seule fois ──
  function injecterStyles() {
    if (document.getElementById('aide-styles')) return;
    const css = `
      .sh-entete-actions {
        display: inline-flex; align-items: center; gap: 8px;
        margin-left: 14px; vertical-align: middle;
      }
      .sh-btn-tuto {
        display: inline-flex; align-items: center; gap: 6px;
        background: #f59e0b; color: #412402; border: none; border-radius: 8px;
        padding: 7px 12px; font-size: 13px; font-weight: 700; line-height: 1;
        cursor: pointer; font-family: Arial, sans-serif; white-space: nowrap;
      }
      .sh-btn-tuto:hover { background: #e08e08; }
      .sh-btn-aide {
        width: 30px; height: 30px; border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,0.65); background: transparent; color: #fff;
        font-size: 15px; font-weight: 700; line-height: 1; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        font-family: Arial, sans-serif;
      }
      .sh-btn-aide:hover { background: rgba(255,255,255,0.15); }
      #aide-panneau {
        position: fixed; top: 64px; right: 22px; z-index: 9999;
        width: 360px; max-width: calc(100vw - 44px); max-height: 70vh;
        background: #fff; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.28);
        display: none; flex-direction: column; overflow: hidden;
        font-family: Arial, sans-serif;
      }
      #aide-panneau.ouvert { display: flex; }
      #aide-entete {
        background: ${BLEU}; color: #fff; padding: 12px 16px;
        display: flex; align-items: center; justify-content: space-between;
      }
      #aide-entete .titre { font-weight: 700; font-size: 0.98rem; }
      #aide-entete .fermer { background: none; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; line-height: 1; }
      #aide-recherche {
        border: none; border-bottom: 1px solid #e5e7eb; padding: 10px 16px;
        font-size: 0.9rem; width: 100%; box-sizing: border-box; outline: none;
      }
      #aide-liste { overflow-y: auto; padding: 6px 0; }
      .aide-theme { font-size: 0.72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase;
        letter-spacing: 0.04em; padding: 10px 16px 4px; }
      .aide-item { border-bottom: 1px solid #f3f4f6; }
      .aide-q {
        padding: 10px 16px; font-size: 0.88rem; color: #1f2937; cursor: pointer;
        display: flex; justify-content: space-between; gap: 8px; align-items: center;
      }
      .aide-q:hover { background: #f8fafc; }
      .aide-q .chev { color: ${BLEU}; font-size: 0.8rem; flex-shrink: 0; }
      .aide-r {
        display: none; padding: 0 16px 12px; font-size: 0.85rem; color: #4b5563; line-height: 1.5;
      }
      .aide-item.ouvert .aide-r { display: block; }
      .aide-item.ouvert .aide-q { font-weight: 700; color: ${BLEU_FONCE}; }
      #aide-vide { padding: 20px 16px; color: #9ca3af; font-size: 0.85rem; text-align: center; }
      #aide-pied { padding: 8px 16px; font-size: 0.74rem; color: #9ca3af; border-top: 1px solid #f3f4f6; text-align: center; }
      #aide-pied a { color: ${BLEU}; font-weight: 700; text-decoration: none; }
      #aide-pied a:hover { text-decoration: underline; }
      @media print { .sh-entete-actions, #aide-panneau { display: none !important; } }
    `;
    const style = document.createElement('style');
    style.id = 'aide-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Construire le DOM du widget ──
  function construire() {
    const panneau = document.createElement('div');
    panneau.id = 'aide-panneau';
    panneau.innerHTML =
      '<div id="aide-entete"><span class="titre">💬 Aide Suiv\'Heures</span>'
      + '<button class="fermer" aria-label="Fermer" onclick="document.getElementById(\'aide-panneau\').classList.remove(\'ouvert\')">×</button></div>'
      + '<input id="aide-recherche" type="text" placeholder="Rechercher une question…">'
      + '<div id="aide-liste"></div>'
      + '<div id="aide-pied">Vous ne trouvez pas ? <a href="mailto:contact@volitis.net">Contactez Volitis</a>.</div>';

    document.body.appendChild(panneau);

    document.getElementById('aide-recherche').addEventListener('input', function () {
      rendreListe(this.value.trim().toLowerCase());
    });

    // Boutons dans le bandeau (tuto de la page + aide « ? »)
    injecterBoutonsEntete();
    // Filets de sécurité si le bandeau est (re)construit tardivement par sync.js
    setTimeout(injecterBoutonsEntete, 400);
    setTimeout(injecterBoutonsEntete, 1200);
    window.addEventListener('donnees-chargees', injecterBoutonsEntete);
  }

  // ── Injecte le bouton « Tuto de la page » puis le « ? » à droite du titre ──
  function injecterBoutonsEntete() {
    const titre = document.querySelector('.main-header .page-title')
               || document.querySelector('.page-title');
    if (!titre) return;
    if (titre.querySelector('.sh-entete-actions')) return; // déjà en place

    const wrap = document.createElement('span');
    wrap.className = 'sh-entete-actions';

    const ancre = GUIDE_ANCRES[_pageActuelle()];
    if (ancre) {
      const bTuto = document.createElement('button');
      bTuto.type = 'button';
      bTuto.className = 'sh-btn-tuto';
      bTuto.innerHTML = '📘 Tuto de la page';
      bTuto.title = 'Ouvrir le tuto de cette page';
      bTuto.addEventListener('click', function () { _ouvrirGuide(ancre); });
      wrap.appendChild(bTuto);
    }

    const bAide = document.createElement('button');
    bAide.type = 'button';
    bAide.className = 'sh-btn-aide';
    bAide.textContent = '?';
    bAide.title = 'Aide';
    bAide.setAttribute('aria-label', "Ouvrir l'aide");
    bAide.addEventListener('click', basculer);
    wrap.appendChild(bAide);

    titre.appendChild(wrap);
  }

  function basculer() {
    const p = document.getElementById('aide-panneau');
    const ouvert = p.classList.toggle('ouvert');
    if (ouvert) {
      if (!_charge) chargerFaqs();
      setTimeout(() => document.getElementById('aide-recherche')?.focus(), 50);
    }
  }

  // ── Charger les Q/R depuis le serveur ──
  async function chargerFaqs() {
    const liste = document.getElementById('aide-liste');
    liste.innerHTML = '<div id="aide-vide">Chargement…</div>';
    try {
      const r = await fetch('/api/faq');
      const d = await r.json();
      _faqs = (d && d.ok && Array.isArray(d.faqs)) ? d.faqs : [];
      _charge = true;
      rendreListe('');   // recherche vide → affiche l'invitation, pas toute la liste
    } catch (e) {
      liste.innerHTML = '<div id="aide-vide">Aide momentanément indisponible.</div>';
    }
  }

  // Échappe le HTML pour l'affichage
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── Afficher uniquement les résultats correspondant à la recherche ──
  function rendreListe(filtre) {
    const liste = document.getElementById('aide-liste');

    // Tant qu'aucune recherche n'est saisie, on n'affiche pas les questions :
    // on invite l'utilisateur à taper sa question.
    if (!filtre) {
      liste.innerHTML = '<div id="aide-vide">Tapez un mot-clé ci-dessus pour trouver une réponse (ex. « planning », « PIN », « export »…).</div>';
      return;
    }

    const groupes = _tokensRequete(filtre);
    let resultats;

    if (!groupes.length) {
      // Requête composée uniquement de mots vides : repli sur une recherche simple.
      const f0 = _norm(filtre);
      resultats = _faqs
        .filter(f => _norm(f.question + ' ' + f.reponse + ' ' + (f.theme || '')).indexOf(f0) !== -1)
        .map(f => ({ f }));
    } else {
      resultats = [];
      _faqs.forEach(f => {
        const nQ = _norm(f.question);
        const nTout = _norm(f.question + ' ' + f.reponse + ' ' + (f.theme || ''));
        let score = 0, trouves = 0;
        groupes.forEach(g => {
          if (_groupePresent(g, nQ)) { score += 3; trouves++; }        // mot dans la question : fort
          else if (_groupePresent(g, nTout)) { score += 1; trouves++; } // mot dans la réponse/thème : faible
        });
        if (trouves === groupes.length) score += 2;   // bonus : tous les mots trouvés
        if (score > 0) resultats.push({ f, score });
      });
      resultats.sort((a, b) => b.score - a.score);   // les plus pertinents en premier
    }

    if (!resultats.length) {
      liste.innerHTML = '<div id="aide-vide">Aucune réponse trouvée. Essayez d\'autres mots-clés (ex. « salarié », « planning », « export »).</div>';
      return;
    }

    // Liste plate triée par pertinence ; le thème apparaît en petite étiquette après la question.
    let html = '';
    resultats.slice(0, 25).forEach(({ f }, i) => {
      const theme = f.theme
        ? ` <span style="color:#9ca3af;font-size:0.76rem;">· ${esc(f.theme)}</span>`
        : '';
      html += `<div class="aide-item" data-i="${i}">
        <div class="aide-q" onclick="this.parentElement.classList.toggle('ouvert')">
          <span>${esc(f.question)}${theme}</span><span class="chev">▾</span>
        </div>
        <div class="aide-r">${esc(f.reponse)}</div>
      </div>`;
    });
    liste.innerHTML = html;
  }

  // ── Initialisation ──
  function init() {
    injecterStyles();
    construire();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
