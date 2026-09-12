import { spawn } from "node:child_process";

export function pingOne(ip, timeoutSeconds = 1) {
  return new Promise((resolve) => {
    const child = spawn("ping", ["-n", "-c", "1", "-W", String(timeoutSeconds), ip], {
      stdio: "ignore",
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, (timeoutSeconds + 1) * 1000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function pingMany(ips, { concurrency = 32, timeoutSeconds = 1, attempts = 1 } = {}) {
  const results = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < ips.length) {
      const index = cursor;
      cursor += 1;
      const ip = ips[index];
      let online = false;
      for (let attempt = 0; attempt < Math.max(1, attempts) && !online; attempt += 1) online = await pingOne(ip, timeoutSeconds);
      results.set(ip, online);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, () => worker()));
  return results;
}
