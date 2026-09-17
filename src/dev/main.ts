import * as os from 'os';
import * as path from 'path';
import { RatingRefresher, fetchMarketplaceRating, type StoredRating } from '../marketplace';
import { createDevServer } from './server';

// Point d'entrée de `npm run dev` (bundlé par esbuild dans dist/dev-server.js, relancé à chaque rebuild).
const port = Number(process.env.PORT ?? 5173);
// Vraie note du Marketplace, gardée en mémoire le temps que le serveur tourne.
let storedRating: StoredRating | undefined;
const rating = new RatingRefresher({
  fetch: fetchMarketplaceRating,
  now: Date.now,
  load: () => storedRating,
  save: (value) => {
    storedRating = value;
  },
});
const options = {
  claudeDir: path.join(os.homedir(), '.claude'),
  root: path.resolve(__dirname, '..'),
  log: (message: string) => console.log(message),
  rating: () => {
    rating.maybeRefresh();
    return rating.current;
  },
};

// « localhost » résout d'abord en ::1 sous Windows : on écoute les deux boucles locales, IPv6 en option.
const ipv4 = createDevServer(options);
ipv4.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Aperçu live : impossible d'écouter sur le port ${port} (${error.code ?? error.message})`);
  process.exit(1);
});
ipv4.listen(port, '127.0.0.1', () => {
  console.log(`Claude Agents — aperçu live sur http://localhost:${port}/  (Ctrl+C pour arrêter)`);
});
const ipv6 = createDevServer(options);
ipv6.on('error', () => undefined);
ipv6.listen(port, '::1');
