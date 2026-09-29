// Propagate the provider-identity rename from MiniMax to Kilo across the
// workspace. Symbol-level only: string literals are handled deliberately in
// the modules that own them, so this pass cannot silently rewrite user-facing
// copy or unrelated `minimax` mentions.
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['packages', 'scripts', 'test', 'docs', 'release'];
const EXT = new Set(['.ts', '.mts', '.cts', '.mjs', '.json', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'third_party']);

const RENAMES = [
  ['KILO_PROVIDER_ID', 'KILO_PROVIDER_ID'],
  ['KILO_API_PROVIDER_ID', 'KILO_API_PROVIDER_ID'],
  ['KILO_API_MODEL_CATALOG', 'KILO_API_MODEL_CATALOG'],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let changedFiles = 0;
let changedHits = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    let src = fs.readFileSync(file, 'utf8');
    const before = src;
    for (const [from, to] of RENAMES) {
      const parts = src.split(from);
      if (parts.length > 1) {
        changedHits += parts.length - 1;
        src = parts.join(to);
      }
    }
    if (src !== before) {
      fs.writeFileSync(file, src);
      changedFiles += 1;
    }
  }
}
console.log(`RENAMED files=${changedFiles} hits=${changedHits}`);
