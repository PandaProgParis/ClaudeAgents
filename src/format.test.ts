import { describe, expect, it } from 'vitest';
import { abbreviateModel, contextLimitFor, formatDuration, formatRelativeTime, formatTokens } from './format';

describe('formatDuration', () => {
  it('affiche les secondes sous la minute', () => {
    expect(formatDuration(12_000)).toBe('12 s');
  });

  it('affiche les minutes entières sous l’heure', () => {
    expect(formatDuration(150_000)).toBe('2 min');
  });

  it('affiche heures et minutes', () => {
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
  });

  it('affiche les heures rondes sans minutes', () => {
    expect(formatDuration(7_200_000)).toBe('2 h');
  });

  it('plancher à zéro pour les deltas négatifs', () => {
    expect(formatDuration(-5_000)).toBe('0 s');
  });
});

describe('formatRelativeTime', () => {
  it('préfixe avec « il y a » par défaut (fr)', () => {
    expect(formatRelativeTime(120_000)).toBe('il y a 2 min');
  });

  it('suffixe avec « ago » en anglais', () => {
    expect(formatRelativeTime(120_000, 'en')).toBe('2 min ago');
  });
});

describe('abbreviateModel', () => {
  it('réduit un id de modèle Claude à sa famille', () => {
    expect(abbreviateModel('claude-fable-5')).toBe('fable');
    expect(abbreviateModel('claude-opus-4-8')).toBe('opus');
    expect(abbreviateModel('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('prend le premier segment pour un id inconnu', () => {
    expect(abbreviateModel('gpt-x')).toBe('gpt');
  });
});

describe('formatTokens', () => {
  it('affiche les milliers en k arrondis', () => {
    expect(formatTokens(482_851)).toBe('483k');
    expect(formatTokens(61_000)).toBe('61k');
  });

  it('affiche les millions avec virgule française', () => {
    expect(formatTokens(1_200_000)).toBe('1,2M');
  });

  it('affiche les millions avec point décimal en anglais', () => {
    expect(formatTokens(1_200_000, 'en')).toBe('1.2M');
  });

  it('affiche un million rond sans décimale', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_000_000, 'en')).toBe('1M');
  });

  it('affiche les petites valeurs brutes', () => {
    expect(formatTokens(950)).toBe('950');
  });
});

describe('contextLimitFor', () => {
  it('connaît les modèles 1M', () => {
    expect(contextLimitFor('claude-fable-5')).toBe(1_000_000);
    expect(contextLimitFor('claude-opus-4-8')).toBe(1_000_000);
    expect(contextLimitFor('claude-sonnet-5')).toBe(1_000_000);
    expect(contextLimitFor('claude-sonnet-4-6')).toBe(1_000_000);
  });

  it('connaît haiku 4.5 à 200k', () => {
    expect(contextLimitFor('claude-haiku-4-5-20251001')).toBe(200_000);
  });

  it('retourne undefined pour un modèle inconnu', () => {
    expect(contextLimitFor('claude-opus-4-5-20251101')).toBeUndefined();
    expect(contextLimitFor('gpt-x')).toBeUndefined();
  });
});
