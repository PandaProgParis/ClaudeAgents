import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { buildState } from '../state';
import type { Locale } from '../i18n';
import type { FinishedAgentSettings } from '../types';

/**
 * Aperçu local de la vue « cards » sans passer par VS Code : une page HTML charge le vrai media/cards.css
 * et le vrai dist/webview.js, puis interroge /state toutes les 2 s et rejoue le message comme le ferait
 * l'extension (window.postMessage). Les variables --vscode-* sont émulées avec les palettes Dark/Light Modern.
 */

export interface StateQuery {
  settings: FinishedAgentSettings;
  inactiveSessionRetentionMinutes: number;
  locale: Locale;
}

export interface DevServerOptions {
  /** Dossier ~/.claude à scanner. */
  claudeDir: string;
  /** Racine du dépôt : sert media/cards.css et dist/webview.js. */
  root: string;
  log?: (message: string) => void;
  isPidAlive?: (pid: number) => boolean;
}

const MODES: ReadonlySet<string> = new Set(['always', 'temporarily', 'never']);

function nonNegative(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Réglages de rendu lus dans l'URL (?mode=&retention=&inactive=&locale=), avec les défauts de l'extension. */
export function parseStateQuery(params: URLSearchParams): StateQuery {
  const mode = params.get('mode');
  return {
    settings: {
      mode: mode !== null && MODES.has(mode) ? (mode as FinishedAgentSettings['mode']) : 'temporarily',
      retentionSeconds: nonNegative(params, 'retention', 60),
    },
    inactiveSessionRetentionMinutes: nonNegative(params, 'inactive', 10),
    locale: params.get('locale') === 'en' ? 'en' : 'fr',
  };
}

type Theme = 'dark' | 'light';

/** Valeurs des thèmes Dark Modern / Light Modern de VS Code pour les variables utilisées par cards.css. */
const THEMES: Record<Theme, Record<string, string>> = {
  dark: {
    'font-family': 'system-ui, "Segoe WPF", "Segoe UI", sans-serif',
    'font-size': '13px',
    foreground: '#cccccc',
    descriptionForeground: '#9d9d9d',
    'editor-background': '#1f1f1f',
    'sideBar-background': '#181818',
    'editorWidget-background': '#202020',
    'widget-border': '#313131',
    'badge-background': '#616161',
    'badge-foreground': '#f8f8f8',
    'progressBar-background': '#0078d4',
    'tree-inactiveIndentGuidesStroke': '#585858',
    'gitDecoration-modifiedResourceForeground': '#e2c08d',
    'textLink-foreground': '#4daafc',
    'charts-blue': '#3794ff',
    'charts-green': '#89d185',
    'charts-orange': '#d18616',
    'charts-purple': '#b180d7',
    'charts-red': '#f14c4c',
    'charts-yellow': '#cca700',
  },
  light: {
    'font-family': 'system-ui, "Segoe WPF", "Segoe UI", sans-serif',
    'font-size': '13px',
    foreground: '#3b3b3b',
    descriptionForeground: '#717171',
    'editor-background': '#ffffff',
    'sideBar-background': '#f8f8f8',
    'editorWidget-background': '#f8f8f8',
    'widget-border': '#e5e5e5',
    'badge-background': '#cccccc',
    'badge-foreground': '#3b3b3b',
    'progressBar-background': '#0078d4',
    'tree-inactiveIndentGuidesStroke': '#a9a9a9',
    'gitDecoration-modifiedResourceForeground': '#895503',
    'textLink-foreground': '#005fb8',
    'charts-blue': '#3794ff',
    'charts-green': '#89d185',
    'charts-orange': '#d18616',
    'charts-purple': '#b180d7',
    'charts-red': '#f14c4c',
    'charts-yellow': '#cca700',
  },
};

function cssVariables(theme: Theme): string {
  return Object.entries(THEMES[theme])
    .map(([name, value]) => `  --vscode-${name}: ${value};`)
    .join('\n');
}

function escapeAttr(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Lien vers la même page avec un seul paramètre changé. */
function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  next.set(key, value);
  return `/?${next.toString()}`;
}

function choices(params: URLSearchParams, key: string, values: string[], current: string): string {
  return values
    .map((value) => {
      const cls = value === current ? ' class="on"' : '';
      return `<a${cls} href="${escapeAttr(withParam(params, key, value))}">${value}</a>`;
    })
    .join(' ');
}

/** Page d'aperçu : mêmes fichiers que la webview, barre de réglages en haut à droite, rechargement auto. */
export function devPageHtml(params: URLSearchParams): string {
  const theme: Theme = params.get('theme') === 'light' ? 'light' : 'dark';
  const query = parseStateQuery(params);
  const bar = [
    `<span>mode ${choices(params, 'mode', ['always', 'temporarily', 'never'], query.settings.mode)}</span>`,
    `<span>rétention ${query.settings.retentionSeconds} s · sessions ${query.inactiveSessionRetentionMinutes} min</span>`,
    `<span>${choices(params, 'locale', ['fr', 'en'], query.locale)}</span>`,
    `<span>${choices(params, 'theme', ['dark', 'light'], theme)}</span>`,
  ].join('\n');
  return `<!DOCTYPE html>
<html lang="fr" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<title>Claude Agents — aperçu</title>
<style>
:root {
${cssVariables(theme)}
}
html, body { margin: 0; }
body {
  background: var(--vscode-sideBar-background); min-height: 100vh; box-sizing: border-box;
  display: flex; align-items: flex-start;
}
/* Une colonne de la largeur d'une barre latérale, redimensionnable par sa poignée en bas à droite. */
#frame {
  flex: none; width: 360px; min-width: 220px; max-width: calc(100vw - 200px); min-height: 100vh; box-sizing: border-box;
  resize: horizontal; overflow: auto; border-right: 1px solid var(--vscode-widget-border);
}
#devbar {
  position: sticky; top: 8px; margin: 8px 16px; display: flex; flex-direction: column; gap: 4px;
  font: 12px var(--vscode-font-family); color: var(--vscode-descriptionForeground); white-space: nowrap;
}
#devbar a { color: inherit; text-decoration: none; opacity: 0.6; }
#devbar a.on { opacity: 1; font-weight: 600; text-decoration: underline; }
</style>
<link rel="stylesheet" href="/media/cards.css">
</head>
<body>
<div id="frame"><div id="root"><p class="empty">…</p></div></div>
<nav id="devbar">
${bar}
</nav>
<script src="/dist/webview.js"></script>
<script>
(function () {
  var query = location.search;
  var version;
  function pull() {
    fetch('/state' + query, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : undefined; })
      .then(function (state) { if (state) { window.postMessage(state, '*'); } })
      .catch(function () {});
  }
  // Rechargement dès que dist/webview.js ou media/cards.css change (esbuild --watch les régénère).
  function check() {
    fetch('/version', { cache: 'no-store' })
      .then(function (res) { return res.text(); })
      .then(function (v) { if (version !== undefined && v !== version) { location.reload(); } version = v; })
      .catch(function () {});
  }
  pull();
  check();
  setInterval(pull, 2000);
  setInterval(check, 1000);
})();
</script>
</body>
</html>
`;
}

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/media/cards.css': { file: 'media/cards.css', type: 'text/css; charset=utf-8' },
  '/dist/webview.js': { file: 'dist/webview.js', type: 'text/javascript; charset=utf-8' },
  '/dist/webview.js.map': { file: 'dist/webview.js.map', type: 'application/json; charset=utf-8' },
};

/** Empreinte des fichiers servis : la page se recharge quand elle change. */
function versionStamp(root: string): string {
  return Object.values(STATIC_FILES)
    .map(({ file }) => {
      try {
        return String(fs.statSync(path.join(root, file)).mtimeMs);
      } catch {
        return '-';
      }
    })
    .join('|');
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

export function createDevServer(options: DevServerOptions): http.Server {
  const log = options.log ?? (() => {});
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/') {
        send(res, 200, 'text/html; charset=utf-8', devPageHtml(url.searchParams));
        return;
      }
      if (url.pathname === '/state') {
        const state = buildState({
          claudeDir: options.claudeDir,
          now: Date.now(),
          ...parseStateQuery(url.searchParams),
          log,
          isPidAlive: options.isPidAlive,
        });
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state));
        return;
      }
      if (url.pathname === '/version') {
        send(res, 200, 'text/plain; charset=utf-8', versionStamp(options.root));
        return;
      }
      const asset = STATIC_FILES[url.pathname];
      const filePath = asset ? path.join(options.root, asset.file) : undefined;
      if (asset && filePath && fs.existsSync(filePath)) {
        send(res, 200, asset.type, fs.readFileSync(filePath));
        return;
      }
      send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    } catch (error) {
      send(res, 500, 'text/plain; charset=utf-8', String(error));
    }
  });
}
