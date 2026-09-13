import { buildDevice, compactPortLabel, normalizeInterface, parseCdpNeighbors, parseLldpNeighbors, validIpv4 } from "./parsers.mjs";
import { runDeviceCommands } from "./transport.mjs";

export const DISCOVERY_COMMANDS = [
  "show privilege",
  "show version",
  "show inventory",
  "show running-config | include ^hostname",
  "show cdp neighbors detail",
  "show lldp neighbors detail",
  "show interfaces status",
  "show interface status",
  "show interfaces trunk",
  "show interface trunk",
  "show vlan brief",
  "show etherchannel summary",
  "show port-channel summary",
  "show vpc brief",
];

const CONFIG_COMMANDS = ["show running-config"];

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("عملیات متوقف شد.")); }, { once: true });
  });
}

function runOptions(input, ip, commands) {
  return {
    host: ip,
    port: input.port,
    username: input.username,
    password: input.password,
    enablePassword: input.enablePassword,
    protocol: input.protocol,
    connectTimeout: input.connectTimeout,
    commandTimeout: input.commandTimeout,
    commands,
    signal: input.signal,
  };
}

async function firstAttempt(input, ip, commands) {
  return runDeviceCommands(runOptions(input, ip, commands));
}

async function retryFailures(input, failures, commands, onProgress) {
  const recovered = new Map();
  let pending = [...failures];
  for (let retry = 1; retry <= input.retries && pending.length; retry += 1) {
    await sleep(Math.min(3000 * retry, 9000), input.signal);
    const next = [];
    for (const item of pending) {
      if (input.signal?.aborted) throw new Error("عملیات متوقف شد.");
      onProgress?.({ message: `تلاش مجدد ${retry} برای ${item.ip}`, currentIp: item.ip });
      try { recovered.set(item.ip, await firstAttempt(input, item.ip, commands)); }
      catch (error) { next.push({ ip: item.ip, error }); }
    }
    pending = next;
  }
  return { recovered, failures: pending };
}

function neighborKey(item) {
  return `${item.ip || item.remoteName}|${normalizeInterface(item.localPort)}|${normalizeInterface(item.remotePort)}`.toLowerCase();
}

function dedupeNeighbors(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = neighborKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDevice(ip, response) {
  const cdpText = response.outputs["show cdp neighbors detail"] || "";
  const lldpText = response.outputs["show lldp neighbors detail"] || "";
  const neighbors = dedupeNeighbors([...parseCdpNeighbors(cdpText), ...parseLldpNeighbors(lldpText)]);
  return buildDevice({ ip, prompt: response.prompt, outputs: response.outputs, neighbors });
}

function endpointPort(device, name) {
  const normalized = normalizeInterface(name);
  const port = device?.ports?.find((item) => normalizeInterface(item.name) === normalized) || { name: normalized };
  return { ...port, name: normalized || port.name };
}

function buildTopology(seedIp, scanned, unreachable) {
  const devices = [...scanned.values()];
  const byIp = new Map(devices.map((item) => [item.ip, item]));
  const placeholders = new Map();
  const links = [];
  const seenLinks = new Set();
  for (const source of devices) {
    for (const neighbor of source.neighbors || []) {
      const target = neighbor.ip ? byIp.get(neighbor.ip) : null;
      const placeholderKey = neighbor.ip || `name:${neighbor.remoteName}`;
      if (!target && !placeholders.has(placeholderKey)) {
        placeholders.set(placeholderKey, {
          key: `unreachable:${placeholderKey}`,
          ip: neighbor.ip || "",
          hostname: neighbor.remoteName || "همسایه ناشناس",
          model: neighbor.model || "",
          platform: "",
          osVersion: "",
          serial: "",
          ports: [],
          vlans: [],
          portCounts: { total: 0, up: 0, free: 0, adminDown: 0, error: 0 },
          reachable: false,
          error: unreachable.get(neighbor.ip)?.message || (neighbor.ip ? "تجهیز پیدا شد اما ورود موفق نبود." : "آدرس مدیریتی از همسایه دریافت نشد."),
        });
      }
      const targetDevice = target || placeholders.get(placeholderKey);
      const endpointA = `${source.ip}|${normalizeInterface(neighbor.localPort)}`;
      const endpointB = `${targetDevice.ip || targetDevice.hostname}|${normalizeInterface(neighbor.remotePort)}`;
      const linkKey = [endpointA, endpointB].sort().join("<->");
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);
      const sourcePort = endpointPort(source, neighbor.localPort);
      const targetPort = endpointPort(target, neighbor.remotePort);
      links.push({
        id: linkKey,
        from: source.key,
        to: targetDevice.key,
        fromPort: sourcePort,
        toPort: targetPort,
        fromLabel: compactPortLabel(sourcePort),
        toLabel: compactPortLabel(targetPort),
        discoveredBy: neighbor.discoveredBy,
        warning: sourcePort.mode && targetPort.mode && sourcePort.mode !== targetPort.mode ? "عدم تطابق trunk/access" : "",
      });
    }
  }
  const allDevices = [...devices, ...placeholders.values()];
  return { seedIp, devices: allDevices, links, createdAt: new Date().toISOString() };
}

async function runBatch(items, limit, worker) {
  const output = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function discoverNetwork(input, onProgress = () => {}) {
  const scanned = new Map();
  const unreachable = new Map();
  const queued = new Set([input.seedIp]);
  let frontier = [input.seedIp];
  let processed = 0;
  while (frontier.length && scanned.size < input.maxDevices) {
    if (input.signal?.aborted) throw new Error("عملیات به‌دلیل بسته‌شدن صفحه متوقف شد.");
    const batch = frontier.splice(0, Math.max(1, input.maxDevices - scanned.size));
    const first = await runBatch(batch, input.concurrency, async (ip) => {
      onProgress({ message: `در حال خواندن ${ip}`, currentIp: ip, processed, discovered: queued.size });
      try { return { ip, response: await firstAttempt(input, ip, DISCOVERY_COMMANDS) }; }
      catch (error) { return { ip, error }; }
    });
    const initialFailures = first.filter((item) => item.error);
    const retry = await retryFailures(input, initialFailures, DISCOVERY_COMMANDS, onProgress);
    for (const item of first) {
      const response = item.response || retry.recovered.get(item.ip);
      processed += 1;
      if (!response) {
        unreachable.set(item.ip, retry.failures.find((failure) => failure.ip === item.ip)?.error || item.error);
        onProgress({ message: `ورود به ${item.ip} ناموفق بود`, currentIp: item.ip, processed, discovered: queued.size });
        continue;
      }
      const device = parseDevice(item.ip, response);
      scanned.set(item.ip, device);
      onProgress({ message: `${device.hostname} خوانده شد`, currentIp: item.ip, processed, discovered: queued.size });
      for (const neighbor of device.neighbors) {
        if (!validIpv4(neighbor.ip) || queued.has(neighbor.ip) || queued.size >= input.maxDevices) continue;
        queued.add(neighbor.ip);
        frontier.push(neighbor.ip);
      }
    }
  }
  const topology = buildTopology(input.seedIp, scanned, unreachable);
  return {
    topology,
    summary: {
      scanned: scanned.size,
      unreachable: topology.devices.filter((item) => !item.reachable).length,
      links: topology.links.length,
      limited: queued.size >= input.maxDevices,
    },
  };
}

export async function readSingleDevice(input, ip, onProgress = () => {}) {
  onProgress({ message: `در حال خواندن ${ip}`, currentIp: ip });
  try {
    return parseDevice(ip, await firstAttempt(input, ip, DISCOVERY_COMMANDS));
  } catch (firstError) {
    const retry = await retryFailures(input, [{ ip, error: firstError }], DISCOVERY_COMMANDS, onProgress);
    const response = retry.recovered.get(ip);
    if (!response) throw retry.failures[0]?.error || firstError;
    return parseDevice(ip, response);
  }
}

export async function readRunningConfiguration(input, ip, onProgress = () => {}) {
  onProgress({ message: `در حال دریافت کانفیگ ${ip}`, currentIp: ip });
  try {
    const response = await firstAttempt(input, ip, CONFIG_COMMANDS);
    return response.outputs[CONFIG_COMMANDS[0]] || "";
  } catch (firstError) {
    const retry = await retryFailures(input, [{ ip, error: firstError }], CONFIG_COMMANDS, onProgress);
    const response = retry.recovered.get(ip);
    if (!response) throw retry.failures[0]?.error || firstError;
    return response.outputs[CONFIG_COMMANDS[0]] || "";
  }
}

export function mergeRefreshedDevice(topology, refreshed) {
  const copy = structuredClone(topology);
  const index = copy.devices.findIndex((item) => item.ip === refreshed.ip || item.key === refreshed.key);
  const previous = index >= 0 ? copy.devices[index] : null;
  if (index >= 0) copy.devices[index] = { ...refreshed, ipamHostId: previous?.ipamHostId || null, ipamSpaceId: previous?.ipamSpaceId || null };
  else copy.devices.push(refreshed);
  const key = previous?.key || refreshed.key;
  for (const link of copy.links) {
    if (link.from === key) {
      link.from = refreshed.key;
      link.fromPort = endpointPort(refreshed, link.fromPort?.name);
      link.fromLabel = compactPortLabel(link.fromPort);
    }
    if (link.to === key) {
      link.to = refreshed.key;
      link.toPort = endpointPort(refreshed, link.toPort?.name);
      link.toLabel = compactPortLabel(link.toPort);
    }
  }
  copy.createdAt = new Date().toISOString();
  return copy;
}
