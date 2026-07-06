import { describe, expect, it } from 'vitest';
import { STRINGS, resolveLocale } from './i18n';

describe('resolveLocale', () => {
  it('reconnaît le français quelle que soit la région', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('fr-FR')).toBe('fr');
    expect(resolveLocale('FR-ca')).toBe('fr');
  });

  it("replie sur l'anglais pour toute autre langue", () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('de')).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});

describe('STRINGS', () => {
  it('fournit les deux locales avec les mêmes clés', () => {
    expect(Object.keys(STRINGS.fr.verbs).sort()).toEqual(Object.keys(STRINGS.en.verbs).sort());
    expect(STRINGS.fr.empty).not.toBe(STRINGS.en.empty);
  });

  it('formate le temps relatif dans chaque langue', () => {
    expect(STRINGS.fr.relative('3 min')).toBe('il y a 3 min');
    expect(STRINGS.en.relative('3 min')).toBe('3 min ago');
  });
});
