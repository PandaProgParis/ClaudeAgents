import { formatDuration } from './format';
import { STRINGS, type Locale } from './i18n';
import type { UsageLimit, UsageSnapshot } from './types';
import { STALE_AFTER_MS, formatReset, labelOf } from './webview/usageView';

/**
 * Usage dans la barre d'état, sans dépendance à VS Code : textes des éléments, niveaux d'alerte et infobulle.
 * Session et hebdo sont deux éléments distincts, pour que l'alerte ne colore que la limite concernée.
 */

export type StatusFormat = 'text' | 'rings' | 'off';
export type StatusLevel = 'normal' | 'warning' | 'critical';
export type StatusKey = 'session' | 'weekly';

export interface StatusItemModel {
  key: StatusKey;
  text: string;
  level: StatusLevel;
}

/** Préfixe des icônes contribuées par la police `media/usage-rings.woff` (crans 0 à 8). */
export const RING_ICON_PREFIX = 'claude-agents-ring-';
export const RING_STEPS = 8;

const WARNING_PERCENT = 80;
const CRITICAL_PERCENT = 95;

/** Limites montrées dans la barre d'état ; celles par modèle restent dans l'infobulle. */
const STATUS_KINDS: Array<{ key: StatusKey; kind: string }> = [
  { key: 'session', kind: 'session' },
  { key: 'weekly', kind: 'weekly_all' },
];

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Temps restant avant la reprise : `h:mm:ss`, puis `mm:ss` sous une heure. Avec `withDays` (hebdo),
 * `3j 04h` tant qu'il reste au moins un jour. Arrondi à la seconde supérieure ; rien une fois la reprise passée.
 */
export function formatCountdown(remainingMs: number, withDays: boolean, locale: Locale): string | undefined {
  if (remainingMs <= 0) {
    return undefined;
  }
  const total = Math.ceil(remainingMs / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  if (withDays && days > 0) {
    return STRINGS[locale].statusDays(days, pad(hours));
  }
  const allHours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return allHours > 0 ? `${allHours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Cran d'anneau (0 à 8) : vide seulement à 0 %, plein seulement à 100 %. */
export function ringStep(percent: number): number {
  if (percent <= 0) {
    return 0;
  }
  if (percent >= 100) {
    return RING_STEPS;
  }
  return Math.min(RING_STEPS - 1, Math.max(1, Math.round((percent / 100) * RING_STEPS)));
}

/** Le plus haut des deux : seuils 80 / 95 % et sévérité écrite par claude.ai. */
export function levelOf(limit: UsageLimit): StatusLevel {
  if (limit.severity === 'critical' || limit.percent >= CRITICAL_PERCENT) {
    return 'critical';
  }
  if (limit.severity === 'warning' || limit.percent >= WARNING_PERCENT) {
    return 'warning';
  }
  return 'normal';
}

export function statusItems(
  snapshot: UsageSnapshot,
  options: { now: number; locale: Locale; format: StatusFormat },
): StatusItemModel[] {
  if (options.format === 'off') {
    return [];
  }
  const strings = STRINGS[options.locale];
  const items = STATUS_KINDS.flatMap(({ key, kind }): StatusItemModel[] => {
    const limit = snapshot.limits.find((candidate) => candidate.kind === kind);
    if (limit === undefined) {
      return [];
    }
    let text: string;
    if (options.format === 'rings') {
      text = `$(${RING_ICON_PREFIX}${ringStep(limit.percent)})`;
    } else {
      const label = key === 'session' ? strings.statusSession : strings.statusWeekly;
      const countdown =
        limit.resetsAt === undefined ? undefined : formatCountdown(limit.resetsAt - options.now, key === 'weekly', options.locale);
      text = [label, `${limit.percent}%`, countdown].filter((part) => part !== undefined).join(' ');
    }
    return [{ key, text, level: levelOf(limit) }];
  });
  if (items.length > 0 && options.now - snapshot.updatedAt >= STALE_AFTER_MS) {
    items[0] = { ...items[0], text: `$(warning) ${items[0].text}` };
  }
  return items;
}

/** Infobulle Markdown : toutes les limites, leur reprise, puis la fraîcheur du fichier. */
export function statusTooltip(snapshot: UsageSnapshot, options: { now: number; locale: Locale }): string {
  const strings = STRINGS[options.locale];
  const rows = snapshot.limits.map((limit) => {
    const reset = limit.resetsAt === undefined ? '' : strings.usageResets(formatReset(limit.resetsAt, options.now, options.locale));
    return `| ${labelOf(limit, options.locale)} | ${limit.percent}% | ${reset} |`;
  });
  const age = Math.max(0, options.now - snapshot.updatedAt);
  const freshness =
    age >= STALE_AFTER_MS ? strings.usageStale(formatDuration(age)) : strings.usageUpdated(formatDuration(age));
  return [`**${strings.statusTitle}**`, '', '| | | |', '|:--|--:|--:|', ...rows, '', freshness].join('\n');
}
