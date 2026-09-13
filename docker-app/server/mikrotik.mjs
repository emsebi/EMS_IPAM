function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

// This helper only creates text for an operator to run manually on RouterOS.
// It never opens a connection to equipment and never stores submitted values.
export function buildMikrotikScript({ username, password, certificateName, port, transport = "mikrotik-api" }) {
  const user = clean(username, 80);
  const pass = String(password ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const cert = clean(certificateName, 120);
  const apiSsl = transport === "mikrotik-api-ssl";
  const rest = transport === "mikrotik-rest";
  const servicePort = Math.max(1, Math.min(65535, Number(port) || (apiSsl ? 8729 : rest ? 443 : 8728)));
  if (!/^[A-Za-z0-9_.-]{3,80}$/.test(user)) throw new Error("نام کاربری میکروتیک معتبر نیست.");
  if ((apiSsl || rest) && !cert) throw new Error("برای روش رمزگذاری‌شده نام Certificate را وارد کنید؛ روش ساده API به Certificate نیاز ندارد.");
  const policy = rest ? "read,rest-api" : "read,api";
  const service = rest ? "www-ssl" : apiSsl ? "api-ssl" : "api";
  const commands = [
    `:if ([:len [/user/group find where name="ems-ipam"]] = 0) do={ /user/group/add name=ems-ipam policy=${policy} } else={ /user/group/set [find where name="ems-ipam"] policy=${policy} }`,
    `:if ([:len [/user find where name="${user}"]] = 0) do={ /user/add name=${user} group=ems-ipam password="${pass}" } else={ /user/set [find where name="${user}"] group=ems-ipam password="${pass}" disabled=no }`,
  ];
  commands.push((apiSsl || rest)
    ? `/ip/service/set ${service} disabled=no port=${servicePort} certificate=${cert} tls-version=only-1.2`
    : `/ip/service/set api disabled=no port=${servicePort}`);
  return commands.join("\n");
}
