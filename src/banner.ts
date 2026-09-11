import { STRINGS, type Locale } from './i18n';

/**
 * Encart de notation ancré en haut de la vue. Module pur : la webview (cardsView) et l'aperçu local
 * (dev/server) le posent tous deux hors de #root, que le rendu des cards réécrit à chaque scan.
 * Le message change au hasard — tirage initial ici (SSR, jamais vide), rotation ensuite dans la webview.
 */

/** Page de l'extension sur le Marketplace, onglet des avis. */
export const REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=pandaprog.claude-agents&ssr=false#review-details';

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Pool des messages de l'encart : les phrases fun + la salutation adaptée à l'heure donnée. */
export function ratePool(locale: Locale, hour: number): string[] {
  const strings = STRINGS[locale];
  return [...strings.ratePhrases, strings.rateGreeting(hour)];
}

/** Message tiré au hasard dans le pool (rng injectable pour les tests). */
export function pickPhrase(locale: Locale, hour: number, rng: () => number = Math.random): string {
  const pool = ratePool(locale, hour);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * Les étoiles sont écrites de 5 à 1 : `flex-direction: row-reverse` les remet à l'endroit, ce qui laisse
 * `.star:hover ~ .star` atteindre celles affichées à gauche et dorer l'ensemble de 1 jusqu'à la survolée.
 * Le `<span class="msg">` porte la phrase initiale ; la webview (main.ts) la fait tourner via data-locale.
 */
export function rateBannerHtml(locale: Locale): string {
  const strings = STRINGS[locale];
  const message = pickPhrase(locale, new Date().getHours());
  const stars = [5, 4, 3, 2, 1]
    .map((count) => `<a class="star" href="${escape(REVIEW_URL)}" title="${escape(strings.rateStars(count))}">★</a>`)
    .join('');
  return `<aside id="rate" data-locale="${escape(locale)}"><span class="msg">${escape(message)}</span><span class="stars">${stars}</span></aside>`;
}
