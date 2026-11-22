// Shared by the browser and the server. Names/MIME types are metadata, not evidence.
export const MAX_SHEET_IMPORT_BYTES = 7 * 1024 * 1024;
export const MAX_PORTABLE_IMPORT_BYTES = 8 * 1024 * 1024;

export function detectIpamImportFormat(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("فایل خالی یا نامعتبر است.");
  if (bytes.length > MAX_PORTABLE_IMPORT_BYTES) throw new Error("فایل بیش از حد بزرگ است (حداکثر ۸ مگابایت).");
  // ZIP is only an XLSX candidate; the server must still validate the workbook.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b &&
      ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))) {
    if (bytes.length > MAX_SHEET_IMPORT_BYTES) throw new Error("فایل Excel بیش از حد بزرگ است (حداکثر ۷ مگابایت).");
    return "xlsx";
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart(); }
  catch { throw new Error("فایل متنی باید UTF-8 باشد؛ فایل باینری یا Excel قدیمی پشتیبانی نمی‌شود."); }
  if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("محتوای فایل متنی معتبر نیست.");
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  if (bytes.length > MAX_SHEET_IMPORT_BYTES) throw new Error("فایل CSV بیش از حد بزرگ است (حداکثر ۷ مگابایت).");
  const first = text.split(/[\r\n]/, 1)[0];
  // A/B/C with comma, semicolon or tab; also retain single-column IP imports.
  // Row/quote/IP validity is decided by the server parser, not this classifier.
  if (!text.startsWith("<") && (/[;,\t]/.test(first) ||
      /^(?:"?(?:\d{1,3}\.){3}\d{1,3}"?|IP(?:\s*Address)?|آی\s*پی|آدرس\s*(?:IP|آی\s*پی))\s*$/i.test(first))) return "csv";
  throw new Error("محتوای فایل Excel، CSV یا Portable JSON قابل شناسایی نیست.");
}
