import type { FinishedAgentSettings, ProjectNode } from '../types';
import type { Locale } from '../i18n';
import { morphChildren } from './morph';
import { renderApp } from './render';

interface StateMessage {
  projects: ProjectNode[];
  effortLevel?: string;
  settings: FinishedAgentSettings;
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
  now: number;
}

const root = document.getElementById('root') as HTMLElement;
let state: StateMessage | undefined;
let clockSkew = 0;
let lastHtml = '';

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
