import * as net from 'net';

/**
 * Sonde les adresses locales écrites par les commandes de fond : une connexion TCP dit si le serveur
 * répond encore. C'est une mesure, pas une déduction — un port qui n'écoute plus refuse la connexion
 * immédiatement. Le scan reste synchrone et lit ce cache ; le sondage tourne à côté (probeUrls).
 */

/** Au-delà, on resonde : un serveur peut mourir entre deux scans. */
const TTL_MS = 10_000;
/** Sur la boucle locale, un port ouvert répond en une poignée de millisecondes ; au-delà on le tient pour mort. */
const TIMEOUT_MS = 300;

interface Probe {
  alive: boolean;
  checkedAt: number;
}

const probes = new Map<number, Probe>();

/** Port de l'URL, avec le repli du schéma quand il est implicite. */
export function portOf(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.port !== '') {
    return Number(parsed.port);
  }
  return parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : undefined;
}

/**
 * Vivacité connue de l'URL : `undefined` tant qu'elle n'a jamais été sondée.
 * L'affichage garde alors le lien — on ne masque que sur une preuve de mort, jamais sur une ignorance.
 */
export function isUrlAlive(url: string): boolean | undefined {
  const port = portOf(url);
  return port === undefined ? undefined : probes.get(port)?.alive;
}

/** Une connexion TCP qui s'ouvre = le serveur est là ; refus, timeout ou erreur = il n'est plus là. */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const settle = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
    socket.connect(port, '127.0.0.1');
  });
}

/** Sonde en parallèle les ports des URL données, en sautant ceux dont le résultat est encore frais. */
export async function probeUrls(urls: string[], options: { now?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  const ports = new Set<number>();
  for (const url of urls) {
    const port = portOf(url);
    if (port === undefined) {
      continue;
    }
    const known = probes.get(port);
    if (known === undefined || now - known.checkedAt >= TTL_MS) {
      ports.add(port);
    }
  }
  await Promise.all(
    [...ports].map(async (port) => {
      const alive = await probePort(port);
      probes.set(port, { alive, checkedAt: now });
    }),
  );
}

/** Vide le cache (tests). */
export function resetProbes(): void {
  probes.clear();
}
