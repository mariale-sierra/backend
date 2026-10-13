'use strict';

/**
 * B11 — jest-environment-node (Jest 27) does not expose the WHATWG fetch
 * globals that Node 18+ has natively and that the app uses at runtime
 * (the OpenAI SDK resolves `fetch`/`Headers`/`Response` from globalThis).
 * This environment only copies those existing runtime globals into the test
 * sandbox, so a spec can drive the REAL OpenAI SDK against a stubbed
 * `fetch` — no request ever leaves the process. Opt-in per spec via the
 * `@jest-environment` docblock; every other spec keeps the default env.
 */
const NodeEnvironment = require('jest-environment-node');

const WEB_GLOBALS = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'Blob',
  'File',
  'ReadableStream',
  'AbortController',
  'AbortSignal',
  'DOMException',
  'TextEncoder',
  'TextDecoder',
];

class NodeWithFetchEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of WEB_GLOBALS) {
      if (this.global[name] === undefined && globalThis[name] !== undefined) {
        this.global[name] = globalThis[name];
      }
    }
  }
}

module.exports = NodeWithFetchEnvironment;
