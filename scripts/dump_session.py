import sqlite3, json, sys

DB = "C:/Users/22986/.online/runtime.sqlite3"
OUT = "D:/1024train/online/_session_dump2.json"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

# Get latest session
cur.execute("SELECT id,source_lang,target_lang,started_at FROM sessions ORDER BY started_at DESC LIMIT 1")
row = cur.fetchone()
if not row:
    print("No sessions found")
    sys.exit(1)
sid, src_lang, tgt_lang, started = row
print(f"Session: {sid}  lang: {src_lang}->{tgt_lang}  started: {started}")

cur.execute(
    "SELECT id,source_text,translated_text,status,version,start_time,end_time,updated_at,superseded_by "
    "FROM subtitle_segments WHERE session_id=? ORDER BY updated_at ASC",
    (sid,),
)
rows = cur.fetchall()
data = [
    {
        "id": r[0], "src": r[1], "trn": r[2], "status": r[3],
        "v": r[4], "start": r[5], "end": r[6], "upd": r[7], "sup": r[8],
    }
    for r in rows
]
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Exported {len(data)} segments to {OUT}")
