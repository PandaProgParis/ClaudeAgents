import type { WorkflowPhase } from './types';

/** Ce qu'un script de workflow déclare de lui-même dans son bloc `export const meta = { … }` (littéral pur). */
export interface WorkflowMeta {
  description?: string;
  phases?: WorkflowPhase[];
}

/** Le bloc meta se termine par une accolade en début de ligne ; les objets de phases sont indentés. */
const META_BLOCK_PATTERN = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/;
/** Chaîne JS entre ', " ou `, échappements compris : groupe 1 = guillemet, groupe 2 = contenu. */
const STRING_SOURCE = '([\'"`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1';
const DESCRIPTION_PATTERN = new RegExp('\\bdescription\\s*:\\s*' + STRING_SOURCE);
const PHASES_PATTERN = /\bphases\s*:\s*\[([\s\S]*?)\]/;
const PHASE_OBJECT_PATTERN = /\{[^{}]*\}/g;
const TITLE_PATTERN = new RegExp('\\btitle\\s*:\\s*' + STRING_SOURCE);
const DETAIL_PATTERN = new RegExp('\\bdetail\\s*:\\s*' + STRING_SOURCE);

function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

/** Description et phases prévues, lues dans le bloc meta seulement (un `title` ailleurs dans le script n'est pas une phase). */
export function parseWorkflowMeta(script: string): WorkflowMeta {
  const block = META_BLOCK_PATTERN.exec(script)?.[1];
  if (block === undefined) {
    return {};
  }
  const meta: WorkflowMeta = {};
  const description = DESCRIPTION_PATTERN.exec(block);
  if (description) {
    meta.description = unescape(description[2]);
  }
  const phasesBlock = PHASES_PATTERN.exec(block)?.[1];
  if (phasesBlock !== undefined) {
    const phases: WorkflowPhase[] = [];
    for (const object of phasesBlock.match(PHASE_OBJECT_PATTERN) ?? []) {
      const title = TITLE_PATTERN.exec(object);
      if (!title) {
        continue;
      }
      const detail = DETAIL_PATTERN.exec(object);
      phases.push(detail ? { title: unescape(title[2]), detail: unescape(detail[2]) } : { title: unescape(title[2]) });
    }
    if (phases.length > 0) {
      meta.phases = phases;
    }
  }
  return meta;
}
