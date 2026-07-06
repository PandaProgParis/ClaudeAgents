import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

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

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
} else {
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}
