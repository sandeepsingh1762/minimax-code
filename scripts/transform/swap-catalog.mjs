// One-shot surgery: swap the MiniMax catalog/preset block in config.ts for the
// Kilo provider of record. Run once; the script is not idempotent in a way that
// matters because it fails loudly if the anchor text is already gone.
import fs from 'node:fs';

const target = 'packages/config/src/config.ts';
let src = fs.readFileSync(target, 'utf8');

const startAnchor = 'const MINIMAX_M3_FILE_API_CAPABILITIES: ModelCapabilitiesConfig = {';
const endAnchor = 'export const KILO_API_MODEL_CATALOG: Record<string, ModelConfig> =\n  MINIMAX_MODELS;';

const start = src.indexOf(startAnchor);
const end = src.indexOf(endAnchor);
if (start === -1 || end === -1) {
  console.error('ANCHOR_MISSING start=' + start + ' end=' + end);
  process.exit(1);
}

const replacement = `/**
 * First-party model catalog for the default route.
 *
 * Kilo is the provider of record; its catalog, gateway origin, credential
 * resolution and fallback chain all live in ./kilo-provider.ts so this file
 * cannot drift from the provider implementation.
 */
export const KILO_API_MODEL_CATALOG: Record<string, ModelConfig> = KILO_MODEL_CATALOG;`;

src = src.slice(0, start) + replacement + src.slice(end + endAnchor.length);
fs.writeFileSync(target, src);
console.log('CATALOG_BLOCK_REPLACED');
