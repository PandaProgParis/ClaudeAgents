import type { StateMessage } from '../types';
import { pickPhrase } from '../banner';
import type { Locale } from '../i18n';
import { morphChildren } from './morph';
import { applyRating } from './rating';
import { renderApp } from './render';
import { sparkleStars } from './sparkle';
import { renderUsage } from './usageView';

/** API de la webview VS Code (état persistant) ; absente dans l'aperçu local `npm run dev`. */
declare function acquireVsCodeApi(): { getState(): unknown; setState(state: unknown): void; postMessage(message: unknown): void };

const root = document.getElementById('root') as HTMLElement;
let state: StateMessage | undefined;
let clockSkew = 0;
let lastHtml = '';

const api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

/**
 * Liste d'ids sauvegardée dans l'état de la webview sous `key` (vide si absente ou d'une autre forme).
 * Dans l'aperçu local, sans API VS Code, la même clé se lit dans l'URL (?maps=<sessionId>, répétable).
 */
function savedIds(key: 'expanded' | 'maps' | 'sdd'): string[] {
  if (api === undefined) {
    return new URLSearchParams(window.location.search).getAll(key);
  }
  const saved = api.getState();
  const ids = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>)[key] : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** Couples [clé, valeur] sauvegardés dans l'état de la webview sous `key` (vide si absents ou d'une autre forme). */
function savedPairs(key: 'sddViewed'): Array<[string, string]> {
  const saved = api?.getState();
  const pairs = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>)[key] : undefined;
  return Array.isArray(pairs)
    ? pairs.filter(
        (pair): pair is [string, string] =>
          Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string',
      )
    : [];
}

/** Drapeau sauvegardé dans l'état de la webview sous `key` ; dans l'aperçu local, `?<key>=1`. */
function savedFlag(key: 'usageCollapsed'): boolean {
  if (api === undefined) {
    return new URLSearchParams(window.location.search).get(key) === '1';
  }
  const saved = api.getState();
  return typeof saved === 'object' && saved !== null && (saved as Record<string, unknown>)[key] === true;
}

/** Workflows dont le détail est déplié ; survit au masquage de la vue grâce à l'état de la webview. */
const expandedWorkflows = new Set<string>(savedIds('expanded'));
/** Sessions dont la carte des agents est dépliée ; même mécanique. */
const expandedMaps = new Set<string>(savedIds('maps'));
/** Sessions dont la liste des tâches SDD est dépliée ; même mécanique. */
const expandedSdd = new Set<string>(savedIds('sdd'));
/** Ancien plan consulté par session (dossier du workspace) ; même mécanique, absent de l'aperçu local. */
const sddViewed = new Map<string, string>(savedPairs('sddViewed'));
/** Card d'usage réduite à une ligne (flèche) ; même mécanique. */
let usageCollapsed = savedFlag('usageCollapsed');

function persistExpanded(): void {
  api?.setState({
    expanded: [...expandedWorkflows],
    maps: [...expandedMaps],
    sdd: [...expandedSdd],
    sddViewed: [...sddViewed],
    usageCollapsed,
  });
}

function toggle(set: Set<string>, id: string, open?: boolean): void {
  if (open ?? !set.has(id)) {
    set.add(id);
  } else {
    set.delete(id);
  }
}

root.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  // Pastille « N agents » : ouvre ou replie la carte des agents de la card ; sa croix la replie.
  const pill = target?.closest('.agents-pill');
  const close = target?.closest('.map-close');
  if (pill || close) {
    const sessionKey = target?.closest('article.card')?.getAttribute('data-key');
    if (sessionKey?.startsWith('sess:')) {
      toggle(expandedMaps, sessionKey.slice(5), close ? false : undefined);
      persistExpanded();
      render();
    }
    return;
  }
  // Flèches ‹ › de l'historique des plans.
  const arrow = target?.closest('.sdd-nav');
  if (arrow) {
    const sessionKey = arrow.closest('article.card')?.getAttribute('data-key');
    if (sessionKey?.startsWith('sess:')) {
      const plan = arrow.getAttribute('data-sdd-plan') ?? '';
      if (plan === '') {
        sddViewed.delete(sessionKey.slice(5));
      } else {
        sddViewed.set(sessionKey.slice(5), plan);
      }
      persistExpanded();
      render();
    }
    return;
  }
  // « Plan » ou les carrés : déplie ou replie la liste des tâches du plan.
  const sddKey = target?.closest('.sdd-toggle')?.closest('.sdd')?.getAttribute('data-key');
  if (sddKey?.startsWith('sdd:')) {
    toggle(expandedSdd, sddKey.slice(4));
    persistExpanded();
    render();
    return;
  }
  const key = target?.closest('.wf-head')?.closest('li.workflow')?.getAttribute('data-key');
  if (!key || !key.startsWith('wf:')) {
    return;
  }
  toggle(expandedWorkflows, key.slice(3));
  persistExpanded();
  render();
});

/** Dernière note posée sur l'encart : elle ne change que quelques fois par jour, inutile de la reposer à chaque scan. */
let lastRating = '';

window.addEventListener('message', (event: MessageEvent<StateMessage>) => {
  state = event.data;
  // L'horloge locale peut différer de celle de l'extension : on aligne.
  clockSkew = Date.now() - state.now;
  const rating = JSON.stringify(state.rating ?? null);
  if (rating !== lastRating) {
    lastRating = rating;
    applyRating(document.getElementById('rate'), state.rating, state.locale ?? 'fr');
  }
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
    expandedMaps,
    expandedSdd,
    sddViewed,
    pinnedFolders: state.pinnedFolders,
  });
  renderUsageCard();
  if (html !== lastHtml) {
    lastHtml = html;
    // Morph par clé plutôt que innerHTML : préserve animations, tooltips ouverts et sélection.
    const nextRoot = document.createElement('div');
    nextRoot.innerHTML = html;
    morphChildren(root, nextRoot);
  }
}

/**
 * Card des limites du forfait, hors de #root (le morph des cards n'y touche pas) et ancrée en bas.
 * Absente du message = fonction désactivée : on n'affiche rien du tout.
 */
let lastUsageHtml = '';
/** Encart masqué à la croix : l'extension décoche le réglage, mais on n'attend pas le prochain scan. */
let usageDismissed = false;
function renderUsageCard(): void {
  const host = document.getElementById('usage');
  if (!host || !state) {
    return;
  }
  const html =
    usageDismissed || state.usageFile === undefined
      ? ''
      : renderUsage(state.usage, {
          now: Date.now() - clockSkew,
          locale: state.locale ?? 'fr',
          file: state.usageFile,
          collapsed: usageCollapsed,
        });
  if (html !== lastUsageHtml) {
    lastUsageHtml = html;
    host.innerHTML = html;
  }
}

// Encart d'usage : le lien et le picto ⚙ demandent à l'extension d'ouvrir les réglages (la webview ne peut pas),
// le picto d'affichage lui demande le menu de la barre d'état ;
// ▾/▸ réduit la card à une ligne, état retenu ; la croix de la card d'aide masque immédiatement ici,
// et l'extension décoche le réglage pour de bon.
document.getElementById('usage')?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const settingLink = target?.closest('[data-setting]');
  if (settingLink) {
    api?.postMessage({ type: 'openSetting', setting: settingLink.getAttribute('data-setting') });
    return;
  }
  if (target?.closest('.usage-display')) {
    api?.postMessage({ type: 'usageStatusMenu' });
    return;
  }
  if (target?.closest('.usage-collapse')) {
    usageCollapsed = !usageCollapsed;
    persistExpanded();
    renderUsageCard();
    return;
  }
  if (!target?.closest('.usage-close')) {
    return;
  }
  usageDismissed = true;
  render();
  api?.postMessage({ type: 'dismissUsage' });
});

// Anime jauges et durées entre deux scans (250 ms = fluide à l'œil, coût négligeable).
setInterval(render, 250);

// Fait tourner le message de l'encart de notation (hors #root, épargné par le morph). La locale est
// posée par le serveur dans data-locale ; la salutation suit l'heure locale de qui regarde.
// À chaque nouvelle phrase, les étoiles scintillent (sparkle.ts + cards.css).
(function rotateRateMessage(): void {
  const msg = document.querySelector<HTMLElement>('#rate .msg');
  const stars = document.querySelector<HTMLElement>('#rate .stars');
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
      sparkleStars(stars);
    }, 300);
  }, 45000);
})();
