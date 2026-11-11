/**
 * Bounds the tool calls of one model run. A curation run needs a handful of
 * catalog searches; a reply that keeps asking for more is cut off here rather
 * than by the run's timeout, and a refused call does no catalog, embedding or
 * analytics work. The model is told why (`tool_budget_exhausted`) so it can
 * answer with what it already has.
 */
export const MAX_TOOL_CALLS_PER_RUN = 24;
/** Vertex only: function calls answered in a single model turn. */
export const MAX_TOOL_CALLS_PER_ROUND = 8;

export const TOOL_BUDGET_EXHAUSTED = { error: "tool_budget_exhausted" } as const;

export class ToolCallBudget {
  private used = 0;

  constructor(private readonly max: number = MAX_TOOL_CALLS_PER_RUN) {}

  /** True when the call may run; counts it. */
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }

  get calls(): number {
    return this.used;
  }
}
