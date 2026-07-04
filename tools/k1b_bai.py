# -*- coding: utf-8 -*-
"""K1b(v2): bai.go.kr 결산검사보고(BAK_0022)·감사연구원(ERK_0001) 수집 — collect_bai 헤더 정확 복제."""
import json, re, time, urllib.request
from pathlib import Path

BASE = "https://www.bai.go.kr"
K1 = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\기준수집_K1")
HG = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*", "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": BASE + "/bai/board/base/list?brdId=BAK_0022", "X-Requested-With": "XMLHttpRequest"}

def get(path):
    req = urllib.request.Request(BASE + path, headers=HG)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def post_dl(doc_id):
    h = dict(HG); h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + "/api/files/downloadZip", data=json.dumps({"fileId": doc_id}).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

def list_board(brd):
    rows, page = [], 1
    while True:
        j = json.loads(get(f"/api/bak/main/mains/list?brdId={brd}&pageIndex={page}&recordCountPerPage=50"))
        items = (j.get("_embedded") or {}).get("boardDtoList") or []
        if not items: break
        rows += items
        tp = (j.get("page") or {}).get("totalPages", 1)
        if page >= tp: break
        page += 1; time.sleep(0.3)
    return rows

def safe(s): return re.sub(r'[\\/:*?"<>|]', "_", s or "무제").strip()[:80]

def dl(doc_id, outdir: Path, name):
    try:
        data = post_dl(doc_id)
        if len(data) < 5000:
            print(f"SKIP {name} (응답 {len(data)}B)"); return False
        ext = ".zip" if data[:2] == b"PK" else (".pdf" if data[:4] == b"%PDF" else ".bin")
        outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / (safe(name) + ext)
        out.write_bytes(data)
        print(f"OK {out.name} · {len(data)/1024/1024:.1f}MB")
        return True
    except Exception as e:
        print(f"ERR {name}: {e}"); return False

# 1) 결산검사보고 — 2023·2024·2025회계연도(국가+공공기관)
rows = list_board("BAK_0022")
print(f"[BAK_0022] {len(rows)}건")
want = [r for r in rows if re.search(r"(2022|2023|2024|2025)회계연도", r.get("titNm") or "")]
print("대상:", [r["titNm"] for r in want])
got = sum(dl(r["docId"], K1 / "bai_gyulsan", r["titNm"]) for r in want if r.get("docId"))

# 2) 감사연구원 — 회계·재정 키워드
rows2 = list_board("ERK_0001")
print(f"\n[ERK_0001] {len(rows2)}건")
KEY = re.compile(r"회계|결산|재무|재정|부채|복식부기|내부통제")
want2 = [r for r in rows2 if KEY.search(r.get("titNm") or "")]
print(f"키워드 일치 {len(want2)}건 — 상위 25건 수집")
got2 = 0
for r in want2[:25]:
    if r.get("docId"):
        got2 += dl(r["docId"], K1 / "eri", r["titNm"]); time.sleep(0.5)

print(f"\n=== K1b 완료: 결산검사 {got}건 · 감사연구원 {got2}건 ===")
