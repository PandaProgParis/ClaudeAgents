import { describe, expect, it } from 'vitest';
import { renderUsage } from './usageView';
import type { UsageSnapshot } from '../types';

const NOW = Date.parse('2026-09-11T16:26:59.894281+00:00');
const RESET = Date.parse('2026-09-13T16:59:59.894281+00:00'); // NOW + 48 h 33

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    updatedAt: NOW - 60_000,
    limits: [
      { kind: 'session', percent: 0, severity: 'normal' },
      { kind: 'weekly_all', percent: 100, resetsAt: RESET, severity: 'critical' },
      { kind: 'weekly_scoped', scopeLabel: 'Fable', percent: 77, resetsAt: RESET, severity: 'warning' },
    ],
    ...overrides,
  };
}

const OPTIONS = { now: NOW, locale: 'en' as const, file: 'C:\\usage.json' };

describe('renderUsage', () => {
  it('rend une jauge par limite, avec les libellés de ClaudeCockpit', () => {
    const html = renderUsage(snapshot(), OPTIONS);
    expect(html).toContain('Session (5h)');
    expect(html).toContain('Weekly — All models');
    expect(html).toContain('Weekly — Fable');
    expect(html.match(/class="gauge"/g)).toHaveLength(3);
  });

  it('remplit la barre à la hauteur du pourcentage et l’affiche', () => {
    const html = renderUsage(snapshot(), OPTIONS);
    expect(html).toContain('width="77"');
    expect(html).toContain('>77%<');
    expect(html).toContain('>100%<');
  });

  it('reprend les couleurs de ClaudeCockpit, dont celle du modèle', () => {
    const html = renderUsage(snapshot(), OPTIONS);
    expect(html).toContain('#D4956A'); // session
    expect(html).toContain('#64B5F6'); // weekly all
    expect(html).toContain('#BA68C8'); // Fable
  });

  it('formate le reset en jours au-delà de 24 h, en heures et minutes en deçà', () => {
    expect(renderUsage(snapshot(), OPTIONS)).toContain('resets 2d 00h');
    expect(renderUsage(snapshot(), OPTIONS)).not.toContain('48h33');
    const weekly = snapshot({ limits: [{ kind: 'weekly_all', percent: 5, resetsAt: NOW + 135 * 3_600_000 + 42 * 60_000, severity: 'normal' }] });
    expect(renderUsage(weekly, OPTIONS)).toContain('resets 5d 15h');
    expect(renderUsage(weekly, { ...OPTIONS, locale: 'fr' })).toContain('réinit. 5j 15h');
    const hours = snapshot({ limits: [{ kind: 'session', percent: 5, resetsAt: NOW + 4 * 3_600_000 + 9 * 60_000, severity: 'normal' }] });
    expect(renderUsage(hours, OPTIONS)).toContain('resets 4h09');
    const soon = snapshot({ limits: [{ kind: 'session', percent: 5, resetsAt: NOW + 12 * 60_000, severity: 'normal' }] });
    expect(renderUsage(soon, OPTIONS)).toContain('resets 12min');
    const past = snapshot({ limits: [{ kind: 'session', percent: 5, resetsAt: NOW - 1000, severity: 'normal' }] });
    expect(renderUsage(past, OPTIONS)).toContain('resets now');
  });

  it('signale discrètement un fichier frais et alerte sur un fichier vieilli', () => {
    const fresh = renderUsage(snapshot({ updatedAt: NOW - 60_000 }), OPTIONS);
    expect(fresh).toContain('updated 1 min ago');
    expect(fresh).not.toContain('usage-age stale');
    const old = renderUsage(snapshot({ updatedAt: NOW - 3 * 3_600_000 }), OPTIONS);
    expect(old).toContain('usage-age stale');
    expect(old).toContain('⚠');
  });

  it('sans données, rend la card d’aide pointillée avec le chemin attendu', () => {
    const html = renderUsage(undefined, OPTIONS);
    expect(html).toContain('usage-help');
    expect(html).toContain('claude.ai/usage');
    expect(html).toContain('C:\\usage.json');
    expect(html).not.toContain('class="gauge"');
  });

  it('la card d’aide porte une croix pour renoncer sans passer par les réglages', () => {
    const html = renderUsage(undefined, OPTIONS);
    expect(html).toContain('usage-close');
    expect(html).toContain('Hide this panel');
  });

  it('la card de jauges n’a pas de croix : on la désactive par les réglages', () => {
    expect(renderUsage(snapshot(), OPTIONS)).not.toContain('usage-close');
  });

  it('sans chemin configuré, la card d’aide fait de l’indication un lien vers le réglage à renseigner', () => {
    const html = renderUsage(undefined, { now: NOW, locale: 'en' });
    expect(html).toContain('Set the path in the claudeAgents.usageFile setting');
    expect(html).toContain('class="usage-path usage-settings" role="button" data-setting="claudeAgents.usageFile"');
  });

  it('avec un chemin configuré, l’indication n’est pas un lien', () => {
    expect(renderUsage(undefined, OPTIONS)).not.toContain('usage-settings');
  });

  it('la card de jauges porte un bouton réduire et un bouton réglages', () => {
    const html = renderUsage(snapshot(), OPTIONS);
    expect(html).toContain('class="usage-btn usage-collapse" type="button" title="Collapse"');
    expect(html).toContain('class="usage-btn usage-settings-btn" type="button" title="Usage settings" data-setting="claudeAgents.usageFile"');
  });

  it('entre la flèche et le ⚙, un picto ouvre le menu d’affichage de l’usage, card dépliée comme réduite', () => {
    for (const collapsed of [false, true]) {
      const html = renderUsage(snapshot(), { ...OPTIONS, collapsed });
      expect(html).toMatch(/usage-collapse[\s\S]*class="usage-btn usage-display" type="button" title="Usage display"[\s\S]*usage-settings-btn/);
      expect(html).toMatch(/usage-display[^>]*>\s*<svg class="usage-display-icon"/);
    }
    expect(renderUsage(snapshot(), { ...OPTIONS, locale: 'fr' })).toContain('title="Affichage de l’usage"');
  });

  it('la card d’aide n’a pas de picto d’affichage', () => {
    expect(renderUsage(undefined, OPTIONS)).not.toContain('usage-display');
  });

  it('le bouton réduire/déplier porte une flèche SVG dimensionnée par le CSS, pas un glyphe de police', () => {
    const expanded = renderUsage(snapshot(), OPTIONS);
    expect(expanded).toMatch(/usage-collapse[^>]*>\s*<svg class="usage-arrow"/);
    expect(expanded).not.toContain('▾');
    const collapsed = renderUsage(snapshot(), { ...OPTIONS, collapsed: true });
    expect(collapsed).toMatch(/usage-collapse[^>]*>\s*<svg class="usage-arrow"/);
    expect(collapsed).not.toContain('▸');
  });

  it('réduite : sans titre, les jauges 5h et hebdo côte à côte avec barre et pourcentage, bouton déplier', () => {
    const html = renderUsage(snapshot(), { ...OPTIONS, collapsed: true });
    expect(html).toContain('class="usage collapsed"');
    expect(html).not.toContain('usage-title');
    expect(html).not.toContain('class="gauge"');
    expect(html).toContain('title="Expand"');
    expect(html.match(/class="gauge-compact"/g)).toHaveLength(2);
    expect(html).toContain('<span class="gauge-short">5h</span>');
    expect(html).toContain('<span class="gauge-short">Weekly</span>');
    expect(html).toContain('width="100"');
    expect(html).toContain('>0%<');
    expect(html).toContain('>100%<');
  });

  it('réduite : libellé complet et reset en infobulle de chaque jauge', () => {
    const html = renderUsage(snapshot(), { ...OPTIONS, collapsed: true });
    expect(html).toContain('title="Session (5h)"');
    expect(html).toContain('title="Weekly — All models · resets 2d 00h"');
  });

  it('réduite : la limite par modèle attend le dépliage', () => {
    const html = renderUsage(snapshot(), { ...OPTIONS, collapsed: true });
    expect(html).not.toContain('Fable');
    expect(html).not.toContain('>77%<');
  });

  it('réduite en français : libellés courts « 5h » et « Hebdo »', () => {
    const html = renderUsage(snapshot(), { ...OPTIONS, locale: 'fr', collapsed: true });
    expect(html).toContain('<span class="gauge-short">5h</span>');
    expect(html).toContain('<span class="gauge-short">Hebdo</span>');
  });

  it('réduite et vieillie : l’alerte reste visible', () => {
    const fresh = renderUsage(snapshot(), { ...OPTIONS, collapsed: true });
    expect(fresh).not.toContain('usage-age');
    const old = renderUsage(snapshot({ updatedAt: NOW - 3 * 3_600_000 }), { ...OPTIONS, collapsed: true });
    expect(old).toContain('class="usage-age stale"');
  });

  it('la card d’aide renvoie vers l’outil qui écrit le fichier', () => {
    const html = renderUsage(undefined, { now: NOW, locale: 'en' });
    expect(html).toContain('href="https://github.com/PandaProgParis/ClaudeUsage"');
    expect(html).toContain('class="usage-repo"');
  });

  it('n’émet aucun style inline : la CSP de la webview les bloque', () => {
    expect(renderUsage(snapshot(), OPTIONS)).not.toContain('style=');
    expect(renderUsage(undefined, OPTIONS)).not.toContain('style=');
  });

  it('échappe ce qui vient du fichier', () => {
    const evil = snapshot({ limits: [{ kind: 'weekly_scoped', scopeLabel: '<b>', percent: 1, severity: 'normal' }] });
    expect(renderUsage(evil, OPTIONS)).not.toContain('<b>');
  });
});
