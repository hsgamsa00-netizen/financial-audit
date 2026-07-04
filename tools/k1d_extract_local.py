# -*- coding: utf-8 -*-
"""K1d: 로컬 회계지식 원문(회계감리·적정성점검·결산검사) 텍스트 추출 + 지적목차 스캔."""
import re, glob
from pathlib import Path
import fitz

BAI = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\PDF")
OUT = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\기준수집_K1\etc\로컬추출")
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = ["*3318*.pdf", "*3052*.pdf", "*2905*.pdf", "*3288*.pdf"]
for pat in TARGETS:
    for f in glob.glob(str(BAI / pat)):
        p = Path(f)
        doc = fitz.open(f)
        parts = []
        for i, pg in enumerate(doc, 1):
            parts.append(f"\n[[p.{i}]]\n" + pg.get_text())
        n = doc.page_count; doc.close()
        text = "".join(parts)
        # 실명 마스킹은 불필요(감사원 공개문은 이미 가명·직위 처리) — 만일의 주민번호 패턴만 방어
        text = re.sub(r"\d{6}-\d{7}", "******-*******", text)
        out = OUT / (p.stem + ".txt")
        out.write_text(text, encoding="utf-8")
        # 지적항목 목차 추출(간단 휴리스틱: 목차부 '…' 라인·번호붙은 제목)
        toc = [ln.strip() for ln in text[:20000].split("\n")
               if re.match(r"^\s*(\d+[\.\)]\s|[가-힣]+\s*\d+\s*[\.\)]).{6,60}$", ln) and ("계상" in ln or "회계" in ln or "부적정" in ln or "과소" in ln or "과대" in ln or "충당" in ln or "자산" in ln)]
        print(f"OK {p.name} · {n}p · {len(text):,}자 · 지적후보 {len(toc)}")
        for t in toc[:12]: print("   -", t[:70])
print("=== K1d 완료 ===")
