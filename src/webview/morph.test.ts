// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { morphChildren } from './morph';

/** Monte un conteneur réel avec le HTML initial. */
function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Construit le conteneur détaché représentant le nouvel état. */
function next(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('morphChildren', () => {
  it("préserve l'instance d'un élément keyed quand seul son contenu change", () => {
    const root = mount('<article data-key="sess:s1"><span class="timer">3 s</span></article>');
    const article = root.firstElementChild;
    const timer = root.querySelector('.timer');
    morphChildren(root, next('<article data-key="sess:s1"><span class="timer">4 s</span></article>'));
    expect(root.firstElementChild).toBe(article);
    expect(root.querySelector('.timer')).toBe(timer);
    expect(root.querySelector('.timer')?.textContent).toBe('4 s');
  });

  it('met à jour les attributs changés et retire les attributs absents', () => {
    const root = mount('<article data-key="sess:s1" class="card active" title="a"></article>');
    const article = root.firstElementChild;
    morphChildren(root, next('<article data-key="sess:s1" class="card"></article>'));
    expect(root.firstElementChild).toBe(article);
    expect(article?.getAttribute('class')).toBe('card');
    expect(article?.hasAttribute('title')).toBe(false);
  });

  it('réordonne les éléments keyed en préservant leurs instances', () => {
    const root = mount('<li data-key="ag:a">A</li><li data-key="ag:b">B</li>');
    const [a, b] = [...root.children];
    morphChildren(root, next('<li data-key="ag:b">B</li><li data-key="ag:a">A</li>'));
    expect([...root.children]).toEqual([b, a]);
  });

  it('supprime les éléments disparus et insère les nouveaux', () => {
    const root = mount('<li data-key="ag:a">A</li><li data-key="ag:b">B</li>');
    const a = root.firstElementChild;
    morphChildren(root, next('<li data-key="ag:a">A</li><li data-key="ag:c">C</li>'));
    expect(root.children).toHaveLength(2);
    expect(root.firstElementChild).toBe(a);
    expect(root.children[1].getAttribute('data-key')).toBe('ag:c');
    expect(root.textContent).toBe('AC');
  });

  it('remplace un nœud quand le tag diffère', () => {
    const root = mount('<p class="empty">vide</p>');
    morphChildren(root, next('<section data-key="proj:x"><h2>x</h2></section>'));
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild?.tagName).toBe('SECTION');
  });

  it('réutilise un nœud non-keyed de même tag et met à jour son texte', () => {
    const root = mount('<header><h3>titre</h3><span class="timer">3 s</span></header>');
    const header = root.firstElementChild;
    const h3 = root.querySelector('h3');
    morphChildren(root, next('<header><h3>titre</h3><span class="timer">5 s</span></header>'));
    expect(root.firstElementChild).toBe(header);
    expect(root.querySelector('h3')).toBe(h3);
    expect(root.querySelector('.timer')?.textContent).toBe('5 s');
  });

  it('synchronise récursivement les listes keyed imbriquées', () => {
    const root = mount(
      '<article data-key="sess:s1"><ul class="agents"><li data-key="ag:a">A</li><li data-key="ag:b">B</li></ul></article>',
    );
    const liB = root.querySelector('[data-key="ag:b"]');
    morphChildren(root, next('<article data-key="sess:s1"><ul class="agents"><li data-key="ag:b">B2</li></ul></article>'));
    expect(root.querySelectorAll('li')).toHaveLength(1);
    expect(root.querySelector('[data-key="ag:b"]')).toBe(liB);
    expect(liB?.textContent).toBe('B2');
  });
});
