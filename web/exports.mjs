export function timestamp(seconds, srt = false) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${srt ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;
}

export function exportTranscript(rows, format) {
  if (format === 'srt') return rows.map((r, i) => `${i + 1}\n${timestamp(r.start, true)} --> ${timestamp(r.end, true)}\n${r.speaker}：${r.text}\n`).join('\n');
  if (format === 'csv') {
    const quote = value => {
      let text = String(value);
      if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
      return `"${text.replaceAll('"', '""')}"`;
    };
    return '\ufeff' + [['行號', '開始時間', '結束時間', '講者', '內容'], ...rows.map((r, i) => [i + 1, timestamp(r.start), timestamp(r.end), r.speaker, r.text])].map(row => row.map(quote).join(',')).join('\r\n');
  }
  return '粵語自動轉錄初稿｜請核對英文、專有名詞及講者。\n\n' + rows.map((r, i) => `${String(i + 1).padStart(4, '0')}｜${timestamp(r.start)}–${timestamp(r.end)}｜${r.speaker}｜${r.text}`).join('\n') + '\n';
}
