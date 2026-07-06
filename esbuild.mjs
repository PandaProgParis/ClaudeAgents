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
const stopServer = () => {
  server?.kill();
  server = undefined;
};
const restartServer = () => {
  stopServer();
  server = spawn(process.execPath, ['dist/dev-server.js'], { stdio: 'inherit', env: process.env });
};
process.on('exit', stopServer);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopServer();
    process.exit(0);
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
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                restartServer();
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
