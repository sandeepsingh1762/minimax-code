/**
 * Pentest tool size budgets — shared by the `pentest_probe` / `pentest_findings`
 * desktop tools, the local-runtime probe client, the finding store and the
 * finding facade.
 *
 * The two tools have one hard requirement in common: a model must never be able
 * to blow a turn's context with a single call, and a ledger file must never be
 * able to grow without bound. The desktop layer enforces the *output* budgets,
 * the facade enforces the *field* budgets, and the store enforces the *file*
 * budgets. Declaring all three here keeps those three layers from drifting apart
 * and keeps a single reviewable place to reason about the total budget of one
 * probe plus one ledger entry.
 */

/** Native `pentest_probe` single-response byte budget. */
export const PENTEST_PROBE_OUTPUT_MAX_BYTES = 16 * 1024;

/**
 * Response-body excerpt budget captured by the probe client before the desktop
 * tool truncates the assembled result. Applies to the HTTP body, a TCP banner
 * and a DNS answer blob alike; probes against large download endpoints should
 * narrow with `http.method: "HEAD"` instead of raising this.
 */
export const PENTEST_PROBE_BODY_MAX_BYTES = 8 * 1024;

/** Number of response headers preserved in probe evidence. */
export const PENTEST_PROBE_MAX_HEADERS = 40;

/** Default probe timeout when the caller supplies none. */
export const PENTEST_PROBE_DEFAULT_TIMEOUT_MS = 10 * 1000;

/**
 * Hard ceiling on a caller-supplied probe timeout. A model that asks for
 * `timeoutMs: 600000` must not be able to pin the turn open for ten minutes, so
 * the client clamps rather than rejects.
 */
export const PENTEST_PROBE_MAX_TIMEOUT_MS = 60 * 1000;

/** Native `pentest_findings` single-response byte budget. */
export const PENTEST_FINDINGS_TOOL_OUTPUT_MAX_BYTES = 16 * 1024;

/** `export` payload budget before the desktop tool truncates head+tail. */
export const PENTEST_FINDINGS_EXPORT_MAX_BYTES = 256 * 1024;

/**
 * Hard cap for one live ledger file. A write that would exceed it archives the
 * coldest terminal records first (see the store's `enforceBudget`); a ledger
 * that is entirely live is never silently dropped.
 */
export const PENTEST_FINDINGS_MAX_FILE_BYTES = 1024 * 1024;

/** Hard cap for live records in one ledger file. */
export const PENTEST_FINDINGS_MAX_RECORDS_PER_FILE = 2000;

/** Per-field cap for short free text (title, target, endpoint, cwe, category). */
export const PENTEST_FINDINGS_MAX_FIELD_BYTES = 4 * 1024;

/** Per-field cap for long free text (proof, remediation). */
export const PENTEST_FINDINGS_MAX_NOTE_BYTES = 16 * 1024;

/** Per-record cap for the retained evidence excerpt. */
export const PENTEST_FINDINGS_MAX_EVIDENCE_BYTES = 8 * 1024;

/**
 * Number of merged re-observations retained per finding. A finding re-observed
 * fifty times keeps the first `N` distinct evidence entries plus a counter; the
 * counter is what the model uses to judge confidence.
 */
export const PENTEST_FINDINGS_MAX_EVIDENCE_LOG_ENTRIES = 10;

/** Default bounded page for `list` / `search`. */
export const PENTEST_FINDINGS_DEFAULT_PAGE_SIZE = 20;

/** Maximum bounded page for `list` / `search`. */
export const PENTEST_FINDINGS_MAX_PAGE_SIZE = 100;
