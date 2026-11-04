// Builds one self-contained index.html: CSS, JSON data and the three JS modules inlined.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Strip ESM import/export syntax so the modules share one function scope.
function unmodule(src, name) {
  const out = src
    .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
  if (/^\s*(import|export)\s/m.test(out)) throw new Error(`${name}: unhandled import/export`);
  return `// ---- ${name} ----\n${out}`;
}

// JSON inside <script type="application/json">: escape "<" so "</script>" can't end the block.
const safeJSON = (rel) => JSON.stringify(JSON.parse(read(rel))).replace(/</g, '\\u003c');

const js = ['src/engine.js', 'src/interpreter.js', 'src/app.js'].map((f) => unmodule(read(f), f)).join('\n');
const bundle = `(function () {\n'use strict';\n${js}\n})();`;
new vm.Script(bundle, { filename: 'bundle.js' }); // syntax check (throws on duplicate declarations)

let html = read('src/template.html');
const put = (marker, value) => {
  if (!html.includes(marker)) throw new Error('template marker missing: ' + marker);
  html = html.split(marker).join(value);
};
put('/*__CSS__*/', read('src/style.css'));
put('/*__FACTS__*/', safeJSON('src/data/facts.json'));
put('/*__TREE__*/', safeJSON('src/data/tree.json'));
if (/<\/script/i.test(bundle)) throw new Error('bundle contains </script');
put('/*__JS__*/', bundle);

// Requirement 1 guards.
const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bimport\s*\(/, /\beval\s*\(/, /new\s+Function/, /<link\b/i, /\bsrc\s*=\s*["']https?:/i, /sendBeacon/, /WebSocket/];
for (const re of banned) if (re.test(html)) throw new Error('banned construct in build: ' + re);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html written: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
