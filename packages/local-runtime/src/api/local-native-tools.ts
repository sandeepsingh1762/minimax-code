import type { PiEventWriter } from "@mavis/agent-core/pi-turn-runner";
import type { RuntimeTool } from "@mavis/agent-core/tools";
import {
  buildLocalToolRegistry,
  LocalTodoWriteToolDef,
  type LocalAskUserAdapter,
  type LocalBashAdapter,
  type LocalCodeReviewAdapter,
  type LocalRuntimeTool,
  type LocalRuntimeToolContext,
  type LocalSandboxBashOperationsFactory,
  type LocalMavisAgentAdapter,
  type LocalMavisCronAdapter,
  type LocalMavisMcpAdapter,
  type LocalMavisSessionAdapter,
  type LocalTaskAdapter,
  type LocalTaskAppendAdapter,
  type LocalTaskControlAdapter,
  type LocalPentestProbeAdapter,
  type LocalPentestFindingsAdapter,
  type LocalWebFetchAdapter,
  type LocalWebSearchAdapter,
  WebSearchToolDef,
} from "@mavis/agent-tools/desktop";
import { MatrixWebSearchToolDef } from "@mavis/agent-tools";
import {
  resolveAgentCapabilities,
  type AgentBuiltinMcpToolId,
  type AgentBuiltinSkillId,
  type ResolvedAgentCapabilities,
} from "@mavis/config";
import { resolveFeatureAwareBuiltinSkillNames } from "../agent/feature-owned-skills.js";
import type { ModuleMetricsReporter } from "../common/metrics.js";
import { CU_DESKTOP_SKILL_NAME } from "../cu/gate.js";
import type { LocalMemoryFacade } from "../memory/local-memory-facade.js";
import { executeLocalMemoryTool } from "../memory/local-memory-tool.js";
import type { LocalFindingFacade } from "../pentest/local-finding-facade.js";
import { executeLocalPentestFindingsTool } from "../pentest/local-pentest-findings-tool.js";
import { LocalPentestProbeClient } from "../pentest/local-pentest-probe-client.js";
import type { DesktopTurnCapabilityView } from "../runtime/desktop-turn-capabilities.js";
import type { LocalRuntimeAuthContext } from "../runtime/model-resolver.js";
import type { LocalRuntimeRoutingContext } from "../runtime/routing-headers.js";
import { buildLocalHostTrashRuntime } from "../permissions/host-trash-runtime.js";
import { resolveAgentBashEnvPolicy } from "../infra/ensure-rm-shim.js";
import { getSkillService } from "../skills/skill-service.js";
import { emitLocalTodoUpdatedEvent } from "../turns/todo-event.js";
import { LocalWebFetchClient } from "../web-fetch/index.js";
import { createManagedLocalWebSearchClient } from "../web-search/index.js";
import { LocalWebsiteDeployClient } from "../website-deploy/index.js";
import { buildLocalAskUserAdapter } from "./local-ask-user-adapter.js";
import { mergeDesktopTurnTools } from "./local-desktop-tool-modes.js";
import { withLocalMemoryPolicyGuidance } from "./local-memory-policy-guidance.js";
import { withoutLocalMavisCronGuidance } from "./local-mavis-cron-guidance.js";
import {
  filterLocalBuiltinCapabilityTools,
  isDesktopExtensionSkillSelected,
  normalizedSkillName,
} from "./local-native-tool-filter.js";
import type {
  LocalTurnToolSources,
  LocalTurnToolSourcesInput,
} from "./local-turn-tool-sources.types.js";

/**
 * Pentest capability switches for one Turn's tool sources.
 *
 * Declared here, as an intersection with `LocalTurnToolSourcesInput`, rather than
 * inside that shared type: both pentest tools are opt-in capabilities whose
 * activation belongs to the surface that owns the Turn, not to every v1 tool
 * source in the runtime. Absent fields mean "no pentest tools".
 */
export interface LocalTurnPentestToolSourcesInput {
  /** Overrides the default probe client; used by tests to inject a fake. */
  pentestProbeAdapter?: LocalPentestProbeAdapter;
  /** Overrides the default ledger adapter built from `findingFacade`. */
  pentestFindingsAdapter?: LocalPentestFindingsAdapter;
  /**
   * Must be explicitly true for `pentest_probe` to be assembled. Active network
   * probing is never on by default, even when a `fetchImpl` is available.
   */
  pentestProbeEnabled?: boolean;
  /** Supplies the durable ledger; `pentest_findings` is absent without it. */
  findingFacade?: LocalFindingFacade;
  /**
   * Authorized targets from `pentest.scope`. An empty or absent list means the
   * permission system is the only boundary; a non-empty list is enforced in
   * the probe client before any socket is opened.
   */
  pentestScope?: readonly string[];
}

export type {
  LocalTurnToolSources,
  LocalTurnToolSourcesInput,
} from "./local-turn-tool-sources.types.js";

export function buildLocalNativeRuntimeTools(input: {
  dataDir?: string;
  workspaceRoot: string;
  agentName: string;
  excludeAgentResources?: boolean;
  expectedAgentInstanceId?: string;
  skipAgentResolution?: boolean;
  eventWriter?: PiEventWriter;
  askUserAdapter?: LocalAskUserAdapter;
  bashAdapter?: LocalBashAdapter;
  sandboxOperationsFactory?: LocalSandboxBashOperationsFactory;
  authContext?: LocalRuntimeAuthContext;
  routingContextGetter?: () => LocalRuntimeRoutingContext | undefined;
  fetchImpl?: typeof fetch;
  webFetchAdapter?: LocalWebFetchAdapter;
  /** Local product gate for native web_search. */
  webSearchEnabled?: boolean;
  webSearchAdapter?: LocalWebSearchAdapter;
  taskAdapter?: LocalTaskAdapter;
  taskAppendAdapter?: LocalTaskAppendAdapter;
  taskControlAdapter?: LocalTaskControlAdapter;
  memoryFacade?: LocalMemoryFacade;
  /**
   * Host-owned pentest capabilities. Both are opt-in: a surface that supplies
   * neither adapter gets neither tool, so network reach and a writable ledger
   * are never acquired implicitly. `pentestProbeEnabled` is a separate switch
   * because active probing is the part that must be deliberately turned on.
   */
  pentestProbeAdapter?: LocalPentestProbeAdapter;
  pentestFindingsAdapter?: LocalPentestFindingsAdapter;
  pentestProbeEnabled?: boolean;
  findingFacade?: LocalFindingFacade;
  /**
   * Authorized targets from `pentest.scope`. Empty or absent means the
   * permission system is the only boundary; a non-empty list is enforced
   * inside the probe client before any socket is opened.
   */
  pentestScope?: readonly string[];
  mavisAgentAdapter?: LocalMavisAgentAdapter;
  mavisCronAdapter?: LocalMavisCronAdapter;
  mavisMcpAdapter?: LocalMavisMcpAdapter;
  mavisSessionAdapter?: LocalMavisSessionAdapter;
  emitBusEvent?: (type: string, payload: Record<string, unknown>) => void;
  /** Optional metrics reporter injected by the host. Absent → noop. */
  metrics?: ModuleMetricsReporter;
  /** Frozen CU active snapshot, resolved once by hosted turn assembly. */
  cuModeActive?: boolean;
  /** Host-owned Mini App Tool is present for this exact execution surface. */
  miniappAvailable?: boolean;
  codeReviewAdapter?: LocalCodeReviewAdapter;
  desktopCapabilities?: DesktopTurnCapabilityView;
  builtinCapabilities?: ResolvedAgentCapabilities;
  memoryEnabled?: boolean;
  memoryReadEnabled?: boolean;
  memoryWriteEnabled?: boolean;
  /** Per-Turn Agent profile gate; user/global Memory remains available. */
  memoryAgentScopeEnabled?: boolean;
  /** Canonical-first Runtime Memory aliases from the rendered Agent profile. */
  memoryReadAgentNames?: readonly string[];
  /** Frozen canonical standalone Skill selector for this Turn. */
  allowedSkillNames?: readonly string[];
  /** Frozen extension Skill selector for this Turn. */
  allowedExtensionSkillNames?: readonly string[];
  disabledBuiltinSkillNames?: readonly AgentBuiltinSkillId[];
  resumeCodexAvailable?: boolean;
}): LocalRuntimeTool[] {
  const capabilities = input.builtinCapabilities ?? resolveAgentCapabilities();
  const webFetchAdapter =
    input.webFetchAdapter ??
    new LocalWebFetchClient({ fetchImpl: input.fetchImpl });
  const webSearchAdapter =
    input.webSearchEnabled === true
      ? (input.webSearchAdapter ?? createManagedLocalWebSearchClient(input))
      : undefined;
  // Both pentest adapters are host-owned. `pentest_probe` is additionally gated
  // on its own enable switch: a host must opt in to active network probing
  // explicitly, and the permission engine asks on the first call regardless.
  const pentestProbeAdapter =
    input.pentestProbeEnabled === true
      ? (input.pentestProbeAdapter ??
        new LocalPentestProbeClient({
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          // The operator's authorized target list, enforced inside the client
          // before any packet is sent.
          ...(input.pentestScope && input.pentestScope.length > 0
            ? { scope: input.pentestScope }
            : {}),
        }))
      : undefined;
  const pentestFindingsAdapter = input.findingFacade
    ? (input.pentestFindingsAdapter ?? {
        execute: (ctx, toolInput) =>
          executeLocalPentestFindingsTool(input.findingFacade!, ctx, toolInput),
      })
    : undefined;
  const builtinSkillNames = resolveFeatureAwareBuiltinSkillNames(capabilities, {
    cuModeActive: input.cuModeActive === true,
    ...(input.miniappAvailable === true ? { miniappAvailable: true } : {}),
    disabledSkillNames: input.disabledBuiltinSkillNames,
    resumeCodexAvailable: input.resumeCodexAvailable === true,
  });
  const nativeTools = [
    ...buildLocalToolRegistry({
      workspaceRoot: input.workspaceRoot,
      skillReader: {
        readSkill: async (name, agentName) => {
          if (name === CU_DESKTOP_SKILL_NAME && input.cuModeActive !== true) {
            return undefined;
          }
          const resolvedAgentName = agentName ?? input.agentName;
          const skill = await getSkillService().readSkillByName(name, {
            agentName: resolvedAgentName,
            ...(input.excludeAgentResources
              ? { excludeAgentResources: true }
              : {}),
            ...(input.expectedAgentInstanceId
              ? { expectedAgentInstanceId: input.expectedAgentInstanceId }
              : {}),
            ...(input.skipAgentResolution ? { skipAgentResolution: true } : {}),
            workspaceDir: input.workspaceRoot,
            ...(builtinSkillNames !== undefined ? { builtinSkillNames } : {}),
            ...(input.allowedSkillNames === undefined
              ? {}
              : { allowedSkillNames: input.allowedSkillNames }),
            ...(input.allowedExtensionSkillNames === undefined
              ? {}
              : {
                  allowedExtensionSkillNames: input.allowedExtensionSkillNames,
                }),
          });
          if (skill) {
            return {
              content: skill.content,
              location: skill.locationUri,
              sourceKind: skill.sourceKind,
            };
          }
          const desktopSkill = input.desktopCapabilities?.skills.find(
            (candidate) =>
              normalizedSkillName(candidate.name) ===
                normalizedSkillName(name) &&
              isDesktopExtensionSkillSelected(
                input.allowedSkillNames,
                input.allowedExtensionSkillNames,
                candidate.pluginName,
                candidate.name,
              ),
          );
          return desktopSkill
            ? {
                content: desktopSkill.content,
                location: desktopSkill.location,
                sourceKind: desktopSkill.sourceKind,
              }
            : undefined;
        },
      },
      todoEventSink: {
        emitTodoUpdated: (ctx, todos, signal) =>
          emitLocalTodoUpdatedEvent({
            ctx,
            todos,
            signal,
            emitBusEvent: input.emitBusEvent,
          }),
      },
      askUserAdapter: input.askUserAdapter,
      bashAdapter: input.bashAdapter,
      sandboxOperationsFactory: input.sandboxOperationsFactory,
      hostTrashRuntime: buildLocalHostTrashRuntime(input),
      bashEnvPolicy: resolveAgentBashEnvPolicy(input.dataDir),
      webFetchAdapter,
      webSearchAdapter,
      taskAdapter: input.taskAdapter,
      taskAppendAdapter: input.taskAppendAdapter,
      taskControlAdapter: input.taskControlAdapter,
      memoryAdapter:
        input.memoryFacade &&
        input.memoryEnabled !== false &&
        !input.excludeAgentResources &&
        input.memoryAgentScopeEnabled === true &&
        (input.memoryReadEnabled !== false ||
          input.memoryWriteEnabled !== false)
          ? {
              execute: (ctx, toolInput) =>
                executeLocalMemoryTool(
                  input.memoryFacade!,
                  ctx,
                  toolInput,
                  input.emitBusEvent,
                  input.metrics,
                  input.memoryReadAgentNames,
                  {
                    readEnabled: input.memoryReadEnabled !== false,
                    writeEnabled: input.memoryWriteEnabled !== false,
                    agentScopeEnabled: input.memoryAgentScopeEnabled,
                  },
                ),
            }
          : undefined,
      pentestProbeAdapter,
      pentestFindingsAdapter,
      mavisAgentAdapter: input.mavisAgentAdapter,
      mavisCronAdapter: input.mavisCronAdapter,
      mavisMcpAdapter: input.mavisMcpAdapter,
      mavisSessionAdapter: input.mavisSessionAdapter,
      websiteDeployAdapter: new LocalWebsiteDeployClient({
        ...(input.authContext ? { authContext: input.authContext } : {}),
        ...(input.dataDir ? { dataDir: input.dataDir } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        routingContextGetter: input.routingContextGetter,
      }),
      codeReviewAdapter: input.codeReviewAdapter,
    }).values(),
  ];
  const modelVisibleNativeTools = input.mavisCronAdapter
    ? nativeTools
    : nativeTools.map(withoutLocalMavisCronGuidance);
  return filterLocalBuiltinCapabilityTools(
    modelVisibleNativeTools.map((tool) =>
      withLocalMemoryPolicyGuidance(tool, {
        readEnabled: input.memoryReadEnabled !== false,
        writeEnabled: input.memoryWriteEnabled !== false,
      }),
    ),
    capabilities,
  );
}

/**
 * Returns still-unmigrated product-domain tool sources before the v2
 * AgentRuntime applies model gates, MCP disclosure and final catalog ordering.
 */
export async function buildLocalTurnToolSources(
  input: LocalTurnToolSourcesInput & LocalTurnPentestToolSourcesInput,
): Promise<LocalTurnToolSources> {
  if (input.toolsDisabled) {
    return {
      nativeTools: [],
      mcpEntries: [],
      threadGoalTools: [],
      cuRuntimeAvailable: false,
    };
  }
  const cuRuntimeAvailable = input.cuModeActive === true;
  const builtinCapabilities =
    input.builtinCapabilities ?? resolveAgentCapabilities();
  const enableTaskControlTools =
    input.enableTaskControlTools ?? !!input.taskControlAdapter;
  // `task` and `task_append` are the same delegation entry point: a surface
  // that may not start a task may not continue one either.
  const delegationEntryPointsEnabled =
    input.enableTaskTool !== false && builtinCapabilities.features.delegation;
  const nativeTools = buildLocalNativeRuntimeTools({
    dataDir: input.dataDir,
    workspaceRoot: input.workspaceRoot,
    agentName: input.agentName,
    ...(input.excludeAgentResources ? { excludeAgentResources: true } : {}),
    ...(input.expectedAgentInstanceId
      ? { expectedAgentInstanceId: input.expectedAgentInstanceId }
      : {}),
    ...(input.skipAgentResolution ? { skipAgentResolution: true } : {}),
    eventWriter: input.eventWriter,
    askUserAdapter: buildLocalAskUserAdapter(input.questionnaireContext),
    bashAdapter: input.bashAdapter,
    sandboxOperationsFactory: input.sandboxOperationsFactory,
    authContext: input.authContext,
    routingContextGetter: input.routingContextGetter,
    fetchImpl: input.fetchImpl,
    webSearchEnabled: input.nativeWebSearchEnabled === true,
    taskAdapter: delegationEntryPointsEnabled ? input.taskAdapter : undefined,
    taskAppendAdapter: delegationEntryPointsEnabled
      ? input.taskAppendAdapter
      : undefined,
    taskControlAdapter: enableTaskControlTools
      ? input.taskControlAdapter
      : undefined,
    memoryFacade: input.memoryFacade,
    findingFacade: input.findingFacade,
    pentestProbeAdapter: input.pentestProbeAdapter,
    pentestFindingsAdapter: input.pentestFindingsAdapter,
    ...(input.pentestProbeEnabled === undefined
      ? {}
      : { pentestProbeEnabled: input.pentestProbeEnabled }),
    mavisAgentAdapter: input.mavisAgentAdapter,
    mavisCronAdapter: input.mavisCronAdapter,
    mavisMcpAdapter: input.mcpService.createMavisAdapter(input.emitBusEvent),
    mavisSessionAdapter: input.mavisSessionAdapter,
    codeReviewAdapter: input.codeReviewAdapter,
    emitBusEvent: input.emitBusEvent,
    metrics: input.metrics,
    cuModeActive: cuRuntimeAvailable,
    ...(input.miniappAvailable === true ? { miniappAvailable: true } : {}),
    desktopCapabilities: input.desktopCapabilities,
    builtinCapabilities,
    memoryEnabled: input.memoryEnabled,
    memoryReadEnabled: input.memoryReadEnabled,
    memoryWriteEnabled: input.memoryWriteEnabled,
    memoryAgentScopeEnabled: input.memoryAgentScopeEnabled,
    memoryReadAgentNames: input.memoryReadAgentNames,
    ...(input.allowedSkillNames === undefined
      ? {}
      : { allowedSkillNames: input.allowedSkillNames }),
    ...(input.allowedExtensionSkillNames === undefined
      ? {}
      : { allowedExtensionSkillNames: input.allowedExtensionSkillNames }),
    disabledBuiltinSkillNames: input.disabledBuiltinSkillNames,
    resumeCodexAvailable: input.resumeCodexAvailable,
  });
  const gatedNativeTools =
    input.enableTodoWriteTool === false
      ? nativeTools.filter(
          (tool) => tool.def.name !== LocalTodoWriteToolDef.name,
        )
      : nativeTools;
  const allEntries = await input.mcpService.listToolEntriesForTurn({
    sessionId: input.sessionId,
    workspaceRoot: input.workspaceRoot,
    ...(input.authContext ? { authContext: input.authContext } : {}),
    routingContextGetter: input.routingContextGetter,
    emitBusEvent: input.emitBusEvent,
  });
  const selectedBuiltinMcpEntries =
    builtinCapabilities.builtinTools === undefined
      ? allEntries
      : allEntries.filter(
          (entry) =>
            entry.source !== "builtin-matrix" ||
            entry.tool.def.name === MatrixWebSearchToolDef.name ||
            builtinCapabilities.builtinTools!.includes(
              entry.tool.def.name as AgentBuiltinMcpToolId,
            ),
        );
  const selectedMcpEntries = builtinCapabilities.features.webSearch
    ? selectedBuiltinMcpEntries
    : selectedBuiltinMcpEntries.filter(
        (entry) =>
          !(
            entry.source === "builtin-matrix" &&
            entry.tool.def.name === MatrixWebSearchToolDef.name
          ),
      );
  const mcpEntries = selectedMcpEntries;
  const threadGoalTools = (await input.threadGoal.runtimeToolsFor(
    false,
    input.sessionId,
  )) as RuntimeTool[];
  return {
    nativeTools: gatedNativeTools as RuntimeTool[],
    mcpEntries,
    threadGoalTools,
    cuRuntimeAvailable,
  };
}
