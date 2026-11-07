// Read-only presentation helpers: never infer live reachability or IP availability.
export function scopedInventory(items, companyId = "") {
  return (Array.isArray(items) ? items : []).filter(item => !companyId || item.companyId === companyId);
}

export function radioGroups(items, companyId = "") {
  const rows = scopedInventory(items, companyId).filter(item => item.radioMode === "ap" || item.radioMode === "station");
  const aps = rows.filter(item => item.radioMode === "ap");
  const stations = rows.filter(item => item.radioMode === "station");
  return {
    aps: aps.map(ap => ({ ap, stations: stations.filter(st => st.radioParentHostId === ap.id) })),
    orphanStations: stations.filter(st => !aps.some(ap => ap.id === st.radioParentHostId))
  };
}

export function distanceKm(first, second) {
  const coordinate = item => {
    const lat = item?.latitude, lon = item?.longitude;
    if ((typeof lat !== "number" && typeof lat !== "string") ||
        (typeof lon !== "number" && typeof lon !== "string") ||
        String(lat).trim() === "" || String(lon).trim() === "") return null;
    const a = Number(lat), b = Number(lon);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 ? [a,b] : null;
  };
  const a = coordinate(first), b = coordinate(second);
  if (!a || !b) return null;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b[0] - a[0]), dLon = radians(b[1] - a[1]);
  const h = Math.sin(dLat/2)**2 + Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(dLon/2)**2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

export function recordedStatus(record) {
  if (record?.pingOnline === true) return "up";
  if (record?.pingOnline === false) return "down";
  return "unknown";
}

export function snapshotStatus(node) {
  if (node?.reachability === "unreachable" || node?.status === "unreachable") return "down";
  if (node?.status === "online" || node?.status === "partial") return "up";
  return "unknown";
}

export function validTopology(value) {
  const topology = value && typeof value === "object" ? value : {};
  return {
    nodes: Array.isArray(topology.nodes) ? topology.nodes.slice(0,500) : [],
    links: Array.isArray(topology.links) ? topology.links.slice(0,1500) : []
  };
}
