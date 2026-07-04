# -*- coding: utf-8 -*-
"""D0: 감사 길잡이 원본 카드에서 재무카드 본문을 이식해 지연 로딩 샤드 생성.

입력: data/cases_fin.json (목록 메타·10,225) + 길잡이 cards_p1..8.js (SSoT)
출력: data/fin_body_p1..p4.json ({id: 본문}) + cases_fin.json에 bp(샤드 번호) 필드 추가
원칙: 길잡이 빌드 산출물이 SSoT(요약본·이미 PII 마스킹 적용) — 여기서 내용 변형 금지, 필드 선별·압축키만.
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
paths = json.loads((ROOT / "tools" / "local_paths.json").read_text(encoding="utf-8"))
CARDS = Path(paths["CARDS"])  # C:\AuditApp\giljabi-web

# 1) 길잡이 전 카드 로드
src = {}
for i in range(1, 9):
    s = (CARDS / f"cards_p{i}.js").read_text(encoding="utf-8")
    arr = json.loads(s[s.index("["):s.rindex("]") + 1])
    for c in arr:
        src[c.get("id")] = c
print(f"길잡이 카드 {len(src):,}건 로드")

# 2) 재무 목록 로드
fin = json.loads((DATA / "cases_fin.json").read_text(encoding="utf-8"))
print(f"재무 목록 {len(fin):,}건")

# 3) 본문 추출(압축 키) — 내용 무변형
FIELDS = [
    ("요지", "yo"), ("위반사실", "wi"), ("원인", "wo"), ("착안점", "ca"),
    ("적신호", "red"), ("핵심구", "kp"), ("처분종류", "disp"), ("경과", "gy"),
    ("근거페이지", "pg"), ("감사명", "gn"), ("공개일", "pd"), ("기관유형", "ot"),
    ("위반유형", "vt"), ("금액", "amt"), ("형사연계", "hs"), ("중점점검", "jj"),
]
matched, missing = 0, []
bodies = {}
for row in fin:
    c = src.get(row["id"])
    if not c:
        missing.append(row["id"]); continue
    b = {}
    for k, short in FIELDS:
        v = c.get(k)
        if v not in (None, "", [], {}):
            b[short] = v
    bodies[row["id"]] = b
    matched += 1
print(f"본문 매칭 {matched:,} / 누락 {len(missing)} {missing[:5]}")

# 4) 4샤드 분할(목록 순서 안정 분할) + bp 필드
N_SHARD = 4
per = math.ceil(len(fin) / N_SHARD)
shards = [dict() for _ in range(N_SHARD)]
for idx, row in enumerate(fin):
    p = idx // per  # 0..3
    row["bp"] = p + 1
    if row["id"] in bodies:
        shards[p][row["id"]] = bodies[row["id"]]

for i, sh in enumerate(shards, 1):
    out = DATA / f"fin_body_p{i}.json"
    out.write_text(json.dumps(sh, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"fin_body_p{i}.json: {len(sh):,}건 · {out.stat().st_size/1024/1024:.2f}MB")

(DATA / "cases_fin.json").write_text(json.dumps(fin, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"cases_fin.json 갱신(bp 필드) · {(DATA/'cases_fin.json').stat().st_size/1024/1024:.2f}MB")

# 5) 표본 무결성: 3건 원본 대조
import random
random.seed(20260703)
sample = random.sample([r["id"] for r in fin if r["id"] in bodies], 3)
for sid in sample:
    p = next(r["bp"] for r in fin if r["id"] == sid)
    sh = json.loads((DATA / f"fin_body_p{p}.json").read_text(encoding="utf-8"))
    assert sh[sid].get("yo") == src[sid].get("요지"), f"불일치: {sid}"
    assert sh[sid].get("wi") == src[sid].get("위반사실"), f"불일치: {sid}"
print(f"표본 대조 OK: {sample}")
