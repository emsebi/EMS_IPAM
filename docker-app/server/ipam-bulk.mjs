// Dependency-free A/B/C importer for IPAM (.csv and ordinary .xlsx workbooks).
// No macro execution, formulas, external resources, or workbook evaluation.
import { inflateRawSync } from "node:zlib";
import { posix as path } from "node:path";
import { ipv4ToInt, intToIpv4, parseCidr } from "./ip.mjs";
import { detectIpamImportFormat, MAX_SHEET_IMPORT_BYTES } from "../public/ipam-import-format.mjs";

const MAX_FILE_BYTES = MAX_SHEET_IMPORT_BYTES;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 10000;

function xmlDecode(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, key) => {
    const item = key.toLowerCase();
    if (item[0] === "#") {
      const number = item[1] === "x" ? parseInt(item.slice(2), 16) : Number(item.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[item] || "";
  });
}

function attribute(tag, key) {
  const match = tag.match(new RegExp("(?:\\s|^)" + key.replace(":", "\\:") + "\\s*=\\s*([\"'])(.*?)\\1", "i"));
  return match ? xmlDecode(match[2]) : "";
}

function zipEntries(buffer) {
  if (buffer.length > MAX_FILE_BYTES) throw new Error("فایل Excel بیش از حد بزرگ است (حداکثر ۷ مگابایت).");
  let end = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p -= 1) {
    if (buffer.readUInt32LE(p) === 0x06054b50) { end = p; break; }
  }
  if (end < 0) throw new Error("ساختار فایل xlsx معتبر نیست.");
  const count = buffer.readUInt16LE(end + 10);
  const offset = buffer.readUInt32LE(end + 16);
  if (count > 1000 || offset >= buffer.length) throw new Error("ساختار فایل xlsx بیش از حد بزرگ است.");
  const entries = new Map();
  let pointer = offset;
  for (let i = 0; i < count; i += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error("فهرست xlsx خراب است.");
    const flags = buffer.readUInt16LE(pointer + 8);
    const method = buffer.readUInt16LE(pointer + 10);
    const compressed = buffer.readUInt32LE(pointer + 20);
    const plain = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const local = buffer.readUInt32LE(pointer + 42);
    const endName = pointer + 46 + nameLength;
    if (endName > buffer.length) throw new Error("مسیر داخلی xlsx نامعتبر است.");
    const name = buffer.toString("utf8", pointer + 46, endName);
    pointer = endName + extraLength + commentLength;
    if (flags & 1) throw new Error("فایل Excel رمزگذاری‌شده پشتیبانی نمی‌شود.");
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    if (plain > MAX_XML_BYTES || compressed > MAX_FILE_BYTES) throw new Error("فایل Excel بیش از حد بزرگ است.");
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("ورودی Excel خراب است.");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new Error("اطلاعات Excel ناقص است.");
    entries.set(name, () => {
      const data = buffer.subarray(start, start + compressed);
      const output = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES }) : null;
      if (!output || output.length !== plain) throw new Error("فشرده‌سازی Excel پشتیبانی نمی‌شود.");
      return output.toString("utf8");
    });
  }
  return entries;
}

function xmlText(fragment) {
  return [...String(fragment).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
}

function firstWorksheet(entries) {
  const workbook = entries.get("xl/workbook.xml")?.();
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.();
  if (workbook && rels) {
    const sheet = workbook.match(/<sheet\b[^>]*\/?>/i)?.[0] || "";
    const relation = attribute(sheet, "r:id");
    for (const match of rels.matchAll(/<Relationship\b[^>]*\/?>/gi)) {
      const tag = match[0];
      if (attribute(tag, "Id") !== relation || !/worksheet/i.test(attribute(tag, "Type"))) continue;
      const target = attribute(tag, "Target");
      if (target.includes("://")) throw new Error("لینک خارجی به عنوان شیت پذیرفته نمی‌شود.");
      const resolved = target.startsWith("/") ? path.normalize(target.slice(1)) : path.normalize(path.join("xl", target));
      if (resolved.startsWith("xl/worksheets/") && entries.has(resolved)) return entries.get(resolved)();
    }
  }
  const file = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/\d+/g).at(-1)) - Number(b.match(/\d+/g).at(-1)))[0];
  if (!file) throw new Error("برگه قابل خواندن در Excel پیدا نشد.");
  return entries.get(file)();
}

function xlsxRows(buffer) {
  const entries = zipEntries(buffer);
  const strings = [];
  const shared = entries.get("xl/sharedStrings.xml")?.() || "";
  for (const item of shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    strings.push(xmlText(item[1]));
    if (strings.length > 100000) throw new Error("فایل Excel بیش از حد بزرگ است.");
  }
  const sheet = firstWorksheet(entries);
  const rows = [];
  for (const match of sheet.matchAll(/<row\b([^>]*?)>([\s\S]*?)<\/row>/g)) {
    const number = Number(attribute(match[1], "r")) || rows.length + 1;
    const fields = ["", "", ""];
    for (const cell of match[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = attribute(cell[1], "r").match(/^([A-C])\d+$/i)?.[1]?.toUpperCase();
      if (!col) continue;
      const i = col.charCodeAt(0) - 65;
      const body = cell[2] || "";
      if (/<f(?:\s|>)/i.test(body)) throw new Error("فرمول در ستون‌های A/B/C پشتیبانی نمی‌شود؛ ابتدا مقادیر را Paste Values کنید.");
      const type = attribute(cell[1], "t");
      const value = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] || "";
      fields[i] = type === "s" ? (strings[Number(value)] || "") : type === "inlineStr" ? xmlText(body) : xmlDecode(value);
    }
    if (fields.some((cell) => String(cell).trim())) rows.push({ row: number, fields });
    if (rows.length > MAX_ROWS + 2) throw new Error("حداکثر ۱۰ هزار ردیف در هر بار قابل ورود است.");
  }
  return rows;
}

function csvRows(text) {
  const normalized = String(text).replace(/^\ufeff/, "");
  const first = normalized.split(/\r?\n/).find(line => line.trim()) || "";
  const delimiters = [",", ";", "\t"];
  const delimiter = delimiters.sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let fields = [], cell = "", quoted = false, line = 1, rowStart = 1;
  for (let i = 0; i <= normalized.length; i += 1) {
    const ch = normalized[i] ?? "\n";
    if (quoted) {
      if (ch === '"' && normalized[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else { cell += ch; if (ch === "\n") line += 1; }
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter || ch === "\n" || ch === "\r") {
      fields.push(cell); cell = "";
      if (ch !== delimiter) {
        if (fields.some((value) => value.trim())) rows.push({ row: rowStart, fields: fields.slice(0, 3) });
        fields = [];
        if (ch === "\r" && normalized[i + 1] === "\n") i += 1;
        line += 1; rowStart = line;
        if (rows.length > MAX_ROWS + 2) throw new Error("حداکثر ۱۰ هزار ردیف در هر بار قابل ورود است.");
      }
    } else cell += ch;
  }
  if (quoted) throw new Error("نقل قول بسته‌نشده در CSV.");
  return rows;
}

function isHeader(value) {
  return /^(ip|ip\s*address|ipaddress|آی\s*پی|آدرس\s*ip|آدرس\s*آی\s*پی)$/i.test(String(value).trim());
}

export function parseIpamImport({ base64, cidr }) {
  if (typeof base64 !== "string" || base64.length > MAX_FILE_BYTES * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("فایل معتبر نیست یا بیش از حد بزرگ است.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error("فایل خالی یا بیش از حد بزرگ است.");
  const format = detectIpamImportFormat(buffer);
  if (format === "json") throw new Error("بسته JSON باید از مسیر Portable Import بررسی و وارد شود.");
  const rows = format === "xlsx" ? xlsxRows(buffer) : csvRows(buffer.toString("utf8"));
  const root = parseCidr(cidr);
  if (!root) throw new Error("فضای آدرس مقصد معتبر نیست.");
  if (rows.length && isHeader(rows[0].fields[0])) rows.shift();
  const items = [];
  const errors = [];
  const seen = new Set();
  let invalid = 0;
  for (const row of rows) {
    const [rawIp, rawName, rawNotes] = row.fields;
    const ipNumber = ipv4ToInt(rawIp);
    const ip = ipNumber === null ? "" : intToIpv4(ipNumber);
    let reason = "";
    if (!ip) reason = "IP نامعتبر";
    else if (ipNumber < root.start || ipNumber > root.end) reason = "IP خارج از رنج مقصد";
    else if (seen.has(ip)) reason = "IP تکراری در فایل";
    else if (String(rawName || "").length > 160 || String(rawNotes || "").length > 3000) reason = "نام یا توضیحات بیش از حد طولانی";
    if (reason) {
      invalid += 1;
      if (errors.length < 30) errors.push({ row: row.row, ip: String(rawIp || "").slice(0, 60), reason });
    } else {
      seen.add(ip);
      items.push({ ip, name: String(rawName || "").trim(), notes: String(rawNotes || "").trim() });
    }
  }
  if (!rows.length) throw new Error("فایل هیچ ردیف IP قابل خواندنی ندارد.");
  return { items, errors, invalid, total: rows.length, columns: ["IP", "Name", "Description"] };
}
