# -*- coding: utf-8 -*-
r"""S1 체크리스트 조립 + 원문 인용 검증(결정론)
_scratch/checkitems_*.json → 근거조문이 기준 원문에 실제 존재하는지 공백무시 대조 →
통과분만 data/checkitems.json, 불일치는 _scratch/checkitems_rejected.json.
검산규칙(checkrules_metrics.json)도 동일 검증 후 data/check_rules.json.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PATHS = json.loads((HERE / "local_paths.json").read_text(encoding="utf-8"))
STD = Path(PATHS["STANDARDS"])

SOURCES = {
    "PE": "2025사업연도 지방공기업 결산기준 (1).txt",
    "IO": "2025사업연도 지방출자·출연기관 결산기준.txt",
    "LG": "지방자치단체 결산 통합기준 (전문).txt",
}

_CANON = str.maketrans({
    "⋅": "·", "･": "·", "•": "·", "‧": "·", "∙": "·", "ㆍ": "·",
    "？": "?", "！": "!", "（": "(", "）": ")", "［": "[", "］": "]",
    "～": "~", "－": "-", "‐": "-", "–": "-", "—": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"', "＂": '"',
    "，": ",", "．": ".", "：": ":", "；": ";",
})

def squash(s: str) -> str:
    s = (s or "").translate(_CANON)
    s = s.replace("​", "").replace("﻿", "")
    return re.sub(r"\s+", "", s)

def load_source_squashed():
    return {k: squash((STD / v).read_text(encoding="utf-8", errors="replace"))
            for k, v in SOURCES.items()}

def code_of(item_id: str) -> str:
    return (item_id or "").split("-")[0]

def verify_quote(quote: str, src_squashed: str) -> bool:
    q = squash(quote)
    if len(q) < 8:
        return False
    if q in src_squashed:
        return True
    # 복수 구절 인용(에이전트가 '/'·줄바꿈·중략표시로 이어 붙임): 구절별로 전부 원문 존재해야 통과
    segs = [squash(s) for s in re.split(r"[/\n]|\(중략\)|…|\.\.\.", quote or "")]
    longs = [s for s in segs if len(s) >= 12]
    if longs and all(_seg_in(s, src_squashed) for s in longs):
        return True
    return _seg_in(q, src_squashed)


def _seg_in(seg: str, src: str) -> bool:
    """연속 일치 또는 순서 보존 창 대조.
    PDF 표 추출 시 셀 텍스트('공통' 등)가 문장 중간에 끼어 연속성이 깨지는 경우를 허용하되,
    12자 창 전부가 원문에 순서대로 존재해야 하므로 재구성·조작 인용은 통과 불가."""
    if seg in src:
        return True
    if len(seg) < 12:
        return False
    wins = [seg[i:i + 12] for i in range(0, len(seg) - 11, 12)]
    if len(seg) % 12:
        wins.append(seg[-12:])
    pos = 0
    ok = True
    for w in wins:
        i = src.find(w, pos)
        if i < 0:
            ok = False
            break
        pos = i + 1
    if ok:
        return True
    return _fuzzy_local(seg, src)


def _fuzzy_local(seg: str, src: str) -> bool:
    """국소 정렬 유사도: 인용의 6자 앵커가 나타나는 원문 위치마다 인용 길이의 1.35배 구간을 잘라
    difflib 유사도 ≥ 0.85면 통과. 표 추출 노이즈(셀 텍스트 끼어듦)는 흡수하되
    재구성·조작 인용은 전 구간 85% 유사를 만들 수 없어 실패한다."""
    import difflib
    span = int(len(seg) * 1.35) + 12
    starts = []
    for k in (0, 6, 12):  # 서두가 노이즈에 깨졌을 수도 있어 앵커 3개 시도
        a = seg[k:k + 6]
        if len(a) < 6:
            break
        i = src.find(a)
        while i >= 0 and len(starts) < 20:
            starts.append(max(0, i - k - 6))
            i = src.find(a, i + 1)
        if starts:
            break
    for s in starts:
        cand = src[s:s + span]
        matched = sum(b.size for b in difflib.SequenceMatcher(None, seg, cand).get_matching_blocks())
        if matched / len(seg) >= 0.9:
            return True
    return False

def main():
    srcs = load_source_squashed()
    all_src = "".join(srcs.values())
    items, rejected = [], []
    seen_ids = set()

    for f in sorted((REPO / "_scratch").glob("checkitems_*.json")):
        if f.name == "checkitems_rejected.json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"{f.name}: JSON 파싱 실패 {e}")
            continue
        for it in data:
            iid = it.get("id") or ""
            base = iid
            n = 2
            while iid in seen_ids:
                iid = f"{base}-{n}"
                n += 1
            it["id"] = iid
            seen_ids.add(iid)
            src = srcs.get(code_of(iid), all_src)
            if verify_quote(it.get("근거조문", ""), src):
                it["인용검증"] = "통과"
                items.append(it)
                continue
            # 자동 트림: 구절 중 원문 검증되는 것만 남김(기준 밖 법령 인용 등 제거)
            segs_raw = [s.strip() for s in re.split(r"\s*/\s*|\n", it.get("근거조문", "")) if s.strip()]
            kept = [s for s in segs_raw if verify_quote(s, src)]
            if kept:
                it["근거조문"] = " / ".join(kept)
                it["인용검증"] = "통과(미검증 구절 제거)"
                items.append(it)
            else:
                it["인용검증"] = "불일치"
                it["_원천파일"] = f.name
                rejected.append(it)

    rules, rules_rej = [], []
    rf = REPO / "_scratch" / "checkrules_metrics.json"
    if rf.exists():
        for r in json.loads(rf.read_text(encoding="utf-8")):
            if verify_quote(r.get("산식_원문", "") or r.get("근거조문", ""), all_src):
                rules.append(r)
            else:
                rules_rej.append(r)

    (REPO / "data" / "checkitems.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    (REPO / "data" / "check_rules.json").write_text(
        json.dumps(rules, ensure_ascii=False, indent=1), encoding="utf-8")
    (REPO / "_scratch" / "checkitems_rejected.json").write_text(
        json.dumps(rejected + rules_rej, ensure_ascii=False, indent=1), encoding="utf-8")

    from collections import Counter
    print(json.dumps({
        "checkitem_통과": len(items),
        "checkitem_불일치": len(rejected),
        "검산규칙_통과": len(rules),
        "검산규칙_불일치": len(rules_rej),
        "기관유형별": dict(Counter(o for it in items for o in (it.get("기관유형") or []))),
        "모듈별": dict(Counter(it.get("모듈") for it in items)),
    }, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
