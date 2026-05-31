// Runtime polyfills that must load before any other module.
//
// Hermes (the engine Expo Go / RN use) does not define some web/DOM globals
// that browser-oriented libraries (e.g. livekit-client) reference at module
// load time. Without these, the app crashes on launch with errors like
// "Property 'DOMException' doesn't exist". We install minimal shims here and
// import this file first from App.tsx so they exist before anything else runs.

const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.DOMException === 'undefined') {
  class DOMExceptionPolyfill extends Error {
    readonly code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name || 'Error';
      this.code = 0;
    }
  }
  g.DOMException = DOMExceptionPolyfill;
}

export {};
