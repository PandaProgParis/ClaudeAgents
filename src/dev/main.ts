import * as os from 'os';
import * as path from 'path';
import { createDevServer } from './server';

// Point d'entrée de `npm run dev` (bundlé par esbuild dans dist/dev-server.js, relancé à chaque rebuild).
const port = Number(process.env.PORT ?? 5173);
const options = {
  claudeDir: path.join(os.homedir(), '.claude'),
  root: path.resolve(__dirname, '..'),
  log: (message: string) => console.log(message),
};

// « localhost » résout d'abord en ::1 sous Windows : on écoute les deux boucles locales, IPv6 en option.
createDevServer(options).listen(port, '127.0.0.1', () => {
  console.log(`Claude Agents — aperçu live sur http://localhost:${port}/  (Ctrl+C pour arrêter)`);
});
const ipv6 = createDevServer(options);
ipv6.on('error', () => undefined);
ipv6.listen(port, '::1');
