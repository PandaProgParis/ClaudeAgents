import { RING_STEPS } from '../usageStatus';

/**
 * Police d'icônes des anneaux d'usage de la barre d'état (`contributes.icons`) : la barre d'état n'affiche que
 * des glyphes de police et les codicons n'ont pas de jauge. Un glyphe par cran, U+E000 (vide) à U+E008 (plein).
 * Générée sans dépendance : TrueType minimal (contours quadratiques), enveloppé en WOFF sans compression
 * pour que le fichier livré soit reproductible octet pour octet (`npm run font`).
 */

export const RING_FIRST_CODEPOINT = 0xe000;

const UNITS_PER_EM = 1000;
/** Mêmes métriques que les codicons : ascendante = em, descendante nulle, glyphe centré dans le carré. */
const CENTER = 500;
const OUTER = 440;
/** Rail fin (≈ 1 px à 16 px) et arc de progression épais (≈ 3 px). */
const TRACK_INNER = 370;
const ARC_INNER = 250;
const SEGMENT_DEGREES = 45;
/** 2026-09-15 en secondes depuis le 1er janvier 1904 (horloge des polices), sur 32 bits bas. */
const FONT_DATE = (Date.UTC(2026, 8, 15) / 1000 + 2_082_844_800) >>> 0;

interface Point {
  x: number;
  y: number;
  on: boolean;
}

type Contour = Point[];

/** Angle en degrés compté depuis midi, dans le sens horaire (repère TrueType : y vers le haut). */
function pointAt(radius: number, degrees: number, on: boolean): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.round(CENTER + radius * Math.sin(radians)), y: Math.round(CENTER + radius * Math.cos(radians)), on };
}

/** Arc de `from` à `to` (degrés, sens quelconque) en segments quadratiques d'au plus 45°, extrémités comprises. */
function arc(radius: number, from: number, to: number): Point[] {
  const segments = Math.max(1, Math.ceil(Math.abs(to - from) / SEGMENT_DEGREES));
  const span = (to - from) / segments;
  const control = radius / Math.cos((Math.abs(span) / 2) * (Math.PI / 180));
  const points = [pointAt(radius, from, true)];
  for (let i = 0; i < segments; i++) {
    points.push(pointAt(control, from + span * (i + 0.5), false), pointAt(radius, from + span * (i + 1), true));
  }
  return points;
}

/** Cercle fermé : sens horaire pour une surface pleine, anti-horaire pour un trou. */
function circle(radius: number, clockwise: boolean): Contour {
  const points = arc(radius, 0, clockwise ? 360 : -360);
  return points.slice(0, -1);
}

function ringContours(step: number): Contour[] {
  if (step >= RING_STEPS) {
    return [circle(OUTER, true), circle(ARC_INNER, false)];
  }
  const track = [circle(OUTER, true), circle(TRACK_INNER, false)];
  if (step <= 0) {
    return track;
  }
  const end = (360 * step) / RING_STEPS;
  return [...track, [...arc(OUTER, 0, end), ...arc(ARC_INNER, end, 0)]];
}

class Writer {
  private readonly bytes: number[] = [];
  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }
  u16(value: number): this {
    return this.u8(value >> 8).u8(value);
  }
  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value);
  }
  u32(value: number): this {
    return this.u16(value >>> 16).u16(value & 0xffff);
  }
  tag(value: string): this {
    for (const char of value) {
      this.u8(char.charCodeAt(0));
    }
    return this;
  }
  raw(data: Uint8Array): this {
    for (const byte of data) {
      this.u8(byte);
    }
    return this;
  }
  pad4(): this {
    while (this.bytes.length % 4 !== 0) {
      this.u8(0);
    }
    return this;
  }
  get length(): number {
    return this.bytes.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

interface Box {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function encodeGlyph(contours: Contour[]): { data: Uint8Array; box: Box; points: number } {
  const all = contours.flat();
  const box = {
    xMin: Math.min(...all.map((p) => p.x)),
    yMin: Math.min(...all.map((p) => p.y)),
    xMax: Math.max(...all.map((p) => p.x)),
    yMax: Math.max(...all.map((p) => p.y)),
  };
  const out = new Writer().i16(contours.length).i16(box.xMin).i16(box.yMin).i16(box.xMax).i16(box.yMax);
  let last = -1;
  for (const contour of contours) {
    last += contour.length;
    out.u16(last);
  }
  out.u16(0); // pas d'instructions
  // Coordonnées toujours en deltas int16 : seul le bit « sur la courbe » est posé.
  for (const point of all) {
    out.u8(point.on ? 1 : 0);
  }
  let previous = 0;
  for (const point of all) {
    out.i16(point.x - previous);
    previous = point.x;
  }
  previous = 0;
  for (const point of all) {
    out.i16(point.y - previous);
    previous = point.y;
  }
  return { data: out.pad4().done(), box, points: all.length };
}

function utf16be(text: string): Uint8Array {
  const out = new Writer();
  for (const char of text) {
    out.u16(char.charCodeAt(0));
  }
  return out.done();
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function buildTables(): Map<string, Uint8Array> {
  const glyphs = [
    { data: new Uint8Array(0), box: undefined as Box | undefined, points: 0, contours: 0 },
    ...Array.from({ length: RING_STEPS + 1 }, (_, step) => {
      const contours = ringContours(step);
      return { ...encodeGlyph(contours), contours: contours.length };
    }),
  ];
  const boxes = glyphs.flatMap((glyph) => (glyph.box ? [glyph.box] : []));
  const bounds: Box = {
    xMin: Math.min(...boxes.map((b) => b.xMin)),
    yMin: Math.min(...boxes.map((b) => b.yMin)),
    xMax: Math.max(...boxes.map((b) => b.xMax)),
    yMax: Math.max(...boxes.map((b) => b.yMax)),
  };
  const numGlyphs = glyphs.length;

  const glyf = new Writer();
  const loca = new Writer();
  for (const glyph of glyphs) {
    loca.u32(glyf.length);
    glyf.raw(glyph.data);
  }
  loca.u32(glyf.length);

  const hmtx = new Writer();
  for (const glyph of glyphs) {
    hmtx.u16(UNITS_PER_EM).i16(glyph.box?.xMin ?? 0);
  }

  const head = new Writer()
    .u32(0x00010000) // version
    .u32(0x00010000) // fontRevision
    .u32(0) // checkSumAdjustment, posé une fois la police assemblée
    .u32(0x5f0f3cf5)
    .u16(0x000b) // flags : ligne de base à y=0, lsb à x=0, ppem entiers
    .u16(UNITS_PER_EM)
    .u32(0)
    .u32(FONT_DATE) // created (date fixe : fichier reproductible)
    .u32(0)
    .u32(FONT_DATE) // modified
    .i16(bounds.xMin)
    .i16(bounds.yMin)
    .i16(bounds.xMax)
    .i16(bounds.yMax)
    .u16(0) // macStyle
    .u16(8) // lowestRecPPEM
    .i16(2) // fontDirectionHint
    .i16(1) // indexToLocFormat : loca en uint32
    .i16(0);

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(UNITS_PER_EM) // ascender
    .i16(0) // descender
    .i16(0) // lineGap
    .u16(UNITS_PER_EM) // advanceWidthMax
    .i16(bounds.xMin) // minLeftSideBearing
    .i16(UNITS_PER_EM - bounds.xMax) // minRightSideBearing
    .i16(bounds.xMax) // xMaxExtent
    .i16(1)
    .i16(0)
    .i16(0) // caret
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0) // réservés
    .i16(0) // metricDataFormat
    .u16(numGlyphs);

  const maxp = new Writer()
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(Math.max(...glyphs.map((g) => g.points)))
    .u16(Math.max(...glyphs.map((g) => g.contours)))
    .u16(0)
    .u16(0) // composites
    .u16(2) // maxZones
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0);

  const last = RING_FIRST_CODEPOINT + RING_STEPS;
  const cmap = new Writer()
    .u16(0) // version
    .u16(1) // une sous-table
    .u16(3)
    .u16(1)
    .u32(12) // Windows, Unicode BMP
    .u16(4) // format 4
    .u16(32) // longueur
    .u16(0) // language
    .u16(4) // segCountX2
    .u16(4) // searchRange
    .u16(1) // entrySelector
    .u16(0) // rangeShift
    .u16(last)
    .u16(0xffff) // endCode
    .u16(0) // reservedPad
    .u16(RING_FIRST_CODEPOINT)
    .u16(0xffff) // startCode
    .u16((1 - RING_FIRST_CODEPOINT) & 0xffff)
    .u16(1) // idDelta : U+E000 → glyphe 1
    .u16(0)
    .u16(0); // idRangeOffset

  const os2 = new Writer()
    .u16(4) // version
    .i16(UNITS_PER_EM) // xAvgCharWidth
    .u16(400)
    .u16(5)
    .u16(0) // poids, chasse, fsType
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(75) // indice
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(350) // exposant
    .i16(50)
    .i16(258) // barré
    .i16(0) // sFamilyClass
    .raw(new Uint8Array(10)) // panose
    .u32(0)
    .u32(0x10000000) // ulUnicodeRange2 bit 60 : zone à usage privé
    .u32(0)
    .u32(0)
    .tag('PNDA')
    .u16(0x0040) // fsSelection : REGULAR
    .u16(RING_FIRST_CODEPOINT)
    .u16(last)
    .i16(UNITS_PER_EM)
    .i16(0)
    .i16(0) // sTypo*
    .u16(UNITS_PER_EM)
    .u16(0) // usWin*
    .u32(1)
    .u32(0) // ulCodePageRange
    .i16(0)
    .i16(0) // sxHeight, sCapHeight
    .u16(0)
    .u16(32)
    .u16(1); // usDefaultChar, usBreakChar, usMaxContext

  const names: Array<[number, string]> = [
    [1, 'Claude Agents Usage Rings'],
    [2, 'Regular'],
    [3, 'claude-agents-usage-rings'],
    [4, 'Claude Agents Usage Rings'],
    [5, 'Version 1.0'],
    [6, 'ClaudeAgentsUsageRings'],
  ];
  const name = new Writer().u16(0).u16(names.length).u16(6 + names.length * 12);
  const strings = new Writer();
  for (const [id, text] of names) {
    const encoded = utf16be(text);
    name.u16(3).u16(1).u16(0x0409).u16(id).u16(encoded.length).u16(strings.length);
    strings.raw(encoded);
  }
  name.raw(strings.done());

  const post = new Writer().u32(0x00030000).u32(0).i16(-75).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);

  return new Map([
    ['OS/2', os2.done()],
    ['cmap', cmap.done()],
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp.done()],
    ['name', name.done()],
    ['post', post.done()],
  ]);
}

const pad4 = (length: number): number => (length + 3) & ~3;

/** Police TrueType assemblée, utile au calcul de checkSumAdjustment (somme de toute la police). */
function sfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const count = tables.size;
  const out = new Writer().u32(0x00010000).u16(count).u16(128).u16(3).u16(count * 16 - 128);
  let offset = 12 + count * 16;
  for (const [tag, data] of tables) {
    out.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += pad4(data.length);
  }
  for (const data of tables.values()) {
    out.raw(data).pad4();
  }
  return out.done();
}

export function buildRingFont(): Uint8Array {
  const tables = buildTables();
  const checks = new Map([...tables].map(([tag, data]) => [tag, checksum(data)]));
  const head = tables.get('head')!;
  const adjustment = (0xb1b0afba - checksum(sfnt(tables))) >>> 0;
  new DataView(head.buffer, head.byteOffset, head.byteLength).setUint32(8, adjustment);

  const count = tables.size;
  const sfntSize = 12 + count * 16 + [...tables.values()].reduce((total, data) => total + pad4(data.length), 0);
  let offset = 44 + count * 20;
  const directory = new Writer();
  for (const [tag, data] of tables) {
    directory.tag(tag).u32(offset).u32(data.length).u32(data.length).u32(checks.get(tag)!);
    offset += pad4(data.length);
  }
  const body = new Writer();
  for (const data of tables.values()) {
    body.raw(data).pad4();
  }
  return new Writer()
    .tag('wOFF')
    .u32(0x00010000) // flavor TrueType
    .u32(offset) // longueur totale
    .u16(count)
    .u16(0)
    .u32(sfntSize)
    .u16(1)
    .u16(0) // version du fichier
    .u32(0)
    .u32(0)
    .u32(0) // métadonnées
    .u32(0)
    .u32(0) // données privées
    .raw(directory.done())
    .raw(body.done())
    .done();
}
