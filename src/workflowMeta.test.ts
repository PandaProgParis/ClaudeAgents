import { describe, expect, it } from 'vitest';
import { parseWorkflowMeta } from './workflowMeta';

const SCRIPT = [
  'export const meta = {',
  "  name: 'suite-ui',",
  "  description: 'Deux chantiers en parallèle : contrepartie et densité de l\\'interface',",
  '  phases: [',
  "    { title: 'Implémentation', detail: 'un implémenteur par chantier' },",
  '    { title: "Revue" },',
  '  ],',
  '}',
  "const done = await agent('go', { label: 'impl', phase: 'Implémentation', schema: { title: { type: 'string' } } })",
  "log('title: fini')",
].join('\n');

describe('parseWorkflowMeta', () => {
  it('lit la description (apostrophe échappée comprise) et les phases avec leur détail', () => {
    expect(parseWorkflowMeta(SCRIPT)).toEqual({
      description: "Deux chantiers en parallèle : contrepartie et densité de l'interface",
      phases: [{ title: 'Implémentation', detail: 'un implémenteur par chantier' }, { title: 'Revue' }],
    });
  });

  it('ne lit que le bloc meta : un title ailleurs dans le script n’est pas une phase', () => {
    const script = "export const meta = {\n  name: 'x',\n}\nconst s = { title: 'pas une phase' }\n";
    expect(parseWorkflowMeta(script)).toEqual({});
  });

  it('accepte les guillemets doubles et les backticks, et un script sans bloc meta', () => {
    expect(parseWorkflowMeta('export const meta = {\n  description: `Trois "essais"`,\n}\n')).toEqual({
      description: 'Trois "essais"',
    });
    expect(parseWorkflowMeta('const a = 1')).toEqual({});
  });
});
