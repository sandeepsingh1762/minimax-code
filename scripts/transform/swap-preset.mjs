// Second surgery pass: point the builtin provider preset at the Kilo gateway
// and rebuild the default preset entry from the Kilo provider definition.
import fs from 'node:fs';

const target = 'packages/config/src/config.ts';
let src = fs.readFileSync(target, 'utf8');

function replaceOnce(from, to, label) {
  const i = src.indexOf(from);
  if (i === -1) {
    console.error('ANCHOR_MISSING ' + label);
    process.exit(1);
  }
  if (src.indexOf(from, i + 1) !== -1) {
    console.error('ANCHOR_AMBIGUOUS ' + label);
    process.exit(1);
  }
  src = src.slice(0, i) + to + src.slice(i + from.length);
  console.log('OK ' + label);
}

// 1. Import the Kilo provider definition.
replaceOnce(
  `import { resolveDataDir } from "./data-dir.js";`,
  `import { resolveDataDir } from "./data-dir.js";
import { KILO_DEFAULT_MODEL, KILO_GATEWAY_BASE_URL, KILO_MODEL_CATALOG, buildKiloProviderEntry } from "./kilo-provider.js";`,
  'import',
);

// 2. All region presets collapse onto the single Kilo gateway origin.
const presetStart = 'const PRESET_BASE_URLS: Record<PresetKey, string> = {';
const presetEnd = '};';
const ps = src.indexOf(presetStart);
if (ps === -1) {
  console.error('ANCHOR_MISSING preset-block');
  process.exit(1);
}
const pe = src.indexOf(presetEnd, ps);
src =
  src.slice(0, ps) +
  `/**
 * The builtin provider is Kilo, which serves one gateway origin for every
 * region/build combination. The preset map is retained so preset-keyed lookups
 * keep working, but every key resolves to the same Kilo endpoint.
 */
const PRESET_BASE_URLS: Record<PresetKey, string> = {
  "cn-test": KILO_GATEWAY_BASE_URL,
  "cn-dev": KILO_GATEWAY_BASE_URL,
  "cn-staging": KILO_GATEWAY_BASE_URL,
  "cn-prod": KILO_GATEWAY_BASE_URL,
  "en-test": KILO_GATEWAY_BASE_URL,
  "en-dev": KILO_GATEWAY_BASE_URL,
  "en-staging": KILO_GATEWAY_BASE_URL,
  "en-prod": KILO_GATEWAY_BASE_URL,
};` +
  src.slice(pe + presetEnd.length);
console.log('OK preset-block');

// 3. Legacy managed origins no longer describe a reachable upstream.
replaceOnce(
  `const LEGACY_MANAGED_PRESET_BASE_URLS = [
  "https://agent.minimaxi.com/mavis/api/v1/llm/v1",
] as const;`,
  `const LEGACY_MANAGED_PRESET_BASE_URLS = [] as const;`,
  'legacy-origins',
);

// 4. Build the default preset from the Kilo provider definition.
replaceOnce(
  `function buildPresetEntry(key: PresetKey) {
  const provider: ProviderConfig = {
    name: "MiniMax",
    npm: "@ai-sdk/anthropic",
    options: {
      authMode: "managed-login",
      apiKey: "sk-xxx",
      baseURL: PRESET_BASE_URLS[key],
    },
    models: MINIMAX_MODELS,
  };
  return {
    provider: { minimax: provider } as ModelsConfig,
    defaultModel: "minimax/MiniMax-M3",
  };
}`,
  `/**
 * Build the first-run provider preset. Kilo is an OpenAI-compatible BYOK
 * gateway, so there is no managed-login auth mode and no placeholder key: the
 * credential is supplied by KILO_API_KEY or the lock-protected BYOK config.
 */
function buildPresetEntry(_key: PresetKey) {
  const provider = buildKiloProviderEntry();
  return {
    provider: { kilo: provider } as ModelsConfig,
    defaultModel: \`kilo/\${KILO_DEFAULT_MODEL}\`,
  };
}`,
  'buildPresetEntry',
);

fs.writeFileSync(target, src);
console.log('PRESET_PASS_DONE');
