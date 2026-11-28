// Mapping between axe-core rule identifiers and French RGAA 4.1 criteria.

export interface RgaaCriterion {
  /** RGAA 4.1 criterion identifier (e.g. `'1.1'`, `'3.2'`, `'11.1'`). */
  id: string
  /** RGAA 4.1 theme number (1–13). */
  theme: number
  /** Short French RGAA 4.1 criterion title. */
  label: string
}

/** Subset of official French RGAA 4.1 criteria detectable by automated axe-core checks. */
export const RGAA_CRITERIA: Readonly<Record<string, RgaaCriterion>> = {
  '1.1': { id: '1.1', theme: 1, label: 'Alternative textuelle pour chaque image porteuse d\'information' },
  '1.2': { id: '1.2', theme: 1, label: 'Image de décoration ignorée par les technologies d\'assistance' },
  '1.3': { id: '1.3', theme: 1, label: 'Pertinence de l\'alternative textuelle des images' },
  '2.1': { id: '2.1', theme: 2, label: 'Titre de chaque cadre (iframe)' },
  '2.2': { id: '2.2', theme: 2, label: 'Pertinence du titre de chaque cadre' },
  '3.1': { id: '3.1', theme: 3, label: 'Information non donnée uniquement par la couleur' },
  '3.2': { id: '3.2', theme: 3, label: 'Contraste suffisant entre texte et arrière-plan' },
  '4.1': { id: '4.1', theme: 4, label: 'Transcription textuelle ou audiodescription des médias temporels' },
  '4.10': { id: '4.10', theme: 4, label: 'Contrôle des sons déclenchés automatiquement' },
  '5.1': { id: '5.1', theme: 5, label: 'Résumé des tableaux de données complexes' },
  '5.3': { id: '5.3', theme: 5, label: 'Compréhension du contenu linéarisé des tableaux de mise en forme' },
  '5.4': { id: '5.4', theme: 5, label: 'Association du titre au tableau de données' },
  '5.6': { id: '5.6', theme: 5, label: 'Déclaration des en-têtes de colonnes et de lignes des tableaux' },
  '5.7': { id: '5.7', theme: 5, label: 'Association des cellules de données avec leurs en-têtes' },
  '6.1': { id: '6.1', theme: 6, label: 'Intitulé explicite de chaque lien' },
  '6.2': { id: '6.2', theme: 6, label: 'Présence d\'un intitulé pour chaque lien' },
  '7.1': { id: '7.1', theme: 7, label: 'Compatibilité des scripts et composants ARIA avec les technologies d\'assistance' },
  '7.3': { id: '7.3', theme: 7, label: 'Contrôle au clavier et par tout dispositif de pointage' },
  '8.2': { id: '8.2', theme: 8, label: 'Validité du code source généré (identifiants uniques)' },
  '8.3': { id: '8.3', theme: 8, label: 'Présence de la langue par défaut de la page' },
  '8.4': { id: '8.4', theme: 8, label: 'Pertinence du code de langue par défaut' },
  '8.5': { id: '8.5', theme: 8, label: 'Présence d\'un titre de page (<title>)' },
  '8.7': { id: '8.7', theme: 8, label: 'Indication des changements de langue dans le code source' },
  '9.1': { id: '9.1', theme: 9, label: 'Structuration de l\'information par les titres (h1–h6)' },
  '9.2': { id: '9.2', theme: 9, label: 'Cohérence de la structure et des zones principales (landmarks)' },
  '9.3': { id: '9.3', theme: 9, label: 'Structuration correcte des listes' },
  '10.1': { id: '10.1', theme: 10, label: 'Utilisation des feuilles de styles pour contrôler la présentation' },
  '10.4': { id: '10.4', theme: 10, label: 'Lisibilité du texte lors d\'un agrandissement jusqu\'à 200 %' },
  '10.11': { id: '10.11', theme: 10, label: 'Présentation sans perte d\'information ni défilement horizontal (reflow)' },
  '10.13': { id: '10.13', theme: 10, label: 'Contrôle des contenus additionnels au focus ou au survol' },
  '11.1': { id: '11.1', theme: 11, label: 'Étiquette associée à chaque champ de formulaire' },
  '11.5': { id: '11.5', theme: 11, label: 'Regroupement des champs de même nature dans les formulaires' },
  '11.13': { id: '11.13', theme: 11, label: 'Déduction de la finalité des champs de saisie (autocomplete)' },
  '12.6': { id: '12.6', theme: 12, label: 'Accès et évitement des zones de regroupement de contenus' },
  '12.7': { id: '12.7', theme: 12, label: 'Lien d\'évitement ou d\'accès rapide au contenu principal' },
  '12.8': { id: '12.8', theme: 12, label: 'Cohérence de l\'ordre de tabulation' },
  '13.1': { id: '13.1', theme: 13, label: 'Contrôle par l\'utilisateur de chaque limite de temps' },
  '13.8': { id: '13.8', theme: 13, label: 'Contrôle des contenus en mouvement ou clignotants' },
}

/** Direct lookup from axe-core rule ID to one or more RGAA 4.1 criterion IDs. */
export const AXE_TO_RGAA: Readonly<Record<string, readonly string[]>> = {
  // Theme 1 — Images
  'image-alt': ['1.1'],
  'input-image-alt': ['1.1'],
  'area-alt': ['1.1'],
  'object-alt': ['1.1'],
  'svg-img-alt': ['1.1'],
  'role-img-alt': ['1.1'],
  'image-redundant-alt': ['1.3'],
  'presentation-role-conflict': ['1.2', '7.1'],

  // Theme 2 — Cadres
  'frame-title': ['2.1'],
  'frame-title-unique': ['2.2'],
  'frame-focusable-content': ['2.1', '7.3'],

  // Theme 3 — Couleurs
  'link-in-text-block': ['3.1'],
  'color-contrast': ['3.2'],
  'color-contrast-enhanced': ['3.2'],

  // Theme 4 — Multimédia
  'audio-caption': ['4.1'],
  'video-caption': ['4.1'],
  'no-autoplay-audio': ['4.10'],

  // Theme 5 — Tableaux
  'table-duplicate-name': ['5.1'],
  'layout-table': ['5.3'],
  'table-fake-caption': ['5.4'],
  'empty-table-header': ['5.6'],
  'th-has-data-cells': ['5.6'],
  'td-headers-attr': ['5.7'],
  'td-has-header': ['5.7'],
  'scope-attr-valid': ['5.7'],

  // Theme 6 — Liens
  'link-name': ['6.1', '6.2'],
  'identical-links-same-purpose': ['6.1'],

  // Theme 7 — Scripts & ARIA
  'button-name': ['7.1'],
  'input-button-name': ['7.1'],
  'summary-name': ['7.1'],
  'nested-interactive': ['7.1'],
  'scrollable-region-focusable': ['7.3'],
  'focus-order-semantics': ['7.3'],

  // Theme 8 — Éléments obligatoires
  'duplicate-id': ['8.2'],
  'duplicate-id-active': ['8.2'],
  'duplicate-id-aria': ['8.2'],
  'html-has-lang': ['8.3'],
  'html-lang-valid': ['8.4'],
  'html-xml-lang-mismatch': ['8.4'],
  'document-title': ['8.5'],
  'valid-lang': ['8.7'],

  // Theme 9 — Structuration de l'information
  'heading-order': ['9.1'],
  'empty-heading': ['9.1'],
  'page-has-heading-one': ['9.1'],
  'landmark-one-main': ['9.2'],
  'landmark-no-duplicate-banner': ['9.2'],
  'landmark-no-duplicate-contentinfo': ['9.2'],
  'landmark-no-duplicate-main': ['9.2'],
  'landmark-banner-is-top-level': ['9.2'],
  'landmark-complementary-is-top-level': ['9.2'],
  'landmark-contentinfo-is-top-level': ['9.2'],
  'landmark-main-is-top-level': ['9.2'],
  'landmark-unique': ['9.2'],
  'region': ['9.2'],
  'list': ['9.3'],
  'listitem': ['9.3'],
  'definition-list': ['9.3'],
  'dlitem': ['9.3'],

  // Theme 10 — Présentation de l'information
  'blink': ['10.1', '13.8'],
  'marquee': ['10.1', '13.8'],
  'meta-viewport': ['10.4'],
  'meta-viewport-large': ['10.4'],
  'avoid-inline-spacing': ['10.11'],
  'target-size': ['10.13'],

  // Theme 11 — Formulaires
  'label': ['11.1'],
  'label-title-only': ['11.1'],
  'select-name': ['11.1'],
  'form-field-multiple-labels': ['11.1'],
  'fieldset': ['11.5'],
  'radiogroup': ['11.5'],
  'autocomplete-valid': ['11.13'],

  // Theme 12 — Navigation
  'skip-link': ['12.7'],
  'bypass': ['12.7'],
  'tabindex': ['12.8'],
  'accesskeys': ['12.8'],

  // Theme 13 — Consultation
  'meta-refresh': ['13.1'],
  'meta-refresh-no-exceptions': ['13.1'],
}

function lookupCriteria(ids: readonly string[]): RgaaCriterion[] {
  const out: RgaaCriterion[] = []
  for (const id of ids) {
    const found = RGAA_CRITERIA[id]
    if (found !== undefined)
      out.push(found)
  }
  return out
}

/** Resolves an axe-core rule ID (e.g. `'image-alt'`, `'aria-roles'`) to its matching RGAA 4.1 criteria. */
export function rgaaCriteriaForAxeRule(ruleId: string): RgaaCriterion[] {
  const exact = AXE_TO_RGAA[ruleId]
  if (exact !== undefined)
    return lookupCriteria(exact)
  if (ruleId.startsWith('aria-'))
    return lookupCriteria(['7.1'])
  if (ruleId.startsWith('table-') || ruleId.startsWith('td-') || ruleId.startsWith('th-'))
    return lookupCriteria(['5.7'])
  if (ruleId.startsWith('landmark-'))
    return lookupCriteria(['9.2'])
  if (ruleId.startsWith('frame-'))
    return lookupCriteria(['2.1'])
  return []
}
