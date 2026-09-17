import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { REVIEWS_URL, RatingRefresher, fetchRating, getText, type StoredRating } from './marketplace';

/** Page de l'API des avis telle que le Marketplace la renvoie (champs utiles seulement). */
function page(reviews: Array<{ id: number; rating: number; date: string; deleted?: boolean }>, hasMore: boolean): string {
  return JSON.stringify({
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      updatedDate: review.date,
      isDeleted: review.deleted ?? false,
    })),
    totalReviewCount: reviews.length,
    hasMoreReviews: hasMore,
  });
}

describe('fetchRating', () => {
  it('fait la moyenne des notes lues et les compte', async () => {
    const rating = await fetchRating(async () =>
      page(
        [
          { id: 3, rating: 5, date: '2026-09-16T20:18:20.093Z' },
          { id: 2, rating: 4, date: '2026-09-16T16:35:41.557Z' },
          { id: 1, rating: 3, date: '2026-09-16T13:07:17.673Z' },
        ],
        false,
      ),
    );
    expect(rating).toEqual({ average: 4, count: 3 });
  });

  it('demande la première page puis les suivantes avant la date du plus ancien avis lu', async () => {
    const urls: string[] = [];
    const rating = await fetchRating(async (url) => {
      urls.push(url);
      return urls.length === 1
        ? page([{ id: 2, rating: 5, date: '2026-09-16T16:35:41.557Z' }], true)
        : page([{ id: 1, rating: 2, date: '2026-09-16T13:07:17.673Z' }], false);
    });
    expect(urls).toEqual([
      `${REVIEWS_URL}?count=100`,
      `${REVIEWS_URL}?count=100&beforeDate=${encodeURIComponent('2026-09-16T16:35:41.557Z')}`,
    ]);
    expect(rating).toEqual({ average: 3.5, count: 2 });
  });

  it('ignore les avis supprimés et ne compte pas deux fois un avis revu d’une page à l’autre', async () => {
    let calls = 0;
    const rating = await fetchRating(async () => {
      calls++;
      return calls === 1
        ? page(
            [
              { id: 3, rating: 1, date: '2026-09-16T20:00:00.000Z', deleted: true },
              { id: 2, rating: 5, date: '2026-09-16T16:00:00.000Z' },
            ],
            true,
          )
        : page(
            [
              { id: 2, rating: 5, date: '2026-09-16T16:00:00.000Z' },
              { id: 1, rating: 4, date: '2026-09-16T13:00:00.000Z' },
            ],
            false,
          );
    });
    expect(rating).toEqual({ average: 4.5, count: 2 });
  });

  it('rend zéro avis quand l’extension n’en a pas encore', async () => {
    expect(await fetchRating(async () => page([], false))).toEqual({ average: 0, count: 0 });
  });

  it('ne rend rien si une page échoue à chaque essai ou ne se lit pas : pas de note partielle', async () => {
    let calls = 0;
    const failing = async (): Promise<string> => {
      calls++;
      if (calls === 1) {
        return page([{ id: 2, rating: 5, date: '2026-09-16T16:00:00.000Z' }], true);
      }
      throw new Error('réseau coupé');
    };
    expect(await fetchRating(failing, { delayMs: 0 })).toBeUndefined();
    expect(await fetchRating(async () => '<html>maintenance</html>', { delayMs: 0 })).toBeUndefined();
    expect(await fetchRating(async () => JSON.stringify({ reviews: 'x' }), { delayMs: 0 })).toBeUndefined();
  });

  // Le Marketplace coupe des connexions au hasard (ECONNRESET dès la poignée de main, 4 appels sur 8 le 2026-09-17).
  it('réessaie une page dont la connexion est coupée', async () => {
    let calls = 0;
    const flaky = async (): Promise<string> => {
      calls++;
      if (calls < 3) {
        throw new Error('read ECONNRESET');
      }
      return page([{ id: 1, rating: 4, date: '2026-09-16T13:00:00.000Z' }], false);
    };
    expect(await fetchRating(flaky, { delayMs: 0 })).toEqual({ average: 4, count: 1 });
    expect(calls).toBe(3);
  });

  it('abandonne une page après le nombre d’essais prévu', async () => {
    let calls = 0;
    const down = async (): Promise<string> => {
      calls++;
      throw new Error('read ECONNRESET');
    };
    expect(await fetchRating(down, { attempts: 4, delayMs: 0 })).toBeUndefined();
    expect(calls).toBe(4);
  });

  it('abandonne au-delà du nombre de pages prévu plutôt que de boucler', async () => {
    let calls = 0;
    const endless = async (): Promise<string> => {
      calls++;
      return page([{ id: calls, rating: 5, date: new Date(Date.UTC(2026, 8, 16) - calls * 1000).toISOString() }], true);
    };
    expect(await fetchRating(endless, { maxPages: 3, delayMs: 0 })).toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe('getText', () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('rend le corps d’une réponse 200 et envoie les en-têtes demandés', async () => {
    let accept: string | undefined;
    const base = await serve((req, res) => {
      accept = req.headers.accept;
      res.end('{"ok":true}');
    });
    expect(await getText(`${base}/x`, { headers: { Accept: 'application/json' } })).toBe('{"ok":true}');
    expect(accept).toBe('application/json');
  });

  it('échoue sur un statut d’erreur', async () => {
    const base = await serve((_req, res) => {
      res.statusCode = 404;
      res.end('nope');
    });
    await expect(getText(`${base}/x`)).rejects.toThrow('404');
  });

  it('échoue quand le serveur ne répond pas à temps', async () => {
    const base = await serve(() => undefined);
    await expect(getText(`${base}/x`, { timeoutMs: 50 })).rejects.toThrow();
  });
});

describe('RatingRefresher', () => {
  const HOUR = 3_600_000;

  function setup(stored?: StoredRating) {
    let now = 10 * HOUR;
    let saved = stored;
    const pending: Array<(rating: { average: number; count: number } | undefined) => void> = [];
    const refresher = new RatingRefresher({
      fetch: () => new Promise((resolve) => pending.push(resolve)),
      now: () => now,
      load: () => saved,
      save: (value) => {
        saved = value;
      },
    });
    return {
      refresher,
      pending,
      saved: () => saved,
      advance: (ms: number) => {
        now += ms;
      },
      now: () => now,
    };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('rend la note mémorisée dès le départ, sans attendre le réseau', () => {
    const { refresher } = setup({ average: 5, count: 3, fetchedAt: 9 * HOUR });
    expect(refresher.current).toEqual({ average: 5, count: 3 });
  });

  it('interroge le Marketplace quand rien n’est mémorisé, puis garde et mémorise la note lue', async () => {
    const { refresher, pending, saved, now } = setup();
    refresher.maybeRefresh();
    expect(pending).toHaveLength(1);
    pending[0]({ average: 4.5, count: 2 });
    await flush();
    expect(refresher.current).toEqual({ average: 4.5, count: 2 });
    expect(saved()).toEqual({ average: 4.5, count: 2, fetchedAt: now() });
  });

  it('ne relance pas de requête tant que la note a moins de 6 h, ni pendant qu’une requête tourne', async () => {
    const { refresher, pending, advance } = setup({ average: 5, count: 3, fetchedAt: 10 * HOUR });
    refresher.maybeRefresh();
    expect(pending).toHaveLength(0);
    advance(6 * HOUR);
    refresher.maybeRefresh();
    refresher.maybeRefresh();
    expect(pending).toHaveLength(1);
  });

  it('après un échec, garde l’ancienne note et attend 30 min avant de réessayer', async () => {
    const { refresher, pending, advance } = setup({ average: 5, count: 3, fetchedAt: 0 });
    refresher.maybeRefresh();
    pending[0](undefined);
    await flush();
    expect(refresher.current).toEqual({ average: 5, count: 3 });
    advance(29 * 60_000);
    refresher.maybeRefresh();
    expect(pending).toHaveLength(1);
    advance(60_000);
    refresher.maybeRefresh();
    expect(pending).toHaveLength(2);
  });
});
