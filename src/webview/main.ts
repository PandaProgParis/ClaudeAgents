import type { StateMessage } from '../types';
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
