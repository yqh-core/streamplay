#!/usr/bin/env node
/* Failure-simulation test for PR #25 parser-load resilience.
   Proves player.js does NOT abort its IIFE when the shared M3U8 parser
   module is missing or malformed, while normal playback wiring is untouched.
   Run: node scripts/test-player-parser-guard.mjs   (exit 0 = pass, 1 = fail) */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const GUARDED = 'var m3u8ParserReady = !!(window.StreamPlayM3U8Parser';
const src = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
assert.ok(src.includes(GUARDED), 'player.js must contain the guarded parser init');

/* Universal permissive stub: any property get returns a callable stub,
   length->0 (so forEach/array-like loops no-op), then->undefined (not thenable),
   Symbol.toPrimitive->' ' (so regex.test on a stub is benign). */
function makeAnything() {
  const f = function () {};
  const p = new Proxy(f, {
    get(t, k) {
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => ' ';
      if (k === Symbol.iterator) return function* () {};
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; },
    has() { return true; },
  });
  return p;
}

/* Load player.js in a fresh browser-like sandbox where the ONLY thing that
   varies is what window.StreamPlayM3U8Parser resolves to. Returns the thrown
   error (if the IIFE aborted) or null (if it completed). */
function loadPlayer(source, parserValue) {
  const base = makeAnything();
  const win = new Proxy(base, {
    get(t, k) { return k === 'StreamPlayM3U8Parser' ? parserValue : Reflect.get(t, k); },
    has() { return true; },
  });
  /* Real globals we want genuinely present; every OTHER bare identifier
     (IntersectionObserver, MutationObserver, ResizeObserver, WebVTT, ...)
     auto-resolves to a permissive stub so the load test isolates the
     parser-guard variable instead of tripping on unrelated browser APIs. */
  const real = {
    window: win,
    document: makeAnything(),
    navigator: makeAnything(),
    location: makeAnything(),
    fetch: () => new Promise(() => {}),
    URL, Promise, console,
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0,
  };
  const anything = makeAnything();
  const sandbox = new Proxy(real, {
    has() { return true; },
    get(t, k) { return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : anything; },
    set(t, k, v) { t[k] = v; return true; },
  });
  try {
    vm.runInNewContext(source, sandbox, { filename: 'js/player.js' });
    return null;
  } catch (e) {
    return e;
  }
}

let failed = 0;
function check(name, err, expectThrow) {
  const threw = err !== null;
  const ok = threw === expectThrow;
  console.log((ok ? '  ok  ' : '  FAIL') + '  ' + name + '  -> threw=' + threw
    + '  ' + (err ? '(' + err.constructor.name + ': ' + err.message.slice(0, 60) + ')' : '(clean load)'));
  if (!ok) failed++;
}

const WORKING_PARSER = { parseManifest: () => ({ isMaster: false, segments: [], variants: [], media: [] }) };

console.log('FIXED player.js (with guard):');
check('A parser present  -> loads clean', loadPlayer(src, WORKING_PARSER), false);
check('B parser missing  -> loads clean (no IIFE abort)', loadPlayer(src, undefined), false);
check('C parser obj, no method -> loads clean', loadPlayer(src, {}), false);

/* Regression proof: the ORIGINAL unguarded init must abort the IIFE when the
   module is missing. Reconstruct that variant by reverting the guard block to
   the pre-fix single-line dereference, and confirm it throws in scenario B. */
const unguarded = src.replace(
  /var m3u8ParserReady = !![\s\S]*?: null;/,
  'var parseManifest = window.StreamPlayM3U8Parser.parseManifest;'
);
assert.notEqual(unguarded, src, 'unguarded reconstruction must differ from fixed source');
console.log('UNGUARDED player.js (pre-fix, for contrast):');
check("B' parser missing  -> IIFE ABORTS (the bug the guard fixes)", loadPlayer(unguarded, undefined), true);

if (failed) { console.log('FAIL: ' + failed + ' resilience scenario(s) not met'); process.exit(1); }
console.log('PASS: player.js survives missing/malformed parser module; guard is load-bearing');
