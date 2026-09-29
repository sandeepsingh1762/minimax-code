export type CanonicalSubagentRole =
  | 'explore'
  | 'worker'
  | 'verifier'
  | 'recon'
  | 'webapp'
  | 'infra'
  | 'mobile';

export interface LocalSubagentRoleDefinition {
  whenToUse: string;
}

/** Single source of truth for canonical desktop SubAgent role names. */
export const SUBAGENT_ROLES = {
  explore: {
    whenToUse:
      'Read-only mapping for unfamiliar, cross-file, or evidence-heavy questions; it can use Bash for read-only Git and code investigation, but cannot create or edit files.',
  },
  worker: {
    whenToUse:
      'Bounded production work with explicit scope, ownership, deliverable, and acceptance.',
  },
  verifier: {
    whenToUse:
      'Independently validate an existing deliverable and report findings; no project-file changes. Temporary validation artifacts require an explicitly designated temporary location.',
  },
  recon: {
    whenToUse:
      'Read-only attack-surface discovery for an authorized target: hosts, ports, services, endpoints, parameters, identities, technologies and exposed artifacts. Never sends intrusive or state-changing payloads; returns an inventory plus candidate hypotheses.',
  },
  webapp: {
    whenToUse:
      'Autonomous offensive operator for in-scope web applications, web platforms, HTTP APIs and backends (including secured/authenticated backends). Given a mission objective it surveys the surface, invents its own attack strategies, exploits and chains them, verifies whether the objective was achieved, and keeps iterating until it is proven or scope is exhausted. Use this when the goal is to break a web target, not to assess it.',
  },
  infra: {
    whenToUse:
      'Active testing of in-scope network and platform infrastructure: exposed services, transport configuration, misconfigured access control, and host-level weaknesses. Requires an explicit host/port scope.',
  },
  mobile: {
    whenToUse:
      'Client-side and mobile application analysis for an authorized engagement: manifest and permission review, exported components, embedded endpoints and secrets, transport security, and client-side trust assumptions.',
  },
} as const satisfies Record<CanonicalSubagentRole, LocalSubagentRoleDefinition>;

export const CANONICAL_SUBAGENT_ROLES = Object.keys(SUBAGENT_ROLES) as CanonicalSubagentRole[];

/**
 * Three independent facts about what a canonical role may actually reach at
 * runtime. The `agent.md` capability selection is only a declaration: the
 * canonical ceiling below is what strips a tool the role may not use, so the
 * two must describe the same intent or the declared capabilities are a lie.
 */
export interface CanonicalSubagentRolePolicy {
  /**
   * The role may not change project or target state. Every write, edit, todo,
   * delegation, memory and ask entry point is removed for it, and its
   * filesystem stays read-only for the whole turn.
   */
  readonly readOnly: boolean;
  /**
   * The role is an authorized-engagement operator and may use the shared
   * pentest probe/findings ledger. Read-only mapping and validation roles are
   * deliberately excluded: a read-only observer must not mutate the record
   * another operator is relying on for chain state.
   */
  readonly engagement: boolean;
  /** The role may open a new delegation from its own turn. */
  readonly delegating: boolean;
}

/**
 * `satisfies Record<CanonicalSubagentRole, ...>` is the guard: adding a role to
 * `SUBAGENT_ROLES` without deciding its ceiling fails the type check here
 * instead of silently inheriting a read-only or write-capable default.
 */
const CANONICAL_SUBAGENT_ROLE_POLICIES = {
  explore: { readOnly: true, engagement: false, delegating: false },
  verifier: { readOnly: true, engagement: false, delegating: false },
  recon: { readOnly: true, engagement: true, delegating: false },
  worker: { readOnly: false, engagement: false, delegating: false },
  webapp: { readOnly: false, engagement: true, delegating: true },
  infra: { readOnly: false, engagement: true, delegating: true },
  mobile: { readOnly: false, engagement: true, delegating: true },
} as const satisfies Record<CanonicalSubagentRole, CanonicalSubagentRolePolicy>;

/** Engagement-ledger tools shared by the authorized offensive roles. */
export const PENTEST_ENGAGEMENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pentest_probe',
  'pentest_findings',
]);

export function canonicalSubagentRolePolicy(
  value: string,
): CanonicalSubagentRolePolicy | undefined {
  return isCanonicalSubagentRole(value) ? CANONICAL_SUBAGENT_ROLE_POLICIES[value] : undefined;
}

/** True for every canonical role whose ceiling forbids state changes. */
export function isReadOnlyCanonicalSubagentRole(value: string): boolean {
  return canonicalSubagentRolePolicy(value)?.readOnly === true;
}

/** Model-visible built-in targets. */
const TASK_AGENT_TARGETS = ['mavis', ...CANONICAL_SUBAGENT_ROLES] as const;

const TASK_AGENT_TARGET_DESCRIPTIONS: Readonly<
  Record<(typeof TASK_AGENT_TARGETS)[number], string>
> = {
  mavis: 'Broad or mixed-scope work that does not fit a specialist role.',
  explore: SUBAGENT_ROLES.explore.whenToUse,
  worker: SUBAGENT_ROLES.worker.whenToUse,
  verifier: SUBAGENT_ROLES.verifier.whenToUse,
  recon: SUBAGENT_ROLES.recon.whenToUse,
  webapp: SUBAGENT_ROLES.webapp.whenToUse,
  infra: SUBAGENT_ROLES.infra.whenToUse,
  mobile: SUBAGENT_ROLES.mobile.whenToUse,
};

/** Names whose bare form is interpreted as a canonical role or primary alias. */
export const RESERVED_SUBAGENT_NAMES = [
  ...CANONICAL_SUBAGENT_ROLES,
  'main',
  'mavis',
] as readonly string[];

const RESERVED_SUBAGENT_NAME_SET = new Set(RESERVED_SUBAGENT_NAMES);

/**
 * The desktop service currently returns the thrift enum value for built-ins,
 * while a few adapters expose the already-decoded string. Everything else is
 * intentionally treated as non-builtin so a manual/unknown row cannot be
 * selected through a role or primary alias by accident.
 */
export function isTrustedBuiltinCreationSource(value: unknown): boolean {
  return value === 3 || value === 'builtin';
}

export function toAgentRequestRef(
  agent: { name?: unknown; creationSource?: unknown } | null | undefined,
): string | undefined {
  if (typeof agent?.name !== 'string') return undefined;
  const name = agent.name;
  if (name.toLowerCase().startsWith('agent:')) return name;
  if (
    RESERVED_SUBAGENT_NAME_SET.has(name.toLowerCase()) &&
    !isTrustedBuiltinCreationSource(agent.creationSource)
  ) {
    return `agent:${name}`;
  }
  return name;
}

export const AGENT_REQUEST_REF_DESCRIPTION =
  'Use the `requestRef` returned by the native `mavis` tool with command "agent list". For built-in work use mavis, explore, worker, verifier, recon, webapp, infra, or mobile. Use `agent:<stable-name>` to select the exact manual/custom Agent when its name collides with a reserved role or primary alias; ordinary custom names use their raw stable name.';

export const LOCAL_MAVIS_AGENT_NAME_DESCRIPTION = `${AGENT_REQUEST_REF_DESCRIPTION} "me" selects the current Agent.`;

const TASK_AGENT_REQUEST_REF_DESCRIPTION =
  'Built-in name or stable custom `requestRef`. Use `agent:<stable-name>` for a custom Agent whose name collides with a reserved role or primary alias; ordinary custom names use their raw stable name. Use the native `mavis` tool with command "agent list" for discovery only when needed and available.';

const WITHOUT_MAVIS_AGENT_REQUEST_REF_DESCRIPTION =
  'Use explore, worker, verifier, recon, webapp, infra, or mobile for built-in work. For a known custom Agent, use its stable `requestRef`. Use `agent:<stable-name>` to select the exact manual/custom Agent when its name collides with a reserved role or primary alias; ordinary custom names use their raw stable name.';

export function isCanonicalSubagentRole(value: string): value is CanonicalSubagentRole {
  return Object.hasOwn(SUBAGENT_ROLES, value);
}

export function resolveCanonicalSubagentRole(
  requestedName: string,
): CanonicalSubagentRole | undefined {
  const normalized = requestedName.trim().toLowerCase();
  return isCanonicalSubagentRole(normalized) ? normalized : undefined;
}

export function roleDirectoryText(): string {
  return TASK_AGENT_TARGETS.map(
    (target) => `- ${target} — ${TASK_AGENT_TARGET_DESCRIPTIONS[target]}`,
  ).join('\n');
}

/**
 * Returns model-visible Task target guidance for the currently exposed
 * capability surface. Resolver compatibility stays unchanged.
 */
export function agentNameDescription(options: { includeMavis?: boolean } = {}): string {
  return options.includeMavis === false
    ? WITHOUT_MAVIS_AGENT_REQUEST_REF_DESCRIPTION
    : TASK_AGENT_REQUEST_REF_DESCRIPTION;
}
