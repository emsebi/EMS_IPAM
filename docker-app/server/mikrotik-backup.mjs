import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { jalaliFilenameStamp } from "./jalali.mjs";

const execFileAsync = promisify(execFile);

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeName(value) {
  const result = clean(value, 120)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return result || "MikroTik";
}

function outputError(error) {
  const text = clean(error?.stderr || error?.message || "خطای ناشناخته", 500).replace(/[\r\n]+/g, " — ");
  if (/permission denied/i.test(text)) return "نام کاربری یا رمز عبور صحیح نیست، یا دسترسی SSH کافی نیست.";
  if (/timed out|timeout|no route|unreachable/i.test(text)) return "ارتباط SSH با دستگاه برقرار نشد یا مهلت اتصال پایان یافت.";
  if (/connection refused/i.test(text)) return "پورت SSH دستگاه بسته است یا پورت واردشده صحیح نیست.";
  if (/host key verification failed/i.test(text)) return "اثر انگشت SSH دستگاه تغییر کرده است و باید بررسی شود.";
  return text;
}

async function sshCommand({ ip, port, username, password, command, timeoutSeconds, knownHostsPath }) {
  const args = [
    "-e", "ssh",
    "-p", String(port),
    "-o", `ConnectTimeout=${timeoutSeconds}`,
    "-o", "ConnectionAttempts=1",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "PubkeyAuthentication=no",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    `${username}@${ip}`,
    command,
  ];
  try {
    const result = await execFileAsync("sshpass", args, {
      env: { ...process.env, SSHPASS: String(password ?? "") },
      timeout: Math.max(5, timeoutSeconds) * 1000,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout || "").replace(/\r\n/g, "\n");
  } catch (error) {
    throw new Error(outputError(error));
  }
}

function parseIdentity(text, fallback) {
  const match = String(text).match(/(?:^|\n)\s*name:\s*"?([^"\r\n]+)"?/i);
  return clean(match?.[1] || fallback, 120);
}

function parseVersion(text, preferred = "auto") {
  if (["6", "7"].includes(String(preferred))) return String(preferred);
  const match = String(text).match(/(?:^|\n)\s*version:\s*([67])(?:\.|\s|$)/i);
  return match?.[1] || "7";
}

export async function runMikrotikBackup({ target, password, timeoutSeconds = 20, knownHostsPath, now = new Date() }) {
  if (!String(password ?? "")) throw new Error("رمز عبور این دستگاه وارد نشده است.");
  const common = {
    ip: target.ip,
    port: Number(target.sshPort || 22),
    username: target.username,
    password,
    timeoutSeconds,
    knownHostsPath: path.resolve(knownHostsPath),
  };
  const information = await sshCommand({
    ...common,
    command: "/system identity print; /system resource print",
  });
  const identity = parseIdentity(information, target.name || target.ip);
  let version = parseVersion(information, target.routerosVersion);
  let content;
  try {
    content = await sshCommand({
      ...common,
      command: version === "6" ? "/export hide-sensitive=no" : "/export show-sensitive",
    });
  } catch (error) {
    if (String(target.routerosVersion || "auto") !== "auto" || version !== "7") throw error;
    version = "6";
    content = await sshCommand({ ...common, command: "/export hide-sensitive=no" });
  }
  if (!content.trim()) throw new Error("میکروتیک خروجی کانفیگ خالی برگرداند.");
  const filename = `${safeName(identity || target.name || target.ip)}_${jalaliFilenameStamp(now)}.rsc`;
  return { identity, version, filename, content, sizeBytes: Buffer.byteLength(content, "utf8"), information };
}

export { parseIdentity, parseVersion, safeName };
