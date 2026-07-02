# -*- coding: utf-8 -*-
r"""S2·S3 앱 데이터 생성(결정론)
- data/tie_rules.json  : 등식형 검산규칙 → 입력필드 분해(+ 기관유형 3분기 매핑)
- data/risk_rules.json : 지표·배점 규칙(3분기 매핑·임계값 구조화)
- data/cases_fin.json  : 재무카드 슬림(제목·연도·분야·처분·원문상태·srno)
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DATA = REPO / "data"
PATHS = json.loads((HERE / "local_paths.json").read_text(encoding="utf-8"))

ORG_MAP = [
    ("출자", "출자·출연기관"), ("출연", "출자·출연기관"),
    ("공사", "지방공기업"), ("공기업", "지방공기업"), ("상수도", "지방공기업"),
    ("하수도", "지방공기업"), ("도시철도", "지방공기업"),
    ("자치단체", "지자체"),
]

def org_of(s):
    s = s if isinstance(s, str) else " ".join(s or [])
    # '지방자치단체(지방공기업 부문)'처럼 괄호 안이 실제 대상인 경우 괄호 우선
    inner = re.findall(r"\(([^)]*)\)", s)
    for probe in inner + [s]:
        for k, v in ORG_MAP:
            if k in probe:
                return v
    return "지자체"

def addends(expr):
    """'+' 분리하되 괄호 안은 통째로 유지 — '이월재원(A+B+C)'가 3필드로 쪼개지는 오류 방지."""
    parts, buf, depth = [], "", 0
    for ch in expr or "":
        if ch in "(（":
            depth += 1
        elif ch in ")）":
            depth = max(0, depth - 1)
        if ch in "+＋" and depth == 0:
            if buf.strip():
                parts.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        parts.append(buf.strip())
    return parts or [expr or ""]

def main():
    import hashlib
    rules = json.loads((DATA / "check_rules.json").read_text(encoding="utf-8"))
    ties, risks = [], []
    for i, r in enumerate(rules):
        org = org_of(r.get("기관유형", ""))
        # 안정 ID: 위치 기반(R001…)은 재생성·재정렬 시 검산기 저장값이 다른 등식에 붙는 사고 유발
        stable = hashlib.md5(f"{r.get('이름')}|{r.get('기관유형')}|{r.get('출처파일')}".encode("utf-8")).hexdigest()[:8]
        base = {
            "id": f"R-{stable}", "이름": r.get("이름"), "기관유형": org,
            "기관유형_원": r.get("기관유형"), "근거조문": r.get("근거조문"),
            "출처파일": r.get("출처파일"), "산식_원문": r.get("산식_원문"),
        }
        if r.get("type") == "등식":
            ties.append({**base, "좌변": addends(r.get("좌변")), "우변": addends(r.get("우변")),
                         "좌변_명": r.get("좌변"), "우변_명": r.get("우변")})
        else:
            risks.append({**base, "type": r.get("type"), "임계값": r.get("임계값")})
    (DATA / "tie_rules.json").write_text(json.dumps(ties, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "risk_rules.json").write_text(json.dumps(risks, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 재무카드 슬림 ──
    fin = {x["card_id"]: x for x in json.loads((DATA / "finance_cards.json").read_text(encoding="utf-8"))}
    status = {}
    import csv
    with (DATA / "case_source_map.csv").open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            status[row["card_id"]] = row["원문상태"]
    # finance_cards.json이 필요한 전 필드(처분종류 포함)를 보유 — 샤드 8개(21,503건) 재로딩 불필요
    cards = []
    for cid, f_ in fin.items():
        cards.append({
            "id": cid, "s": str(f_.get("srno")), "se": f_.get("series"),
            "t": f_.get("제목") or "", "y": f_.get("연도") or "",
            "b": (f_.get("분야") or [])[:2], "d": (f_.get("처분종류") or [])[:4],
            "st": status.get(cid, "none"), "ax": f_.get("선별축", ""),
        })
    (DATA / "cases_fin.json").write_text(
        json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    from collections import Counter
    print(json.dumps({
        "tie": len(ties), "tie_기관": dict(Counter(t["기관유형"] for t in ties)),
        "risk": len(risks),
        "cases": len(cards), "cases_MB": round((DATA / "cases_fin.json").stat().st_size / 1e6, 2),
        "원문상태": dict(Counter(c["st"] for c in cards)),
    }, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
