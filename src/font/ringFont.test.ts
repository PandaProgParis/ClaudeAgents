import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { RING_ICON_PREFIX, RING_STEPS } from '../usageStatus';
import { RING_FIRST_CODEPOINT, buildRingFont } from './ringFont';

/** Lecture minimale du WOFF produit (tables stockées sans compression) : de quoi vérifier ce que VS Code chargera. */
function readWoff(bytes: Uint8Array): { signature: string; tables: Map<string, DataView>; checksums: Map<string, number> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const numTables = view.getUint16(12);
  const tables = new Map<string, DataView>();
  const checksums = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    const offset = view.getUint32(entry + 4);
    const compLength = view.getUint32(entry + 8);
    const origLength = view.getUint32(entry + 12);
    expect(compLength).toBe(origLength);
    tables.set(tag, new DataView(bytes.buffer, bytes.byteOffset + offset, origLength));
    checksums.set(tag, view.getUint32(entry + 16));
  }
  return { signature, tables, checksums };
}

function tableChecksum(table: DataView): number {
  let sum = 0;
  for (let i = 0; i < table.byteLength; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      word = (word << 8) | (i + j < table.byteLength ? table.getUint8(i + j) : 0);
    }
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/** Glyphe associé à un point de code par la sous-table cmap format 4. */
function glyphFor(cmap: DataView, codepoint: number): number {
  const subtable = cmap.getUint32(8);
  const segCount = cmap.getUint16(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  for (let i = 0; i < segCount; i++) {
    if (codepoint <= cmap.getUint16(ends + i * 2) && codepoint >= cmap.getUint16(starts + i * 2)) {
      return (codepoint + cmap.getUint16(deltas + i * 2)) & 0xffff;
    }
  }
  return 0;
}

function contoursOf(tables: Map<string, DataView>, glyph: number): number {
  const loca = tables.get('loca')!;
  const start = loca.getUint32(glyph * 4);
  const end = loca.getUint32((glyph + 1) * 4);
  return end === start ? 0 : tables.get('glyf')!.getInt16(start);
}

describe('buildRingFont', () => {
  const font = buildRingFont();
  const { signature, tables, checksums } = readWoff(font);

  it('produit un WOFF TrueType avec les tables exigées par le moteur de polices du navigateur', () => {
    expect(signature).toBe('wOFF');
    expect([...tables.keys()].sort()).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
    expect(tables.get('maxp')!.getUint16(4)).toBe(RING_STEPS + 2);
  });

  it('déclare pour chaque table la somme de contrôle de ses données', () => {
    for (const [tag, table] of tables) {
      if (tag !== 'head') {
        expect(checksums.get(tag), tag).toBe(tableChecksum(table));
      }
    }
  });

  it('associe un glyphe à chaque cran, de U+E000 (vide) à U+E008 (plein)', () => {
    const cmap = tables.get('cmap')!;
    for (let step = 0; step <= RING_STEPS; step++) {
      expect(glyphFor(cmap, RING_FIRST_CODEPOINT + step)).toBe(step + 1);
    }
  });

  it('dessine le rail seul à vide, rail + arc en cours, et un anneau épais plein', () => {
    expect(contoursOf(tables, 1)).toBe(2);
    expect(contoursOf(tables, 1 + RING_STEPS / 2)).toBe(3);
    expect(contoursOf(tables, 1 + RING_STEPS)).toBe(2);
  });

  it('est contribuée au manifeste : une icône par cran, sur le bon point de code', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const icons = manifest.contributes.icons as Record<string, { default: { fontPath: string; fontCharacter: string } }>;
    for (let step = 0; step <= RING_STEPS; step++) {
      const icon = icons[`${RING_ICON_PREFIX}${step}`];
      expect(icon.default.fontPath).toBe('./media/usage-rings.woff');
      expect(icon.default.fontCharacter).toBe(`\\${(RING_FIRST_CODEPOINT + step).toString(16).toUpperCase()}`);
    }
  });

  it('correspond au fichier livré dans media/ (régénérer avec npm run font)', () => {
    const shipped = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'usage-rings.woff'));
    expect(Buffer.compare(shipped, Buffer.from(font))).toBe(0);
  });
});
