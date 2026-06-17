/* ═══════════════════════════════════════════════════════════════
   FILTRE STYLE EXCEL — module commun
   ───────────────────────────────────────────────────────────────
   Modèle « vide = tout affiché » :
     - Par défaut AUCUNE case cochée  → aucun filtre → tout est affiché.
     - Saisir du texte COCHE automatiquement les valeurs correspondantes.
     - Cocher / décocher applique IMMÉDIATEMENT (pas de bouton OK).
     - Un Set vide transmis à onApply() signifie « aucun filtre ».
   ─────────────────────────────────────────────────────────────── */

window.FiltreExcel = (function () {
  let _activeDropdown = null;  // dropdown actuellement ouvert
  let _activeButton   = null;  // bouton qui l'a ouvert

  /**
   * Ouvre un filtre style Excel.
   * @param {Object} cfg
   * @param {HTMLElement} cfg.button   - bouton-déclencheur (positionnement)
   * @param {Array}       cfg.items    - [{ value:'id', label:'Texte' }, …]
   * @param {Set|Array}   cfg.selected - valeurs déjà cochées (vide = tout)
   * @param {Function}    cfg.onApply  - callback(selectedSet) à chaque changement
   * @param {string}      [cfg.labelTous='(Sélectionner tout)']
   * @param {string}      [cfg.placeholderRecherche='Rechercher…']
   */
  function ouvrir(cfg) {
    fermer();

    const dd = document.createElement('div');
    dd.className = 'fexc-dropdown';
    dd.innerHTML = `
      <div class="fexc-search-zone">
        <input type="text" class="fexc-search" placeholder="🔍 ${cfg.placeholderRecherche || 'Rechercher…'}">
      </div>
      <div class="fexc-list"></div>
    `;

    document.body.appendChild(dd);
    positionner(dd, cfg.button);

    const list      = dd.querySelector('.fexc-list');
    const search    = dd.querySelector('.fexc-search');
    const labelTous = cfg.labelTous || '(Sélectionner tout)';
    const selectedSet = new Set(cfg.selected || []);

    /* Rendu de la liste (filtre = texte de recherche éventuel). */
    function rendreListe(filtre = '') {
      list.innerHTML = '';
      const f = normaliser(filtre);
      const itemsVisibles = cfg.items.filter(it => !f || normaliser(it.label).includes(f));

      // Ligne "(Sélectionner tout)" : cochée si tous les éléments visibles sont sélectionnés
      const toutCoches = itemsVisibles.length > 0 &&
                         itemsVisibles.every(it => selectedSet.has(it.value));
      const labelAll = document.createElement('label');
      labelAll.className = 'fexc-item fexc-item-all';
      labelAll.innerHTML = `
        <input type="checkbox" ${toutCoches ? 'checked' : ''}>
        <span>${labelTous}</span>
      `;
      const cbAll = labelAll.querySelector('input');
      cbAll.addEventListener('change', () => {
        if (cbAll.checked) itemsVisibles.forEach(it => selectedSet.add(it.value));
        else               itemsVisibles.forEach(it => selectedSet.delete(it.value));
        rendreListe(filtre);
        cfg.onApply(selectedSet);   // application immédiate
      });
      list.appendChild(labelAll);

      // Cases individuelles
      itemsVisibles.forEach(it => {
        const lab = document.createElement('label');
        lab.className = 'fexc-item';
        lab.innerHTML = `
          <input type="checkbox" ${selectedSet.has(it.value) ? 'checked' : ''}>
          <span></span>
        `;
        lab.querySelector('span').textContent = it.label;
        const cb = lab.querySelector('input');
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSet.add(it.value);
          else            selectedSet.delete(it.value);
          cbAll.checked = itemsVisibles.every(i => selectedSet.has(i.value));
          cfg.onApply(selectedSet);   // application immédiate
        });
        list.appendChild(lab);
      });

      if (itemsVisibles.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'fexc-empty';
        empty.textContent = 'Aucun résultat';
        list.appendChild(empty);
      }
    }

    /* Recherche = coche :
       - champ vide  → on vide la sélection (donc tout est affiché)
       - sinon       → on COCHE les valeurs dont le libellé correspond. */
    function appliquerRecherche(txt) {
      const f = normaliser(txt);
      selectedSet.clear();
      if (f) {
        cfg.items.forEach(it => {
          if (normaliser(it.label).includes(f)) selectedSet.add(it.value);
        });
      }
      rendreListe(txt);
      cfg.onApply(selectedSet);   // application immédiate
    }

    rendreListe();
    search.addEventListener('input', e => appliquerRecherche(e.target.value));

    _activeDropdown = dd;
    _activeButton   = cfg.button;
    setTimeout(() => search.focus(), 50);
  }

  function fermer() {
    if (_activeDropdown && _activeDropdown.parentNode) {
      _activeDropdown.parentNode.removeChild(_activeDropdown);
    }
    _activeDropdown = null;
    _activeButton   = null;
  }

  function positionner(dd, button) {
    const rect = button.getBoundingClientRect();
    const top  = rect.bottom + window.scrollY + 4;
    let left   = rect.left + window.scrollX;
    const ddWidth = 260;
    if (left + ddWidth > window.innerWidth - 10) {
      left = window.innerWidth - ddWidth - 10;
    }
    dd.style.top  = top + 'px';
    dd.style.left = Math.max(8, left) + 'px';
  }

  /* Helpers ─────────────────── */
  function normaliser(s) {
    return (s || '').toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // sans accents
  }

  /* Fermeture sur clic extérieur ou Échap */
  document.addEventListener('mousedown', e => {
    if (_activeDropdown && !_activeDropdown.contains(e.target) &&
        _activeButton    && !_activeButton.contains(e.target)) {
      fermer();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fermer();
  });

  /* Libellé du bouton-déclencheur.
     Set vide ou complet = « Tous » (puisque vide = tout affiché). */
  function libelle(selectedSet, totalItems, items, libelleTous = 'Tous') {
    if (!selectedSet || selectedSet.size === 0) return libelleTous;
    if (selectedSet.size === totalItems)        return libelleTous;
    if (selectedSet.size <= 2 && items) {
      const labels = items.filter(it => selectedSet.has(it.value)).map(it => it.label);
      return labels.join(', ');
    }
    return selectedSet.size + ' sélectionnés';
  }

  return { ouvrir, fermer, libelle };
})();
