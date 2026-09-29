import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PRESETS, KILO_API_MODEL_CATALOG, getRuntimePresetKey } from '../src/config.js';
import {
  KILO_API_KEY_ENV,
  KILO_DEFAULT_MODEL,
  KILO_FALLBACK_MODELS,
  KILO_FREE_MODELS,
  KILO_GATEWAY_API_FORMAT,
  KILO_GATEWAY_BASE_URL,
  KILO_PROVIDER_ID,
  buildKiloProviderEntry,
  resolveKiloApiKey,
} from '../src/kilo-provider.js';

/**
 * The Kilo gateway is the platform's only model route, so this module is the
 * single answer to "which endpoint, which credential, which models". These
 * tests exist because that makes it a security-relevant file: the gateway JWT
 * must never be committed, and the free tier must stay selectable.
 */

const preset = DEFAULT_MODEL_PRESETS[getRuntimePresetKey()];

describe('Kilo gateway endpoint', () => {
  it('targets the kilocode.ai OpenAI-compatible gateway', () => {
    expect(KILO_GATEWAY_BASE_URL).toBe('https://kilocode.ai/api/gateway/v1');
    expect(KILO_GATEWAY_API_FORMAT).toBe('openai-completions');
  });

  it('builds a provider entry on that endpoint with no credential attached', () => {
    const entry = buildKiloProviderEntry();
    expect(entry.api).toBe(KILO_GATEWAY_API_FORMAT);
    expect(entry.npm).toBe('@ai-sdk/openai-compatible');
    expect(entry.options).toEqual({ baseURL: KILO_GATEWAY_BASE_URL });
    // A committed or defaulted apiKey here would ship a live credential.
    expect(Object.hasOwn(entry.options, 'apiKey')).toBe(false);
  });

  it('attaches a credential only when one is explicitly supplied', () => {
    expect(buildKiloProviderEntry('secret-value').options.apiKey).toBe('secret-value');
  });
});

describe('credential resolution', () => {
  it('prefers the environment over persisted config', () => {
    expect(
      resolveKiloApiKey('from-config', { [KILO_API_KEY_ENV]: 'from-env' }),
    ).toBe('from-env');
  });

  it('falls back to persisted config when the environment is empty', () => {
    expect(resolveKiloApiKey('from-config', { [KILO_API_KEY_ENV]: '   ' })).toBe('from-config');
  });

  it('treats a blank or absent credential as absent', () => {
    expect(resolveKiloApiKey('   ', {})).toBeUndefined();
    expect(resolveKiloApiKey(undefined, {})).toBeUndefined();
    expect(resolveKiloApiKey('', {})).toBeUndefined();
  });
});

describe('free-model catalog', () => {
  it('ships the free tier the gateway actually serves', () => {
    // The gateway advertises 19 free entries; two are audio-generation
    // previews kept for completeness but disabled, which is asserted below.
    expect(Object.keys(KILO_FREE_MODELS)).toHaveLength(19);
    expect(Object.keys(KILO_API_MODEL_CATALOG)).toHaveLength(19);
  });

  it('keeps the audio-generation previews present but disabled and unselectable', () => {
    for (const id of ['google/lyria-3-pro-preview', 'google/lyria-3-clip-preview']) {
      const model = KILO_FREE_MODELS[id];
      expect(model, id).toBeDefined();
      expect(model?.enabled, id).toBe(false);
      expect(model?.tool_call, id).toBe(false);
      expect(model?.modalities?.output, id).toEqual(['audio']);
    }
  });

  it('declares every enabled model as tool-capable and temperature-capable', () => {
    // An enabled model that cannot call tools is useless to this agent, so it
    // must be disabled rather than shipped in the picker.
    const enabled = Object.values(KILO_FREE_MODELS).filter((m) => m.enabled !== false);
    expect(enabled).toHaveLength(17);
    expect(enabled.filter((m) => m.tool_call === true)).toHaveLength(16);
    for (const model of enabled) {
      if (model.tool_call === false) continue;
      expect(model.temperature, model.id).toBe(true);
    }
  });

  it('gives every model a positive context and output budget', () => {
    for (const model of Object.values(KILO_FREE_MODELS)) {
      expect(model.limit?.context ?? 0, model.id).toBeGreaterThan(0);
      expect(model.limit?.output ?? 0, model.id).toBeGreaterThan(0);
    }
  });

  it('derives the model key from each catalog entry id', () => {
    for (const [key, model] of Object.entries(KILO_FREE_MODELS)) {
      expect(model.id, key).toBe(key);
    }
  });
});

describe('failover chain', () => {
  it('lists only models that exist in the catalog', () => {
    for (const id of KILO_FALLBACK_MODELS) {
      expect(KILO_FREE_MODELS[id], id).toBeDefined();
    }
  });

  it('prefers a tool-capable model and keeps the auto router first', () => {
    expect(KILO_FALLBACK_MODELS[0]).toBe(KILO_DEFAULT_MODEL);
    expect(KILO_FREE_MODELS[KILO_DEFAULT_MODEL]?.tool_call).toBe(true);
  });
});

describe('shipped preset', () => {
  it('routes only through Kilo and retains no MiniMax provider', () => {
    const providerIds = Object.keys(preset.provider);
    expect(providerIds).toEqual([KILO_PROVIDER_ID]);
    expect(providerIds).not.toContain('minimax');
  });

  it('boots into a Kilo model that exists in the catalog', () => {
    // Gateway model ids contain slashes ("kilo/kilo-auto/free"), so the key
    // format is `providerId/modelId` split on the FIRST slash only — the same
    // rule the model-key parsers apply.
    const separator = preset.defaultModel.indexOf('/');
    const providerId = preset.defaultModel.slice(0, separator);
    const modelId = preset.defaultModel.slice(separator + 1);
    expect(providerId).toBe(KILO_PROVIDER_ID);
    expect(modelId).toBe(KILO_DEFAULT_MODEL);
    expect(KILO_FREE_MODELS[modelId]).toBeDefined();
  });

  it('applies the failover order to the provider entry', () => {
    expect(buildKiloProviderEntry().model_order).toEqual(
      KILO_FALLBACK_MODELS.filter((id) => id in KILO_FREE_MODELS),
    );
  });
});
