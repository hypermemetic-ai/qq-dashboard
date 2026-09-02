import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  defaultUsageCachePath,
  MAX_USAGE_CACHE_BYTES,
  PROVIDER_STALE_MAX_MS,
  readUsageCache,
  USAGE_CACHE_SCHEMA,
} from "../src/usage-cache.mjs";

function envelope() {
  return {
    schema: USAGE_CACHE_SCHEMA,
    generatedAt: 1_788_000_000_000,
    ignored: "lost",
    providers: [{
      id: "codex", label: "Codex", state: "ready", observedAt: 1_788_000_000_000,
      secret: "lost",
      meters: [{ id: "weekly", label: "7d", usedRatio: 0.25,
        resetAt: 1_788_600_000_000, detail: "", raw: "lost" }],
    }, {
      id: "qwen", label: "Qwen", state: "stale", observedAt: 1_788_000_000_000,
      meters: [{ id: "weekly", label: "7d", usedRatio: 1.2,
        resetAt: null, detail: "48000 / 40000" }],
    }, {
      id: "grok", label: "Grok", state: "unavailable", observedAt: null, meters: [],
    }],
  };
}

test("strict usage cache reader isolates valid non-secret display fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qq-dashboard-usage-test."));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "usage-cache.json");
  await writeFile(file, JSON.stringify(envelope()), { mode: 0o600 });
  const usage = await readUsageCache(file);
  assert.equal(usage.generatedAt, envelope().generatedAt);
  assert.deepEqual(usage.providers.map(({ id, state }) => ({ id, state })), [
    { id: "codex", state: "ready" },
    { id: "grok", state: "unavailable" },
    { id: "qwen", state: "stale" },
  ]);
  assert.equal(usage.providers[2].meters[0].usedRatio, 1.2);
  assert.equal(usage.providers[0].issue, null, "v1 cache without issue remains compatible");
  assert.equal("secret" in usage.providers[0], false);
  assert.equal("raw" in usage.providers[0].meters[0], false);
  assert.equal("ignored" in usage, false);
  assert.ok(Object.isFrozen(usage));
});

test("usage cache reader rejects unsafe and malformed files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qq-dashboard-usage-invalid."));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "usage-cache.json");
  const target = join(root, "target.json");
  await writeFile(target, JSON.stringify(envelope()), { mode: 0o600 });
  await symlink(target, file);
  assert.equal(await readUsageCache(file), null, "symlink is rejected");
  await rm(file);

  for (const candidate of [
    "not json",
    JSON.stringify({ ...envelope(), schema: "wrong" }),
    JSON.stringify({ ...envelope(), generatedAt: -1 }),
    JSON.stringify({ ...envelope(), providers: [{
      id: "codex", label: "Codex", state: "unavailable", observedAt: 1, meters: [],
    }] }),
    JSON.stringify({ ...envelope(), providers: envelope().providers.map((provider, index) => (
      index === 0 ? { ...provider, id: "other" } : provider
    )) }),
    JSON.stringify({ ...envelope(), providers: envelope().providers.map((provider, index) => (
      index === 1 ? { ...provider, meters: [{ ...provider.meters[0], detail: "raw secret" }] } : provider
    )) }),
    JSON.stringify({ ...envelope(), providers: envelope().providers.map((provider, index) => (
      index === 0 ? { ...provider, issue: "credential text" } : provider
    )) }),
    JSON.stringify({ ...envelope(), providers: envelope().providers.map((provider, index) => (
      index === 0 ? { ...provider, issue: "login-required" } : provider
    )) }),
    JSON.stringify({ ...envelope(), providers: envelope().providers.map((provider, index) => (
      index === 1 ? { ...provider, issue: "temporary" } : provider
    )) }),
  ]) {
    await writeFile(file, candidate, { mode: 0o600 });
    assert.equal(await readUsageCache(file), null);
  }
  await writeFile(file, JSON.stringify(envelope()), { mode: 0o600 });
  await chmod(file, 0o644);
  assert.equal(await readUsageCache(file), null, "permissive cache mode is rejected");
  await chmod(file, 0o4600);
  assert.equal(await readUsageCache(file), null, "special cache mode bits are rejected");
  await writeFile(file, "x".repeat(MAX_USAGE_CACHE_BYTES + 1), { mode: 0o600 });
  assert.equal(await readUsageCache(file), null, "oversized cache is rejected");
  await chmod(file, 0o600);
  assert.equal(await readUsageCache("relative.json"), null);
  assert.equal(await readUsageCache(join(root, "missing.json")), null);
});

test("default cache path requires an absolute HOME", () => {
  assert.equal(defaultUsageCachePath({ HOME: "/operator" }),
    "/operator/.local/state/qq/telemetry/usage-cache.json");
  assert.equal(defaultUsageCachePath({ HOME: "relative" }), null);
  assert.equal(defaultUsageCachePath({}), null);
});


test("Codex/Grok stale rows expire independently by age or reset", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qq-dashboard-usage-stale."));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "usage-cache.json");
  const generatedAt = 1_788_000_000_000;
  const candidate = envelope();
  candidate.generatedAt = generatedAt;
  candidate.providers[0] = {
    id: "codex", label: "Codex", state: "stale", issue: "temporary",
    observedAt: generatedAt - 60_000,
    meters: [{ id: "weekly", label: "7d", usedRatio: 0.25,
      resetAt: generatedAt + 120_000, detail: "temporary provider failure" }],
  };
  candidate.providers[2] = {
    id: "grok", label: "Grok", state: "ready", observedAt: generatedAt,
    meters: [{ id: "weekly", label: "7d", usedRatio: 0.4,
      resetAt: generatedAt + 3_600_000, detail: "" }],
  };
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 });

  const eligible = await readUsageCache(file, generatedAt + 90_000);
  assert.equal(eligible.providers.find(({ id }) => id === "codex").state, "stale");
  assert.equal(eligible.providers.find(({ id }) => id === "grok").state, "ready");

  const resetExpired = await readUsageCache(file, generatedAt + 120_000);
  assert.deepEqual(resetExpired.providers.find(({ id }) => id === "codex"), {
    id: "codex", label: "Codex", state: "unavailable", issue: "temporary",
    observedAt: null, meters: [],
  });
  assert.equal(resetExpired.providers.find(({ id }) => id === "grok").state, "ready",
    "one expired stale row cannot mask a fresh sibling");

  candidate.providers[0].meters[0].resetAt = null;
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 });
  const ageExpired = await readUsageCache(file,
    candidate.providers[0].observedAt + PROVIDER_STALE_MAX_MS);
  assert.equal(ageExpired.providers.find(({ id }) => id === "codex").state, "unavailable");
});

test("strict cache rejects unbounded or malformed provider stale rows", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qq-dashboard-usage-stale-invalid."));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "usage-cache.json");
  const generatedAt = 1_788_000_000_000;
  const candidate = envelope();
  candidate.generatedAt = generatedAt;
  candidate.providers[0] = {
    id: "codex", label: "Codex", state: "stale", issue: "response-error",
    observedAt: generatedAt - PROVIDER_STALE_MAX_MS,
    meters: [{ id: "weekly", label: "7d", usedRatio: 0.25, resetAt: null,
      detail: "provider response unsupported" }],
  };
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 });
  assert.equal(await readUsageCache(file, generatedAt), null, "producer-age bound is strict");
  candidate.providers[0].observedAt = generatedAt - 1;
  candidate.providers[0].meters[0].resetAt = generatedAt;
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 });
  assert.equal(await readUsageCache(file, generatedAt), null, "expired stale reset is rejected");
  candidate.providers[0].state = "ready";
  candidate.providers[0].observedAt = generatedAt;
  candidate.providers[0].meters[0] = {
    id: "weekly", label: "7d", usedRatio: 1.01, resetAt: null, detail: "",
  };
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 });
  assert.equal(await readUsageCache(file, generatedAt), null, "provider percentage cannot exceed 100%");
});
