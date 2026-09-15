import * as fs from 'fs';
import type { UsageLimit, UsageSnapshot } from './types';

/**
 * Limites du forfait, lues dans un fichier tenu à jour par un outil tiers (le contenu de claude.ai/usage).
 * Rien n'est deviné : seules les entrées de `limits[]` réellement exploitables sont gardées, et la date
 * de dernière écriture du fichier est remontée telle quelle pour que la vue puisse signaler un fichier vieilli.
 */

const SEVERITIES = new Set(['normal', 'warning', 'critical']);

interface Cached {
  mtimeMs: number;
  value: UsageSnapshot | undefined;
}

const cache = new Map<string, Cached>();

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Une entrée de `limits[]` : sans pourcentage numérique, elle ne dit rien et on la laisse tomber. */
function toLimit(raw: unknown): UsageLimit | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const entry = raw as Record<string, unknown>;
  const kind = asText(entry.kind);
  const percent = typeof entry.percent === 'number' && Number.isFinite(entry.percent) ? entry.percent : undefined;
  if (kind === undefined || percent === undefined) {
    return undefined;
  }
  const severity = asText(entry.severity);
  const scope = entry.scope as { model?: { display_name?: unknown }; surface?: unknown } | null | undefined;
  const scopeLabel = asText(scope?.model?.display_name) ?? asText(scope?.surface);
  const resets = asText(entry.resets_at);
  const resetsAt = resets === undefined ? undefined : Date.parse(resets);
  const limit: UsageLimit = {
    kind,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    severity: severity !== undefined && SEVERITIES.has(severity) ? (severity as UsageLimit['severity']) : 'normal',
  };
  if (scopeLabel !== undefined) {
    limit.scopeLabel = scopeLabel;
  }
  if (resetsAt !== undefined && Number.isFinite(resetsAt)) {
    limit.resetsAt = resetsAt;
  }
  return limit;
}

function parse(text: string, updatedAt: number): UsageSnapshot | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const raw = (payload as { limits?: unknown }).limits;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const limits = raw.map(toLimit).filter((limit): limit is UsageLimit => limit !== undefined);
  if (limits.length === 0) {
    return undefined;
  }
  return { limits, updatedAt };
}

/** Lit le fichier d'usage, en ne le reparsant qu'à chaque nouvelle écriture (cache par mtime). */
export function readUsage(filePath: string): UsageSnapshot | undefined {
  if (filePath.trim() === '') {
    return undefined;
  }
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    cache.delete(filePath);
    return undefined;
  }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value;
  }
  let value: UsageSnapshot | undefined;
  try {
    value = parse(fs.readFileSync(filePath, 'utf8'), mtimeMs);
  } catch {
    value = undefined;
  }
  cache.set(filePath, { mtimeMs, value });
  return value;
}

/** Vide le cache (tests). */
export function resetUsageCache(): void {
  cache.clear();
}
