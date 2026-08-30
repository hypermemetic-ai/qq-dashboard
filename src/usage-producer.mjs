import { spawn as spawnChild } from "node:child_process";
import { fileURLToPath } from "node:url";

export const USAGE_UPDATE_SIGNAL = "qq-dashboard:usage-cache-updated";
export const DEFAULT_RESTART_DELAY_MS = 1_000;
export const usageProducerCommand = fileURLToPath(
  new URL("../bin/qq-dashboard", import.meta.url),
);

function fixedSignalReader(onUpdate) {
  let offset = 0;
  let valid = true;
  return (chunk) => {
    // Match the protocol incrementally without retaining arbitrary child text.
    // Only one exact newline-terminated fixed line can reach the cache owner.
    for (const character of String(chunk)) {
      if (character === "\n") {
        if (valid && offset === USAGE_UPDATE_SIGNAL.length) {
          try { onUpdate(); } catch {}
        }
        offset = 0;
        valid = true;
      } else if (valid && offset < USAGE_UPDATE_SIGNAL.length
        && character === USAGE_UPDATE_SIGNAL[offset]) {
        offset += 1;
      } else {
        valid = false;
      }
    }
  };
}

/**
 * Own one cache-only shell producer for a plugin lifetime. The child is never
 * detached, receives credentials only through its inherited environment/local
 * stores, and has no log surface. Unexpected termination is restarted after a
 * fixed delay to prevent a failure loop from spinning.
 */
export function createUsageProducerSupervisor({
  onUpdate = () => {},
  spawn = spawnChild,
  command = usageProducerCommand,
  env = process.env,
  setTimeoutFor = setTimeout,
  clearTimeoutFor = clearTimeout,
  restartDelayMs = DEFAULT_RESTART_DELAY_MS,
} = {}) {
  const delay = Number.isFinite(restartDelayMs) && restartDelayMs >= 0
    ? Math.min(Math.max(Math.floor(restartDelayMs), 100), 30_000)
    : DEFAULT_RESTART_DELAY_MS;
  let disposed = false;
  let child = null;
  let restartTimer = null;

  function scheduleRestart() {
    if (disposed || restartTimer !== null) return;
    restartTimer = setTimeoutFor(() => {
      restartTimer = null;
      start();
    }, delay);
    restartTimer?.unref?.();
  }

  function ended(owner) {
    if (child !== owner) return;
    child = null;
    scheduleRestart();
  }

  function start() {
    if (disposed || child !== null) return;
    let next;
    try {
      next = spawn(command, ["--headless"], {
        detached: false,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      scheduleRestart();
      return;
    }
    child = next;
    const readSignal = fixedSignalReader(() => {
      if (!disposed && child === next) onUpdate();
    });
    next.stdout?.setEncoding?.("utf8");
    next.stdout?.on?.("data", readSignal);
    next.stdout?.on?.("error", () => {});
    next.once?.("error", () => ended(next));
    next.once?.("close", () => ended(next));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (restartTimer !== null) {
      clearTimeoutFor(restartTimer);
      restartTimer = null;
    }
    const running = child;
    child = null;
    if (running) {
      try { running.kill("SIGTERM"); } catch {}
    }
  }

  start();
  return Object.freeze({ dispose });
}
