import { STRINGS, type Locale } from './i18n';

export function formatDuration(deltaMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatRelativeTime(deltaMs: number, locale: Locale = 'fr'): string {
  return STRINGS[locale].relative(formatDuration(deltaMs));
}

/** Familles de modèles Claude connues (badge coloré + libellé court). Tout autre id est affiché tel quel. */
const MODEL_FAMILY_PATTERN = /^claude-(fable|mythos|opus|sonnet|haiku)(?=-|$)/;

/** Famille d'un id de modèle Claude (« opus », « fable »…), ou undefined s'il n'est pas dans la liste connue. */
export function modelFamily(model: string): string | undefined {
  return MODEL_FAMILY_PATTERN.exec(model)?.[1];
}

/** Libellé court d'un modèle : sa famille si elle est connue, sinon l'id tel quel. */
export function abbreviateModel(model: string): string {
  return modelFamily(model) ?? model;
}

export function formatTokens(tokens: number, locale: Locale = 'fr'): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  const millions = (tokens / 1_000_000).toFixed(1).replace('.0', '');
  return `${locale === 'fr' ? millions.replace('.', ',') : millions}M`;
}

/** Fenêtres de contexte validées via la référence API Claude (2026-09). Inconnu → undefined (repli valeur brute). */
const MODEL_CONTEXT_LIMITS: Array<{ pattern: RegExp; limit: number }> = [
  { pattern: /^claude-(fable|mythos)-5/, limit: 1_000_000 },
  { pattern: /^claude-opus-(5|4-(6|7|8))/, limit: 1_000_000 },
  { pattern: /^claude-sonnet-(5|4-6)/, limit: 1_000_000 },
  { pattern: /^claude-haiku-4-5/, limit: 200_000 },
];

export function contextLimitFor(model: string): number | undefined {
  return MODEL_CONTEXT_LIMITS.find(({ pattern }) => pattern.test(model))?.limit;
}
