// The AI notice US companion-chatbot laws require (see lib/aiNotice).
//
//   npm run check:ai-notice
import assert from 'node:assert/strict';
import { AI_NOTICE_INTERVAL_MS, aiNoticeDue, aiNoticeText } from '../lib/aiNotice';

const t0 = Date.UTC(2026, 8, 14, 12, 0, 0);

assert.equal(AI_NOTICE_INTERVAL_MS, 3 * 60 * 60 * 1000, 'New York requires the notice at least every 3 hours');
assert.equal(aiNoticeDue(t0, t0 + AI_NOTICE_INTERVAL_MS - 1), false, 'repeated before 3 hours, which reads as nagging');
assert.equal(aiNoticeDue(t0, t0 + AI_NOTICE_INTERVAL_MS), true, 'not repeated at 3 hours, which the law requires');
console.log('  ✓ repeats at 3 hours, not before');

for (const minor of [false, true]) {
  assert.match(aiNoticeText('Maya', minor, false), /Maya, an AI, not a person/, 'the opening notice must say plainly it is an AI');
  assert.match(aiNoticeText('Maya', minor, true), /AI, not a person/, 'the repeat must still say it is an AI');
}
console.log('  ✓ every notice says plainly the companion is an AI');

assert.match(aiNoticeText('Maya', true, true), /break/, "a minor's 3-hour reminder must suggest a break (California SB 243)");
assert.doesNotMatch(aiNoticeText('Maya', false, true), /break/, 'adults are not told to take breaks');
console.log("  ✓ a minor's reminder suggests a break; an adult's does not");

console.log('\nAI notice checks passed');
