import { normalizeNasIp } from "./nas-inventory.mjs";

const invalid = (reason) => ({ status: "invalid", reason, text: "" });
const placeholder = "<RADIUS_SHARED_SECRET>";

function safeToken(value, pattern, max = 64) {
  return typeof value === "string" && value.length <= max && pattern.test(value) ? value : null;
}

export function previewDeviceRadiusConfig({ vendor, purpose, radiusServerIp, interfaceName = "", serverName = "EMS_RADIUS" } = {}) {
  const serverIp = normalizeNasIp(radiusServerIp);
  if (!serverIp) return invalid("invalid-radius-server-ip");
  if (!["cisco", "mikrotik"].includes(vendor)) return invalid("unsupported-vendor");
  if (!["device-admin", "mab"].includes(purpose)) return invalid("unsupported-purpose");
  const name = safeToken(serverName, /^[A-Za-z][A-Za-z0-9_-]*$/);
  if (!name) return invalid("invalid-server-name");

  if (vendor === "mikrotik" && purpose === "mab") {
    return { status: "unsupported-preview", reason: "model-version-required", text: "" };
  }

  if (vendor === "mikrotik") {
    const lines = [
      "# EMS-IPAM review-only RouterOS device-admin RADIUS template",
      "# Replace the placeholder secret manually. Review against the exact RouterOS version before applying.",
      `/radius add service=login address=${serverIp} authentication-port=1812 accounting-port=1813 secret="${placeholder}"`,
      "/user aaa set use-radius=yes",
      "# Keep a tested local emergency administrator before enabling centralized login.",
    ];
    return { status: "manual-review", reason: "mikrotik-device-admin", text: lines.join("\n") + "\n" };
  }

  const radiusLines = [
    "! EMS-IPAM review-only Cisco IOS/IOS-XE RADIUS template",
    "! Replace the placeholder secret manually and validate syntax on the exact platform/version.",
    "aaa new-model",
    `radius server ${name}`,
    ` address ipv4 ${serverIp} auth-port 1812 acct-port 1813`,
    ` key ${placeholder}`,
    "aaa group server radius EMS_RADIUS_GROUP",
    ` server name ${name}`,
  ];

  if (purpose === "device-admin") {
    radiusLines.push(
      "aaa authentication login default group EMS_RADIUS_GROUP local",
      "aaa authorization exec default group EMS_RADIUS_GROUP local if-authenticated",
      "! Keep and test a local emergency account before changing production AAA.",
    );
    return { status: "manual-review", reason: "cisco-device-admin", text: radiusLines.join("\n") + "\n" };
  }

  const port = safeToken(interfaceName, /^[A-Za-z0-9][A-Za-z0-9/_.:-]*$/);
  if (!port) return invalid("invalid-interface");
  radiusLines.push(
    "aaa authentication dot1x default group EMS_RADIUS_GROUP",
    "aaa authorization network default group EMS_RADIUS_GROUP",
    "dot1x system-auth-control",
    `interface ${port}`,
    " authentication port-control auto",
    " mab",
    " dot1x pae authenticator",
    "! Authentication order/event syntax varies by IOS/IOS-XE release; verify before applying.",
  );
  return { status: "manual-review", reason: "cisco-mab", text: radiusLines.join("\n") + "\n" };
}
