import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTranscript } from '../web/exports.mjs';
const rows = [{ line: 1, start: 59.9996, end: 61.25, speaker: '講者 A', text: '改好嘅「你好」, yes' }];
test('SRT carries edited text and handles timestamp minute rollover', () => {
  assert.equal(exportTranscript(rows, 'srt'), '1\n00:01:00,000 --> 00:01:01,250\n講者 A：改好嘅「你好」, yes\n');
});
test('CSV quotes content and prevents spreadsheet formula execution', () => {
  const csv = exportTranscript([{...rows[0], text: '=1+2,"hi"'}], 'csv');
  assert.ok(csv.includes('"\'=1+2,""hi"""'));
});
test('TXT keeps line numbers, speakers, and user edits', () => {
  assert.ok(exportTranscript(rows, 'txt').includes('0001｜00:01:00.000–00:01:01.250｜講者 A｜改好嘅「你好」, yes'));
});
