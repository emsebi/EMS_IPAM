export const DETAIL_PREFIXES = Object.freeze([30, 29, 28, 27, 26, 25, 24]);

export function rootVerticalLevels(rootPrefix) {
  const prefix = Number(rootPrefix);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 24) throw new RangeError("Root prefix must be between /16 and /24.");
  return Array.from({ length: Math.max(0, 24 - prefix) }, (_, index) => 23 - index);
}

export function tableBlockCount(selectedPrefix) {
  const prefix = Number(selectedPrefix);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 24) throw new RangeError("Selected prefix must be between /16 and /24.");
  return 2 ** (24 - prefix);
}

export function visibleTableCount(total, requested = 8) {
  const count = Math.max(0, Number(total) || 0);
  return Math.min(count, Math.max(1, Number(requested) || 8));
}

export function viewportMapHeight(viewportHeight, elementTop, { minimum = 420, bottomGap = 24 } = {}) {
  const height = Number(viewportHeight) || 0;
  const top = Math.max(0, Number(elementTop) || 0);
  return Math.max(minimum, Math.floor(height - top - bottomGap));
}

export function detailGroupSize(prefix) {
  if (!DETAIL_PREFIXES.includes(Number(prefix))) throw new RangeError("Detail prefix must be between /24 and /30.");
  return 2 ** (32 - Number(prefix));
}

export function detailGroups(prefix) {
  const size = detailGroupSize(prefix);
  return Array.from({ length: 256 / size }, (_, index) => ({ start: index * size, end: index * size + size - 1, size }));
}

export function treeDepth(prefix, maximumDepth = 4) {
  const value = Number(prefix);
  if (!Number.isInteger(value) || value < 0 || value > 32) throw new RangeError("Prefix must be between /0 and /32.");
  return Math.min(Math.max(0, Number(maximumDepth) || 0), 32 - value);
}

/** Position-aware /24 distribution across a /16–/24 Space. Does not treat free prefix labels as used IPs. */
export function usageSegments(cidr, prefixes = [], hosts = [], fallbackColor = "#3157d5") {
  const parse = (ip) => {
    const parts = String(ip || "").split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
    return parts.reduce((value, part) => value * 256 + Number(part), 0);
  };
  const root = String(cidr || "").match(/^(.+)\/(\d+)$/);
  if (!root) return [];
  const startIp = parse(root[1]), prefix = Number(root[2]);
  if (startIp === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 24) return [];
  const size = 2 ** (32 - prefix);
  const start = Math.floor(startIp / size) * size;
  const count = size / 256;
  const segments = Array.from({ length: count }, (_, index) => ({ index, count: 0, allocated: false, color: "", specificity: -1 }));
  for (const item of prefixes) {
    if (item.status === "free") continue;
    const match = String(item.cidr || "").match(/^(.+)\/(\d+)$/);
    if (!match) continue;
    const ip = parse(match[1]), depth = Number(match[2]);
    if (ip === null || depth < prefix || depth > 32) continue;
    const subSize = 2 ** (32 - depth);
    const subnetStart = Math.floor(ip / subSize) * subSize, subnetEnd = subnetStart + subSize - 1;
    for (let index = Math.max(0, Math.floor((subnetStart - start) / 256)); index <= Math.min(count - 1, Math.floor((subnetEnd - start) / 256)); index += 1) {
      const segment = segments[index];
      if (depth >= segment.specificity) {
        segment.allocated = true;
        segment.color = /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : fallbackColor;
        segment.specificity = depth;
      }
    }
  }
  for (const host of hosts) {
    if (host.status === "free") continue;
    const ip = parse(host.ip), index = ip === null ? -1 : Math.floor((ip - start) / 256);
    if (index >= 0 && index < count) segments[index].count += 1;
  }
  return segments.map(({ specificity, ...segment }) => ({ ...segment, color: segment.color || fallbackColor }));
}
