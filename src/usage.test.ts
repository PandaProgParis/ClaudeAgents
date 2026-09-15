import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readUsage, resetUsageCache } from './usage';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  resetUsageCache();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Extrait fidèle du fichier écrit par l'outil de Cyril (AppData/Roaming/Claude/usage.json). */
const REAL = {
  extra_usage: { is_enabled: false },
  limits: [
    { group: 'session', is_active: false, kind: 'session', percent: 0, resets_at: null, scope: null, severity: 'normal' },
    {
      group: 'weekly',
      is_active: true,
      kind: 'weekly_all',
      percent: 100,
      resets_at: '2026-09-13T16:59:59.894281+00:00',
      scope: null,
      severity: 'critical',
    },
    {
      group: 'weekly',
      is_active: false,
      kind: 'weekly_scoped',
      percent: 77,
      resets_at: '2026-09-13T16:59:59.894468+00:00',
      scope: { model: { display_name: 'Fable', id: null }, surface: null },
      severity: 'warning',
    },
  ],
};

function write(content: unknown, name = 'usage.json'): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return file;
}

describe('readUsage', () => {
  it('lit les trois limites du fichier réel', () => {
    const snapshot = readUsage(write(REAL));
    expect(snapshot?.limits).toHaveLength(3);
    expect(snapshot?.limits[0]).toEqual({ kind: 'session', percent: 0, severity: 'normal' });
    expect(snapshot?.limits[1]).toMatchObject({ kind: 'weekly_all', percent: 100, severity: 'critical' });
    expect(snapshot?.limits[2]).toMatchObject({ kind: 'weekly_scoped', percent: 77, severity: 'warning', scopeLabel: 'Fable' });
  });

  it('convertit resets_at en horodatage', () => {
    const snapshot = readUsage(write(REAL));
    expect(snapshot?.limits[1].resetsAt).toBe(Date.parse('2026-09-13T16:59:59.894281+00:00'));
    expect(snapshot?.limits[0].resetsAt).toBeUndefined();
  });

  it('rend undefined sans fichier, sur JSON cassé ou sans limites exploitables', () => {
    expect(readUsage(path.join(dir, 'absent.json'))).toBeUndefined();
    expect(readUsage(write('{ pas du json', 'c.json'))).toBeUndefined();
    expect(readUsage(write({ limits: [] }, 'd.json'))).toBeUndefined();
    expect(readUsage(write({ limits: 'nope' }, 'e.json'))).toBeUndefined();
    expect(readUsage('')).toBeUndefined();
  });

  it('ignore une entrée sans pourcentage utilisable et borne les valeurs', () => {
    const snapshot = readUsage(
      write({ limits: [{ kind: 'session', percent: 'x', severity: 'normal' }, { kind: 'weekly_all', percent: 140, severity: 'critical' }] }),
    );
    expect(snapshot?.limits).toHaveLength(1);
    expect(snapshot?.limits[0].percent).toBe(100);
  });

  it('retombe sur « normal » quand la sévérité est inconnue', () => {
    const snapshot = readUsage(write({ limits: [{ kind: 'session', percent: 10, severity: 'wat' }] }));
    expect(snapshot?.limits[0].severity).toBe('normal');
  });

  it('rapporte la date de mise à jour du fichier, pour juger de sa fraîcheur', () => {
    const file = write(REAL);
    const mtime = fs.statSync(file).mtimeMs;
    expect(readUsage(file)?.updatedAt).toBe(mtime);
  });

  it('relit le fichier quand il change', () => {
    const file = write(REAL);
    expect(readUsage(file)?.limits[2].percent).toBe(77);
    const next = JSON.parse(JSON.stringify(REAL));
    next.limits[2].percent = 12;
    fs.writeFileSync(file, JSON.stringify(next), 'utf8');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
    expect(readUsage(file)?.limits[2].percent).toBe(12);
  });
});
