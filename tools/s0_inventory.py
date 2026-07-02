# -*- coding: utf-8 -*-
"""S0 자료 인벤토리 파이프라인 — 재무감사 도우미
source_registry(+원문상태) → srno 매핑 → 재무카드 선별(분야 4종+키워드 recall) → 검증 게이트.
결정론적 처리(LLM 0). 로컬 절대경로는 출력물에 기록하지 않는다(루트 라벨 방식).

사용:
  python s0_inventory.py            # 인벤토리 전체(해시 제외)
  python s0_inventory.py --hash     # sha256 해시 채움 + 중복 게이트 갱신
"""
import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DATA = REPO / "data"
PATHS = json.loads((HERE / "local_paths.json").read_text(encoding="utf-8"))

# 원문상태 우선순위(높을수록 우선): 같은 srno에 여러 파일이 있으면 최고 상태를 취한다.
# pdf_conv = HWP에서 배치 변환한 열람용 PDF(변환본 — 페이지 번호가 원본과 다를 수 있음)
STATUS_PRIORITY = {"pdf": 5, "pdf_conv": 4, "hwp": 3, "zip": 2, "csd": 1}
EXT_STATUS = {".pdf": "pdf", ".hwp": "hwp", ".hwpx": "hwp", ".bin": "csd", ".zip": "zip"}

# 재무카드 선별 1차 축 = 분야_통합 4종(최종설계안 §1.2-3, 실측값과 일치 확인)
FIN_FIELDS = {"재정·회계", "세무·징수", "보조금·기금", "공유재산·물품"}

# 2차 recall 보조(코덱스안 §4.2 키워드 그물) — 분야축 미포함 카드 중 재무 신호 탐지용.
FIN_KEYWORDS = [
    "결산", "재무제표", "회계처리", "회계연도", "복식부기", "감가상각", "충당부채",
    "미수금", "미지급", "채권관리", "정산", "세입", "세출예산", "통계목", "성과급",
    "업무추진비", "보조금", "출연금", "기금운용", "변상", "횡령", "과오납", "결손처분",
    "자본잠식", "부채비율", "원가계산", "예산 목적 외", "목적외", "이월", "전용",
    # 표본검증(2026-07-02)에서 확인된 누락 유형 보강: 계약 분야지만 본질이 대가지급·세입인 사례
    "지체상금", "과다지급", "과오지급", "과다 지급", "계약금액 조정",
]
KEYWORD_RE = re.compile("|".join(map(re.escape, FIN_KEYWORDS)))

BAI_NAME_RE = re.compile(r"^(?P<date>\d{8})_\[(?P<atype>[^\]]*)\]_(?P<title>.*)_(?P<srno>\d+)(?:_v\d+)?$")


def scan_sources():
    """원문 3계열 스캔 → registry 행 목록."""
    rows = []

    def add(series, root_label, p: Path, srno, year, audit_type, audit_name, status):
        rows.append({
            "source_id": "",  # 뒤에서 일괄 부여
            "source_series": series,
            "root": root_label,
            "file_name": p.name,
            "ext": p.suffix.lower(),
            "size": p.stat().st_size,
            "sha256": "",
            "srno": srno,
            "year": year,
            "audit_type": audit_type,
            "audit_name": audit_name,
            "원문상태": status,
        })

    bai = Path(PATHS["BAI"])
    for p in sorted(bai.iterdir()):
        if not p.is_file():
            continue
        status = EXT_STATUS.get(p.suffix.lower())
        if not status:
            continue
        m = BAI_NAME_RE.match(p.stem)
        srno = m.group("srno") if m else ""
        year = m.group("date")[:4] if m else ""
        atype = m.group("atype") if m else ""
        aname = m.group("title") if m else p.stem
        add("감사원", "BAI", p, srno, year, atype, aname, status)

    conv_root = PATHS.get("BAI_CONV")
    conv = Path(conv_root) if conv_root else None  # 빈 문자열이 Path('.')가 되어 CWD를 스캔하는 사고 방지
    if conv and conv.is_dir():
        for p in sorted(conv.iterdir()):
            if not p.is_file() or p.suffix.lower() != ".pdf":
                continue
            m = BAI_NAME_RE.match(p.stem)
            add("감사원", "BAI_CONV", p,
                m.group("srno") if m else "",
                m.group("date")[:4] if m else "",
                m.group("atype") if m else "", m.group("title") if m else p.stem,
                "pdf_conv")

    hws = Path(PATHS["HWASEONG"])
    for p in sorted(hws.iterdir()):
        if not p.is_file() or p.suffix.lower() != ".pdf":
            continue
        ym = re.search(r"(20\d{2})", p.stem)
        add("화성", "HWASEONG", p, p.stem, ym.group(1) if ym else "", "", p.stem, "pdf")

    std = Path(PATHS["STANDARDS"])
    for p in sorted(std.iterdir()):
        if not p.is_file() or p.suffix.lower() != ".txt":
            continue
        add("기준·연구", "STANDARDS", p, "", "", "기준·연구", p.stem, "txt")

    for i, r in enumerate(rows, 1):
        r["source_id"] = f"S{i:05d}"
    return rows


def load_cards():
    cards = []
    for i in range(1, 9):
        raw = (Path(PATHS["CARDS"]) / f"cards_p{i}.js").read_text(encoding="utf-8")
        cards.extend(json.loads(raw[raw.index("["):raw.rindex("]") + 1]))
    return cards


def card_series_srno(card):
    """카드의 계열(감사원/화성)과 정규화 srno 문자열."""
    s = card.get("srno")
    if isinstance(s, int):
        return "감사원", str(s)
    if isinstance(s, str) and s.isdigit():
        return "감사원", str(int(s))
    return "화성", (s or "")


def main():
    do_hash = "--hash" in sys.argv
    DATA.mkdir(exist_ok=True)

    registry = scan_sources()

    if do_hash:
        # 해시 전용 패스: 기존 registry를 읽어 sha256만 채우고 중복 게이트 갱신
        reg_path = DATA / "source_registry.csv"
        with reg_path.open(encoding="utf-8-sig", newline="") as f:
            existing = list(csv.DictReader(f))
        by_key = {(r["root"], r["file_name"]): r for r in existing}
        n = skipped = 0
        for r in registry:
            tgt = by_key.get((r["root"], r["file_name"]))
            if tgt is not None and tgt.get("sha256"):
                skipped += 1
                continue  # 기존 해시 보존 — 전량 재해시 낭비 방지
            root_path = PATHS.get(r["root"])
            if not root_path:
                continue
            h = hashlib.sha256()
            with (Path(root_path) / r["file_name"]).open("rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            if tgt is not None:
                tgt["sha256"] = h.hexdigest()
            n += 1
            if n % 300 == 0:
                print(f"hash {n}", flush=True)
        with reg_path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(existing[0].keys()))
            w.writeheader()
            w.writerows(existing)
        dup = defaultdict(list)
        for r in existing:
            if r["sha256"]:
                dup[r["sha256"]].append(f'{r["root"]}/{r["file_name"]}')
        dups = {k: v for k, v in dup.items() if len(v) > 1}
        (DATA / "gate_g5_duplicates.json").write_text(
            json.dumps(dups, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"해시 완료 신규 {n}건(스킵 {skipped}) · 중복그룹 {len(dups)}")
        return

    # ── srno → 최우선 원문상태 색인 (감사원/화성 분리) ──
    best = {}  # (series, srno) -> (status, source_id)
    for r in registry:
        if not r["srno"]:
            continue
        key = (r["source_series"], str(int(r["srno"])) if r["srno"].isdigit() else r["srno"])
        cur = best.get(key)
        if cur is None or STATUS_PRIORITY.get(r["원문상태"], 0) > STATUS_PRIORITY.get(cur[0], 0):
            best[key] = (r["원문상태"], r["source_id"])

    cards = load_cards()

    # ── 재무카드 선별 ──
    fin_by_field, fin_by_kw = [], []
    map_rows = []
    for c in cards:
        series, srno = card_series_srno(c)
        fields = set(c.get("분야") or [])
        in_f4 = bool(fields & FIN_FIELDS)
        kw_hit = ""
        if not in_f4:
            sub = c.get("소주제") or ""
            if isinstance(sub, list):
                sub = " ".join(map(str, sub))
            text = " ".join([
                c.get("제목") or "", c.get("요지") or "",
                " ".join(map(str, c.get("위반유형_원") or [])), sub,
            ])
            m = KEYWORD_RE.search(text)
            if m:
                kw_hit = m.group(0)
        if in_f4:
            fin_by_field.append(c)
        elif kw_hit:
            fin_by_kw.append((c, kw_hit))

        status, sid = best.get((series, srno), ("none", ""))
        map_rows.append({
            "card_id": c.get("id"),
            "series": series,
            "srno": srno,
            "source_id": sid,
            "match_method": "srno" if sid else "",
            "원문상태": status,
            "재무선별": "분야축" if in_f4 else ("recall" if kw_hit else ""),
            "needs_review": "Y" if status == "none" else "",
        })

    # ── 출력: registry (기존 sha256 보존 — 일반 패스가 해시를 초기화해 --hash 스킵이 무효화되는 것 방지) ──
    reg_path = DATA / "source_registry.csv"
    if reg_path.exists():
        with reg_path.open(encoding="utf-8-sig", newline="") as f:
            old_hash = {(r["root"], r["file_name"]): r.get("sha256", "")
                        for r in csv.DictReader(f)}
        for r in registry:
            if not r["sha256"]:
                r["sha256"] = old_hash.get((r["root"], r["file_name"]), "")
    with reg_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(registry[0].keys()))
        w.writeheader()
        w.writerows(registry)

    # ── 출력: case_source_map (전 카드) ──
    with (DATA / "case_source_map.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(map_rows[0].keys()))
        w.writeheader()
        w.writerows(map_rows)

    # ── 출력: 재무카드 선별 목록 ──
    fin_list = [{
        "card_id": c.get("id"), "srno": card_series_srno(c)[1],
        "series": card_series_srno(c)[0], "선별축": "분야축",
        "분야": c.get("분야"), "연도": c.get("연도"), "제목": c.get("제목"),
    } for c in fin_by_field] + [{
        "card_id": c.get("id"), "srno": card_series_srno(c)[1],
        "series": card_series_srno(c)[0], "선별축": f"recall:{kw}",
        "분야": c.get("분야"), "연도": c.get("연도"), "제목": c.get("제목"),
    } for c, kw in fin_by_kw]
    (DATA / "finance_cards.json").write_text(
        json.dumps(fin_list, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 게이트 ──
    fin_ids = {x["card_id"] for x in fin_list}
    fin_map = [m for m in map_rows if m["card_id"] in fin_ids]
    g1 = Counter((m["series"], m["원문상태"]) for m in fin_map)
    card_srnos = {(m["series"], m["srno"]) for m in map_rows}
    g2 = [k for k in best if k not in card_srnos]  # 원문 있는데 카드 없음
    field_missing = Counter()
    short_cards = 0
    for c in fin_by_field:
        for fld in ("근거페이지", "금액", "처분종류", "연도"):
            v = c.get(fld)
            if not v:
                field_missing[fld] += 1
        if len(c.get("요지") or "") < 30:
            short_cards += 1
    # G4: 기준·연구 텍스트 품질
    g4 = []
    for r in registry:
        if r["source_series"] != "기준·연구":
            continue
        t = (Path(PATHS["STANDARDS"]) / r["file_name"]).read_text(encoding="utf-8", errors="replace")
        bad = t.count("�")
        if len(t) == 0 or bad / max(len(t), 1) > 0.01:
            g4.append(r["file_name"])
    # G7: map 상태 무결성(자체 검산)
    g7_bad = sum(1 for m in map_rows if m["source_id"] and
                 best.get((m["series"], m["srno"]), ("none",))[0] != m["원문상태"])
    # G8: HWP 변환 대상 = 재무카드가 참조하는 감사원 문서 중 상태 hwp
    hwp_srnos = {m["srno"] for m in fin_map if m["series"] == "감사원" and m["원문상태"] == "hwp"}
    g8_files = sorted({r["file_name"] for r in registry
                       if r["source_series"] == "감사원" and r["원문상태"] == "hwp"
                       and r["srno"] and str(int(r["srno"])) in hwp_srnos})

    summary = {
        "카드총수": len(cards),
        "재무카드": {"분야축": len(fin_by_field), "recall보조": len(fin_by_kw), "계": len(fin_list)},
        "원문파일": Counter(r["source_series"] for r in registry),
        "원문상태분포_전카드": Counter(m["원문상태"] for m in map_rows),
        "원문상태분포_재무카드": Counter(m["원문상태"] for m in fin_map),
        "G1_재무카드_원문없음": {f"{k[0]}/{k[1]}": v for k, v in sorted(g1.items())},
        "G2_원문있는데_카드없음": len(g2),
        "G3_재무카드_필드결측(분야축)": dict(field_missing),
        "G4_기준텍스트_불량": g4,
        "G6_요지30자미만(분야축)": short_cards,
        "G7_상태정합오류": g7_bad,
        "G8_HWP변환대상_재무참조문서": len(g8_files),
    }
    (DATA / "s0_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "gate_g2_unreferenced_sources.json").write_text(
        json.dumps(sorted(f"{a}/{b}" for a, b in g2), ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "gate_g8_hwp_targets.json").write_text(
        json.dumps(g8_files, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
