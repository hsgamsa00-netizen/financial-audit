# -*- coding: utf-8 -*-
"""K2-0: 기준수집_K1 전 수집물 텍스트화 — ZIP 해제·PDF(fitz)·HWPX(zip+정규식)·HWP(텍스트 불가시 스킵 기록).
산출: 기준수집_K1/_text/<원폴더>__<파일명>.txt ([[p.N]] 페이지 앵커 · PII 주민번호 방어 마스킹)"""
import re, zipfile, io, sys
from pathlib import Path
import fitz

K1 = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\기준수집_K1")
OUT = K1 / "_text"; OUT.mkdir(exist_ok=True)
mask = lambda t: re.sub(r"\d{6}-\d{7}", "******-*******", t)

def pdf_text(data: bytes) -> str:
    doc = fitz.open(stream=data, filetype="pdf")
    parts = [f"\n[[p.{i}]]\n" + p.get_text() for i, p in enumerate(doc, 1)]
    n = doc.page_count; doc.close()
    return "".join(parts), n

def hwpx_text(data: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(data))
    secs = sorted(n for n in z.namelist() if re.search(r"section\d+\.xml$", n, re.I))
    out = []
    for n in secs:
        xml = z.read(n).decode("utf-8", "replace")
        for para in re.split(r"</hp:p>", xml):
            ts = re.findall(r"<hp:t(?:\s[^>]*)?>(.*?)</hp:t>", para, re.S)
            line = re.sub(r"<[^>]+>", "", "".join(ts))
            import html as _h
            line = _h.unescape(line).strip()
            if line: out.append(line)
    return "\n".join(out), len(secs)

done = skip = 0
for f in sorted(K1.rglob("*")):
    if not f.is_file() or f.parent == OUT or f.parent.name in ("_text", "로컬추출"): continue
    rel = f"{f.parent.name}__{f.stem}"
    out = OUT / (rel[:120] + ".txt")
    if out.exists(): continue
    data = f.read_bytes()
    try:
        texts = []
        if f.suffix.lower() == ".zip" or (data[:2] == b"PK" and f.suffix.lower() != ".hwpx"):
            # ZIP: 내부 PDF/HWPX 전개
            z = zipfile.ZipFile(io.BytesIO(data))
            for name in z.namelist():
                inner = z.read(name)
                if inner[:4] == b"%PDF":
                    t, n = pdf_text(inner); texts.append(f"\n===[{name}·{n}p]===\n" + t)
                elif inner[:2] == b"PK" and name.lower().endswith(".hwpx"):
                    t, n = hwpx_text(inner); texts.append(f"\n===[{name}]===\n" + t)
        elif data[:4] == b"%PDF":
            t, n = pdf_text(data); texts.append(t)
        elif f.suffix.lower() == ".hwpx" or (data[:2] == b"PK" and b"Contents/section" in data[:300000]):
            t, n = hwpx_text(data); texts.append(t)
        elif f.suffix.lower() == ".xml":
            t = data.decode("utf-8", "replace")
            # DRF XML: 태그 제거 조문 텍스트 + 원문 보존은 원파일 참조
            body = re.sub(r"<[^>]+>", "\n", t)
            body = re.sub(r"\n{3,}", "\n\n", body)
            texts.append(body)
        else:
            skip += 1; print(f"SKIP(형식) {rel}{f.suffix}"); continue
        full = mask("\n".join(texts)).strip()
        if len(full) < 500:
            skip += 1; print(f"SKIP(빈약 {len(full)}자) {rel}"); continue
        out.write_text(full, encoding="utf-8")
        done += 1
        if done % 10 == 0: print(f"... {done}건")
    except Exception as e:
        skip += 1; print(f"ERR {rel}: {repr(e)[:60]}")
print(f"\n=== K2-0 완료: 텍스트 {done}건 · 스킵 {skip}건 → {OUT} ===")
