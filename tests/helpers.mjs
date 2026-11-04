import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFacts } from '../src/engine.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
// Value-asserting tests use a frozen copy of the facts as of 2026-11-03, so a legitimate data refresh
// in src/data never breaks them. Tests about the shipped data use shippedFactsDoc().
export const factsDoc = () => readJSON('tests/fixtures/facts-2026-11-03.json');
export const shippedFactsDoc = () => readJSON('src/data/facts.json');
export const tree = () => readJSON('src/data/tree.json');
export const facts = () => indexFacts(factsDoc());
export const TODAY = '2026-11-03';
