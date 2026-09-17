// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { rateBannerHtml } from '../banner';
import { STRINGS } from '../i18n';
import { RATED_CLASS, applyRating } from './rating';

function banner(): HTMLElement {
  document.body.innerHTML = rateBannerHtml('fr');
  return document.getElementById('rate') as HTMLElement;
}

/** Étoiles dans l'ordre affiché : le DOM les écrit de 5 à 1. */
function displayedStars(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('.star')].reverse();
}

describe('applyRating', () => {
  it('remplit les étoiles selon la vraie moyenne et affiche le nombre de votes', () => {
    const el = banner();
    applyRating(el, { average: 3.5, count: 12 }, 'fr');
    expect(el.querySelector('.stars')?.classList.contains(RATED_CLASS)).toBe(true);
    expect(displayedStars(el).map((star) => star.style.getPropertyValue('--fill'))).toEqual([
      '100%',
      '100%',
      '100%',
      '50%',
      '0%',
    ]);
    const votes = el.querySelector('.votes') as HTMLElement;
    expect(votes.textContent).toBe('(12)');
    expect(votes.title).toBe(STRINGS.fr.rateVotes(12, 3.5));
  });

  it('sans note lue, ou sans aucun avis, garde les cinq étoiles allumées et aucun compte', () => {
    for (const rating of [undefined, { average: 0, count: 0 }]) {
      const el = banner();
      applyRating(el, { average: 4, count: 2 }, 'fr');
      applyRating(el, rating, 'fr');
      expect(el.querySelector('.stars')?.classList.contains(RATED_CLASS)).toBe(false);
      expect(displayedStars(el).every((star) => star.style.getPropertyValue('--fill') === '')).toBe(true);
      expect(el.querySelector('.votes')?.textContent).toBe('');
    }
  });

  it('ne fait rien sans encart', () => {
    expect(() => applyRating(null, { average: 5, count: 3 }, 'en')).not.toThrow();
  });
});
