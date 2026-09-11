import { spawn } from 'node:child_process';
import esbuild from 'esbuild';

// --watch : rebuild continu ; --dev : idem + serveur d'aperçu local (dist/dev-server.js) relancé à chaque rebuild.
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch') || dev;

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
});

const webviewCtx = await esbuild.context({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
});

let server;
// L'arrêt est asynchrone et le port reste tenu un instant : on attend la sortie du processus avant d'en relancer un,
// sinon le nouveau serveur meurt sur EADDRINUSE et l'aperçu ne répond plus jusqu'au rebuild suivant.
const stopServer = () =>
  new Promise((resolve) => {
    const running = server;
    server = undefined;
    if (!running || running.exitCode !== null) {
      resolve();
      return;
    }
    running.once('exit', () => resolve());
    running.kill();
  });
const restartServer = async () => {
  await stopServer();
  server = spawn(process.execPath, ['dist/dev-server.js'], { stdio: 'inherit', env: process.env });
};
process.on('exit', () => server?.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stopServer().then(() => process.exit(0));
  });
}

const devCtx = dev
  ? await esbuild.context({
      entryPoints: ['src/dev/main.ts'],
      bundle: true,
      outfile: 'dist/dev-server.js',
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      sourcemap: true,
      plugins: [
        {
          name: 'restart-dev-server',
          setup(build) {
            build.onEnd(async (result) => {
              if (result.errors.length === 0) {
                await restartServer();
              }
            });
          },
        },
      ],
    })
  : undefined;

const contexts = [extensionCtx, webviewCtx, ...(devCtx ? [devCtx] : [])];
if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
