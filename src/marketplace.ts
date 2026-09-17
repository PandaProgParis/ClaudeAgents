import * as http from 'http';
import * as https from 'https';

/**
 * Note de l'extension sur le Marketplace, affichée dans l'encart de notation. Lue dans l'API publique des avis
 * (sans clé), pas dans les statistiques de l'extensionquery : leurs répliques ne sont pas synchronisées et
 * rendent 0, 1, 2 ou 3 avis d'un appel à l'autre, alors que la liste des avis reste constante.
 */

export const REVIEWS_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/pandaprog/extensions/claude-agents/reviews';

/** Taille maximale d'une page de l'API des avis. */
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;
/**
 * Le Marketplace coupe des connexions au hasard (ECONNRESET dès la poignée de main : 4 appels sur 8 le 2026-09-17) :
 * chaque page a droit à plusieurs essais espacés.
 */
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Une note lue reste valable 6 h ; après un échec, on réessaie au bout de 30 min. */
const REFRESH_MS = 6 * 3_600_000;
const RETRY_MS = 30 * 60_000;

export interface FetchRatingOptions {
  maxPages?: number;
  /** Essais par page, le premier compris. */
  attempts?: number;
  delayMs?: number;
}

export interface MarketplaceRating {
  /** Moyenne des notes des avis (0 sans avis). */
  average: number;
  count: number;
}

export interface StoredRating extends MarketplaceRating {
  fetchedAt: number;
}

interface ReviewsPage {
  reviews: Array<{ id: unknown; rating: unknown; updatedDate: unknown; isDeleted?: unknown }>;
  hasMoreReviews: boolean;
}

function parsePage(body: string): ReviewsPage | undefined {
  try {
    const json = JSON.parse(body) as Partial<ReviewsPage>;
    return Array.isArray(json.reviews) ? { reviews: json.reviews, hasMoreReviews: json.hasMoreReviews === true } : undefined;
  } catch {
    return undefined;
  }
}

/** Corps de la page, après autant d'essais que prévu ; undefined si tous ont échoué. */
async function getWithRetries(
  get: (url: string) => Promise<string>,
  url: string,
  attempts: number,
  delayMs: number,
): Promise<string | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await get(url);
    } catch {
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return undefined;
}

/**
 * Lit tous les avis, page par page (la suivante commence avant la date du plus ancien avis lu), et en fait
 * la moyenne. Une page en échec à chaque essai ou illisible, ou trop de pages : rien plutôt qu'une note partielle.
 */
export async function fetchRating(
  get: (url: string) => Promise<string>,
  options: FetchRatingOptions = {},
): Promise<MarketplaceRating | undefined> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_RETRY_DELAY_MS;
  const ratings = new Map<unknown, number>();
  let url = `${REVIEWS_URL}?count=${PAGE_SIZE}`;
  for (let pages = 0; pages < maxPages; pages++) {
    const body = await getWithRetries(get, url, attempts, delayMs);
    if (body === undefined) {
      return undefined;
    }
    const current = parsePage(body);
    if (current === undefined) {
      return undefined;
    }
    let oldest: string | undefined;
    for (const review of current.reviews) {
      if (typeof review.updatedDate === 'string' && (oldest === undefined || review.updatedDate < oldest)) {
        oldest = review.updatedDate;
      }
      if (review.isDeleted !== true && typeof review.rating === 'number' && review.rating >= 1 && review.rating <= 5) {
        ratings.set(review.id, review.rating);
      }
    }
    if (!current.hasMoreReviews) {
      const values = [...ratings.values()];
      const sum = values.reduce((total, rating) => total + rating, 0);
      return { average: values.length === 0 ? 0 : sum / values.length, count: values.length };
    }
    if (oldest === undefined) {
      return undefined;
    }
    url = `${REVIEWS_URL}?count=${PAGE_SIZE}&beforeDate=${encodeURIComponent(oldest)}`;
  }
  return undefined;
}

/** GET texte, en http ou https ; un statut hors 2xx ou un délai dépassé rejettent la promesse. */
export function getText(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: options.headers }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    request.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

/** Note de pandaprog.claude-agents, lue sur le vrai Marketplace. */
export function fetchMarketplaceRating(): Promise<MarketplaceRating | undefined> {
  return fetchRating((url) =>
    getText(url, { headers: { Accept: 'application/json;api-version=7.1-preview.1', 'User-Agent': 'claude-agents-vscode' } }),
  );
}

export interface RatingRefresherDeps {
  fetch: () => Promise<MarketplaceRating | undefined>;
  now: () => number;
  load: () => StoredRating | undefined;
  save: (rating: StoredRating) => void;
}

/**
 * Tient la note à jour sans marteler le Marketplace : une requête à la fois, au plus toutes les 6 h, 30 min
 * après un échec. La dernière note lue est mémorisée (globalState) et resservie telle quelle hors ligne.
 */
export class RatingRefresher {
  private stored: StoredRating | undefined;
  private inFlight = false;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: RatingRefresherDeps) {
    this.stored = deps.load();
  }

  get current(): MarketplaceRating | undefined {
    return this.stored === undefined ? undefined : { average: this.stored.average, count: this.stored.count };
  }

  maybeRefresh(): void {
    const now = this.deps.now();
    const fresh = this.stored !== undefined && now - this.stored.fetchedAt < REFRESH_MS;
    if (this.inFlight || fresh || now - this.lastAttemptAt < RETRY_MS) {
      return;
    }
    this.inFlight = true;
    this.lastAttemptAt = now;
    void this.deps
      .fetch()
      .catch(() => undefined)
      .then((rating) => {
        this.inFlight = false;
        if (rating !== undefined) {
          this.stored = { ...rating, fetchedAt: this.deps.now() };
          this.deps.save(this.stored);
        }
      });
  }
}
