/**
 * Shared daemon evidence types (#159 KD-4).
 *
 * `StreamTracker` (host stream) and the watchdog bundle inputs live here —
 * owned by neither the orchestrator (`agent-daemon.js`) nor the evidence
 * pipeline (`agent-diagnostics.js`, `agent-vm-liveness.js`) — so the modules
 * can share shapes with no import cycle back into `agent-daemon.js`.
 * Dependency-free: no imports, no side effects.
 */

/** KD-6/KD-8: per-run stream tracker fed by each piped JSON line. */
export interface StreamTracker {
  startMs: number;
  lastNonErrorAtMs: number;
  /** #139: wall-clock of the last stdout/stderr bytes (even a partial line). */
  lastChunkAtMs: number;
  /** #139: bytes currently buffered without a trailing newline. */
  pendingBytes: number;
  gatewayCount: number;
  upstreamCount: number;
  otherCount: number;
  linesSeen: number;
  firstGatewayLine: string | null;
  /** #139: last error-class line (gateway-quota/upstream-transient), truncated. */
  lastErrorLine: string | null;
  /** #139: last raw line of any class, truncated (exit diagnosis). */
  lastLine: string | null;
  /**
   * #162 KD-4: bounded host-stream history ("what it was doing last") for
   * the watchdog comment. Each entry truncated to HOST_RING_LINE_CHARS;
   * shift-evicted beyond HOST_RING_LINES. Error-class = gateway-quota +
   * upstream-transient (same classifier as the counters).
   */
  recentOther: string[];
  recentError: string[];
  rootSessionId: string | null;
  parentBySession: Map<string, string>;
  titleBySession: Map<string, string>;
  /** Best-effort observed model per session (ground truth vs requested `--model`). */
  modelBySession: Map<string, string>;
  /**
   * #149 KD-6: nested-Task session IDs extracted from `tool_use` completion
   * lines (`part.state.metadata.sessionId`). Side-table only — the line
   * itself stays `[orchestrator]`, and these IDs join the VM log tail
   * (`session.id=`) where mid-Task sub-agent life is actually observed.
   */
  nestedSessionIds: Set<string>;
}

/** #162 KD-4: host ring buffer caps (comment evidence, not console). */
export const HOST_RING_LINES = 10;
export const HOST_RING_LINE_CHARS = 500;

/**
 * #162 KD-2: what the comment header states. The live post happens
 * pre-destroy + pre-fence, so the runtime value is always `reset-intended`
 * (conditional intent, outcome matrix enumerated in prose). The outcome
 * variants pin wording for tests (the destroy-failure park threads its own
 * inline context into `parkAtQuestion`). The live `checkFencing` call stays
 * post-destroy — never pre-read (TOCTOU + unbounded pre-kill round-trip).
 */
export type WatchdogOutcome = 'reset-intended' | 'fence-blocked' | 'transport-fail-closed' | 'destroy-failed';

/** #162 KD-4: sliced VM tail for the comment (see formatVmTailForComment). */
export interface WatchdogVmTail {
  lines: string[];
  truncated: number;
  rotated: boolean;
  empty: boolean;
}

/**
 * #162 KD-7: injected inputs for the pure watchdog-comment formatter.
 * Shell/VM captures are rendered by the caller (`buildWatchdogBundle`);
 * this function owns header wording, the outcome matrix, evidence layout,
 * and the KD-6 total cap.
 */
export interface WatchdogSectionsInput {
  silenceS: number;
  timeoutS: number;
  elapsedS: number;
  childPid: number | undefined;
  sandboxName: string | null;
  outcome: WatchdogOutcome;
  hostRecentOther: string[];
  hostRecentError: string[];
  vmExcerpt: string[];
  vmTail: WatchdogVmTail;
  vmPresent: boolean;
  sessionSummary: string;
  processTree: string;
  portOwnership: string;
  branchState: string;
  sandboxStatus: string | null;
  vmLegs: string | null;
}
