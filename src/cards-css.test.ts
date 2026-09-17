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

describe('cards.css — vraie note et scintillement des étoiles', () => {
  const rules = parseRules(css);
  const body = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((rule) => rule[1].split(',').map((s) => s.trim()).includes(selector))?.[2];
  const GOLD = '#f5b301';

  /** Pas d'un @keyframes : [pourcentage, 'gold' | 'grey'] triés par pourcentage. */
  function timeline(name: string): Array<[number, 'gold' | 'grey']> {
    const block = css.match(new RegExp(`@keyframes ${name}\\s*\\{((?:[^{}]*\\{[^{}]*\\})*)\\s*\\}`))?.[1] ?? '';
    const steps: Array<[number, 'gold' | 'grey']> = [];
    for (const step of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const color = step[2].includes(GOLD) ? 'gold' : 'grey';
      for (const percent of step[1].split(',')) {
        steps.push([Number(percent.trim().replace('%', '')), color]);
      }
    }
    return steps.sort((a, b) => a[0] - b[0]);
  }

  it('joue une seule passe de 6 temps de 216 ms : 10 % plus vite que les 240 ms d’avant', () => {
    expect(body('#rate .stars.sparkle .star')).toMatch(/animation:\s*sparkle-5\s+1\.296s\s+step-end\s*;/);
  });

  it('allume les étoiles une par une, les garde un temps, les éteint toutes, puis rend la main à la vraie note', () => {
    const step = 100 / 6;
    for (let star = 1; star <= 5; star++) {
      const expected: Array<[number, 'gold' | 'grey']> =
        star === 1 ? [[0, 'gold']] : [[0, 'grey'], [(star - 1) * step, 'gold']];
      expected.push([5 * step, 'grey'], [100, 'grey']);
      const actual = timeline(`sparkle-${star}`);
      expect(actual.map(([, color]) => color), `sparkle-${star}`).toEqual(expected.map(([, color]) => color));
      actual.forEach(([percent], index) => expect(percent, `sparkle-${star}`).toBeCloseTo(expected[index][0], 2));
    }
  });

  it('dessine la vraie note en remplissant chaque étoile de --fill', () => {
    const rated = body('#rate .stars.rated .star');
    expect(rated).toMatch(/var\(--fill/);
    expect(rated).toMatch(/(?:^|[;\s])background-clip:\s*text/);
    expect(rated).toMatch(/color:\s*transparent/);
  });

  it('au survol, la note affichée s’efface devant la note que l’on s’apprête à donner', () => {
    const rated = rules.find((rule) => rule.selectors.includes('#rate .stars.rated .star'))!;
    const grey = rules.find((rule) => rule.selectors.includes('#rate .stars:hover .star'))!;
    expect(rated.index).toBeLessThan(grey.index);
    expect(compare(specificity('#rate .stars.rated .star'), specificity('#rate .stars:hover .star'))).toBeLessThanOrEqual(0);
    expect(body('#rate .stars:hover .star')).toMatch(/background:\s*none/);
  });

  it('masque le nombre de votes tant qu’il est vide', () => {
    expect(body('#rate .votes:empty')).toMatch(/display:\s*none/);
  });
});

describe('cards.css — carrés SDD', () => {
  /** Corps d'une règle dont un sélecteur correspond exactement. */
  function body(selector: string): string | undefined {
    const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((rule) =>
      rule[1].split(',').map((s) => s.trim()).includes(selector),
    );
    return match?.[2];
  }

  // Les deux états signifient « c'est la tâche sur laquelle ça travaille » : sans animation,
  // on ne voit pas que le run avance.
  it.each(['.sdd-sq.doing', '.sdd-sq.review'])('%s pulse pour montrer que le travail tourne', (selector) => {
    expect(body(selector)).toMatch(/animation:\s*pulse/);
  });

  it('un carré terminé ou à faire ne pulse pas', () => {
    expect(body('.sdd-sq.done')).not.toMatch(/animation/);
    expect(body('.sdd-sq')).not.toMatch(/animation/);
  });
});

describe('cards.css — ligne d’un agent', () => {
  const body = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((rule) => rule[1].split(',').map((s) => s.trim()).includes(selector))?.[2];

  // Un titre qui prend toute la largeur repousserait le verbe contre les chiffres, loin du titre.
  it('le titre ne s’étire pas : le verbe le suit, les chiffres restent à droite', () => {
    expect(body('.agent-label')).not.toMatch(/(?:^|[;\s])flex:\s*1\s*;/);
    expect(body('.agent-label')).toMatch(/min-width:\s*0/);
    expect(body('.agent-desc')).toMatch(/margin-left:\s*auto/);
  });

  it('le verbe ne passe pas à la ligne', () => {
    expect(body('.agent-verb')).toMatch(/flex:\s*none/);
    expect(body('.agent-verb')).toMatch(/white-space:\s*nowrap/);
  });
});

describe('cards.css — plan consulté dans l’historique', () => {
  const rules = parseRules(css);
  /** Valeur d'une propriété, prise dans la première règle qui la pose et dont un sélecteur correspond exactement. */
  const property = (selector: string, name: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => rule[1].split(',').map((s) => s.trim()).includes(selector))
      .map((rule) => rule[2].match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`))?.[1].trim())
      .find((value) => value !== undefined);

  it('sépare la ligne « N plans » du reste de la card comme le bloc d’un plan', () => {
    for (const name of ['border-top', 'padding-top', 'margin-top']) {
      expect(property('.sdd', name), name).toBeDefined();
      expect(property('.sdd-history', name), name).toBe(property('.sdd', name));
    }
  });

  it('aligne à droite les chiffres des agents d’une tâche, sans les couper', () => {
    expect(property('.sdd-figures', 'margin-left')).toBe('auto');
    expect(property('.sdd-figures', 'white-space')).toBe('nowrap');
    expect(property('.sdd-text', 'min-width')).toBe('0');
  });

  it('ancre la date et › à droite de l’en-tête', () => {
    expect(property('.sdd-pager', 'margin-left')).toBe('auto');
  });

  // Grisée ou cliquable, ‹ occupe la même place : « Plan » ne bouge pas d'un plan à l'autre.
  it('donne la même largeur aux flèches cliquables et grisées', () => {
    expect(property('.sdd-nav', 'width')).toBeDefined();
    expect(property('.sdd-nav-off', 'width')).toBe(property('.sdd-nav', 'width'));
  });

  it('colore en bleu de lien la flèche cliquable, en gris atténué celle qui ne mène nulle part', () => {
    expect(property('.sdd-nav', 'color')).toMatch(/--vscode-textLink-foreground/);
    expect(property('.sdd-nav-off', 'color')).toMatch(/--vscode-descriptionForeground/);
    expect(Number(property('.sdd-nav-off', 'opacity'))).toBeLessThan(1);
  });

  it('dessine les chevrons au trait, dans la couleur de la flèche', () => {
    expect(property('.sdd-chevron', 'stroke')).toBe('currentColor');
    expect(property('.sdd-chevron', 'fill')).toBe('none');
  });

  // Personne ne travaille sur un ancien plan : ses carrés « en cours » ou « en revue » ne doivent pas pulser.
  it('coupe la pulsation des carrés d’un plan passé, et l’emporte sur les états qui pulsent', () => {
    const stop = rules.find((rule) => rule.selectors.includes('.sdd.past .sdd-sq'));
    expect(stop).toBeDefined();
    expect(css.slice(stop!.index)).toMatch(/^[^{]*\{[^}]*animation:\s*none/);
    for (const pulsing of ['.sdd-sq.doing', '.sdd-sq.review']) {
      expect(compare(specificity('.sdd.past .sdd-sq'), specificity(pulsing)), pulsing).toBeGreaterThan(0);
    }
  });
});
