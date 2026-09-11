import type { StateMessage } from '../types';
import { pickPhrase } from '../banner';
import type { Locale } from '../i18n';
import { morphChildren } from './morph';
import { renderApp } from './render';

/** API de la webview VS Code (état persistant) ; absente dans l'aperçu local `npm run dev`. */
declare function acquireVsCodeApi(): { getState(): unknown; setState(state: unknown): void };

const root = document.getElementById('root') as HTMLElement;
let state: StateMessage | undefined;
let clockSkew = 0;
let lastHtml = '';

const api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

function savedExpandedWorkflows(): string[] {
  const saved = api?.getState();
  const expanded = typeof saved === 'object' && saved !== null ? (saved as { expanded?: unknown }).expanded : undefined;
  return Array.isArray(expanded) ? expanded.filter((id): id is string => typeof id === 'string') : [];
}

/** Workflows dont le détail est déplié ; survit au masquage de la vue grâce à l'état de la webview. */
const expandedWorkflows = new Set<string>(savedExpandedWorkflows());

root.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const key = target?.closest('.wf-head')?.closest('li.workflow')?.getAttribute('data-key');
  if (!key || !key.startsWith('wf:')) {
    return;
  }
  const id = key.slice(3);
  if (expandedWorkflows.has(id)) {
    expandedWorkflows.delete(id);
  } else {
    expandedWorkflows.add(id);
  }
  api?.setState({ expanded: [...expandedWorkflows] });
  render();
});

window.addEventListener('message', (event: MessageEvent<StateMessage>) => {
  state = event.data;
  // L'horloge locale peut différer de celle de l'extension : on aligne.
  clockSkew = Date.now() - state.now;
  render();
});

function render(): void {
  if (!state) {
    return;
  }
  const html = renderApp(state.projects, {
    now: Date.now() - clockSkew,
    effortLevel: state.effortLevel,
    settings: state.settings,
    inactiveSessionRetentionMinutes: state.inactiveSessionRetentionMinutes,
    locale: state.locale,
    expandedWorkflows,
  });
  if (html !== lastHtml) {
    lastHtml = html;
    // Morph par clé plutôt que innerHTML : préserve animations, tooltips ouverts et sélection.
    const nextRoot = document.createElement('div');
    nextRoot.innerHTML = html;
    morphChildren(root, nextRoot);
  }
}

// Anime jauges et durées entre deux scans (250 ms = fluide à l'œil, coût négligeable).
setInterval(render, 250);

// Fait tourner le message de l'encart de notation (hors #root, épargné par le morph). La locale est
// posée par le serveur dans data-locale ; la salutation suit l'heure locale de qui regarde.
(function rotateRateMessage(): void {
  const msg = document.querySelector<HTMLElement>('#rate .msg');
  const locale = (document.getElementById('rate')?.getAttribute('data-locale') ?? 'fr') as Locale;
  if (!msg) {
    return;
  }
  let current = msg.textContent ?? '';
  setInterval(() => {
    let next = current;
    // Évite de retomber sur la même phrase deux fois de suite.
    for (let tries = 0; tries < 5 && next === current; tries++) {
      next = pickPhrase(locale, new Date().getHours());
    }
    current = next;
    msg.style.opacity = '0';
    setTimeout(() => {
      msg.textContent = next;
      msg.style.opacity = '1';
    }, 300);
  }, 45000);
})();
