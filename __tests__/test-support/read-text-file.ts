import { readFileSync } from 'node:fs';

// A suite that spawns bash and only names doc paths as fixtures reads its logs through this:
// the doc-suite discovery (`harness_doc_suites`) selects a suite by `readFileSync` beside a
// quoted doc root, and such a suite would otherwise run in the Stop tier's doc step.
export const readTextFile = (path: string): string => readFileSync(path, 'utf8');
