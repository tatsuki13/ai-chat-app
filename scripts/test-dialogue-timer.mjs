import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const output = mkdtempSync(join(tmpdir(), "dialogue-timer-test-"));
let DialogueTimer;
try {
  execFileSync("node_modules/.bin/tsc", [
    "lib/dialogue-timer.ts", "--outDir", output,
    "--module", "commonjs", "--target", "ES2020", "--skipLibCheck", "--strict",
  ], { stdio: "inherit" });
  ({ DialogueTimer } = createRequire(import.meta.url)(join(output, "dialogue-timer.js")));
} finally {
  rmSync(output, { recursive: true, force: true });
}

function fixture() {
  let time = 0;
  const timer = new DialogueTimer(1_800_000, 6, () => time);
  return { timer, advanceClock: (ms) => { time += ms; } };
}

test("counts active time and excludes pauses, including repeated pause signals", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(12_345);
  timer.setRunning(false);
  advanceClock(60_000);
  timer.setRunning(false);
  assert.equal(timer.snapshot().topicElapsedMs, 12_345);
  timer.setRunning(true);
  advanceClock(2_000);
  timer.setRunning(true);
  advanceClock(3_000);
  assert.equal(timer.snapshot().topicElapsedMs, 17_345);
});

test("samples actual elapsed time even when display ticks are delayed", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(145_678);
  assert.equal(timer.snapshot().topicElapsedMs, 145_678);
});

test("transfers the complete topic duration and redistributes the remaining budget", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(180_000);
  timer.setRunning(false);
  advanceClock(10_000);
  timer.advance();
  const next = timer.snapshot();
  assert.equal(next.topicIndex, 1);
  assert.equal(next.completedElapsedMs, 180_000);
  assert.equal(next.topicElapsedMs, 0);
  assert.equal(next.topicTargetMs, 324_000);
  assert.equal(next.started, true);
  timer.setRunning(true);
  advanceClock(1_234);
  assert.equal(timer.snapshot().topicElapsedMs, 1_234);
});

test("restores durations, index and budget with a new clock origin, initially paused", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(180_000);
  timer.advance();
  advanceClock(25_432);
  const saved = JSON.parse(JSON.stringify(timer.snapshot()));
  let time = 900_000_000;
  const restored = new DialogueTimer(1_800_000, 6, () => time);
  assert.equal(restored.restore(saved), true);
  time += 3_600_000;
  assert.deepEqual(restored.snapshot(), saved);
  restored.setRunning(true);
  time += 5_000;
  assert.equal(restored.snapshot().topicElapsedMs, saved.topicElapsedMs + 5_000);
});

test("keeps fractional milliseconds when distributing the budget", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(180_001);
  timer.setRunning(false);
  timer.advance();
  const state = timer.snapshot();
  assert.equal(state.topicTargetMs, 323_999.8);
  assert.equal(state.topicTargetMs * 5 + state.completedElapsedMs, 1_800_000);
});

test("topic totals stay equal to active elapsed time across all six topics", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  let expected = 0;
  for (let index = 0; index < 6; index++) {
    timer.setRunning(true);
    const duration = 80_123 + index * 21_007;
    advanceClock(duration);
    expected += duration;
    timer.setRunning(false);
    advanceClock(9_876);
    const state = timer.snapshot();
    assert.equal(state.completedElapsedMs + state.topicElapsedMs, expected);
    timer.advance();
  }
  assert.equal(timer.snapshot().topicIndex, 5);
});

test("caps the shared elapsed time at thirty minutes and permits topic overtime", () => {
  const { timer, advanceClock } = fixture();
  timer.start();
  timer.setRunning(true);
  advanceClock(400_000);
  assert.ok(timer.snapshot().topicElapsedMs > timer.snapshot().topicTargetMs);
  timer.advance();
  advanceClock(2_000_000);
  const state = timer.snapshot();
  assert.equal(state.completedElapsedMs + state.topicElapsedMs, 1_800_000);
  timer.advance();
  assert.equal(timer.snapshot().topicTargetMs, 0);
});

test("rejects corrupt or incompatible stored snapshots", () => {
  const { timer } = fixture();
  const valid = timer.snapshot();
  for (const invalid of [null, {}, { ...valid, version: 2 },
    { ...valid, topicIndex: 6 }, { ...valid, topicElapsedMs: NaN },
    { ...valid, topicElapsedMs: -1 }, { ...valid, topicCount: 5 },
    { ...valid, topicTargetMs: 123 },
    { ...valid, started: true, topicElapsedMs: 1_800_001 }]) {
    assert.equal(timer.restore(invalid), false);
    assert.deepEqual(timer.snapshot(), valid);
  }
});

test("does not count before start and resets independently of external timestamps", () => {
  const { timer, advanceClock } = fixture();
  timer.setRunning(true);
  advanceClock(40_000);
  assert.equal(timer.snapshot().topicElapsedMs, 0);
  timer.start();
  timer.setRunning(true);
  advanceClock(10_000);
  timer.reset();
  advanceClock(50_000);
  assert.equal(timer.snapshot().started, false);
  assert.equal(timer.snapshot().topicElapsedMs, 0);
  assert.equal(timer.snapshot().topicTargetMs, 300_000);
});
