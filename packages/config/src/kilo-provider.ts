/**
 * Kilo gateway provider — the platform's default and primary model route.
 *
 * Kilo exposes an OpenAI-compatible gateway, so every model is driven through
 * the generic `openai-completions` transport: no bespoke protocol, no managed
 * login, no first-party-only auth scheme. This module owns the one answer to
 * "what is the Kilo route and which models may it call", so the catalog, the
 * default preset and the model resolver cannot disagree.
 *
 * Credentials are deliberately NOT a constant here. The gateway JWT is a
 * secret and this repository runs Gitleaks plus a credential scan over source,
 * so the key is resolved at runtime from `KILO_API_KEY` or from the
 * lock-protected BYOK config tree. A committed literal would both fail
 * verification and leak the token.
 *
 * Pure by contract: no fs, no process state beyond an explicit env read.
 */

import type { ModelConfig, ProviderConfig } from './config.js';

/** Reserved provider id mirrored by the model-key parsers. */
export const KILO_PROVIDER_ID = 'kilo';

/** Gateway origin. `api.kilo.ai` rejects this token; `kilocode.ai` serves it. */
export const KILO_GATEWAY_BASE_URL = 'https://kilocode.ai/api/gateway/v1';

/** Every Kilo model is driven through the generic OpenAI-compatible transport. */
export const KILO_GATEWAY_API_FORMAT = 'openai-completions';

/** Environment variable consulted before the persisted config. */
export const KILO_API_KEY_ENV = 'KILO_API_KEY';

/** Live catalog endpoint; also used to refresh the free-model set. */
export const KILO_MODELS_ENDPOINT = `${KILO_GATEWAY_BASE_URL}/models`;

/** Model the platform boots into. Tool-capable and tool-call reliable. */
export const KILO_DEFAULT_MODEL = 'kilo-auto/free';

/**
 * Free tier of the gateway, captured from a live `/models` read. `:free`
 * suffixed ids remain free indefinitely; `kilo-auto/free` and a few
 * unprefixed ids are free by provider policy. Non-text-only entries keep
 * their real modalities so attachment gating stays truthful.
 */
export const KILO_FREE_MODELS: Record<string, ModelConfig> = {
  'kilo-auto/free': {
    id: 'kilo-auto/free',
    name: 'Kilo Auto Free (rotating)',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 256_000, output: 32_768 },
  },
  'stealth/space-bunny-alpha': {
    id: 'stealth/space-bunny-alpha',
    name: 'Space Bunny Alpha',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image', 'video'], output: ['text'] },
    limit: { context: 1_000_000, output: 524_288 },
  },
  'poolside/laguna-s-2.1:free': {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S 2.1',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 262_144, output: 32_768 },
  },
  'nvidia/nemotron-3-ultra-550b-a55b:free': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA Nemotron 3 Ultra',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 1_000_000, output: 65_536 },
  },
  'dots-studio/dots-3-note-preview:free': {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots Studio Dots3-Note',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 512_000, output: 460_800 },
  },
  'inclusionai/ling-3.0-flash-sante:free': {
    id: 'inclusionai/ling-3.0-flash-sante:free',
    name: 'inclusionAI Ling 3.0 Flash Sante',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 262_144, output: 32_768 },
  },
  'qwen/qwen3.8-27b:free': {
    id: 'qwen/qwen3.8-27b:free',
    name: 'Qwen3.8 27B',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image', 'video'], output: ['text'] },
    limit: { context: 262_144, output: 235_929 },
  },
  'thinkingmachines/inkling-small:free': {
    id: 'thinkingmachines/inkling-small:free',
    name: 'Thinking Machines Inkling Small',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
    limit: { context: 1_048_576, output: 262_144 },
  },
  'poolside/laguna-xs-2.1:free': {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 262_144, output: 32_768 },
  },
  'cohere/north-mini-code:free': {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 256_000, output: 64_000 },
  },
  'nvidia/nemotron-3.5-content-safety:free': {
    id: 'nvidia/nemotron-3.5-content-safety:free',
    name: 'NVIDIA Nemotron 3.5 Content Safety',
    reasoning: true,
    tool_call: false,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 128_000, output: 8_192 },
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA Nemotron 3 Nano Omni',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] },
    limit: { context: 256_000, output: 65_536 },
  },
  'nvidia/nemotron-3-super-120b-a12b:free': {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'NVIDIA Nemotron 3 Super 120B',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 262_144, output: 235_929 },
  },
  'openrouter/free': {
    id: 'openrouter/free',
    name: 'OpenRouter Free Router',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 200_000, output: 8_192 },
  },
  'stepfun/step-3.7-flash:free': {
    id: 'stepfun/step-3.7-flash:free',
    name: 'StepFun Step 3.7 Flash',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 262_144, output: 262_144 },
  },
  'liquid/lfm-2.5-2.6b:free': {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'LiquidAI LFM2.5-2.6B',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 65_536, output: 8_192 },
  },
  'nvidia/nemotron-3.5-lightning:free': {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA Nemotron 3.5 Lightning',
    reasoning: true,
    tool_call: true,
    temperature: true,
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 1_000_000, output: 65_536 },
  },
  // Audio-generation previews. Free but not language models: no tool calling
  // and no text-completion contract, so they stay in the catalog for
  // completeness yet disabled and out of the picker.
  'google/lyria-3-pro-preview': {
    id: 'google/lyria-3-pro-preview',
    name: 'Google Lyria 3 Pro Preview',
    enabled: false,
    reasoning: false,
    tool_call: false,
    temperature: false,
    attachment: false,
    modalities: { input: ['text', 'image'], output: ['audio'] },
    limit: { context: 1_048_576, output: 65_536 },
  },
  'google/lyria-3-clip-preview': {
    id: 'google/lyria-3-clip-preview',
    name: 'Google Lyria 3 Clip Preview',
    enabled: false,
    reasoning: false,
    tool_call: false,
    temperature: false,
    attachment: false,
    modalities: { input: ['text', 'image'], output: ['audio'] },
    limit: { context: 1_048_576, output: 65_536 },
  },
};

/**
 * Ordered failover chain. The free tier returns transient upstream 5xx when a
 * provider is saturated, so the runtime walks this list before surfacing an
 * error. Ordering prefers tool-reliable, long-context entries first.
 */
export const KILO_FALLBACK_MODELS: readonly string[] = [
  'kilo-auto/free',
  'stealth/space-bunny-alpha',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3.8-27b:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-s-2.1:free',
  'stepfun/step-3.7-flash:free',
  'thinkingmachines/inkling-small:free',
  'openrouter/free',
];

/** Full Kilo catalog. Free tier is the shipping default. */
export const KILO_MODEL_CATALOG: Record<string, ModelConfig> = KILO_FREE_MODELS;

/** Resolve the gateway credential: environment first, then persisted config. */
export function resolveKiloApiKey(
  persisted: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const fromEnv = env[KILO_API_KEY_ENV]?.trim() || env['MCODE_PROVIDER_API_KEY']?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = persisted?.trim();
  return fromConfig && fromConfig.length > 0 ? fromConfig : undefined;
}

/**
 * Build the Kilo provider entry. `apiKey` is injected by the caller from the
 * resolved credential; omitting it yields a configuration-only entry, which is
 * what a fresh profile writes before a key is present.
 */
export function buildKiloProviderEntry(apiKey?: string): ProviderConfig {
  return {
    api: KILO_GATEWAY_API_FORMAT,
    name: 'Kilo',
    npm: '@ai-sdk/openai-compatible',
    options: {
      ...(apiKey ? { apiKey } : {}),
      baseURL: KILO_GATEWAY_BASE_URL,
    },
    models: KILO_MODEL_CATALOG,
    model_order: KILO_FALLBACK_MODELS.filter((id) => id in KILO_MODEL_CATALOG),
  };
}

