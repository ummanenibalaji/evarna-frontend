// Release builds inline EXPO_PUBLIC_API_URL at bundle time, and one built
// without it cannot reach Evarna at all (see API_MISCONFIGURED in api/client).
// EAS runs this right after installing dependencies (the
// eas-build-post-install script), so such a build fails there instead of in
// someone's hands.
//
//   npm run check:api-url
//
// Development builds load their JavaScript from Metro and are skipped. Outside
// EAS it only checks a URL that is actually exported: .env is gitignored, so it
// never reaches an EAS build, and only a value EAS provides counts there.
import assert from 'node:assert/strict';

// Same rule as USABLE_RELEASE_URL in src/api/client.ts.
const USABLE_RELEASE_URL = /^(https:\/\/|http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/:]+\.local(:|\/|$)))/;

for (const ok of ['https://api.evarna.app', 'http://192.168.1.43:3000', 'http://10.0.2.2:3000', 'http://studio.local:3000']) {
  assert.match(ok, USABLE_RELEASE_URL, `${ok} is usable in a release build`);
}
for (const bad of ['http://api.evarna.app', 'http://172.32.0.1:3000', 'ftp://api.evarna.app', 'api.evarna.app']) {
  assert.doesNotMatch(bad, USABLE_RELEASE_URL, `${bad} is not usable in a release build`);
}
console.log('  ✓ only https, or http on the local network, counts as usable');

const profile = process.env.EAS_BUILD_PROFILE;
const url = process.env.EXPO_PUBLIC_API_URL?.trim();

if (profile === 'development') {
  console.log('  - development build: its JavaScript comes from Metro, nothing to check');
} else if (!process.env.EAS_BUILD && !url) {
  console.log('  - not an EAS build and EXPO_PUBLIC_API_URL is not exported, nothing to check');
} else {
  const build = profile ? `the "${profile}" build` : 'this build';
  assert.ok(url, `EXPO_PUBLIC_API_URL is not set for ${build}. Add it to that EAS environment (eas env:create) or to the profile's env in eas.json.`);
  assert.match(url, USABLE_RELEASE_URL, `EXPO_PUBLIC_API_URL must be an https URL for ${build} (got ${url}).`);
  console.log(`  ✓ ${build} talks to ${url}`);
}

console.log('\nAPI URL check passed');
