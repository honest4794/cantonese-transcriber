"""Assign recognised tokens to anonymous speaker turns."""
import re


def make_lines(chunks, turns):
    from opencc import OpenCC
    convert = OpenCC("s2t")
    names = {}
    for turn in sorted(turns, key=lambda x: x["start"]):
        if turn["speaker"] not in names:
            names[turn["speaker"]] = "講者 " + chr(65 + len(names))
    rows = []
    def flush(row):
        if not row:
            return
        text = convert.convert("".join(row.pop("pieces"))).strip()
        text = re.sub(r"(?<![體關聯世])系(?![統列數譜])", "係", text)
        text = re.sub(r"(?<![聯維連])繫(?![帶鞋])", "係", text)
        row["text"] = text
        row["line"] = len(rows) + 1
        rows.append(row)
    for chunk in chunks:
        row = None
        for i, (token, start) in enumerate(zip(chunk["tokens"], chunk["timestamps"])):
            if not token.strip():
                if row:
                    row["pieces"].append(token)
                continue
            next_start = chunk["timestamps"][i + 1] if i + 1 < len(chunk["timestamps"]) else chunk["end"]
            end = min(chunk["end"], max(start + .06, min(start + .4, next_start)))
            hit = {t["speaker"] for t in turns if t["start"] <= (start + end) / 2 < t["end"]}
            if not turns:
                speaker = "講者"
            elif len(hit) == 1:
                speaker = names[next(iter(hit))]
            elif len(hit) > 1:
                speaker = "／".join(sorted(names[x] for x in hit)) + "（重疊）"
            else:
                speaker = "講者不確定"
            if row and (speaker != row["speaker"] or start - row["end"] > 1 or start - row["start"] > 20):
                flush(row)
                row = None
            if row is None:
                row = {"start": round(start, 3), "end": end, "speaker": speaker, "pieces": []}
            row["pieces"].append(token)
            row["end"] = round(end, 3)
        flush(row)
    return rows
