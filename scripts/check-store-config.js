// Guards the store-review fixes so they cannot quietly come back.
//
//   npm run check:store
//
// Reads the committed native files, which are what EAS builds, and app.json,
// which is what a prebuild would regenerate them from.
const fs = require('fs');
const assert = require('assert/strict');

const BLOCKED = [
  'android.permission.CAMERA',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const plist = fs.readFileSync('ios/Whisper/Info.plist', 'utf8');

for (const perm of BLOCKED) {
  // react-native-webrtc declares some of these itself; only an explicit remove
  // keeps them out of the merged manifest.
  assert.ok(
    manifest.includes(`<uses-permission android:name="${perm}" tools:node="remove"/>`),
    `AndroidManifest.xml must remove ${perm}`,
  );
  assert.ok(
    !new RegExp(`<uses-permission android:name="${perm}"\\s*/>`).test(manifest),
    `AndroidManifest.xml requests ${perm} again`,
  );
  assert.ok(app.android.blockedPermissions?.includes(perm), `app.json must block ${perm} for prebuild`);
  assert.ok(!app.android.permissions?.includes(perm), `app.json requests ${perm} again`);
}
console.log(`  ✓ ${BLOCKED.length} unused Android permissions stay removed`);

// Without POST_NOTIFICATIONS, Android 13+ never shows the notification prompt,
// so no check-in or reply notification ever arrives.
assert.ok(manifest.includes('<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'), 'AndroidManifest.xml must declare POST_NOTIFICATIONS');
assert.ok(app.android.permissions?.includes('android.permission.POST_NOTIFICATIONS'), 'app.json must declare POST_NOTIFICATIONS for prebuild');
const appGradle = fs.readFileSync('android/app/build.gradle', 'utf8');
assert.ok(/apply plugin: 'com\.google\.gms\.google-services'/.test(appGradle), 'android/app/build.gradle must apply the Google services plugin (Firebase push)');
console.log('  ✓ the notification permission and Firebase push wiring are in place');

// Background VoIP without VoIP push is a common App Store rejection.
assert.ok(!/<string>voip<\/string>/.test(plist), 'Info.plist declares the voip background mode again');
assert.ok(!app.ios.infoPlist.UIBackgroundModes.includes('voip'), 'app.json declares the voip background mode again');
console.log('  ✓ no voip background mode');

// Permission prompts are shown to users and read by App Review.
for (const [where, text] of [['Info.plist', plist], ['app.json', JSON.stringify(app.ios.infoPlist)]]) {
  assert.ok(!/development server/i.test(text), `${where} shows users a developer-facing permission prompt`);
}
console.log('  ✓ permission prompts are written for users');

console.log('\nstore config check passed');
