import { describe, expect, it } from 'vitest';
import { pickPhrase, ratePool, rateBannerHtml, REVIEW_URL, starFills } from './banner';
import { STRINGS } from './i18n';

describe('ratePool', () => {
  it('réunit les phrases fun et la salutation de l’heure', () => {
    const pool = ratePool('fr', 20);
    expect(pool).toContain(STRINGS.fr.ratePhrases[0]);
    expect(pool).toContain(STRINGS.fr.rateGreeting(20)); // 'Bonsoir 🌙'
    expect(pool).toHaveLength(STRINGS.fr.ratePhrases.length + 1);
  });

  it('adapte la salutation à l’heure', () => {
    expect(STRINGS.en.rateGreeting(9)).toBe('Good morning ☀️');
    expect(STRINGS.en.rateGreeting(14)).toBe('Good afternoon 👋');
    expect(STRINGS.en.rateGreeting(21)).toBe('Good evening 🌙');
  });

  it('offre autant de phrases en français qu’en anglais, toutes différentes et courtes', () => {
    expect(STRINGS.fr.ratePhrases).toHaveLength(STRINGS.en.ratePhrases.length);
    for (const phrases of [STRINGS.fr.ratePhrases, STRINGS.en.ratePhrases]) {
      expect(new Set(phrases).size).toBe(phrases.length);
      for (const phrase of phrases) {
        expect(phrase.length).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('rateVotes', () => {
  it('dit la moyenne à une décimale et le nombre d’avis, au singulier comme au pluriel', () => {
    expect(STRINGS.fr.rateVotes(3, 4.5)).toBe('4,5 ★ · 3 avis sur le Marketplace');
    expect(STRINGS.fr.rateVotes(1, 5)).toBe('5,0 ★ · 1 avis sur le Marketplace');
    expect(STRINGS.en.rateVotes(3, 4.5)).toBe('4.5 ★ · 3 reviews on the Marketplace');
    expect(STRINGS.en.rateVotes(1, 5)).toBe('5.0 ★ · 1 review on the Marketplace');
  });
});

describe('pickPhrase', () => {
  it('tire une entrée du pool selon le rng injecté', () => {
    const pool = ratePool('en', 10);
    expect(pickPhrase('en', 10, () => 0)).toBe(pool[0]);
    expect(pickPhrase('en', 10, () => 0.999999)).toBe(pool[pool.length - 1]);
  });
});

describe('rateBannerHtml', () => {
  it('pose le message, la locale, l’URL et cinq étoiles', () => {
    const html = rateBannerHtml('fr');
    expect(html).toContain('data-locale="fr"');
    expect(html).toContain('class="msg"');
    expect(html).toContain(REVIEW_URL.replaceAll('&', '&amp;'));
    expect(html.match(/class="star"/g)).toHaveLength(5);
  });

  it('réserve le nombre de votes juste à gauche des étoiles, vide tant que la note n’est pas lue', () => {
    expect(rateBannerHtml('en')).toMatch(/<span class="votes"><\/span><span class="stars">/);
  });
});

describe('starFills', () => {
  it('remplit les étoiles de la première à la cinquième selon la moyenne, en pourcentage', () => {
    expect(starFills(5)).toEqual([100, 100, 100, 100, 100]);
    expect(starFills(3.5)).toEqual([100, 100, 100, 50, 0]);
    expect(starFills(4.3)).toEqual([100, 100, 100, 100, 30]);
    expect(starFills(0)).toEqual([0, 0, 0, 0, 0]);
  });
});
