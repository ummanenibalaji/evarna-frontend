// Expo reads this in preference to app.json when both exist, and receives
// app.json's contents as `config`. Everything static still lives there; this
// file only injects the values that differ per environment and must not be
// committed — currently just the Google iOS URL scheme.
//
// The scheme is the iOS OAuth client id with its dot-separated parts reversed,
// which Google shows on the client's page as "iOS URL scheme". It is needed at
// BUILD time, not runtime, so it cannot come from the app's own env at launch —
// hence this file rather than a lookup inside the app.
//
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID looks like:
//   1234567890-abcdef.apps.googleusercontent.com
// and the scheme derived from it is:
//   com.googleusercontent.apps.1234567890-abcdef

function iosUrlSchemeFrom(clientId) {
  if (!clientId) return undefined;
  return clientId.split(".").reverse().join(".");
}

module.exports = ({ config }) => {
  const iosUrlScheme = iosUrlSchemeFrom(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

  // Without a client id the plugin is left off entirely rather than added with
  // a placeholder. A placeholder builds fine and then fails at runtime with a
  // native error that says nothing useful; a missing plugin fails at sign-in
  // with the message the app already shows.
  const plugins = (config.plugins ?? []).map((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    if (name !== "@react-native-google-signin/google-signin") return p;
    return iosUrlScheme
      ? ["@react-native-google-signin/google-signin", { iosUrlScheme }]
      : p;
  });

  return { ...config, plugins };
};
