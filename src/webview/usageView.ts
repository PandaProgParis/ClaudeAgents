import { escapeHtml } from './render';
import { formatDuration } from '../format';
import { STRINGS, type Locale } from '../i18n';
import type { UsageLimit, UsageSnapshot } from '../types';

/**
 * Card des limites du forfait, ancrée en bas de la vue. Jauges reprises du plugin Chrome de
 * ClaudeCockpit (mêmes couleurs, mêmes libellés ; reset en jours au-delà de 24 h) — à une différence près :
 * la CSP de la webview interdit `style="width:…"`, donc la barre est un SVG dont les attributs
 * de présentation portent la largeur et la couleur, comme la jauge de contexte des cards.
 */

/** Couleurs de ClaudeCockpit (popup.js, GAUGE_CONFIG). */
const KIND_COLORS: Record<string, string> = {
  session: '#D4956A',
  weekly_all: '#64B5F6',
};
const MODEL_COLORS: Record<string, string> = {
  fable: '#BA68C8',
  mythos: '#F06292',
  opus: '#FFB74D',
  sonnet: '#64B5F6',
  haiku: '#81C784',
};
const SCOPED_FALLBACK = '#8BB8E0';

/** Au-delà, les chiffres ne valent plus rien : l'outil qui écrit le fichier a dû s'arrêter. */
export const STALE_AFTER_MS = 30 * 60_000;

function colorOf(limit: UsageLimit): string {
  const known = KIND_COLORS[limit.kind];
  if (known !== undefined) {
    return known;
  }
  const name = (limit.scopeLabel ?? '').toLowerCase();
  const family = Object.keys(MODEL_COLORS).find((model) => name.includes(model));
  return family !== undefined ? MODEL_COLORS[family] : SCOPED_FALLBACK;
}

export function labelOf(limit: UsageLimit, locale: Locale): string {
  const strings = STRINGS[locale];
  if (limit.kind === 'session') {
    return strings.usageSession;
  }
  if (limit.kind === 'weekly_all') {
    return strings.usageWeeklyAll;
  }
  if (limit.scopeLabel !== undefined) {
    return strings.usageWeeklyScoped(limit.scopeLabel);
  }
  return limit.kind;
}

/** « now », « 12min », « 4h09 », puis en jours dès 24 h (« 5d 15h », comme l'hebdo de la barre d'état). */
export function formatReset(resetsAt: number, now: number, locale: Locale): string {
  const diff = resetsAt - now;
  if (diff <= 0) {
    return 'now';
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    return STRINGS[locale].statusDays(Math.floor(hours / 24), String(hours % 24).padStart(2, '0'));
  }
  return `${hours}h${String(minutes % 60).padStart(2, '0')}`;
}

function renderGauge(limit: UsageLimit, options: { now: number; locale: Locale }): string {
  const strings = STRINGS[options.locale];
  const reset = limit.resetsAt === undefined ? '' : strings.usageResets(formatReset(limit.resetsAt, options.now, options.locale));
  return [
    `<div class="gauge" data-key="usage:${escapeHtml(limit.kind)}:${escapeHtml(limit.scopeLabel ?? '')}">`,
    '<div class="gauge-header">',
    `<span class="gauge-label">${escapeHtml(labelOf(limit, options.locale))}</span>`,
    `<span class="gauge-reset">${escapeHtml(reset)}</span>`,
    '</div>',
    '<div class="gauge-row">',
    renderTrack(limit),
    `<span class="gauge-value">${limit.percent}%</span>`,
    '</div>',
    '</div>',
  ].join('');
}

/** La barre seule : fond grisé, remplissage à la hauteur du pourcentage, couleur de la limite. */
function renderTrack(limit: UsageLimit): string {
  return [
    '<svg class="gauge-track" viewBox="0 0 100 6" preserveAspectRatio="none">',
    '<rect class="gauge-bg" x="0" y="0" width="100" height="6" rx="3"/>',
    `<rect x="0" y="0" width="${limit.percent}" height="6" rx="3" fill="${colorOf(limit)}"/>`,
    '</svg>',
  ].join('');
}

/** Âge du fichier : discret tant qu'il est frais, alerté quand l'outil a visiblement cessé d'écrire. */
function renderAge(updatedAt: number, options: { now: number; locale: Locale }): string {
  const strings = STRINGS[options.locale];
  const age = Math.max(0, options.now - updatedAt);
  const duration = formatDuration(age);
  const stale = age >= STALE_AFTER_MS;
  const text = stale ? strings.usageStale(duration) : strings.usageUpdated(duration);
  return `<span class="usage-age${stale ? ' stale' : ''}">${escapeHtml(text)}</span>`;
}

/** Dépôt de l'outil qui écrit le fichier d'usage pour l'extension. */
export const USAGE_TOOL_URL = 'https://github.com/PandaProgParis/ClaudeUsage';

/** Réglage ouvert par le picto ⚙ et par le lien de la card d'aide. */
const USAGE_SETTING = 'claudeAgents.usageFile';

type Strings = (typeof STRINGS)[Locale];

export interface UsageViewOptions {
  now: number;
  locale: Locale;
  /** Chemin configuré, montré dans la card d'aide. */
  file?: string;
  /** Card réduite à sa ligne d'en-tête (état tenu par la webview). */
  collapsed?: boolean;
}

/** Bouton picto sans bordure ; `extra` = attributs supplémentaires, déjà échappés. */
function button(className: string, title: string, glyph: string, extra = ''): string {
  const label = escapeHtml(title);
  return `<button class="usage-btn ${className}" type="button" title="${label}"${extra} aria-label="${label}">${glyph}</button>`;
}

/**
 * Flèche du bouton réduire/déplier : un triangle SVG plutôt qu'un glyphe ▾/▸, dont l'encre ne remplit
 * qu'une demi-boîte et reste minuscule quelle que soit la taille de police. Pointe vers le bas ; le CSS
 * la retourne vers le haut quand la card, ancrée en bas de la vue, est réduite.
 */
const ARROW = '<svg class="usage-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3 L5 7.5 L8.5 3 Z"/></svg>';

/** Picto du menu d'affichage : une fenêtre et sa barre d'état pleine en bas. */
const DISPLAY_ICON =
  '<svg class="usage-display-icon" viewBox="0 0 16 16" aria-hidden="true">' +
  '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
  '<rect x="1.5" y="10.5" width="13" height="3" rx="0.8" fill="currentColor"/></svg>';

/** Réduire/déplier, menu d'affichage (barre d'état, card) puis réglages, à droite de l'en-tête de la card de jauges. */
function renderActions(collapsed: boolean, strings: Strings): string {
  return [
    '<span class="usage-actions">',
    button('usage-collapse', collapsed ? strings.usageExpand : strings.usageCollapse, ARROW),
    button('usage-display', strings.statusMenu, DISPLAY_ICON),
    button('usage-settings-btn', strings.usageSettings, '⚙', ` data-setting="${USAGE_SETTING}"`),
    '</span>',
  ].join('');
}

/** Seules limites montrées en card réduite ; celles par modèle attendent le dépliage. */
const COMPACT_SHORT_LABELS: Record<string, (strings: Strings) => string> = {
  session: (strings) => strings.usageSessionShort,
  weekly_all: (strings) => strings.usageWeeklyAllShort,
};

/**
 * Card réduite : les jauges 5h et hebdo côte à côte sur la ligne d'en-tête (libellé court, barre, pourcentage),
 * libellé complet et reset en infobulle, l'alerte de fraîcheur conservée.
 */
function renderCompact(snapshot: UsageSnapshot, options: UsageViewOptions): string {
  const strings = STRINGS[options.locale];
  const gauges = snapshot.limits.flatMap((limit) => {
    const shortLabel = COMPACT_SHORT_LABELS[limit.kind];
    if (shortLabel === undefined) {
      return [];
    }
    const reset = limit.resetsAt === undefined ? '' : ` · ${strings.usageResets(formatReset(limit.resetsAt, options.now, options.locale))}`;
    return [
      `<span class="gauge-compact" data-key="usage:${escapeHtml(limit.kind)}:" title="${escapeHtml(labelOf(limit, options.locale) + reset)}">`,
      `<span class="gauge-short">${escapeHtml(shortLabel(strings))}</span>`,
      renderTrack(limit),
      `<span class="gauge-value">${limit.percent}%</span>`,
      '</span>',
    ].join('');
  });
  const age = Math.max(0, options.now - snapshot.updatedAt);
  const stale =
    age >= STALE_AFTER_MS
      ? `<span class="usage-age stale" title="${escapeHtml(strings.usageStale(formatDuration(age)))}">⚠</span>`
      : '';
  return `<span class="usage-compact">${gauges.join('')}${stale}</span>`;
}

/**
 * Rend la card d'usage (dépliée ou réduite à une ligne), ou — sans données lisibles — une card pointillée
 * qui dit quoi faire plutôt que de disparaître en silence : réglage à renseigner, outil qui écrit le fichier.
 */
export function renderUsage(snapshot: UsageSnapshot | undefined, options: UsageViewOptions): string {
  const strings = STRINGS[options.locale];
  const title = `<span class="usage-title">${escapeHtml(strings.usageTitle)}</span>`;
  if (snapshot === undefined) {
    const target =
      options.file !== undefined && options.file.trim() !== ''
        ? `<code class="usage-path">${escapeHtml(options.file)}</code>`
        : `<span class="usage-path usage-settings" role="button" data-setting="${USAGE_SETTING}">${escapeHtml(strings.usageHelpPath)}</span>`;
    return [
      '<section class="usage usage-help">',
      `<button class="usage-close" type="button" title="${escapeHtml(strings.usageDismiss)}" aria-label="${escapeHtml(strings.usageDismiss)}">×</button>`,
      `<div class="usage-head">${title}</div>`,
      `<p class="usage-hint">${escapeHtml(strings.usageHelp)}</p>`,
      target,
      `<a class="usage-repo" href="${USAGE_TOOL_URL}" title="${USAGE_TOOL_URL}">${escapeHtml(strings.usageRepo)}</a>`,
      '</section>',
    ].join('');
  }
  const collapsed = options.collapsed === true;
  // Réduite, la ligne appartient aux jauges : le titre s'efface pour leur laisser la largeur.
  const head = collapsed ? renderCompact(snapshot, options) : title + renderAge(snapshot.updatedAt, options);
  return [
    `<section class="usage${collapsed ? ' collapsed' : ''}">`,
    `<div class="usage-head">${head}${renderActions(collapsed, strings)}</div>`,
    collapsed ? '' : snapshot.limits.map((limit) => renderGauge(limit, options)).join(''),
    '</section>',
  ].join('');
}
