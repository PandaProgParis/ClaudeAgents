/**
 * Scintillement des étoiles de l'encart de notation : à chaque nouvelle phrase, main.ts pose la classe
 * `sparkle` sur `#rate .stars` et cards.css allume les cinq étoiles une par une, deux fois de suite.
 * La classe est retirée à la fin de l'animation (ou après un délai de secours) pour pouvoir rejouer la fois suivante.
 */
export const SPARKLE_CLASS = 'sparkle';

/** Animation CSS : 2 passes × 1,2 s ; le filet part un peu après, au cas où animationend ne viendrait jamais. */
const DEFAULT_FALLBACK_MS = 3_000;

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  stop: () => void;
}

const pending = new WeakMap<Element, Pending>();

export function sparkleStars(stars: Element | null, fallbackMs = DEFAULT_FALLBACK_MS): void {
  if (!stars) {
    return;
  }
  // Relance pendant une animation : on solde la précédente (fin d'écoute et filet) avant de repartir de zéro.
  const previous = pending.get(stars);
  if (previous !== undefined) {
    previous.stop();
  }
  const stop = (): void => {
    stars.classList.remove(SPARKLE_CLASS);
    stars.removeEventListener('animationend', stop);
    const current = pending.get(stars);
    if (current !== undefined && current.stop === stop) {
      clearTimeout(current.timer);
      pending.delete(stars);
    }
  };
  // Retirer puis remettre la classe ne suffit pas : le navigateur ne rejoue l'animation qu'après un reflow.
  stars.classList.remove(SPARKLE_CLASS);
  void (stars as HTMLElement).offsetWidth;
  stars.addEventListener('animationend', stop);
  stars.classList.add(SPARKLE_CLASS);
  pending.set(stars, { timer: setTimeout(stop, fallbackMs), stop });
}
