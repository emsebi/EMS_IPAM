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
