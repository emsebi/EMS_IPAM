import https from "node:https";
import tls from "node:tls";
import crypto from "node:crypto";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function routerRequest({ host, port, username, password, caPem, pathname, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host,
      port,
      path: pathname,
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      rejectUnauthorized: true,
      ca: caPem || undefined,
      servername: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? undefined : host,
      timeout,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) request.destroy(new Error("پاسخ میکروتیک بیش از حد مجاز است."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`میکروتیک پاسخ ${response.statusCode} داد.`);
          error.statusCode = response.statusCode;
          return reject(error);
        }
        try { resolve(text ? JSON.parse(text) : []); }
        catch { reject(new Error("پاسخ میکروتیک JSON معتبر نیست.")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("مهلت ارتباط با میکروتیک تمام شد.")));
    request.on("error", reject);
    request.end();
  });
}

function firstSignal(value) {
  const match = String(value ?? "").match(/-?\d+/);
  return match ? `${match[0]} dBm` : "";
}

function normalizeStation(item) {
  return {
    mac: clean(item["mac-address"] || item.mac || "", 32).toUpperCase(),
    interface: clean(item.interface, 80),
    ssid: clean(item.ssid, 160),
    radioName: clean(item["radio-name"], 160),
    signal: firstSignal(item.signal || item["signal-strength"] || item["signal-strength-ch0"]),
    txRate: clean(item["tx-rate"] || item["tx-rate-set"], 80),
    rxRate: clean(item["rx-rate"], 80),
    txBytes: clean(item["tx-bytes"], 40),
    rxBytes: clean(item["rx-bytes"], 40),
    uptime: clean(item.uptime, 80),
    lastActivity: clean(item["last-activity"], 80),
  };
}

function encodeApiLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    const output = Buffer.alloc(2);
    output.writeUInt16BE(length | 0x8000);
    return output;
  }
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) {
    const output = Buffer.alloc(4);
    output.writeUInt32BE((length | 0xe0000000) >>> 0);
    return output;
  }
  const output = Buffer.alloc(5);
  output[0] = 0xf0;
  output.writeUInt32BE(length >>> 0, 1);
  return output;
}

function decodeApiLength(buffer) {
  if (!buffer.length) return null;
  const first = buffer[0];
  if (first < 0x80) return { length: first, bytes: 1 };
  if (first < 0xc0) return buffer.length < 2 ? null : { length: ((first & 0x3f) << 8) | buffer[1], bytes: 2 };
  if (first < 0xe0) return buffer.length < 3 ? null : { length: ((first & 0x1f) << 16) | (buffer[1] << 8) | buffer[2], bytes: 3 };
  if (first < 0xf0) return buffer.length < 4 ? null : { length: ((first & 0x0f) * 0x1000000) + (buffer[1] << 16) + (buffer[2] << 8) + buffer[3], bytes: 4 };
  if (first === 0xf0) return buffer.length < 5 ? null : { length: buffer.readUInt32BE(1), bytes: 5 };
  throw new Error("پاسخ API میکروتیک دارای بایت کنترلی ناشناخته است.");
}

export function encodeApiSentence(words) {
  return Buffer.concat([...words.map((word) => {
    const value = Buffer.from(String(word), "utf8");
    return Buffer.concat([encodeApiLength(value.length), value]);
  }), Buffer.from([0])]);
}

function sentenceObject(words) {
  const output = { reply: words[0] || "" };
  for (const word of words.slice(1)) {
    if (!word.startsWith("=")) continue;
    const separator = word.indexOf("=", 1);
    if (separator > 1) output[word.slice(1, separator)] = word.slice(separator + 1);
  }
  return output;
}

function routerApiSslPoll({ host, password }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: host.ip,
      port: Number(host.monitorPort || 8729),
      rejectUnauthorized: true,
      ca: host.monitorCaPem || undefined,
      servername: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host.ip) ? undefined : host.ip,
      minVersion: "TLSv1.2",
    });
    let buffer = Buffer.alloc(0);
    let sentence = [];
    let phase = "login";
    let rows = [];
    let resource = {};
    let trap = "";
    let received = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const send = (words) => socket.write(encodeApiSentence(words));
    const consumeSentence = (words) => {
      const item = sentenceObject(words);
      if (item.reply === "!re") rows.push(item);
      if (item.reply === "!trap" || item.reply === "!fatal") trap = item.message || "خطای API میکروتیک";
      if (item.reply !== "!done" && item.reply !== "!empty") return;
      if (trap) return finish(new Error(trap));
      if (phase === "login" && item.ret) {
        const response = crypto.createHash("md5").update(Buffer.concat([Buffer.from([0]), Buffer.from(password), Buffer.from(item.ret, "hex")])).digest("hex");
        phase = "login-response";
        rows = [];
        send(["/login", `=name=${host.monitorUsername}`, `=response=00${response}`]);
      } else if (phase === "login" || phase === "login-response") {
        phase = "resource";
        rows = [];
        send(["/system/resource/print", "=.proplist=board-name,platform,version,uptime,cpu-load,free-memory"]);
      } else if (phase === "resource") {
        resource = rows[0] || {};
        phase = "wireless";
        rows = [];
        send(["/interface/wireless/registration-table/print", "=.proplist=mac-address,interface,ssid,radio-name,signal-strength,signal-strength-ch0,tx-rate,rx-rate,tx-bytes,rx-bytes,uptime,last-activity"]);
      } else {
        finish(null, {
          online: true,
          package: "wireless-api-ssl",
          checkedAt: new Date().toISOString(),
          identity: clean(resource["board-name"] || resource.platform || host.name, 160),
          version: clean(resource.version, 120),
          uptime: clean(resource.uptime, 80),
          cpuLoad: clean(resource["cpu-load"], 20),
          freeMemory: clean(resource["free-memory"], 40),
          stations: rows.map(normalizeStation),
        });
      }
    };
    socket.setTimeout(8000, () => finish(new Error("مهلت ارتباط API-SSL میکروتیک تمام شد.")));
    socket.on("secureConnect", () => send(["/login", `=name=${host.monitorUsername}`, `=password=${password}`]));
    socket.on("data", (chunk) => {
      received += chunk.length;
      if (received > 5 * 1024 * 1024) return finish(new Error("پاسخ میکروتیک بیش از حد مجاز است."));
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (true) {
          const header = decodeApiLength(buffer);
          if (!header || buffer.length < header.bytes + header.length) break;
          const word = buffer.subarray(header.bytes, header.bytes + header.length).toString("utf8");
          buffer = buffer.subarray(header.bytes + header.length);
          if (header.length === 0) { const complete = sentence; sentence = []; consumeSentence(complete); }
          else sentence.push(word);
        }
      } catch (error) { finish(error); }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => { if (!settled) finish(new Error("ارتباط API-SSL میکروتیک پیش از دریافت پاسخ بسته شد.")); });
  });
}

export async function pollMikrotik({ host, secretBox }) {
  const password = secretBox.decrypt(host.monitorSecret || "");
  if (!password) throw new Error("رمز کاربر پایش میکروتیک ثبت نشده است.");
  if (host.monitorDriver === "mikrotik-api-ssl") return routerApiSslPoll({ host, password });
  const request = (pathname) => routerRequest({
    host: host.ip,
    port: Number(host.monitorPort || 443),
    username: host.monitorUsername,
    password,
    caPem: host.monitorCaPem,
    pathname,
  });
  const resource = await request("/rest/system/resource");
  let wirelessPackage = "wifi";
  let registrations;
  try {
    registrations = await request("/rest/interface/wifi/registration-table");
  } catch (error) {
    if (error.statusCode !== 404 && error.statusCode !== 400) throw error;
    wirelessPackage = "wireless";
    registrations = await request("/rest/interface/wireless/registration-table");
  }
  const resourceItem = Array.isArray(resource) ? resource[0] || {} : resource || {};
  return {
    online: true,
    package: wirelessPackage,
    checkedAt: new Date().toISOString(),
    identity: clean(resourceItem["board-name"] || resourceItem.platform || host.name, 160),
    version: clean(resourceItem.version, 120),
    uptime: clean(resourceItem.uptime, 80),
    cpuLoad: clean(resourceItem["cpu-load"], 20),
    freeMemory: clean(resourceItem["free-memory"], 40),
    stations: (Array.isArray(registrations) ? registrations : []).map(normalizeStation),
  };
}

export async function saveMikrotikPoll({ pool, host, result, error }) {
  if (error) {
    await pool.query(
      `UPDATE hosts SET monitor_checked_at=now(),monitor_failures=monitor_failures+1,monitor_error=$1,
         monitor_state=CASE WHEN monitor_failures+1<3 THEN COALESCE(monitor_state,'{}'::jsonb)
           ELSE jsonb_set(COALESCE(monitor_state,'{}'::jsonb),'{online}','false'::jsonb,true) END
       WHERE id=$2`,
      [clean(error.message, 500), host.id],
    );
    return;
  }
  await pool.query(
    `UPDATE hosts SET monitor_state=$1::jsonb,monitor_checked_at=now(),monitor_last_ok_at=now(),monitor_failures=0,monitor_error='',
       firmware=CASE WHEN $2<>'' THEN $2 ELSE firmware END WHERE id=$3`,
    [JSON.stringify(result), result.version, host.id],
  );
  const children = await pool.query(
    `SELECT id,mac FROM hosts WHERE radio_parent_host_id=$1 AND deleted_at IS NULL`,
    [host.id],
  );
  const byMac = new Map(result.stations.filter((item) => item.mac).map((item) => [item.mac, item]));
  for (const child of children.rows) {
    const station = byMac.get(clean(child.mac, 32).toUpperCase());
    const state = station
      ? { online: true, checkedAt: result.checkedAt, ...station }
      : { online: false, checkedAt: result.checkedAt };
    await pool.query(
      `UPDATE hosts SET monitor_state=$1::jsonb,monitor_checked_at=now(),
         monitor_last_ok_at=CASE WHEN $2 THEN now() ELSE monitor_last_ok_at END,
         monitor_failures=CASE WHEN $2 THEN 0 ELSE monitor_failures+1 END,
         monitor_error=CASE WHEN $2 THEN '' ELSE 'Station در Registration Table مشاهده نشد.' END,
         signal=CASE WHEN $3<>'' THEN $3 ELSE signal END,
         ssid=CASE WHEN $4<>'' THEN $4 ELSE ssid END WHERE id=$5`,
      [JSON.stringify(state), Boolean(station), station?.signal || "", station?.ssid || "", child.id],
    );
  }
}

export function buildMikrotikScript({ serverIp, username, password, certificateName, port, transport = "mikrotik-rest" }) {
  const ip = clean(serverIp, 64);
  const user = clean(username, 80);
  const pass = String(password ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const cert = clean(certificateName, 120);
  const apiSsl = transport === "mikrotik-api-ssl";
  const servicePort = Math.max(1, Math.min(65535, Number(port) || (apiSsl ? 8729 : 443)));
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw new Error("IP سرور سامانه معتبر نیست.");
  if (!/^[A-Za-z0-9_.-]{3,80}$/.test(user)) throw new Error("نام کاربری میکروتیک معتبر نیست.");
  if (String(password || "").length < 12) throw new Error("رمز کاربر پایش باید حداقل ۱۲ کاراکتر باشد.");
  if (!cert) throw new Error("نام Certificate سرویس امن میکروتیک را وارد کنید.");
  const policy = apiSsl ? "read,api" : "read,rest-api";
  const service = apiSsl ? "api-ssl" : "www-ssl";
  return [
    `:if ([:len [/user/group find where name="ems-ipam"]] = 0) do={ /user/group/add name=ems-ipam policy=${policy} } else={ /user/group/set [find where name="ems-ipam"] policy=${policy} }`,
    `:if ([:len [/user find where name="${user}"]] = 0) do={ /user/add name=${user} group=ems-ipam address=${ip}/32 password="${pass}" } else={ /user/set [find where name="${user}"] group=ems-ipam address=${ip}/32 password="${pass}" disabled=no }`,
    `/ip/service/set ${service} disabled=no port=${servicePort} certificate=${cert} tls-version=only-1.2 address=${ip}/32`,
    `:if ([:len [/ip/firewall/filter find where comment="EMS IPAM secure monitor"]] = 0) do={ /ip/firewall/filter/add chain=input action=accept protocol=tcp dst-port=${servicePort} src-address=${ip} comment="EMS IPAM secure monitor" }`,
  ].join("\n");
}
