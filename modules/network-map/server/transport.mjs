import net from "node:net";
import { Client as SshClient } from "ssh2";

function safeError(error, fallback = "ارتباط با تجهیز ناموفق بود.") {
  const message = String(error?.message || fallback)
    .replace(/password\s*[=:]\s*\S+/gi, "password=[REDACTED]")
    .replace(/secret\s*[=:]\s*\S+/gi, "secret=[REDACTED]");
  return new Error(message.slice(0, 500));
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "");
}

function lastPrompt(text) {
  const lines = stripAnsi(text).split("\n").map((line) => line.trimEnd()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^[^\n]{1,120}[#>]\s*$/.test(lines[index])) return lines[index].trim();
  }
  return "";
}

function stripCommandFrame(text, command, prompt) {
  const lines = stripAnsi(text).split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && lines[0].trim() === command.trim()) lines.shift();
  while (lines.length && (!lines.at(-1).trim() || lines.at(-1).trim() === prompt.trim())) lines.pop();
  return lines.join("\n").trim();
}

function createShellRunner(stream, { commandTimeout, signal }) {
  let buffer = "";
  let closed = false;
  const waiters = new Set();
  const notify = () => { for (const waiter of waiters) waiter(); };
  stream.on("data", (chunk) => { buffer += chunk.toString("utf8"); notify(); });
  stream.on("close", () => { closed = true; notify(); });
  stream.on("error", () => { closed = true; notify(); });
  const abort = () => { closed = true; stream.destroy(); notify(); };
  signal?.addEventListener("abort", abort, { once: true });

  async function waitUntil(predicate, timeout = commandTimeout) {
    const started = Date.now();
    while (true) {
      if (signal?.aborted) throw new Error("عملیات به‌دلیل بسته‌شدن صفحه متوقف شد.");
      const value = stripAnsi(buffer);
      if (predicate(value)) return value;
      if (closed) throw new Error("ارتباط تجهیز پیش از دریافت پاسخ بسته شد.");
      if (Date.now() - started >= timeout) throw new Error("مهلت دریافت پاسخ فرمان تمام شد.");
      await new Promise((resolve) => {
        const timer = setTimeout(done, Math.min(250, timeout));
        function done() { clearTimeout(timer); waiters.delete(done); resolve(); }
        waiters.add(done);
      });
    }
  }

  async function initialPrompt() {
    await waitUntil((value) => Boolean(lastPrompt(value)));
    const prompt = lastPrompt(buffer);
    buffer = "";
    return prompt;
  }

  async function sendAndWait(command, { allowPassword = false, password = "" } = {}) {
    buffer = "";
    stream.write(`${command}\n`);
    if (allowPassword) {
      await waitUntil((value) => /(?:password|passcode)\s*:\s*$/im.test(value) || Boolean(lastPrompt(value)));
      if (/(?:password|passcode)\s*:\s*$/im.test(stripAnsi(buffer))) {
        buffer = "";
        stream.write(`${password}\n`);
      }
    }
    await waitUntil((value) => Boolean(lastPrompt(value)));
    const prompt = lastPrompt(buffer);
    const output = stripCommandFrame(buffer, command, prompt);
    buffer = "";
    return { output, prompt };
  }

  function destroy() {
    signal?.removeEventListener("abort", abort);
    stream.end();
    stream.destroy();
  }

  return { initialPrompt, sendAndWait, destroy };
}

async function preparePrivilegedShell(runner, enablePassword) {
  let prompt = await runner.initialPrompt();
  if (prompt.endsWith(">")) {
    if (!enablePassword) throw new Error("سطح دسترسی ۱۵ نیست و رمز enable وارد نشده است.");
    const enabled = await runner.sendAndWait("enable", { allowPassword: true, password: enablePassword });
    prompt = enabled.prompt;
    if (!prompt.endsWith("#")) throw new Error("رمز enable پذیرفته نشد یا سطح دسترسی کافی نیست.");
  }
  await runner.sendAndWait("terminal length 0").catch(() => null);
  await runner.sendAndWait("terminal width 511").catch(() => null);
  return prompt;
}

export function runSshCommands({ host, port = 22, username, password, enablePassword = "", connectTimeout = 30_000, commandTimeout = 90_000, commands, signal }) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      client.end();
      if (error) reject(safeError(error)); else resolve(value);
    };
    const onAbort = () => finish(new Error("عملیات به‌دلیل بسته‌شدن صفحه متوقف شد."));
    signal?.addEventListener("abort", onAbort, { once: true });
    client.on("ready", () => {
      client.shell({ term: "vt100", cols: 511, rows: 1000 }, async (error, stream) => {
        if (error) return finish(error);
        const runner = createShellRunner(stream, { commandTimeout, signal });
        try {
          let prompt = await preparePrivilegedShell(runner, enablePassword);
          const outputs = {};
          for (const command of commands) {
            const result = await runner.sendAndWait(command);
            outputs[command] = result.output;
            prompt = result.prompt || prompt;
          }
          runner.destroy();
          finish(null, { prompt, outputs });
        } catch (runError) {
          runner.destroy();
          finish(runError);
        }
      });
    });
    client.on("error", (error) => finish(error));
    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, done) => done(prompts.map(() => password)));
    try {
      client.connect({
        host,
        port: Number(port || 22),
        username,
        password,
        readyTimeout: connectTimeout,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        tryKeyboard: true,
      });
    } catch (error) { finish(error); }
  });
}

function stripTelnetNegotiation(chunk, socket) {
  const input = Buffer.from(chunk);
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 255) { output.push(input[index]); continue; }
    const command = input[index + 1];
    const option = input[index + 2];
    if (command === 255) { output.push(255); index += 1; continue; }
    if ([251, 252, 253, 254].includes(command) && option !== undefined) {
      const response = command === 253 || command === 254 ? 252 : 254;
      socket.write(Buffer.from([255, response, option]));
      index += 2;
    }
  }
  return Buffer.from(output).toString("utf8");
}

export function runTelnetCommands({ host, port = 23, username, password, enablePassword = "", connectTimeout = 30_000, commandTimeout = 90_000, commands, signal }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: Number(port || 23) });
    let settled = false;
    let phase = "login";
    let raw = "";
    let loginTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(loginTimer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(safeError(error)); else resolve(value);
    };
    const onAbort = () => finish(new Error("عملیات به‌دلیل بسته‌شدن صفحه متوقف شد."));
    signal?.addEventListener("abort", onAbort, { once: true });
    loginTimer = setTimeout(() => finish(new Error("مهلت اتصال Telnet تمام شد.")), connectTimeout);
    socket.setTimeout(commandTimeout, () => finish(new Error("مهلت دریافت پاسخ Telnet تمام شد.")));
    socket.on("error", (error) => finish(error));
    socket.on("data", async (chunk) => {
      if (settled || phase === "commands") return;
      raw += stripTelnetNegotiation(chunk, socket);
      const text = stripAnsi(raw);
      if (phase === "login" && /(?:username|login)\s*:\s*$/im.test(text)) {
        phase = "password"; raw = ""; socket.write(`${username}\r\n`); return;
      }
      if ((phase === "password" || phase === "login") && /password\s*:\s*$/im.test(text)) {
        phase = "prompt"; raw = ""; socket.write(`${password}\r\n`); return;
      }
      if (["login", "password", "prompt"].includes(phase) && lastPrompt(text)) {
        phase = "commands";
        clearTimeout(loginTimer);
        const stream = socket;
        const originalWrite = stream.write.bind(stream);
        stream.write = (data, ...args) => originalWrite(String(data).replace(/\n$/, "\r\n"), ...args);
        const runner = createShellRunner(stream, { commandTimeout, signal });
        try {
          runner.initialPrompt = async () => lastPrompt(text);
          let prompt = await preparePrivilegedShell(runner, enablePassword);
          const outputs = {};
          for (const command of commands) {
            const result = await runner.sendAndWait(command);
            outputs[command] = result.output;
            prompt = result.prompt || prompt;
          }
          runner.destroy();
          finish(null, { prompt, outputs });
        } catch (error) { runner.destroy(); finish(error); }
      }
    });
  });
}

export async function runDeviceCommands(options) {
  if (options.protocol === "telnet") return runTelnetCommands(options);
  return runSshCommands(options);
}
