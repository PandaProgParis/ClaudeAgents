import { describe, expect, it } from 'vitest';
import { extractLocalUrl } from './localUrl';

describe('extractLocalUrl', () => {
  it('lit la première adresse locale de la sortie', () => {
    expect(extractLocalUrl('\n> dev\nClaude Agents — aperçu live sur http://localhost:5173/  (Ctrl+C)')).toBe(
      'http://localhost:5173/',
    );
    expect(extractLocalUrl('  ➜  Local:   http://127.0.0.1:4321/app\n')).toBe('http://127.0.0.1:4321/app');
  });

  it('ne retient rien d’une adresse distante ou d’une sortie muette', () => {
    expect(extractLocalUrl('rien à voir https://example.com/')).toBeUndefined();
    expect(extractLocalUrl('')).toBeUndefined();
  });
});
