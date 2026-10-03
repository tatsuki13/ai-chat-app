export type DialogueTimerSnapshot = {
  version: 1;
  topicCount: number;
  durationMs: number;
  topicIndex: number;
  started: boolean;
  completedElapsedMs: number;
  topicElapsedMs: number;
  topicTargetMs: number;
};

// Only this clock owns elapsed time. Stored snapshots contain durations, never
// wall-clock timestamps, so time while the page is closed is not counted.
export class DialogueTimer {
  private state!: DialogueTimerSnapshot;
  private runningSince: number | null = null;

  constructor(
    private readonly durationMs: number,
    private readonly topicCount: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.reset();
  }

  reset() {
    this.runningSince = null;
    this.state = {
      version: 1,
      durationMs: this.durationMs,
      topicCount: this.topicCount,
      topicIndex: 0,
      started: false,
      completedElapsedMs: 0,
      topicElapsedMs: 0,
      topicTargetMs: this.durationMs / this.topicCount,
    };
  }

  start() {
    this.state.started = true;
  }

  setRunning(running: boolean) {
    const current = this.now();
    this.sample(current);
    this.runningSince = running && this.state.started ? current : null;
  }

  snapshot(): DialogueTimerSnapshot {
    this.sample();
    return { ...this.state };
  }

  advance() {
    this.sample();
    if (this.state.topicIndex >= this.topicCount - 1) return;
    this.state.completedElapsedMs += this.state.topicElapsedMs;
    this.state.topicElapsedMs = 0;
    this.state.topicIndex += 1;
    this.state.topicTargetMs = (
      (this.durationMs - this.state.completedElapsedMs) /
        (this.topicCount - this.state.topicIndex)
    );
  }

  restore(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const saved = value as DialogueTimerSnapshot;
    if (
      saved.version !== 1 || saved.durationMs !== this.durationMs ||
      saved.topicCount !== this.topicCount || typeof saved.started !== "boolean" ||
      !Number.isInteger(saved.topicIndex) || saved.topicIndex < 0 ||
      saved.topicIndex >= this.topicCount ||
      ![saved.completedElapsedMs, saved.topicElapsedMs, saved.topicTargetMs].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      ) ||
      saved.completedElapsedMs + saved.topicElapsedMs > this.durationMs ||
      saved.topicTargetMs !== (
        (this.durationMs - saved.completedElapsedMs) / (this.topicCount - saved.topicIndex)
      ) ||
      (!saved.started && (saved.completedElapsedMs !== 0 || saved.topicElapsedMs !== 0))
    ) return false;
    this.state = { ...saved };
    this.runningSince = null;
    return true;
  }

  private sample(current = this.now()) {
    if (this.runningSince === null) return;
    const delta = Math.max(0, current - this.runningSince);
    this.state.topicElapsedMs = Math.min(
      this.durationMs - this.state.completedElapsedMs,
      this.state.topicElapsedMs + delta,
    );
    this.runningSince = current;
  }
}
