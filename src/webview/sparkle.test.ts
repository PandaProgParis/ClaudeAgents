// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPARKLE_CLASS, sparkleStars } from './sparkle';

function stars(): HTMLElement {
  document.body.innerHTML = '<aside id="rate"><span class="msg">Coucou</span><span class="stars">★★★★★</span></aside>';
  return document.querySelector('#rate .stars') as HTMLElement;
}

describe('sparkleStars', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pose la classe qui déclenche l’animation CSS des étoiles', () => {
    const el = stars();
    sparkleStars(el);
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(true);
  });

  it('retire la classe à la fin de l’animation, pour pouvoir la rejouer au prochain message', () => {
    const el = stars();
    sparkleStars(el);
    el.dispatchEvent(new Event('animationend'));
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(false);
    sparkleStars(el);
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(true);
  });

  it('retire la classe de lui-même si animationend ne vient jamais (animations désactivées)', () => {
    const el = stars();
    sparkleStars(el, 800);
    vi.advanceTimersByTime(1_000);
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(false);
  });

  it('relancée pendant l’animation, elle repart de zéro sans laisser deux fins se chevaucher', () => {
    const el = stars();
    sparkleStars(el, 800);
    vi.advanceTimersByTime(500);
    sparkleStars(el, 800);
    vi.advanceTimersByTime(500);
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(true);
    vi.advanceTimersByTime(400);
    expect(el.classList.contains(SPARKLE_CLASS)).toBe(false);
  });

  it('ne fait rien sans élément', () => {
    expect(() => sparkleStars(null)).not.toThrow();
  });
});
