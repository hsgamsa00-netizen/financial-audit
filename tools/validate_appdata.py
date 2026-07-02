# -*- coding: utf-8 -*-
r"""앱 데이터 무결성 게이트(결정론) — 배포 전 실행.
data/*.json이 앱(app.js·tools.js)이 기대하는 스키마를 만족하는지 검사한다.
위반 발견 시 종료코드 1(배포 차단용)."""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
ORGS = {"지자체", "지방공기업", "출자·출연기관"}
MODULES = {"세입", "세출", "보조금·출연금", "재산·물품", "손해·변상", "결산·재무제표", "재무건전성"}
STATES = {"pdf", "pdf_conv", "hwp", "zip", "csd", "none"}
import re
ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")  # 라디오 name·셀렉터에 안전한 문자만
errors = []

def check(cond, msg):
    if not cond:
        errors.append(msg)

def main():
    ci = json.loads((DATA / "checkitems.json").read_text(encoding="utf-8"))
    check(len(ci) >= 150, f"checkitems 수 이상: {len(ci)}")
    ids = set()
    for it in ci:
        check(it.get("id") and it["id"] not in ids, f"checkitem id 중복/누락: {it.get('id')}")
        check(bool(ID_RE.match(it.get("id") or "")), f"checkitem id 특수문자: {it.get('id')}")
        ids.add(it.get("id"))
        check(set(it.get("기관유형") or []) <= ORGS and it.get("기관유형"), f"{it.get('id')}: 기관유형 이상 {it.get('기관유형')}")
        check(it.get("모듈") in MODULES, f"{it.get('id')}: 모듈 이상 {it.get('모듈')}")
        check(len(it.get("착안질문") or "") >= 8, f"{it.get('id')}: 착안질문 부실")
        # 원문 자체가 짧은 문항(예: "예산의 과대집행은 없는가?")이 있으므로 인용검증 통과를 함께 인정
        check(len(it.get("근거조문") or "") >= 15 or str(it.get("인용검증", "")).startswith("통과"),
              f"{it.get('id')}: 근거조문 부실(원문 인용 원칙)")
        check(it.get("난이도") in {"진입", "심화"}, f"{it.get('id')}: 난이도 이상")

    tr = json.loads((DATA / "tie_rules.json").read_text(encoding="utf-8"))
    check(len(tr) >= 25, f"tie_rules 수 이상: {len(tr)}")
    for r in tr:
        check(r.get("기관유형") in ORGS, f"{r.get('id')}: 검산 기관유형 이상 {r.get('기관유형')}")
        check(r.get("좌변") and r.get("우변"), f"{r.get('id')}: 등식 변 누락")
        check(all((s or "").strip() for s in (r.get("좌변") or []) + (r.get("우변") or [])), f"{r.get('id')}: 빈 입력필드명")

    rr = json.loads((DATA / "risk_rules.json").read_text(encoding="utf-8"))
    check(len(rr) >= 80, f"risk_rules 수 이상: {len(rr)}")

    cs = json.loads((DATA / "cases_fin.json").read_text(encoding="utf-8"))
    check(len(cs) >= 10000, f"cases_fin 수 이상: {len(cs)}")
    for c in cs[:200] + cs[-200:]:
        check(c.get("st") in STATES, f"{c.get('id')}: 원문상태 이상 {c.get('st')}")
        check(c.get("se") in {"감사원", "화성"}, f"{c.get('id')}: 계열 이상")
        check(bool(c.get("t")), f"{c.get('id')}: 제목 없음")

    co = json.loads((DATA / "concepts.json").read_text(encoding="utf-8"))
    check(len(co) >= 15, f"concepts 수 이상: {len(co)}")
    for x in co:
        check(bool(x.get("용어")) and bool(x.get("초심자설명")), f"concept {x.get('id')}: 필드 누락")

    if errors:
        print(f"✗ 위반 {len(errors)}건")
        for e in errors[:20]:
            print(" -", e)
        sys.exit(1)
    print(f"✓ 통과 — checkitems {len(ci)} · tie {len(tr)} · risk {len(rr)} · cases {len(cs)} · concepts {len(co)}")

if __name__ == "__main__":
    main()
