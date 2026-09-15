import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fous sur media/cards.css que les tests de rendu HTML ne voient pas : l'ordre et la spécificité
 * des règles, seuls arbitres de la cascade quand deux règles posent la même propriété.
 */

const css = readFileSync(path.join(__dirname, '..', 'media', 'cards.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selectors: string[];
  /** Position dans le fichier : à spécificité égale, la règle écrite après l'emporte. */
  index: number;
}

/** Règles à un niveau d'accolades ; les pas de @keyframes (« 0% », « 20%, 100% ») ressortent aussi, inoffensifs. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    rules.push({ selectors: match[1].split(',').map((s) => s.trim()).filter(Boolean), index: match.index ?? 0 });
  }
  return rules;
}

/** Spécificité (ids, classes + pseudo-classes + attributs, éléments) d'un sélecteur sans pseudo-élément. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|(?<!:):[\w-]+(?:\([^)]*\))?|\[[^\]]+\]/g) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, elements];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

describe('specificity', () => {
  it('compte ids, classes et pseudo-classes, éléments', () => {
    expect(specificity('#rate .stars:hover .star')).toEqual([1, 3, 0]);
    expect(specificity('#rate .star:hover ~ .star')).toEqual([1, 3, 0]);
    expect(specificity('.agents li > .gauge')).toEqual([0, 2, 1]);
  });
});

describe('cards.css — survol des étoiles de l’encart de notation', () => {
  const rules = parseRules(css);
  const greyAll = rules.find((rule) => rule.selectors.some((s) => /\.stars:hover\s+\.star$/.test(s)));
  const golden = rules.filter((rule) => rule !== greyAll && rule.selectors.some((s) => /\.star:hover/.test(s)));

  it('grise toutes les étoiles au survol du conteneur', () => {
    expect(greyAll).toBeDefined();
  });

  it('la règle qui dore la survolée et celles à sa gauche l’emporte : écrite après et au moins aussi spécifique', () => {
    expect(golden.length).toBeGreaterThan(0);
    const grey = specificity(greyAll!.selectors.find((s) => /\.stars:hover\s+\.star$/.test(s))!);
    for (const rule of golden) {
      expect(rule.index).toBeGreaterThan(greyAll!.index);
      for (const selector of rule.selectors) {
        expect(compare(specificity(selector), grey), `${selector} perd contre la mise en gris`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
