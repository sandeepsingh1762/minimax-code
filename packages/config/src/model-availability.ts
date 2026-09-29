// Route-aware model availability.
//
// A model id alone says nothing about whether it can be called: the same
// `minimax/MiniMax-M2.7` is a retired token-plan model on one backend and a
// perfectly callable BYOK model on a user's own API key. This module owns the
// one answer to "may this route call this model", so the local model list, the
// save entry (`selectModel`) and the Turn execution gate cannot disagree and
// let a locally-known model reach a backend that retired it.
//
// Pure by contract: no fs, no process state, no runtime types. Callers pass a
// structured read-only view of the effective config plus the runtime PresetKey.
// Do not use a resolver's generic limit fallback as a validity signal — an
// unknown model resolving to default limits is exactly the bug this replaces.

import { KILO_API_MODEL_CATALOG, type PresetKey } from './config.js';
import { resolveProviderAuthMode } from './provider-auth-mode.js';

/** Reserved provider ids, mirrored by the local-runtime model-key parsers. */
export const KILO_PROVIDER_ID = 'kilo';
export const KILO_API_PROVIDER_ID = 'kilo_api';
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom_provider:';

/** Which upstream a selected model would actually be called through. */
export type ModelCallRoute =
  | 'kilo_gateway'
  | 'kilo_api_key'
  | 'custom_provider'
  | 'configured_provider';

/** Where the selected model came from; decides the failure handling. */
export type ModelSelectionSource = 'explicit_request' | 'session_override' | 'config_default';

export type ModelAvailabilityErrorCode =
  | 'MODEL_NOT_AVAILABLE_FOR_ROUTE'
  | 'DEFAULT_MODEL_NOT_AVAILABLE_FOR_ROUTE';

export interface ModelAvailabilityProviderView {
  readonly options?: {
    readonly authMode?: unknown;
    readonly baseURL?: unknown;
    readonly [key: string]: unknown;
  };
  readonly models?: Readonly<Record<string, { readonly enabled?: unknown }>>;
  readonly model_order?: unknown;
}

export interface ModelAvailabilityCustomProviderView extends ModelAvailabilityProviderView {
  readonly enabled?: boolean;
}

/** Read-only projection of the effective config this module needs. */
export interface ModelAvailabilityConfigView {
  readonly provider?: Readonly<Record<string, ModelAvailabilityProviderView>>;
  readonly minimax_api?: { readonly apiKey?: string; readonly baseURL?: string };
  readonly custom_provider?: Readonly<Record<string, ModelAvailabilityCustomProviderView>>;
  readonly minimaxModelSource?: 'token_plan' | 'minimax_api_key';
}

export interface ModelAvailabilityInput {
  readonly config: ModelAvailabilityConfigView;
  readonly providerId: string;
  readonly modelId: string;
  readonly preset: PresetKey;
  readonly source: ModelSelectionSource;
}

export type ModelAvailability =
  | { readonly available: true; readonly route: ModelCallRoute }
  | {
      readonly available: false;
      readonly route: ModelCallRoute;
      readonly code: ModelAvailabilityErrorCode;
      readonly message: string;
    };

/**
 * Cache-compatibility policy for the builtin provider's Messages route.
 *
 * Kilo speaks `openai-completions`, so no builtin route satisfies this today.
 * The predicate is retained for the resolver's generic BYOK path, where a
 * user-configured Anthropic-compatible provider under the reserved ids would
 * still need the first-party cache rules.
 */
export function isFirstPartyMinimaxMessagesRoute(api: string, providerId: string): boolean {
  return (
    api === 'anthropic-messages' &&
    (providerId === KILO_PROVIDER_ID || providerId === KILO_API_PROVIDER_ID)
  );
}

/**
 * The route a provider id resolves to.
 *
 * Kilo is a single OpenAI-compatible gateway reached with one credential, so
 * the historic managed-token-plan vs. user-key split collapses: `provider.kilo`
 * is always the gateway, whether the credential came from `KILO_API_KEY` or
 * from the lock-protected BYOK config tree. `kilo_api` remains a distinct id
 * only so a hand-written second entry can address the same gateway.
 */
export function resolveModelCallRoute(
  config: ModelAvailabilityConfigView,
  providerId: string,
): ModelCallRoute {
  if (providerId === KILO_API_PROVIDER_ID) return 'kilo_api_key';
  if (providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX)) return 'custom_provider';
  if (providerId !== KILO_PROVIDER_ID) return 'configured_provider';
  return 'kilo_gateway';
}

/**
 * Model ids the given provider id may actually call right now.
 *
 * The Kilo gateway is called with a user-supplied credential, so its model set
 * is the shipped catalog; every other route keeps exactly what the user
 * configured.
 */
export function listRouteModelIds(
  config: ModelAvailabilityConfigView,
  providerId: string,
  _preset: PresetKey,
): readonly string[] {
  const route = resolveModelCallRoute(config, providerId);
  switch (route) {
    case 'kilo_gateway': {
      // Provider entry wins when present so a disabled model stays disabled;
      // the shipped catalog is the fallback for a profile that has not been
      // written yet.
      const configured = configuredModelIds(config.provider?.[providerId], true);
      return configured.length > 0 ? configured : Object.keys(KILO_API_MODEL_CATALOG);
    }
    case 'kilo_api_key': {
      return Object.keys(KILO_API_MODEL_CATALOG);
    }
    case 'custom_provider': {
      const provider = config.custom_provider?.[providerId.slice(CUSTOM_PROVIDER_ID_PREFIX.length)];
      if (!provider || provider.enabled === false) return [];
      return configuredModelIds(provider);
    }
    case 'configured_provider':
      return configuredModelIds(config.provider?.[providerId]);
  }
}

/** The single availability answer shared by list, save and Turn execution. */
export function resolveModelAvailability(input: ModelAvailabilityInput): ModelAvailability {
  const route = resolveModelCallRoute(input.config, input.providerId);
  let modelId = input.modelId.trim();
  if (input.providerId === 'kilo' || input.providerId === 'kilo_api') {
    if (modelId.startsWith('kilo/')) modelId = modelId.slice(5);
    else if (modelId.startsWith('kilo_api/')) modelId = modelId.slice(9);
  }
  const routeModels = listRouteModelIds(input.config, input.providerId, input.preset);
  if (
    modelId.length > 0 &&
    (routeModels.includes(modelId) || routeModels.includes(`${modelId}:free`))
  ) {
    return { available: true, route };
  }
  return {
    available: false,
    route,
    code:
      input.source === 'config_default'
        ? 'DEFAULT_MODEL_NOT_AVAILABLE_FOR_ROUTE'
        : 'MODEL_NOT_AVAILABLE_FOR_ROUTE',
    message: `Model "${input.providerId}/${input.modelId}" is not available for the "${route}" route (preset ${input.preset}).`,
  };
}

function configuredModelIds(
  provider: ModelAvailabilityProviderView | undefined,
  applyModelOrder = false,
): readonly string[] {
  const configured = Object.entries(provider?.models ?? {})
    .filter(([, model]) => model?.enabled !== false)
    .map(([modelId]) => modelId);
  const order = provider?.model_order;
  if (!applyModelOrder || !Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
    return configured;
  }
  const remaining = new Set(configured);
  const ordered = order.filter((modelId) => remaining.delete(modelId));
  return [...ordered, ...configured.filter((modelId) => remaining.has(modelId))];
}
