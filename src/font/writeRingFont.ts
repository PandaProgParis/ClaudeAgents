import * as fs from 'fs';
import * as path from 'path';
import { buildRingFont } from './ringFont';

// `npm run font` : régénère media/usage-rings.woff (le test ringFont.test.ts vérifie qu'il est à jour).
const target = path.join(process.cwd(), 'media', 'usage-rings.woff');
fs.writeFileSync(target, buildRingFont());
console.log(`${target} écrit`);
