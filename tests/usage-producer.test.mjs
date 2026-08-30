import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import test from "node:test";

import {
  createUsageProducerSupervisor,
  DEFAULT_RESTART_DELAY_MS,
  USAGE_UPDATE_SIGNAL,
  usageProducerCommand,
} from "../src/usage-producer.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); return true; };
  return child;
}

test("usage producer accepts only its exact fixed signal and spawns without an output surface", () => {
  const children = [];
  const calls = [];
  const inherited = { HOME: "/operator", FIXTURE_SECRET: "never-an-argument" };
  let updates = 0;
  const supervisor = createUsageProducerSupervisor({
    env: inherited,
    onUpdate() { updates += 1; },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = fakeChild();
      children.push(child);
      return child;
    },
  });

  assert.equal(usageProducerCommand, resolve("bin/qq-dashboard"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, usageProducerCommand);
  assert.deepEqual(calls[0].args, ["--headless"]);
  assert.deepEqual(calls[0].options, {
    detached: false,
    env: inherited,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ok(!JSON.stringify(calls[0].args).includes("FIXTURE_SECRET"));

  children[0].stdout.write(`${USAGE_UPDATE_SIGNAL.slice(0, 10)}`);
  children[0].stdout.write(`${USAGE_UPDATE_SIGNAL.slice(10)}\n`);
  assert.equal(updates, 1, "a chunked exact signal is accepted");
  children[0].stdout.write([
    "raw provider payload",
    `${USAGE_UPDATE_SIGNAL} extra`,
    `prefix ${USAGE_UPDATE_SIGNAL}`,
    `${USAGE_UPDATE_SIGNAL}\r`,
    "",
  ].join("\n"));
  assert.equal(updates, 1, "malformed lines and arbitrary output are ignored");
  children[0].stdout.write(`${USAGE_UPDATE_SIGNAL}\n${USAGE_UPDATE_SIGNAL}\n`);
  assert.equal(updates, 3);

  supervisor.dispose();
  supervisor.dispose();
  children[0].stdout.write(`${USAGE_UPDATE_SIGNAL}\n`);
  assert.equal(updates, 3, "buffered output is inert after owner disposal");
  assert.deepEqual(children[0].kills, ["SIGTERM"]);
});

test("usage producer keeps one child, delays restart, and never restarts after disposal", () => {
  const children = [];
  const timers = [];
  const cleared = [];
  const spawn = () => {
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const supervisor = createUsageProducerSupervisor({
    spawn,
    setTimeoutFor(callback, delay) {
      const timer = { callback, delay, unrefCalls: 0, unref() { this.unrefCalls += 1; } };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFor(timer) { cleared.push(timer); },
  });

  assert.equal(children.length, 1);
  children[0].emit("close", 1, null);
  assert.equal(children.length, 1, "exit never causes an immediate second child");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, DEFAULT_RESTART_DELAY_MS);
  assert.equal(timers[0].unrefCalls, 1);
  timers[0].callback();
  assert.equal(children.length, 2);

  children[1].emit("error", new Error("injected spawn failure"));
  children[1].emit("close", 1, null);
  assert.equal(timers.length, 2, "error plus close schedules only one restart");
  supervisor.dispose();
  assert.deepEqual(cleared, [timers[1]]);
  assert.deepEqual(children[1].kills, [], "an already-ended child is not killed");
  timers[1].callback();
  assert.equal(children.length, 2, "a stale restart callback cannot spawn after disposal");
});

test("synchronous spawn failure is supervised with a bounded delayed retry", () => {
  const timers = [];
  let calls = 0;
  const supervisor = createUsageProducerSupervisor({
    restartDelayMs: Number.MAX_SAFE_INTEGER,
    spawn() { calls += 1; throw new Error("missing command"); },
    setTimeoutFor(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFor() {},
  });
  assert.equal(calls, 1);
  assert.equal(timers[0].delay, 30_000);
  timers[0].callback();
  assert.equal(calls, 2);
  supervisor.dispose();
});
