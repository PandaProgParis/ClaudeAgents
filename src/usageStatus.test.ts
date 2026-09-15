import { describe, expect, it } from 'vitest';
import { formatCountdown, levelOf, ringStep, statusItems, statusTooltip } from './usageStatus';
import type { UsageSnapshot } from './types';

const NOW = Date.parse('2026-09-15T10:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    updatedAt: NOW - MINUTE,
    limits: [
      { kind: 'session', percent: 2, resetsAt: NOW + 4 * HOUR + 9 * MINUTE + 21 * SECOND, severity: 'normal' },
      { kind: 'weekly_all', percent: 18, resetsAt: NOW + 3 * DAY + 4 * HOUR + 5 * MINUTE, severity: 'normal' },
      { kind: 'weekly_scoped', scopeLabel: 'Opus', percent: 9, resetsAt: NOW + 3 * DAY, severity: 'normal' },
    ],
    ...overrides,
  };
}

describe('formatCountdown', () => {
  it('décompte la session en h:mm:ss, puis mm:ss sous une heure', () => {
    expect(formatCountdown(4 * HOUR + 9 * MINUTE + 21 * SECOND, false, 'fr')).toBe('4:09:21');
    expect(formatCountdown(22 * MINUTE + 14 * SECOND, false, 'fr')).toBe('22:14');
    expect(formatCountdown(7 * MINUTE + 48 * SECOND, false, 'fr')).toBe('07:48');
  });

  it('arrondit à la seconde supérieure : le décompte atteint zéro au moment de la reprise, pas avant', () => {
    expect(formatCountdown(59 * SECOND + 1, false, 'fr')).toBe('01:00');
    expect(formatCountdown(1, false, 'fr')).toBe('00:01');
  });

  it("affiche l'hebdo en jours et heures tant qu'il reste au moins un jour, puis s'affine", () => {
    expect(formatCountdown(3 * DAY + 4 * HOUR + 5 * MINUTE, true, 'fr')).toBe('3j 04h');
    expect(formatCountdown(3 * DAY + 4 * HOUR + 5 * MINUTE, true, 'en')).toBe('3d 04h');
    expect(formatCountdown(DAY, true, 'fr')).toBe('1j 00h');
    expect(formatCountdown(21 * HOUR + 14 * MINUTE + 5 * SECOND, true, 'fr')).toBe('21:14:05');
    expect(formatCountdown(47 * MINUTE + 12 * SECOND, true, 'fr')).toBe('47:12');
  });

  it('ne montre rien une fois la reprise passée', () => {
    expect(formatCountdown(0, false, 'fr')).toBeUndefined();
    expect(formatCountdown(-5 * SECOND, true, 'en')).toBeUndefined();
  });
});

describe('ringStep', () => {
  it('découpe le pourcentage en 9 crans (0 à 8)', () => {
    expect(ringStep(62)).toBe(5);
    expect(ringStep(50)).toBe(4);
    expect(ringStep(25)).toBe(2);
  });

  it("ne montre un anneau vide qu'à 0 % et plein qu'à 100 %", () => {
    expect(ringStep(0)).toBe(0);
    expect(ringStep(2)).toBe(1);
    expect(ringStep(99)).toBe(7);
    expect(ringStep(100)).toBe(8);
  });
});

describe('levelOf', () => {
  it('passe en alerte à 80 % et en critique à 95 %', () => {
    expect(levelOf({ kind: 'session', percent: 79, severity: 'normal' })).toBe('normal');
    expect(levelOf({ kind: 'session', percent: 80, severity: 'normal' })).toBe('warning');
    expect(levelOf({ kind: 'session', percent: 95, severity: 'normal' })).toBe('critical');
  });

  it('reprend la sévérité écrite par claude.ai quand elle est plus haute', () => {
    expect(levelOf({ kind: 'session', percent: 40, severity: 'warning' })).toBe('warning');
    expect(levelOf({ kind: 'session', percent: 85, severity: 'critical' })).toBe('critical');
  });
});

describe('statusItems', () => {
  const OPTIONS = { now: NOW, locale: 'fr' as const, format: 'text' as const };

  it('format texte : session puis hebdo, pourcentage et compte à rebours', () => {
    expect(statusItems(snapshot(), OPTIONS)).toEqual([
      { key: 'session', text: 'Session 2% 4:09:21', level: 'normal' },
      { key: 'weekly', text: 'Hebdo 18% 3j 04h', level: 'normal' },
    ]);
  });

  it('suit la langue de VS Code', () => {
    const items = statusItems(snapshot(), { ...OPTIONS, locale: 'en' });
    expect(items.map((item) => item.text)).toEqual(['Session 2% 4:09:21', 'Weekly 18% 3d 04h']);
  });

  it('omet le compte à rebours quand la reprise est inconnue', () => {
    const items = statusItems(snapshot({ limits: [{ kind: 'session', percent: 2, severity: 'normal' }] }), OPTIONS);
    expect(items).toEqual([{ key: 'session', text: 'Session 2%', level: 'normal' }]);
  });

  it('format anneaux : une icône de la police embarquée par limite, sans texte', () => {
    const items = statusItems(snapshot(), { ...OPTIONS, format: 'rings' });
    expect(items.map((item) => item.text)).toEqual(['$(claude-agents-ring-1)', '$(claude-agents-ring-1)']);
  });

  it('porte le niveau d’alerte de chaque limite séparément', () => {
    const limits = snapshot().limits.map((limit) => (limit.kind === 'session' ? { ...limit, percent: 86 } : limit));
    const items = statusItems(snapshot({ limits }), OPTIONS);
    expect(items.map((item) => item.level)).toEqual(['warning', 'normal']);
  });

  it('signale des chiffres vieillis devant le premier élément', () => {
    const items = statusItems(snapshot({ updatedAt: NOW - 45 * MINUTE }), OPTIONS);
    expect(items[0].text).toBe('$(warning) Session 2% 4:09:21');
    expect(items[1].text).toBe('Hebdo 18% 3j 04h');
  });

  it('ne rend rien en mode masqué', () => {
    expect(statusItems(snapshot(), { ...OPTIONS, format: 'off' })).toEqual([]);
  });
});

describe('statusTooltip', () => {
  it('détaille toutes les limites avec leur reprise, et la fraîcheur du fichier', () => {
    const tooltip = statusTooltip(snapshot(), { now: NOW, locale: 'fr' });
    expect(tooltip).toContain('Session (5h)');
    expect(tooltip).toContain('Hebdo — tous modèles');
    expect(tooltip).toContain('Hebdo — Opus');
    expect(tooltip).toContain('18%');
    expect(tooltip).toContain('réinit. 4h09');
    expect(tooltip).toContain('réinit. 3j 04h');
    expect(tooltip).toContain('réinit. 3j 00h');
    expect(tooltip).toContain('maj il y a 1 min');
  });
});
