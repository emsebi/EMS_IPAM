const SECRET_PATTERNS = [
  /^(\s*enable\s+(?:password|secret)(?:\s+\d+)?\s+).+$/i,
  /^(\s*username\s+\S+(?:\s+privilege\s+\d+)?\s+(?:password|secret)(?:\s+\d+)?\s+).+$/i,
  /^(\s*(?:password|secret|key)\s+(?:\d+\s+)?).+$/i,
  /^(\s*snmp-server\s+community\s+).+$/i,
  /^(\s*(?:tacacs|radius)-server[^\n]*(?:key|secret)\s+).+$/i,
  /^(\s*neighbor\s+\S+\s+password\s+).+$/i,
  /^(\s*wpa-psk\s+ascii(?:\s+\d+)?\s+).+$/i,
  /^(\s*pre-shared-key[^\n]*\s+).+$/i,
  /^(\s*crypto\s+isakmp\s+key\s+).+$/i,
  /^(\s*authentication-key[^\n]*\s+).+$/i,
  /^(\s*snmp-server\s+user\s+).+$/i,
  /^(\s*snmp-server\s+host\s+).+$/i,
];

const SENSITIVE_LINE = /\b(?:password|passwd|secret|community|key-string|pre-shared-key|private-key|authentication-key|message-digest-key|wpa-psk|encrypted-password)\b/i;

export function sanitizeConfiguration(input) {
  let redactionCount = 0;
  let privateKeyBlock = false;
  const lines = String(input || "").replace(/\r/g, "").split("\n").map((line) => {
    if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(line)) {
      privateKeyBlock = true;
      redactionCount += 1;
      return `${line.match(/^\s*/)?.[0] || ""}[REDACTED PRIVATE KEY BLOCK]`;
    }
    if (privateKeyBlock) {
      if (/-----END [^-]*PRIVATE KEY-----/i.test(line)) privateKeyBlock = false;
      return "";
    }
    for (const pattern of SECRET_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        redactionCount += 1;
        return `${match[1]}[REDACTED]`;
      }
    }
    if (SENSITIVE_LINE.test(line)) {
      redactionCount += 1;
      return `${line.match(/^\s*/)?.[0] || ""}[REDACTED SENSITIVE LINE]`;
    }
    return line;
  });
  return { text: lines.join("\n").trimEnd() + "\n", redactionCount };
}

export function assertNoSubmittedSecrets(value) {
  const serialized = JSON.stringify(value || {});
  if (/"[^"]*(?:password|secret|credential|privateKey|community)[^"]*"\s*:/i.test(serialized)) {
    throw new Error("اطلاعات ذخیره‌شونده نباید شامل رمز باشد.");
  }
}
