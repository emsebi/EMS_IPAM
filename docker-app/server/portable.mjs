import crypto from "node:crypto";

function clean(value, max = 3000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeConnections(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => ({
    type: clean(item?.type, 20).toUpperCase(),
    label: clean(item?.label, 80),
    port: Number.isInteger(Number(item?.port)) ? Number(item.port) : null,
    url: clean(item?.url, 500),
  })).filter((item) => ["SSH", "WINBOX", "HTTP", "HTTPS", "RDP", "VNC", "TELNET"].includes(item.type));
}

function sanitizePrefix(item) {
  return {
    cidr: clean(item.cidr, 64),
    name: clean(item.name, 160),
    status: clean(item.status, 40) || "active",
    role: clean(item.role, 100),
    vlan: clean(item.vlan, 40),
    gateway: clean(item.gateway, 80),
    color: clean(item.color, 7),
    description: clean(item.description, 2000),
  };
}

function sanitizeHost(item) {
  return {
    sourceId: clean(item.id, 80),
    ip: clean(item.ip, 64),
    name: clean(item.name, 160),
    status: clean(item.status, 40) || "active",
    type: clean(item.type, 100),
    os: clean(item.os, 160),
    mac: clean(item.mac, 32),
    vlan: clean(item.vlan, 40),
    username: clean(item.username, 120),
    owner: clean(item.owner, 160),
    location: clean(item.location, 200),
    vendor: clean(item.vendor, 100),
    model: clean(item.model, 120),
    serial: clean(item.serial, 120),
    firmware: clean(item.firmware, 120),
    radioMode: ["ap", "station"].includes(item.radioMode) ? item.radioMode : "",
    ssid: clean(item.ssid, 160),
    frequency: clean(item.frequency, 80),
    channel: clean(item.channel, 80),
    signal: clean(item.signal, 40),
    sourceRadioParentHostId: clean(item.radioParentHostId, 80) || null,
    connectionMethods: normalizeConnections(item.connectionMethods),
    notes: clean(item.notes, 3000),
    ports: item.ports && typeof item.ports === "object" ? item.ports : {},
    devicePorts: Array.isArray(item.devicePorts) ? item.devicePorts.slice(0, 256).map((port) => ({
      name: clean(port.name, 80),
      description: clean(port.description, 240),
      portType: clean(port.portType, 40) || "ethernet",
      speed: clean(port.speed, 40),
      vlanMode: clean(port.vlanMode, 40),
      vlan: clean(port.vlan, 80),
      enabled: port.enabled !== false,
    })).filter((port) => port.name) : [],
  };
}

export async function buildSubnetPackage({ pool, space, cidr, appVersion, parseCidr, contains }) {
  const scope = parseCidr(cidr);
  const root = parseCidr(space.cidr);
  if (!scope || !root || !contains(root, scope)) throw new Error("رنج انتخاب‌شده داخل فضای آدرس نیست.");
  const [prefixes, hosts, devicePorts] = await Promise.all([
    pool.query(
      `SELECT id,cidr,name,status,role,vlan,gateway,color,description
         FROM prefixes WHERE space_id=$1 AND deleted_at IS NULL ORDER BY cidr`,
      [space.id],
    ),
    pool.query(
      `SELECT id,ip,name,status,type,os,mac,vlan,username,owner,location,vendor,model,serial,firmware,
              radio_mode AS "radioMode",ssid,frequency,channel,signal,radio_parent_host_id AS "radioParentHostId",
              connection_methods AS "connectionMethods",notes,ports
         FROM hosts WHERE space_id=$1 AND deleted_at IS NULL ORDER BY ip`,
      [space.id],
    ),
    pool.query(
      `SELECT p.host_id AS "hostId",p.name,p.description,p.port_type AS "portType",p.speed,
              p.vlan_mode AS "vlanMode",p.vlan,p.enabled
         FROM device_ports p JOIN hosts h ON h.id=p.host_id
        WHERE h.space_id=$1 AND h.deleted_at IS NULL ORDER BY p.name`,
      [space.id],
    ),
  ]);
  const portsByHost = new Map();
  for (const port of devicePorts.rows) {
    if (!portsByHost.has(port.hostId)) portsByHost.set(port.hostId, []);
    portsByHost.get(port.hostId).push(port);
  }
  const scopedPrefixes = prefixes.rows.filter((item) => contains(scope, parseCidr(item.cidr))).map(sanitizePrefix);
  const scopedHosts = hosts.rows.filter((item) => contains(scope, item.ip))
    .map((item) => sanitizeHost({ ...item, devicePorts: portsByHost.get(item.id) || [] }));
  const hostIds = new Set(scopedHosts.map((item) => item.sourceId));
  for (const host of scopedHosts) {
    if (!hostIds.has(host.sourceRadioParentHostId)) host.sourceRadioParentHostId = null;
  }
  return {
    format: "EMS-IPAM-SUBNET",
    formatVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    passwordPolicy: "excluded",
    source: {
      companyName: clean(space.companyName, 160),
      spaceName: clean(space.name, 160),
      spaceCidr: space.cidr,
      cidr: scope.cidr,
    },
    prefixes: scopedPrefixes,
    hosts: scopedHosts,
    summary: { prefixes: scopedPrefixes.length, hosts: scopedHosts.length, devicePorts: scopedHosts.reduce((sum, item) => sum + item.devicePorts.length, 0) },
  };
}

export function validateSubnetPackage(value, { parseCidr, contains, destinationSpace }) {
  if (!value || value.format !== "EMS-IPAM-SUBNET" || Number(value.formatVersion) !== 1) {
    throw new Error("فایل انتخاب‌شده بسته معتبر EMS IPAM نیست.");
  }
  const scope = parseCidr(value.source?.cidr);
  const root = parseCidr(destinationSpace.cidr);
  if (!scope || !root || !contains(root, scope)) throw new Error("رنج بسته داخل فضای آدرس مقصد قرار نمی‌گیرد.");
  const prefixes = Array.isArray(value.prefixes) ? value.prefixes.slice(0, 20000).map(sanitizePrefix) : [];
  const hosts = Array.isArray(value.hosts) ? value.hosts.slice(0, 200000).map(sanitizeHost) : [];
  for (const item of prefixes) {
    const info = parseCidr(item.cidr);
    if (!info || !contains(scope, info) || !contains(root, info)) throw new Error(`زیررنج نامعتبر در بسته: ${item.cidr || "بدون مقدار"}`);
  }
  for (const item of hosts) {
    if (!contains(scope, item.ip) || !contains(root, item.ip)) throw new Error(`آدرس نامعتبر در بسته: ${item.ip || "بدون مقدار"}`);
  }
  return { scope, prefixes, hosts };
}

export async function importSubnetPackage({ pool, user, destinationSpace, packageData, mode, parseCidr, contains }) {
  const data = validateSubnetPackage(packageData, { parseCidr, contains, destinationSpace });
  const conflictMode = mode === "replace" ? "replace" : "skip";
  const client = await pool.connect();
  const result = { prefixesCreated: 0, prefixesUpdated: 0, prefixesSkipped: 0, hostsCreated: 0, hostsUpdated: 0, hostsSkipped: 0, devicePorts: 0 };
  const sourceToTarget = new Map();
  try {
    await client.query("BEGIN");
    for (const item of data.prefixes) {
      const existing = (await client.query("SELECT id FROM prefixes WHERE space_id=$1 AND cidr=$2", [destinationSpace.id, item.cidr])).rows[0];
      if (existing && conflictMode === "skip") { result.prefixesSkipped += 1; continue; }
      const id = existing?.id || crypto.randomUUID();
      if (existing) {
        await client.query(
          `UPDATE prefixes SET name=$1,status=$2,role=$3,vlan=$4,gateway=$5,color=$6,description=$7,
             deleted_at=NULL,deleted_by=NULL,updated_by=$8,updated_at=now() WHERE id=$9`,
          [item.name || item.cidr, item.status, item.role, item.vlan, item.gateway, item.color || "#3157d5", item.description, user.id, id],
        );
        result.prefixesUpdated += 1;
      } else {
        await client.query(
          `INSERT INTO prefixes(id,space_id,cidr,name,status,role,vlan,gateway,color,description,created_by,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [id, destinationSpace.id, item.cidr, item.name || item.cidr, item.status, item.role, item.vlan, item.gateway, item.color || "#3157d5", item.description, user.id],
        );
        result.prefixesCreated += 1;
      }
    }
    for (const item of data.hosts) {
      const existing = (await client.query("SELECT id FROM hosts WHERE space_id=$1 AND ip=$2", [destinationSpace.id, item.ip])).rows[0];
      if (existing && conflictMode === "skip") {
        sourceToTarget.set(item.sourceId, existing.id);
        result.hostsSkipped += 1;
        continue;
      }
      const id = existing?.id || crypto.randomUUID();
      sourceToTarget.set(item.sourceId, id);
      const values = [
        item.name,item.status,item.type,item.os,item.mac,item.vlan,item.username,item.owner,item.location,item.vendor,item.model,item.serial,item.firmware,
        item.radioMode,item.ssid,item.frequency,item.channel,item.signal,JSON.stringify(item.connectionMethods),item.notes,JSON.stringify(item.ports),user.id,id,
      ];
      if (existing) {
        await client.query(
          `UPDATE hosts SET name=$1,status=$2,type=$3,os=$4,mac=$5,vlan=$6,username=$7,owner=$8,location=$9,
             vendor=$10,model=$11,serial=$12,firmware=$13,radio_mode=$14,ssid=$15,frequency=$16,channel=$17,signal=$18,
             connection_methods=$19::jsonb,notes=$20,ports=$21::jsonb,deleted_at=NULL,deleted_by=NULL,updated_by=$22,updated_at=now() WHERE id=$23`,
          values,
        );
        result.hostsUpdated += 1;
      } else {
        await client.query(
          `INSERT INTO hosts(id,space_id,ip,name,status,type,os,mac,vlan,username,owner,location,vendor,model,serial,firmware,
                             radio_mode,ssid,frequency,channel,signal,connection_methods,notes,ports,created_by,updated_by)
           VALUES($23,$24,$25,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21::jsonb,$22,$22)`,
          [...values, destinationSpace.id, item.ip],
        );
        result.hostsCreated += 1;
      }
      await client.query("DELETE FROM device_ports WHERE host_id=$1", [id]);
      for (const port of item.devicePorts) {
        await client.query(
          `INSERT INTO device_ports(id,host_id,name,description,port_type,speed,vlan_mode,vlan,enabled)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [crypto.randomUUID(), id, port.name, port.description, port.portType, port.speed, port.vlanMode, port.vlan, port.enabled],
        );
        result.devicePorts += 1;
      }
    }
    for (const item of data.hosts) {
      const id = sourceToTarget.get(item.sourceId);
      const parentId = sourceToTarget.get(item.sourceRadioParentHostId) || null;
      if (id && item.radioMode === "station") await client.query("UPDATE hosts SET radio_parent_host_id=$1 WHERE id=$2", [parentId, id]);
    }
    await client.query("COMMIT");
    return { ...result, cidr: data.scope.cidr, mode: conflictMode };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
