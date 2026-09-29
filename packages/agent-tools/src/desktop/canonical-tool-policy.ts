import type { RuntimeTool } from '@mavis/agent-core/tools';

import { MatrixWebSearchToolDef } from '../cloud/matrix-tools/tool-defs.js';
import {
  canonicalSubagentRolePolicy,
  isCanonicalSubagentRole,
  PENTEST_ENGAGEMENT_TOOL_NAMES,
} from './subagent-roles.js';

/**
 * Starting a task and continuing one are the same delegation entry point, so
 * `task_append` is gated with `task` rather than with the read-only handles.
 */
export const DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set(['task', 'task_append']);

/**
 * Every entry point through which a canonical read-only role could change
 * project or target state. The engagement-ledger names are blocked here too:
 * only a role whose policy marks it as an engagement operator re-admits them
 * below, so Explore and Verifier cannot mutate the record an offensive role is
 * relying on for chain state.
 */
const READ_ONLY_CANONICAL_BLOCKED_TOOL_NAMES = new Set([
  'write',
  'edit',
  'website_deploy',
  'todowrite',
  'task',
  'task_append',
  'memory',
  'ask_user',
  'request_feature_enable',
  ...PENTEST_ENGAGEMENT_TOOL_NAMES,
]);

/** Computer-use tools share the desktop_* namespace across native and MCP paths. */
export function isComputerUseRuntimeToolName(name: string): boolean {
  return name.startsWith('desktop_');
}

/**
 * Apply the canonical built-in role ceiling to an already capability-filtered
 * native tool list. This helper is intentionally pure so V1 and V2 catalog
 * owners cannot drift on Explore/Verifier/Worker/Recon/Webapp/Infra/Mobile
 * semantics.
 *
 * Three shapes, derived from the role policy table in `subagent-roles.ts`:
 * - `worker` is the production writer: it keeps every write tool and only loses
 *   the delegation entry point, so a task child cannot fan out again.
 * - `webapp` / `infra` / `mobile` are write-capable delegating operators: their
 *   `agent.md` grant is the ceiling, including the engagement ledger. Stripping
 *   their declared `write` / `edit` / `todowrite` / `task` here is what used to
 *   make the declared capabilities a lie.
 * - `explore` / `verifier` / `recon` are read-only. Recon differs only in that
 *   it keeps `pentest_probe` / `pentest_findings`, because surveying the
 *   engagement surface is exactly what it is for.
 */
export function filterCanonicalNativeToolCeiling<T extends RuntimeTool>(
  tools: readonly T[],
  canonicalRole?: string,
  builtinAgent = false,
): T[] {
  const policy =
    builtinAgent && canonicalRole ? canonicalSubagentRolePolicy(canonicalRole) : undefined;
  if (!canonicalRole || !isCanonicalSubagentRole(canonicalRole) || !policy) {
    return [...tools];
  }
  if (canonicalRole === 'worker') {
    return tools.filter((tool) => !DELEGATION_TOOL_NAMES.has(tool.def.name));
  }
  if (!policy.readOnly) return [...tools];
  return tools.filter((tool) => {
    const name = tool.def.name;
    // Recon surveys the engagement surface, so it reads and records the ledger
    // even though it may not write a single project file.
    if (policy.engagement && PENTEST_ENGAGEMENT_TOOL_NAMES.has(name)) return true;
    if (READ_ONLY_CANONICAL_BLOCKED_TOOL_NAMES.has(name)) return false;
    if (isComputerUseRuntimeToolName(name)) return false;
    // Explore never receives a background task handle in the first place, so
    // the control tools are dropped rather than left dangling.
    return !(
      canonicalRole === 'explore' && ['task_query', 'task_output', 'task_stop'].includes(name)
    );
  });
}

/**
 * Apply the canonical builtin role MCP ceiling to source-tagged entries.
 * Read-only roles (Explore, Verifier, Recon) retain only Matrix web search —
 * reconnaissance needs advisories and vendor documentation, not a creative
 * media catalog. Write-capable operators and custom or untrusted agents retain
 * the configured entry set, which their own capability selection narrows.
 */
export function filterCanonicalBuiltinMcpEntries<
  T extends { readonly source: string; readonly tool: RuntimeTool },
>(entries: readonly T[], canonicalRole?: string, builtinAgent?: boolean): T[] {
  const policy =
    builtinAgent === true && canonicalRole
      ? canonicalSubagentRolePolicy(canonicalRole)
      : undefined;
  if (!policy?.readOnly) return [...entries];
  return entries.filter(
    (entry) =>
      entry.source === 'builtin-matrix' && entry.tool.def.name === MatrixWebSearchToolDef.name,
  );
}

export function isCanonicalBuiltinTurn(canonicalRole?: string, builtinAgent?: boolean): boolean {
  return (
    builtinAgent === true && canonicalRole !== undefined && isCanonicalSubagentRole(canonicalRole)
  );
}
