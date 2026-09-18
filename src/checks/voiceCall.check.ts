// The voice call's timing and state rules (see lib/voiceCall).
//
//   npx tsx src/checks/voiceCall.check.ts
import assert from 'node:assert/strict';
import {
  ORB_SETTLE_MS,
  createOrbSettler,
  decodeAgentState,
  formatClock,
  levelFromRms,
  liveBalance,
  orbFromSpeakers,
  spokenDuration,
  type OrbState,
} from '../lib/voiceCall';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

// ── Backend hints ───────────────────────────────────────────────────────
assert.equal(decodeAgentState(bytes({ kind: 'agent_state', state: 'speaking' })), 'speaking');
assert.equal(decodeAgentState(bytes({ kind: 'agent_state', state: 'initializing' })), null, 'unknown states are ignored');
assert.equal(decodeAgentState(bytes({ kind: 'transcript', state: 'speaking' })), null, 'other payloads on the topic are ignored');
assert.equal(decodeAgentState(new Uint8Array([0xff, 0x00])), null, 'garbage does not throw');
console.log('  ✓ reads the backend agent state and ignores everything else');

// ── Speaker fallback ────────────────────────────────────────────────────
assert.equal(orbFromSpeakers(true), 'speaking');
assert.equal(orbFromSpeakers(false), 'listening', 'silence is the user’s turn, never "thinking"');
console.log('  ✓ silence reads as listening, not thinking');

// ── Settler: no flicker at pauses ───────────────────────────────────────
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (id: unknown) => {
      timers = timers.filter(t => t.id !== id);
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter(t => t.at <= now);
      timers = timers.filter(t => t.at > now);
      due.forEach(t => t.fn());
    },
  };
}

{
  const clock = fakeClock();
  const shown: OrbState[] = [];
  const settler = createOrbSettler('listening', s => shown.push(s), clock.schedule, clock.cancel);

  settler.propose('speaking');
  assert.deepEqual(shown, ['speaking'], 'speech shows at once, so the orb moves with the voice');

  // A breath between sentences: listening for 150ms, then speaking again.
  settler.propose('listening');
  clock.advance(150);
  settler.propose('speaking');
  clock.advance(ORB_SETTLE_MS);
  assert.deepEqual(shown, ['speaking'], 'a short pause does not flip the orb');

  // A real turn change holds, so it shows after the settle time.
  settler.propose('listening');
  clock.advance(ORB_SETTLE_MS - 1);
  assert.deepEqual(shown, ['speaking'], 'not before the settle time');
  clock.advance(1);
  assert.deepEqual(shown, ['speaking', 'listening'], 'a held change shows');

  settler.propose('thinking');
  settler.dispose();
  clock.advance(ORB_SETTLE_MS * 2);
  assert.deepEqual(shown, ['speaking', 'listening'], 'nothing shows after dispose');
}
console.log('  ✓ the orb ignores pauses and follows real turn changes');

// ── Clock and spoken length ─────────────────────────────────────────────
assert.equal(formatClock(0), '0:00');
assert.equal(formatClock(252.9), '4:12', 'whole seconds, floored');
assert.equal(formatClock(3729), '1:02:09');
assert.equal(spokenDuration(252), '4 minutes, 12 seconds');
assert.equal(spokenDuration(60), '1 minute');
assert.equal(spokenDuration(0), '0 seconds');
assert.equal(spokenDuration(3601), '1 hour, 1 second');
console.log('  ✓ call length reads right on screen and aloud');

// ── Live balance ────────────────────────────────────────────────────────
assert.equal(liveBalance(null, 0, 10_000), null, 'unknown balance shows no banner');
assert.equal(liveBalance(300, null, 10_000), 300, 'nothing is charged before the session starts');
assert.equal(liveBalance(300, 1_000, 61_000), 240, 'counts down from the session start');
assert.equal(liveBalance(300, 5_000, 1_000), 300, 'a clock behind the start never adds time');
console.log('  ✓ the minutes banner counts down from the session start');

// ── Voice level ─────────────────────────────────────────────────────────
assert.equal(levelFromRms(0), 0);
assert.equal(levelFromRms(Number.NaN), 0);
assert.equal(levelFromRms(10 ** (-50 / 20)), 0, '-50 dBFS is silence');
assert.ok(Math.abs(levelFromRms(10 ** (-30 / 20)) - 0.5) < 1e-9, '-30 dBFS is half');
assert.equal(levelFromRms(1), 1, 'full scale is clamped to 1');
console.log('  ✓ voice level maps speech loudness onto 0–1');

console.log('\nVoice call checks passed');
