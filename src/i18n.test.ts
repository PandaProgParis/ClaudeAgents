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

  it('libelle la réflexion du modèle et les tâches de fond dans chaque langue', () => {
    expect(STRINGS.fr.thinking).toBe('💭 réfléchit');
    expect(STRINGS.en.thinking).toBe('💭 thinking');
    expect(STRINGS.fr.backgroundTask).toBe('tâche en arrière-plan');
    expect(STRINGS.en.backgroundTask).toBe('background task');
    expect(STRINGS.fr.agentCount(1)).toBe('1 agent');
    expect(STRINGS.fr.agentCount(2)).toBe('2 agents');
    expect(STRINGS.en.agentCount(2)).toBe('2 agents');
    expect(STRINGS.fr.phases).toBe('Phases prévues');
    expect(STRINGS.en.phases).toBe('Planned phases');
  });

  it('libelle les compteurs de workflow (en cours, en échec) dans chaque langue', () => {
    expect(STRINGS.fr.running(3)).toBe('3 en cours');
    expect(STRINGS.fr.failedCount(1)).toBe('1 en échec');
    expect(STRINGS.fr.failed).toBe('en échec');
    expect(STRINGS.en.running(3)).toBe('3 running');
    expect(STRINGS.en.failedCount(1)).toBe('1 failed');
    expect(STRINGS.en.failed).toBe('failed');
  });

  it('libelle le badge des sessions en attente au singulier et au pluriel', () => {
    expect(STRINGS.fr.waitingBadge(1)).toBe('1 session attend une réponse');
    expect(STRINGS.fr.waitingBadge(3)).toBe('3 sessions attendent une réponse');
    expect(STRINGS.en.waitingBadge(1)).toBe('1 session is waiting for your answer');
    expect(STRINGS.en.waitingBadge(3)).toBe('3 sessions are waiting for your answer');
  });
});
