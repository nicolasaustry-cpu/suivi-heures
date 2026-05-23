/* ═══════════════════════════════════════════════════════════════
   FILTRE STYLE EXCEL — module commun
   ───────────────────────────────────────────────────────────────
   Affiche un dropdown avec :
     - Champ de recherche
     - "(Sélectionner tout)"
     - Liste de cases à cocher
     - Boutons OK / Annuler
   Le filtre n'est appliqué qu'au clic sur OK.
   ─────────────────────────────────────────────────────────────── */

window.FiltreExcel = (function () {
  let _activeDropdown = null;  // dropdown actuellement ouvert
  let _activeButton   = null;  // bouton qui l'a ouvert

  /**
   * Ouvre un filtre style Excel.
   *
   * @param {Object} cfg
   * @param {HTMLElement} cfg.button     - le bouton-déclencheur (sera utilisé pour positionner le dropdown)
   * @param {Array}       cfg.items      - tableau d'items, chacun = { value: 'id-unique', label: 'Texte affiché' }
   * @param {Set|Array}   cfg.selected   - les valeurs actuellement sélectionnées
   * @param {Function}    cfg.onApply    - callback(selectedSet) appelé au clic OK
   * @param {string}      [cfg.labelTous='(Sélectionner tout)']
   * @param {string}      [cfg.placeholderRecherche='Rechercher…']
   */
  function ouvrir(cfg) {
    fermer();  // toujours fermer un éventuel dropdown ouvert avant

    const dd = document.createElement('div');
    dd.className = 'fexc-dropdown';
    dd.innerHTML = `
      <div class="fexc-search-zone">
        <input type="text" class="fexc-search" placeholder="🔍 ${cfg.placeholderRecherche || 'Rechercher…'}">
      </div>
      <div class="fexc-list"></div>
      <div class="fexc-actions">
        <button class="fexc-btn-ok">OK</button>
        <button class="fexc-btn-cancel">Annuler</button>
      </div>
    `;

    // Positionnement absolu sous le bouton
    document.body.appendChild(dd);
    positionner(dd, cfg.button);

    const list = dd.querySelector('.fexc-list');
    const search = dd.querySelector('.fexc-search');
    const labelTous = cfg.labelTous || '(Sélectionner tout)';
    const selectedSet = new Set(cfg.selected || []);

    // Rendu de la liste
    function rendreListe(filtre = '') {
      list.innerHTML = '';
      const f = normaliser(filtre);

      // Filtrer les items selon la recherche
      const itemsVisibles = cfg.items.filter(it =>
        !f || normaliser(it.label).includes(f)
      );

      // Ligne "(Sélectionner tout)"
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
        if (cbAll.checked) {
          itemsVisibles.forEach(it => selectedSet.add(it.value));
        } else {
          itemsVisibles.forEach(it => selectedSet.delete(it.value));
        }
        rendreListe(filtre);
      });
      list.appendChild(labelAll);

      // Items individuels
      itemsVisibles.forEach(it => {
        const lab = document.createElement('label');
        lab.className = 'fexc-item';
        lab.innerHTML = `
          <input type="checkbox" data-value="${escapeAttr(it.value)}" ${selectedSet.has(it.value) ? 'checked' : ''}>
          <span></span>
        `;
        lab.querySelector('span').textContent = it.label;
        const cb = lab.querySelector('input');
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSet.add(it.value);
          else            selectedSet.delete(it.value);
          // Mettre à jour le checkbox "tous"
          const allChecked = itemsVisibles.every(i => selectedSet.has(i.value));
          cbAll.checked = allChecked;
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

    rendreListe();
    search.addEventListener('input', e => rendreListe(e.target.value));

    // Actions
    dd.querySelector('.fexc-btn-ok').addEventListener('click', () => {
      // Comportement type Excel : si l'utilisateur a tapé une recherche,
      // on considère qu'il veut cibler uniquement les éléments trouvés.
      // On enlève donc du set tous les items NON-visibles.
      const filtre = search.value.trim();
      if (filtre) {
        const f = normaliser(filtre);
        const visiblesValues = new Set(
          cfg.items
            .filter(it => normaliser(it.label).includes(f))
            .map(it => it.value)
        );
        // Retirer du set tout ce qui n'est pas visible
        [...selectedSet].forEach(v => {
          if (!visiblesValues.has(v)) selectedSet.delete(v);
        });
      }
      cfg.onApply(selectedSet);
      fermer();
    });
    dd.querySelector('.fexc-btn-cancel').addEventListener('click', () => {
      fermer();
    });

    _activeDropdown = dd;
    _activeButton   = cfg.button;

    // Focus dans la recherche
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
    // Empêcher de déborder à droite
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
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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

  /* Helper : produire un libellé pour le bouton-déclencheur. */
  function libelle(selectedSet, totalItems, items, libelleTous = 'Tous') {
    if (!selectedSet || selectedSet.size === 0)        return 'Aucun';
    if (selectedSet.size === totalItems)               return libelleTous;
    if (selectedSet.size <= 2 && items) {
      const labels = items.filter(it => selectedSet.has(it.value)).map(it => it.label);
      return labels.join(', ');
    }
    return selectedSet.size + ' sélectionnés';
  }

  return { ouvrir, fermer, libelle };
})();
