// Generates an editable French RGAA 4.1.2 accessibility declaration page (Décret n° 2019-768).

import type { A11yAuditReport } from './index'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { relPosix } from '../build/files'

export type ComplianceStatus = 'full' | 'partial' | 'none'

export interface AccessibilityDeclarationOptions {
  /** Application root directory. */
  root: string
  /** Destination path relative to `root` (or absolute). Default: `'src/routes/accessibilite.tsx'`. */
  outPath?: string | undefined
  /** Optional audit report from `auditAccessibility()` used to pre-fill test results and non-conformities. */
  report?: A11yAuditReport | undefined
  /** Organization or publisher name (editable placeholder by default). */
  organization?: string | undefined
  /** Public site URL (editable placeholder by default). */
  siteUrl?: string | undefined
  /** Contact email for accessibility feedback (editable placeholder by default). */
  contactEmail?: string | undefined
  /** Explicit compliance level override; inferred from `report` when omitted. */
  status?: ComplianceStatus | undefined
  /** Declaration date (defaults to today). */
  date?: Date | undefined
  /** Write the generated TSX page to disk (default: `true`). */
  write?: boolean | undefined
}

export interface AccessibilityDeclarationResult {
  /** Absolute path of the target declaration file. */
  path: string
  /** Root-relative POSIX path (e.g. `'src/routes/accessibilite.tsx'`). */
  relativePath: string
  /** Compliance status written into the declaration. */
  status: ComplianceStatus
  /** Generated TSX source code. */
  content: string
}

export const DEFAULT_DECLARATION_PATH = 'src/routes/accessibilite.tsx'

const STATUS_LABELS: Readonly<Record<ComplianceStatus, string>> = {
  full: 'totalement conforme',
  partial: 'partiellement conforme',
  none: 'non conforme',
}

/** Infers RGAA compliance status from an automated audit report (never claims full compliance without explicit opt-in). */
export function inferComplianceStatus(
  report: A11yAuditReport | undefined,
  override?: ComplianceStatus | undefined,
): ComplianceStatus {
  if (override !== undefined)
    return override
  if (report === undefined)
    return 'none'
  return report.totalViolations === 0 ? 'partial' : 'none'
}

function escapeJsxText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatFrenchDate(date: Date): { iso: string, human: string } {
  const iso = date.toISOString().slice(0, 10)
  const human = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  return { iso, human }
}

function renderNonConformities(report: A11yAuditReport | undefined): string {
  const routesWithIssues = report?.routes.filter(r => r.violations.length > 0) ?? []
  if (routesWithIssues.length === 0) {
    return [
      '          <p>',
      '            {/* TODO: compléter avec les non-conformités relevées lors de l\'audit manuel RGAA 4.1.2 */}',
      '            Aucune non-conformité n\'a été détectée par l\'audit automatisé axe-core.',
      '            Les résultats d\'un audit manuel RGAA 4.1.2 complet doivent être renseignés ci-dessous.',
      '          </p>',
    ].join('\n')
  }

  const items: string[] = []
  for (const route of routesWithIssues) {
    for (const v of route.violations) {
      const rgaaLabel = v.rgaa.length > 0
        ? `RGAA ${v.rgaa.map(c => c.id).join(', ')}`
        : 'WCAG / axe-core'
      const count = v.nodes.length
      const elemWord = count === 1 ? 'élément' : 'éléments'
      const line = `${route.route} — ${rgaaLabel} (${v.id}, impact ${v.impact}, ${count} ${elemWord}) : ${v.help}.`
      items.push(`            <li>${escapeJsxText(line)}</li>`)
    }
  }
  return [
    '          <p>Les non-conformités suivantes ont été détectées automatiquement par axe-core :</p>',
    '          <ul>',
    ...items,
    '          </ul>',
  ].join('\n')
}

function renderAuditedRoutes(report: A11yAuditReport | undefined): string {
  const routes = report?.routes ?? []
  if (routes.length === 0) {
    return [
      '          <ul>',
      '            <li><code>/</code> — Page d\'accueil (TODO : lister l\'échantillon complet audité)</li>',
      '          </ul>',
    ].join('\n')
  }
  const items = routes.map((r) => {
    const summary = r.violations.length === 0
      ? '0 violation automatisée'
      : `${r.violations.length} violation${r.violations.length === 1 ? '' : 's'} automatisée${r.violations.length === 1 ? '' : 's'}`
    return `            <li><code>${escapeJsxText(r.route)}</code> (${escapeJsxText(summary)})</li>`
  })
  return [
    '          <ul>',
    ...items,
    '          </ul>',
  ].join('\n')
}

function buildStatusParagraph(status: ComplianceStatus, siteUrl: string, report: A11yAuditReport | undefined): string {
  const statusLabel = STATUS_LABELS[status]
  const safeSite = escapeJsxText(siteUrl)
  if (status === 'full') {
    return [
      `          {/* TODO: ne conserver "totalement conforme" qu'après validation d'un audit manuel RGAA 4.1.2 complet (100 % des critères applicables conformes). */}`,
      `          <p>`,
      `            <strong>${safeSite}</strong> est <strong>${statusLabel}</strong> avec le référentiel général d'amélioration de l'accessibilité (RGAA), version 4.1.2.`,
      `          </p>`,
    ].join('\n')
  }
  if (status === 'partial') {
    const detail = report !== undefined
      ? ` L'audit automatisé axe-core sur ${report.routes.length} page${report.routes.length === 1 ? '' : 's'} n'a relevé aucune violation, mais un audit manuel RGAA 4.1.2 reste nécessaire avant de déclarer une conformité totale.`
      : ' Des non-conformités ou des vérifications manuelles RGAA 4.1.2 restent à compléter ci-dessous.'
    return [
      `          {/* TODO: mettre à jour le niveau de conformité et le taux après réalisation de l'audit manuel RGAA 4.1.2. */}`,
      `          <p>`,
      `            <strong>${safeSite}</strong> est <strong>${statusLabel}</strong> avec le référentiel général d'amélioration de l'accessibilité (RGAA), version 4.1.2.${escapeJsxText(detail)}`,
      `          </p>`,
    ].join('\n')
  }
  const reason = report !== undefined && report.totalViolations > 0
    ? ` en raison des ${report.totalViolations} non-conformité${report.totalViolations === 1 ? '' : 's'} automatisée${report.totalViolations === 1 ? '' : 's'} recensée${report.totalViolations === 1 ? '' : 's'} ci-dessous`
    : ' en l\'absence d\'audit de conformité RGAA 4.1.2 complet'
  return [
    `          {/* TODO: corriger les non-conformités listées puis réaliser un audit manuel RGAA 4.1.2. */}`,
    `          <p>`,
    `            <strong>${safeSite}</strong> est <strong>${statusLabel}</strong> avec le référentiel général d'amélioration de l'accessibilité (RGAA), version 4.1.2${escapeJsxText(reason)}.`,
    `          </p>`,
  ].join('\n')
}

/** Generates (and optionally writes) a draft French RGAA 4.1.2 accessibility declaration page in TSX. */
export function draftAccessibilityStatement(options: AccessibilityDeclarationOptions): AccessibilityDeclarationResult {
  const root = resolve(options.root)
  const dest = resolve(root, options.outPath ?? DEFAULT_DECLARATION_PATH)
  const relativePath = relPosix(root, dest)
  const status = inferComplianceStatus(options.report, options.status)
  const org = options.organization?.trim() || '[Nom de l\'organisme]'
  const siteUrl = options.siteUrl?.trim() || '[https://exemple.fr]'
  const contactEmail = options.contactEmail?.trim() || 'accessibilite@exemple.fr'
  const { iso, human } = formatFrenchDate(options.date ?? new Date())
  const axeLabel = options.report?.axeVersion ? `axe-core ${options.report.axeVersion}` : 'axe-core'
  const routeCount = options.report?.routes.length ?? 0
  const violationCount = options.report?.totalViolations ?? 0

  const content = `// Brouillon de déclaration d'accessibilité RGAA 4.1.2 (Décret n° 2019-768) généré par \`prunelle a11y --draft\`.
// TODO: Les vérifications automatisées axe-core ne couvrent qu'une partie des 106 critères du RGAA 4.1.2.
// Complétez chaque mention entre crochets ([...]) et renseignez les résultats de votre audit manuel avant publication.

import { Head } from 'prunelle'

export const prerender = true

export default function Accessibilite() {
  return (
    <>
      <Head>
        <title>Déclaration d'accessibilité</title>
      </Head>
      <main>
        <h1>Déclaration d'accessibilité</h1>
        <p>
          <strong>${escapeJsxText(org)}</strong> s'engage à rendre ses sites internet, intranet, extranet et ses progiciels
          accessibles (et ses applications mobiles et mobilier urbain numérique) conformément à l'article 47 de la loi n° 2005-102
          du 11 février 2005.
        </p>
        <p>
          Cette déclaration d'accessibilité s'applique à <strong>${escapeJsxText(siteUrl)}</strong>.
        </p>

        <section>
          <h2>État de conformité</h2>
${buildStatusParagraph(status, siteUrl, options.report)}
        </section>

        <section>
          <h2>Résultats des tests</h2>
          <p>
            L'audit automatisé réalisé via <code>prunelle a11y</code> (${escapeJsxText(axeLabel)}, règles WCAG 2.0 / 2.1 niveaux A et AA
            mappées au RGAA 4.1) a porté sur <strong>${routeCount}</strong> page${routeCount === 1 ? '' : 's'} et a relevé{' '}
            <strong>${violationCount}</strong> violation${violationCount === 1 ? '' : 's'} automatisée${violationCount === 1 ? '' : 's'}.
          </p>
          <p>
            {/* TODO: remplacer par le taux de conformité issu de votre audit manuel RGAA 4.1.2 */}
            L'audit de conformité manuel RGAA 4.1.2 révèle que <strong>[XX %]</strong> des critères du RGAA version 4.1.2 sont respectés.
          </p>
        </section>

        <section>
          <h2>Contenus non accessibles</h2>

          <h3>Non-conformités</h3>
${renderNonConformities(options.report)}

          <h3>Dérogations pour charge disproportionnée</h3>
          <p>
            {/* TODO: lister ici les éventuelles dérogations justifiées */}
            Aucune.
          </p>

          <h3>Contenus non soumis à l'obligation d'accessibilité</h3>
          <p>
            {/* TODO: lister ici les contenus tiers ou archives hors périmètre */}
            Aucun.
          </p>
        </section>

        <section>
          <h2>Établissement de cette déclaration d'accessibilité</h2>
          <p>
            Cette déclaration a été établie le <time dateTime="${escapeAttr(iso)}">${escapeJsxText(human)}</time>.
          </p>

          <h3>Technologies utilisées pour la réalisation du site</h3>
          <ul>
            <li>HTML5</li>
            <li>CSS</li>
            <li>JavaScript</li>
            <li>Prunelle</li>
          </ul>

          <h3>Environnement de test</h3>
          <p>
            Les vérifications automatisées de restitution de contenus ont été réalisées dans l'environnement suivant :
          </p>
          <ul>
            <li>Navigateur : Chromium (headless via Playwright)</li>
            <li>Moteur d'analyse : ${escapeJsxText(axeLabel)}</li>
            <li>{/* TODO: ajouter les combinaisons navigateur + lecteur d'écran testées manuellement (ex. Firefox + NVDA, Safari + VoiceOver) */}Lecteurs d'écran (audit manuel) : [À compléter]</li>
          </ul>

          <h3>Outils pour évaluer l'accessibilité</h3>
          <ul>
            <li><code>prunelle a11y</code> (${escapeJsxText(axeLabel)})</li>
            <li><code>prunelle check</code> (vérifications statiques RGAA sur le JSX)</li>
          </ul>

          <h3>Pages du site ayant fait l'objet de la vérification de conformité</h3>
${renderAuditedRoutes(options.report)}
        </section>

        <section>
          <h2>Retour d'information et contact</h2>
          <p>
            Si vous n'arrivez pas à accéder à un contenu ou à un service, vous pouvez contacter le responsable de{' '}
            <strong>${escapeJsxText(siteUrl)}</strong> pour être orienté vers une alternative accessible ou obtenir le contenu sous une autre forme.
          </p>
          <ul>
            <li>Envoyer un courriel : <a href="mailto:${escapeAttr(contactEmail)}">${escapeJsxText(contactEmail)}</a></li>
            <li>Contacter : ${escapeJsxText(org)} — [Adresse postale / lien vers le formulaire de contact]</li>
          </ul>
        </section>

        <section>
          <h2>Voies de recours</h2>
          <p>
            Cette procédure est à utiliser dans le cas suivant : vous avez signalé au responsable du site internet un défaut
            d'accessibilité qui vous empêche d'accéder à un contenu ou à un des services du portail et vous n'avez pas obtenu
            de réponse satisfaisante.
          </p>
          <ul>
            <li>
              <a href="https://formulaire.defenseurdesdroits.fr/">Écrire un message au Défenseur des droits</a>
            </li>
            <li>
              <a href="https://www.defenseurdesdroits.fr/saisir/delegues">Contacter le délégué du Défenseur des droits dans votre région</a>
            </li>
            <li>
              Envoyer un courrier par la poste (gratuit, ne pas mettre de timbre) : Défenseur des droits, Libre réponse 71120, 75342 Paris CEDEX 07.
            </li>
          </ul>
        </section>
      </main>
    </>
  )
}
`

  if (options.write !== false) {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content)
  }

  return {
    path: dest,
    relativePath,
    status,
    content,
  }
}
