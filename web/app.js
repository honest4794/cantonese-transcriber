import { exportTranscript, timestamp } from './exports.mjs';

const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const freshToken = fragment.get('token');
if (freshToken) {
  sessionStorage.setItem('transcriber-token', freshToken);
  sessionStorage.setItem('transcriber-port', fragment.get('port') || '8765');
  history.replaceState(null, '', location.pathname + location.search);
}
const token = sessionStorage.getItem('transcriber-token') || '';
const portString = sessionStorage.getItem('transcriber-port') || '8765';
const port = /^\d{1,5}$/.test(portString) && +portString > 0 && +portString < 65536 ? +portString : 8765;
const api = `http://127.0.0.1:${port}`;
$('local-link').href = api + '/';
let connected = false, busy = false, selected = null, jobId = null, rows = [], audioUrl = null, timer = null;

function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function controls() { $('start').disabled = !connected || !selected || busy; $('file').disabled = busy; $('speakers').disabled = busy; $('cancel').hidden = !busy; }
async function request(path, options = {}) {
  const response = await fetch(api + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, targetAddressSpace: 'loopback', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本機連接失敗');
  return data;
}
async function connect() {
  if (!token) return;
  try {
    const result = await request('/api/health', { signal: AbortSignal.timeout(5000) });
    if (result.service !== 'cantonese-transcriber') throw new Error();
    connected = true; $('connection').textContent = '已連接本機'; $('light').classList.add('online'); $('setup').hidden = true;
  } catch {
    $('connection').textContent = '未連接';
    error('未能連接本機程式。請啟動 Start.command；如瀏覽器詢問本機網絡權限，請允許。');
  }
  controls();
}
function select(file) {
  if (!file || busy) return;
  if (file.size > 512 * 1024 * 1024) return error('音檔上限為 512 MB，請先分段。');
  if (!file.size) return error('呢個檔案係空白，請重新選擇。');
  selected = file; error();
  $('file-name').textContent = file.name;
  $('file-help').textContent = `${(file.size / 1048576).toFixed(1)} MB · 點擊更換錄音`;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file); $('audio').src = audioUrl;
  $('result').hidden = true; rows = []; controls();
}
$('file').addEventListener('change', event => select(event.target.files[0]));
for (const name of ['dragover', 'dragleave', 'drop']) $('dropzone').addEventListener(name, event => {
  event.preventDefault(); $('dropzone').classList.toggle('drag', name === 'dragover');
  if (name === 'drop') select(event.dataTransfer.files[0]);
});
function finish() { busy = false; jobId = null; $('cancel').disabled = false; controls(); }
function render() {
  const fragment = document.createDocumentFragment();
  for (const [i, row] of rows.entries()) {
    const div = document.createElement('div'); div.className = 'transcript-row';
    const number = document.createElement('span'); number.className = 'line-number'; number.textContent = i + 1;
    const seek = document.createElement('button'); seek.type = 'button'; seek.className = 'seek'; seek.textContent = timestamp(row.start).slice(0, 8); seek.title = '播放呢段錄音';
    seek.addEventListener('click', () => { $('audio').currentTime = row.start; $('audio').play().catch(() => {}); });
    const speaker = document.createElement('div'); speaker.className = 'speaker'; speaker.contentEditable = 'plaintext-only'; speaker.textContent = row.speaker; speaker.setAttribute('aria-label', `第 ${i + 1} 行講者`);
    speaker.addEventListener('input', () => row.speaker = speaker.textContent.trim() || '講者不確定');
    const words = document.createElement('div'); words.className = 'words'; words.contentEditable = 'plaintext-only'; words.textContent = row.text; words.setAttribute('aria-label', `第 ${i + 1} 行內容`);
    words.addEventListener('input', () => row.text = words.textContent);
    div.append(number, seek, speaker, words); fragment.append(div);
  }
  $('lines').replaceChildren(fragment); $('count').textContent = `${rows.length} 行`; $('result').hidden = false;
}
async function poll() {
  if (!jobId) return;
  try {
    const result = await request('/api/jobs/' + jobId, { signal: AbortSignal.timeout(10000) });
    error();
    $('status').textContent = result.message; $('progress').value = result.progress; $('percent').textContent = `${Math.round(result.progress)}%`;
    if (result.status === 'done') { rows = result.lines; render(); finish(); return; }
    if (result.status === 'error' || result.status === 'cancelled') { if (result.status === 'error') error(result.message); finish(); return; }
    timer = setTimeout(poll, document.hidden ? 3000 : 1000);
  } catch { error('連接中斷。請確認本機程式仍開啟；恢復連接後會繼續讀取進度。'); timer = setTimeout(poll, 3000); }
}
$('form').addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || busy || !connected) return;
  busy = true; controls(); $('cancel').disabled = true; error(); $('result').hidden = true; $('status-area').hidden = false;
  $('status').textContent = '傳送至本機程式'; $('percent').textContent = ''; $('progress').removeAttribute('value');
  try {
    const job = await request('/api/jobs?speakers=' + $('speakers').value, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: selected });
    jobId = job.id; $('cancel').disabled = false; poll();
  } catch (err) { error(err.message || '無法開始轉錄，請檢查本機程式。'); $('status').textContent = '未能開始'; $('progress').value = 0; finish(); }
});
$('cancel').addEventListener('click', async () => {
  if (!jobId) return;
  $('cancel').disabled = true;
  try { await request('/api/jobs/' + jobId, { method: 'DELETE' }); $('status').textContent = '正在取消'; }
  catch { $('cancel').disabled = false; error('取消失敗，請確認本機程式仍開啟。'); }
});
$('download').addEventListener('click', () => {
  if (!rows.length) return;
  const format = $('format').value, content = exportTranscript(rows, format);
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
  link.download = (selected?.name.replace(/\.[^.]+$/, '') || '錄音') + '-粵語逐字稿.' + format;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
connect();
