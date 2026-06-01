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

  // ── Styles injectés une seule fois ──
  function injecterStyles() {
    if (document.getElementById('aide-styles')) return;
    const css = `
      #aide-bulle {
        position: fixed; bottom: 22px; right: 22px; z-index: 9998;
        width: 56px; height: 56px; border-radius: 50%; border: none;
        background: ${BLEU}; color: #fff; font-size: 1.6rem; font-weight: 700;
        cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s, background 0.15s;
      }
      #aide-bulle:hover { background: ${BLEU_FONCE}; transform: scale(1.06); }
      #aide-panneau {
        position: fixed; bottom: 90px; right: 22px; z-index: 9999;
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
    `;
    const style = document.createElement('style');
    style.id = 'aide-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Construire le DOM du widget ──
  function construire() {
    const bulle = document.createElement('button');
    bulle.id = 'aide-bulle';
    bulle.textContent = '?';
    bulle.title = 'Aide';
    bulle.setAttribute('aria-label', 'Ouvrir l\'aide');
    bulle.onclick = basculer;

    const panneau = document.createElement('div');
    panneau.id = 'aide-panneau';
    panneau.innerHTML =
      '<div id="aide-entete"><span class="titre">💬 Aide Suiv\'Heures</span>'
      + '<button class="fermer" aria-label="Fermer" onclick="document.getElementById(\'aide-panneau\').classList.remove(\'ouvert\')">×</button></div>'
      + '<input id="aide-recherche" type="text" placeholder="Rechercher une question…">'
      + '<div id="aide-liste"></div>'
      + '<div id="aide-pied">Vous ne trouvez pas ? <a href="mailto:contact@volitis.net">Contactez Volitis</a>.</div>';

    document.body.appendChild(bulle);
    document.body.appendChild(panneau);

    document.getElementById('aide-recherche').addEventListener('input', function () {
      rendreListe(this.value.trim().toLowerCase());
    });
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

    const items = _faqs.filter(f =>
      (f.question + ' ' + f.reponse + ' ' + (f.theme || '')).toLowerCase().includes(filtre)
    );
    if (!items.length) {
      liste.innerHTML = '<div id="aide-vide">Aucune réponse trouvée pour cette recherche.</div>';
      return;
    }
    let html = '';
    let themeCourant = null;
    items.forEach((f, i) => {
      if (f.theme && f.theme !== themeCourant) {
        themeCourant = f.theme;
        html += `<div class="aide-theme">${esc(themeCourant)}</div>`;
      }
      html += `<div class="aide-item" data-i="${i}">
        <div class="aide-q" onclick="this.parentElement.classList.toggle('ouvert')">
          <span>${esc(f.question)}</span><span class="chev">▾</span>
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
