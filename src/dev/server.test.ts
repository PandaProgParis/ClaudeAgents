import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import { createDevServer, devPageHtml, parseStateQuery } from './server';
import { clearScannerCaches } from '../scanner';
import {
  NOW,
  assistantLine,
  cleanupClaudeDirs,
  makeClaudeDir,
  writeRegistry,
  writeTranscript,
} from '../__tests__/helpers';

describe('parseStateQuery', () => {
  it('reprend les valeurs par défaut de l’extension sans paramètre', () => {
    expect(parseStateQuery(new URLSearchParams(''))).toEqual({
      settings: { mode: 'temporarily', retentionSeconds: 60 },
      inactiveSessionRetentionMinutes: 10,
      locale: 'fr',
      showUsage: true,
      usageFile: '',
    });
  });

  it('lit mode, rétention, masquage des sessions et locale depuis l’URL', () => {
    expect(parseStateQuery(new URLSearchParams('mode=always&retention=15&inactive=0&locale=en'))).toEqual({
      settings: { mode: 'always', retentionSeconds: 15 },
      inactiveSessionRetentionMinutes: 0,
      locale: 'en',
      showUsage: true,
      usageFile: '',
    });
  });

  it('active la card d’usage quand ?usage= porte un chemin', () => {
    const on = parseStateQuery(new URLSearchParams('usage=C:/tmp/usage.json'));
    expect(on).toMatchObject({ showUsage: true, usageFile: 'C:/tmp/usage.json' });
    expect(parseStateQuery(new URLSearchParams('usage=0'))).toMatchObject({ showUsage: false, usageFile: '' });
    expect(parseStateQuery(new URLSearchParams(''))).toMatchObject({ showUsage: true, usageFile: '' });
  });

  it('ignore les valeurs invalides', () => {
    const query = parseStateQuery(new URLSearchParams('mode=bogus&retention=-3&inactive=abc&locale=de'));
    expect(query.settings).toEqual({ mode: 'temporarily', retentionSeconds: 60 });
    expect(query.inactiveSessionRetentionMinutes).toBe(10);
    expect(query.locale).toBe('fr');
  });

  it('simule une note du Marketplace passée en ?rating=moyenne,votes ; ignore une valeur invalide', () => {
    expect(parseStateQuery(new URLSearchParams('rating=4.3,12')).rating).toEqual({ average: 4.3, count: 12 });
    expect(parseStateQuery(new URLSearchParams('rating=0,0')).rating).toEqual({ average: 0, count: 0 });
    for (const bogus of ['rating=6,3', 'rating=4.5', 'rating=abc,2', 'rating=4,-1', 'rating=4,1.5']) {
      expect(parseStateQuery(new URLSearchParams(bogus)), bogus).not.toHaveProperty('rating');
    }
  });

  it('épingle les dossiers passés en ?ws= (répétable), aucun sinon', () => {
    expect(parseStateQuery(new URLSearchParams('ws=C:/dev/alpha&ws=C:/dev/beta')).pinnedFolders).toEqual([
      'C:/dev/alpha',
      'C:/dev/beta',
    ]);
    expect(parseStateQuery(new URLSearchParams('ws=')).pinnedFolders).toBeUndefined();
    expect(parseStateQuery(new URLSearchParams(''))).not.toHaveProperty('pinnedFolders');
  });
});

describe('devPageHtml', () => {
  it('charge le vrai CSS et le vrai script de la webview, et interroge /state', () => {
    const html = devPageHtml(new URLSearchParams(''));
    expect(html).toContain('href="/media/cards.css"');
    expect(html).toContain('src="/dist/webview.js"');
    expect(html).toContain('id="root"');
    expect(html).toContain("'/state'");
    expect(html).toContain('data-theme="dark"');
  });

  it('applique le thème clair demandé dans l’URL', () => {
    expect(devPageHtml(new URLSearchParams('theme=light'))).toContain('data-theme="light"');
  });

  it('propose des liens qui changent un seul paramètre en gardant les autres', () => {
    const html = devPageHtml(new URLSearchParams('mode=always&locale=en'));
    expect(html).toContain('href="/?mode=always&amp;locale=fr"');
    expect(html).toContain('href="/?mode=never&amp;locale=en"');
    expect(html).toContain('href="/?mode=always&amp;locale=en&amp;theme=light"');
  });
});

describe('createDevServer', () => {
  beforeEach(() => clearScannerCaches());
  afterEach(() => cleanupClaudeDirs());

  it('sert la page, l’état JSON calculé sur ~/.claude et les fichiers statiques autorisés', async () => {
    const dir = makeClaudeDir();
    const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';
    writeRegistry(dir, { pid: 11, sessionId, cwd: 'c:\\dev\\alpha', startedAt: NOW - 60_000, name: 'x', kind: 'main' });
    writeTranscript(dir, 'c--dev-alpha', sessionId, [assistantLine('claude-opus-5')], 1_000);
    const server = createDevServer({ claudeDir: dir, root: process.cwd(), isPidAlive: () => true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const page = await fetch(`${base}/?theme=light`);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('data-theme="light"');

      const response = await fetch(`${base}/state?mode=never&locale=en`);
      expect(response.headers.get('content-type')).toContain('application/json');
      const state = await response.json();
      expect(state.projects.map((project: { name: string }) => project.name)).toEqual(['alpha']);
      expect(state.projects[0].sessions[0].model).toBe('claude-opus-5');
      expect(state.settings).toEqual({ mode: 'never', retentionSeconds: 60 });
      expect(state.locale).toBe('en');
      expect(typeof state.now).toBe('number');

      const css = await fetch(`${base}/media/cards.css`);
      expect(css.headers.get('content-type')).toContain('text/css');
      expect(await css.text()).toContain('.card');

      const version = await fetch(`${base}/version`);
      expect(version.status).toBe(200);
      expect((await version.text()).length).toBeGreaterThan(0);

      expect((await fetch(`${base}/package.json`)).status).toBe(404);
      expect((await fetch(`${base}/media/../package.json`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('joint à l’état la note lue sur le Marketplace, sauf si l’URL en simule une', async () => {
    const dir = makeClaudeDir();
    const server = createDevServer({
      claudeDir: dir,
      root: process.cwd(),
      isPidAlive: () => true,
      rating: () => ({ average: 5, count: 3 }),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await (await fetch(`${base}/state`)).json()).rating).toEqual({ average: 5, count: 3 });
      expect((await (await fetch(`${base}/state?rating=3.5,40`)).json()).rating).toEqual({ average: 3.5, count: 40 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
