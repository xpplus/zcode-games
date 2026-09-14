// Headless smoke test: run each game's script with DOM stubs + real matter.js,
// drive a few frames and a synthetic input, surface the exact runtime error.
import { readFileSync } from "fs";
import { runInNewContext } from "vm";

const games = {
  "fling.html":     { input: "fling", frames: 400 },
  "slingshot.html": { input: "sling", frames: 400 },
  "ballz.html":     { input: "ballz", frames: 600 },
  "cliff.html":     { input: "cliff", frames: 500 },
};

function callableProxy() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === "length") return 0;
      return proxy;
    },
    set: () => true,
    apply: () => proxy,
  });
  return proxy;
}

function makeSandbox() {
  const listeners = {};
  const sandbox = {
    module: { exports: {} }, exports: {},
    console: { log: () => {}, warn: () => {}, error: (...a) => { throw new Error("console.error: " + a.join(" ")); } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    performance: { now: () => Date.now() },
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
    Matter: null,
    document: {
      getElementById: (id) => sandbox["_" + id] || (sandbox["_" + id] = {
        style: {}, textContent: "",
        getContext: () => callableProxy(),
        addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
        width: 0, height: 0,
      }),
      createElement: () => ({ style: {}, remove() {}, setAttribute() {} }),
    },
    addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
    requestAnimationFrame: (cb) => { sandbox.__raf = cb; return 1; },
    setTimeout: (cb, ms) => { (sandbox.__timers = sandbox.__timers || []).push({ cb, at: Date.now() + (ms || 0) }); return 1; },
    clearTimeout: () => {},
    fire(type, evt) { (listeners[type] || []).forEach((cb) => { try { cb(evt); } catch (e) { throw e; } }); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, listeners };
}

let failed = 0;
for (const [file, cfg] of Object.entries(games)) {
  const html = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const matterSrc = readFileSync(new URL("../matter.min.js", import.meta.url), "utf8");
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const { sandbox } = makeSandbox();
  try {
    runInNewContext(matterSrc, sandbox, { timeout: 10000 });
    sandbox.Matter = sandbox.module.exports;
    runInNewContext(script, sandbox, { timeout: 10000 });
    // drive frames
    let t = Date.now();
    for (let i = 0; i < cfg.frames; i++) {
      const cb = sandbox.__raf; sandbox.__raf = null;
      if (!cb) break;
      t += 16.6;
      const realNow = Date.now; Date.now = () => t; sandbox.performance.now = () => t;
      cb(t);
      Date.now = realNow;
    }
    // synthetic input: touchstart/move/end near center
    const evt = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }], preventDefault() {}, target: {} });
    sandbox.fire("touchstart", evt(200, 500));
    sandbox.fire("touchmove", evt(200, 380));
    sandbox.fire("touchend", evt(200, 380));
    for (let i = 0; i < 200; i++) {
      const cb = sandbox.__raf; sandbox.__raf = null;
      if (!cb) break;
      t += 16.6;
      sandbox.performance.now = () => t;
      cb(t);
      if (sandbox.__timers && sandbox.__timers.length) {
        for (const tm of sandbox.__timers.splice(0)) tm.cb();
      }
    }
    console.log(file + ": PASS (script ran, input driven, no throw)");
  } catch (e) {
    failed++;
    console.log(file + ": FAIL - " + (e && e.message ? e.message : e));
    if (e && e.stack) console.log(e.stack.split("\n").slice(1, 4).join("\n"));
  }
}
process.exit(failed ? 1 : 0);
