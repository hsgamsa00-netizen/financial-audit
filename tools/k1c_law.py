# -*- coding: utf-8 -*-
"""K1c(v2): 법제처 DRF — lawSearch(검색)→ID→lawService(본문) 2단계·http 스킴 (fetch_law.py 작동 패턴)."""
import json, time, urllib.request, urllib.parse
from pathlib import Path

OC = Path(r"C:\AuditApp\haengjeong-giljabi\.law_oc").read_text(encoding="utf-8").strip()
K1 = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\기준수집_K1\law")
K1.mkdir(parents=True, exist_ok=True)

def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def jget(url):
    return json.loads(get(url).decode("utf-8", "replace"))

def collect(name, target):
    q = urllib.parse.quote(name)
    s = jget(f"http://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target={target}&query={q}&type=JSON&display=10")
    if target == "law":
        items = (s.get("LawSearch") or {}).get("law") or []
    else:
        items = (s.get("AdmRulSearch") or {}).get("admrul") or []
    items = items if isinstance(items, list) else [items]
    nm_key = "법령명한글" if target == "law" else "행정규칙명"
    best = next((it for it in items if (it.get(nm_key) or "").strip().replace(" ", "") == name.replace(" ", "")
                 and it.get("현행연혁코드", "현행") == "현행"), None) or (items[0] if items else None)
    if not best:
        print(f"미발견 {name}"); return False
    if target == "law":
        key = best.get("법령일련번호") or best.get("법령ID")
        body = get(f"http://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={key}&type=XML")
    else:
        key = best.get("행정규칙일련번호") or best.get("행정규칙ID")
        body = get(f"http://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={key}&type=XML")
    real_nm = (best.get(nm_key) or name).strip()
    out = K1 / f"{'법령' if target=='law' else '행정규칙'}_{real_nm.replace(' ', '_').replace('/', '_')[:60]}.xml"
    out.write_bytes(body)
    ok = len(body) > 5000
    print(f"{'OK ' if ok else '?소형'} {real_nm} · {len(body)/1024:.0f}KB (시행 {best.get('시행일자','?')})")
    return ok

LAWS = ["지방회계법", "지방회계법 시행령", "지방자치단체 회계기준에 관한 규칙", "지방재정법", "지방재정법 시행령",
        "지방공기업법", "지방공기업법 시행령", "지방공기업법 시행규칙", "지방자치단체 업무추진비 집행에 관한 규칙",
        "지방자치단체 보조금 관리에 관한 법률", "국가회계기준에 관한 규칙", "의료기관 회계기준 규칙",
        "지방자치단체 출자·출연 기관의 운영에 관한 법률", "지방회계법 시행규칙"]
RULES = ["지방자치단체 회계관리에 관한 훈령", "지방자치단체 복식부기·재무회계 운영규정", "지방자치단체 예산편성 운영기준",
         "공익법인회계기준", "공공감사기준", "중앙행정기관 및 지방자치단체 자체감사기준", "감사원 감사사무 처리규칙",
         "공공기관의 회계감사 및 결산감사에 관한 규칙", "재무제표 세부 작성방법", "지방보조금 관리기준",
         "지방자치단체 기금운용계획 수립기준", "지방상수도요금산정요령"]

n1 = n2 = 0
for x in LAWS:
    try: n1 += collect(x, "law")
    except Exception as e: print(f"ERR {x}: {repr(e)[:70]}")
    time.sleep(0.4)
for x in RULES:
    try: n2 += collect(x, "admrul")
    except Exception as e: print(f"ERR {x}: {repr(e)[:70]}")
    time.sleep(0.4)
print(f"\n=== K1c 완료: 법령 {n1}/{len(LAWS)} · 행정규칙 {n2}/{len(RULES)} ===")
