/** Pure transcript and chunk logic shared by the UI, Worker and tests. */
export function makeChunkRanges(length, sampleRate, seconds = 15) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(seconds) || seconds <= 0) throw new RangeError('無效音訊長度或取樣率');
  const step = Math.max(1, Math.round(seconds * sampleRate));
  const context = Math.round(.3 * sampleRate);
  const ranges = [];
  for (let start = 0; start < length; start += step) ranges.push({start: Math.max(0, start - context), end: Math.min(length, start + step + context), keepStart: start, keepEnd: Math.min(length, start + step)});
  return ranges;
}

export function isDigitalSilence(samples) {
  for (const sample of samples) if (sample !== 0) return false;
  return true;
}

export function makeLines(chunks, turns = [], convert = text => text) {
  const names = new Map();
  const sortedTurns=[...turns].sort((a,b)=>a.start-b.start);
  for (const t of sortedTurns) if (!names.has(t.speaker)) names.set(t.speaker, `講者 ${String.fromCharCode(65+names.size)}`);
  let turnIndex=0,active=[],lastTime=-Infinity;
  function speakersAt(time) {
    // Sweep once through the timeline instead of rescanning every turn for every
    // character. This keeps long-transcript formatting off the hot quadratic path.
    if(time<lastTime){turnIndex=0;active=[];}
    lastTime=time;
    while(turnIndex<sortedTurns.length && sortedTurns[turnIndex].start<=time)active.push(sortedTurns[turnIndex++]);
    active=active.filter(t=>t.end>time);
    return new Set(active.map(t=>t.speaker));
  }
  const rows = [];
  function finish(row) {
    if (!row) return;
    const text = convert(row.pieces.join('')).trim().replace(/(?<![體關聯世])系(?![統列數譜])/g,'係').replace(/(?<![聯維連])繫(?![帶鞋])/g,'係');
    if (text) rows.push({line:rows.length+1,start:row.start,end:row.end,speaker:row.speaker,text});
  }
  for (const chunk of chunks) {
    let row = null;
    for (let i=0;i<chunk.tokens.length;i++) {
      const token=chunk.tokens[i],start=chunk.timestamps[i];
      if (!token.trim()) { if(row) row.pieces.push(token); continue; }
      if (!Number.isFinite(start)) continue;
      const next=chunk.timestamps[i+1] ?? chunk.end;
      const end=Math.min(chunk.end,Math.max(start+.06,Math.min(start+.4,next)));
      const hit=speakersAt((start+end)/2);
      let speaker='講者';
      if (turns.length) speaker=hit.size===1 ? names.get([...hit][0]) : hit.size>1 ? [...hit].map(n=>names.get(n)).sort().join('／')+'（重疊）' : '講者不確定';
      if(row && (row.speaker!==speaker || start-row.end>1 || start-row.start>20)) {finish(row);row=null;}
      if(!row) row={start:Math.round(start*1000)/1000,end,speaker,pieces:[]};
      row.pieces.push(token);row.end=Math.round(end*1000)/1000;
    }
    finish(row);
  }
  return rows;
}
