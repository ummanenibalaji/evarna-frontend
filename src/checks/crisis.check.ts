// Crisis resources (see data/crisis): the right numbers for where the phone is,
// and every one of them actually opens something.
//
//   npm run check:crisis
import assert from 'node:assert/strict';
import {
  canOpenCrisisResource, crisisRegion, crisisResources, crisisResourceUrl,
  type CrisisRegion, type CrisisResource,
} from '../data/crisis';

const REGIONS: CrisisRegion[] = ['IN', 'US', 'GB', 'CA', 'AU', 'OTHER'];

const cases: [locale: string, timeZone: string, want: CrisisRegion, why: string][] = [
  ['en-IN', 'Asia/Kolkata', 'IN', 'India'],
  ['en-US', 'Asia/Calcutta', 'IN', 'the legacy Indian zone, whatever the language'],
  ['hi', 'Asia/Kolkata', 'IN', 'a locale with no region'],
  ['en-US', 'America/New_York', 'US', 'the US'],
  ['en-IN', 'America/Los_Angeles', 'US', 'an Indian locale in the US follows the phone'],
  ['en-US', 'America/Indiana/Indianapolis', 'US', 'a nested US zone'],
  ['en-US', 'Pacific/Honolulu', 'US', 'Hawaii'],
  ['en-CA', 'America/Toronto', 'CA', 'Canada'],
  ['en-US', 'America/Vancouver', 'CA', 'a Canadian zone beats a US locale'],
  ['fr-CA', 'America/Montreal', 'CA', 'the legacy Montreal zone'],
  ['en-GB', 'Europe/London', 'GB', 'the UK'],
  ['en-AU', 'Australia/Sydney', 'AU', 'Australia'],
  ['en-US', 'Australia/Perth', 'AU', 'any Australian zone'],
  ['en', 'America/Bogota', 'US', 'an unlisted Americas zone with no region'],
  ['en-US', 'America/Puerto_Rico', 'US', 'an unlisted Americas zone with a US region'],
  ['es-MX', 'America/Mexico_City', 'OTHER', 'Mexico must not get US numbers'],
  ['pt-BR', 'America/Sao_Paulo', 'OTHER', 'Brazil must not get US numbers'],
  ['en-US', 'Europe/Paris', 'OTHER', 'a US traveller in France must not get 911'],
  ['en-IN', 'Asia/Dubai', 'OTHER', 'an Indian locale abroad must not get Indian numbers'],
  ['en-IN', 'UTC', 'IN', 'an uninformative zone falls back to the locale region'],
  ['en-GB', 'Etc/GMT', 'GB', 'Etc zones fall back to the locale region'],
  ['de-DE', 'UTC', 'OTHER', 'an unsupported locale region'],
  ['', '', 'OTHER', 'nothing known'],
  ['zh-Hant-TW', 'Asia/Taipei', 'OTHER', 'script subtags are skipped'],
  ['en_AU', '', 'AU', 'underscore locales'],
];
for (const [locale, timeZone, want, why] of cases) {
  assert.equal(crisisRegion({ locale, timeZone }), want, `${locale || '(none)'} in ${timeZone || '(none)'} → ${want}: ${why}`);
}
console.log(`  ✓ ${cases.length} locale/zone combinations map to the right region`);

assert.ok(REGIONS.includes(crisisRegion()), 'the device default is a known region');
console.log('  ✓ the device default resolves');

const all = (r: CrisisRegion): CrisisResource[] => {
  const { emergency, resources } = crisisResources(r);
  return [emergency, ...resources];
};

const ids = new Set<string>();
for (const region of REGIONS) {
  const { resources } = crisisResources(region);
  assert.ok(resources.length > 0, `${region} offers at least one resource beyond emergency services`);
  for (const r of all(region)) {
    assert.ok(!ids.has(r.id), `resource id ${r.id} is unique`);
    ids.add(r.id);
    assert.ok(r.name.trim() && r.detail.trim(), `${r.id} has a name and a detail line`);
    if (r.id === 'other-emergency') {
      assert.equal(canOpenCrisisResource(r), false, 'OTHER cannot know the local emergency number, so it offers no action');
      assert.equal(crisisResourceUrl(r, 'ios'), null);
      continue;
    }
    assert.ok(canOpenCrisisResource(r), `${r.id} can be opened`);
    for (const platform of ['ios', 'android']) {
      const url = crisisResourceUrl(r, platform);
      assert.ok(url, `${r.id} has a URL on ${platform}`);
      if (r.kind === 'call') assert.match(url, /^tel:\+?\d{3,}$/, `${r.id} dials digits only`);
      if (r.kind === 'text') assert.match(url, /^sms:\+?\d{3,}([?&]body=[A-Z]+)?$/, `${r.id} texts digits only`);
      if (r.kind === 'web') assert.match(url, /^https:\/\/[^\s]+$/, `${r.id} opens an https page`);
    }
  }
}
console.log('  ✓ every resource except OTHER’s emergency entry opens a dialer, messages or a web page');

const byId = (id: string) => REGIONS.flatMap(all).find(r => r.id === id)!;
const expected: [id: string, kind: CrisisResource['kind'], value: string, body?: string][] = [
  ['in-emergency', 'call', '112'],
  ['in-tele-manas', 'call', '14416'],
  ['in-vandrevala', 'call', '+919999666555'],
  ['in-aasra', 'call', '+919820466726'],
  ['in-icall', 'call', '+919152987821'],
  ['us-emergency', 'call', '911'],
  ['us-988-call', 'call', '988'],
  ['us-988-text', 'text', '988'],
  ['us-crisis-text-line', 'text', '741741', 'HOME'],
  ['gb-emergency', 'call', '999'],
  ['gb-samaritans', 'call', '116123'],
  ['gb-shout', 'text', '85258', 'SHOUT'],
  ['ca-emergency', 'call', '911'],
  ['ca-988-call', 'call', '988'],
  ['ca-988-text', 'text', '988'],
  ['au-emergency', 'call', '000'],
  ['au-lifeline-call', 'call', '131114'],
  ['au-lifeline-text', 'text', '0477131114'],
  ['other-find-a-helpline', 'web', 'https://findahelpline.com'],
];
for (const [id, kind, value, body] of expected) {
  const r = byId(id);
  assert.ok(r, `${id} exists`);
  assert.equal(r.kind, kind, `${id} is a ${kind}`);
  assert.equal(r.value, value, `${id} still points at ${value}`);
  assert.equal(r.body, body, `${id} prefills ${body ?? 'nothing'}`);
}
assert.equal(ids.size, expected.length + 1, 'no resource was added without review');
assert.match(byId('in-tele-manas').detail, /1-800-891-4416/, 'Tele-MANAS keeps its toll-free alternative');
assert.equal(byId('in-icall').hours, 'Mon–Sat, 10am–8pm', 'iCall is not a 24/7 line and must not look like one');
console.log(`  ✓ the ${expected.length} reviewed numbers are unchanged`);

assert.equal(crisisResourceUrl(byId('us-crisis-text-line'), 'ios'), 'sms:741741&body=HOME');
assert.equal(crisisResourceUrl(byId('gb-shout'), 'android'), 'sms:85258?body=SHOUT');
assert.equal(crisisResourceUrl(byId('in-emergency'), 'ios'), 'tel:112');
console.log('  ✓ message bodies use each platform’s sms: syntax');

console.log('\nCrisis resource checks passed');
