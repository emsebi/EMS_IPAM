import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { jalaliDate, jalaliDateTime, jalaliFilenameStamp } from "../server/jalali.mjs";
import { parseIdentity, parseVersion, safeName } from "../server/mikrotik-backup.mjs";

test("Jalali helpers use Tehran time and filesystem-safe names", () => {
  const date = new Date("2026-09-12T10:00:00.000Z");
  assert.equal(jalaliDate(date), "1405/06/21");
  assert.equal(jalaliDateTime(date), "1405/06/21 13:30:00");
  assert.equal(jalaliFilenameStamp(date), "1405-06-21_13-30");
});

test("MikroTik backup metadata is normalized without changing Persian identity", () => {
  const output = " name: AP-مرکزی\n version: 7.20.1 (stable)\n";
  assert.equal(parseIdentity(output, "fallback"), "AP-مرکزی");
  assert.equal(parseVersion(output, "auto"), "7");
  assert.equal(parseVersion(output, "6"), "6");
  assert.equal(safeName("AP مرکزی / طبقه ۲"), "AP-مرکزی-طبقه-۲");
});

test("backup implementation passes passwords only through the process environment", async () => {
  const source = await fs.readFile(new URL("../server/mikrotik-backup.mjs", import.meta.url), "utf8");
  assert.match(source, /SSHPASS: String\(password/);
  assert.match(source, /PreferredAuthentications=password,keyboard-interactive/);
  assert.match(source, /\/system identity print; \/system resource print/);
  assert.match(source, /\/export show-sensitive/);
  assert.match(source, /\/export hide-sensitive=no/);
  assert.doesNotMatch(source, /console\.(?:log|error)[^\n]*password/);
});

test("installation guide names Docker and Portainer before installation", async () => {
  const readme = await fs.readFile(new URL("../../README.md", import.meta.url), "utf8");
  const prerequisite = readme.indexOf("## پیش‌نیازهای نصب");
  const install = readme.indexOf("## نصب با خط فرمان");
  assert.ok(prerequisite >= 0 && prerequisite < install);
  assert.match(readme.slice(prerequisite, install), /Docker Engine/);
  assert.match(readme.slice(prerequisite, install), /Portainer/);
});
