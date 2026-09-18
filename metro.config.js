// Metro config: Expo's defaults plus inline requires.
//
// With inline requires, an import is evaluated the first time it is used
// rather than when its importer loads, so a cold start only runs the modules
// the first screen needs. Expo leaves this off by default; React Native's own
// template turns it on. Bare side-effect imports (polyfills, gesture handler,
// Sentry) are unaffected and still run in import order.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const base = getTransformOptions ? await getTransformOptions(...args) : {};
  return {
    ...base,
    transform: {
      ...(base.transform ?? {}),
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  };
};

module.exports = config;
