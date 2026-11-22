import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIpamImportFormat, MAX_SHEET_IMPORT_BYTES, MAX_PORTABLE_IMPORT_BYTES } from '../public/ipam-import-format.mjs';
import { parseIpamImport } from '../server/ipam-bulk.mjs';

const workbook = fs.readFileSync(new URL('./fixtures/ipam-two-sheets.xlsx', import.meta.url));
const csv = Buffer.from('\ufeffIP;Name;Description\r\n192.0.2.94;سوئیچ;طبقه اول');
const parse = (buffer, filename) => parseIpamImport({ base64: buffer.toString('base64'), filename, cidr: '192.0.2.0/24' });

test('shared detection recognizes content, BOM, separators and JSON beyond the old 512-byte window', () => {
  for (const input of [csv, Buffer.from('IP\tName\tDescription\n192.0.2.94\tSwitch\tnote'),
    Buffer.from('"IP","Name","Description"\n192.0.2.94,Switch,note'), Buffer.from('192.0.2.94')]) {
    assert.equal(detectIpamImportFormat(input), 'csv');
  }
  assert.equal(detectIpamImportFormat(workbook), 'xlsx');
  assert.equal(detectIpamImportFormat(Buffer.from('\ufeff' + ' '.repeat(1024) + '{"format":"EMS-IPAM-SUBNET"}')), 'json');
  assert.equal(detectIpamImportFormat(Buffer.from('[]')), 'json');
});

test('spreadsheet server parser ignores misleading or missing filename extensions', () => {
  const expectedXlsx = parse(workbook, 'original.xlsx');
  const expectedCsv = parse(csv, 'original.csv');
  for (const filename of ['renamed.csv', 'renamed.xlsx', 'renamed.json', 'no-extension']) {
    assert.deepEqual(parse(workbook, filename), expectedXlsx);
    assert.deepEqual(parse(csv, filename), expectedCsv);
  }
  assert.equal(expectedXlsx.items[0].name, 'سوئیچ آزمایشی');
  assert.equal(expectedCsv.items[0].name, 'سوئیچ');
  assert.deepEqual(parse(Buffer.from('\ufeff\r\n\r\nIP;Name;Description\r\n192.0.2.94;سوئیچ;طبقه اول'), 'blank-lines.xlsx').items, expectedCsv.items);
});

test('unsupported binary, empty, UTF-16 and malformed UTF-8 cannot become CSV rows', () => {
  for (const data of [Buffer.alloc(0), Buffer.from([0xff, 0xfe, 0x49, 0]),
    Buffer.from('IP,Name\n192.0.2.1,\x00binary'), Buffer.from([0x49, 0x50, 0x2c, 0xc3, 0x28]),
    Buffer.from('<html>not,an,import</html>'), Buffer.from('unstructured text')]) {
    assert.throws(() => parse(data, 'looks-valid.csv'));
  }
});

test('ZIP signature is only a candidate: corrupt/non-workbook ZIP and JSON are rejected by sheet routes', () => {
  const emptyZip = Buffer.alloc(22); emptyZip.writeUInt32LE(0x06054b50);
  for (const data of [Buffer.from([0x50, 0x4b, 3, 4]), emptyZip]) {
    assert.equal(detectIpamImportFormat(data), 'xlsx');
    assert.throws(() => parse(data, 'renamed.csv'), /xlsx|Excel/);
  }
  assert.throws(() => parse(Buffer.from('{"format":"EMS-IPAM-SUBNET"}'), 'looks-valid.xlsx'), /Portable/);
});

test('sheet and Portable size limits are enforced on content regardless of the filename', () => {
  const sheet = Buffer.alloc(MAX_SHEET_IMPORT_BYTES, ' '); sheet.write('IP,Name');
  assert.equal(detectIpamImportFormat(sheet), 'csv');
  assert.throws(() => detectIpamImportFormat(Buffer.concat([sheet, Buffer.from(' ')])), /۷/);
  const portable = Buffer.alloc(MAX_PORTABLE_IMPORT_BYTES, ' '); portable.write('{}');
  assert.equal(detectIpamImportFormat(portable), 'json');
  assert.throws(() => detectIpamImportFormat(Buffer.concat([portable, Buffer.from(' ')])), /۸/);
  const zip = Buffer.alloc(MAX_SHEET_IMPORT_BYTES + 1); zip.set([0x50, 0x4b, 3, 4]);
  assert.throws(() => detectIpamImportFormat(zip), /۷/);
});
