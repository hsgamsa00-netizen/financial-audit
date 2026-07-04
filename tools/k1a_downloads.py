# -*- coding: utf-8 -*-
"""K1a: 행안부·KIPF·NABO·서울시 직접 다운로드 (LLM 불요·결정론)."""
import re, sys, urllib.request, urllib.parse
from pathlib import Path

K1 = Path(r"C:\Users\koojinkyu\Desktop\감사원 사례\기준수집_K1")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def get(url, binary=True, referer=None):
    h = dict(UA)
    if referer: h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")

def save(path: Path, data: bytes, min_kb=30):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    kb = len(data) / 1024
    ok = kb >= min_kb and not data[:200].lstrip().lower().startswith((b"<!doctype", b"<html"))
    print(f"{'OK ' if ok else 'BAD'} {path.name} · {kb:,.0f}KB")
    return ok

def mois_board(url, outdir, tag):
    """행안부 게시글에서 FileDown 첨부 추출 후 전부 다운로드."""
    html = get(url, binary=False)
    # 첨부 링크 패턴: FileDown.do?atchFileId=...&fileSn=N (fn_egov_downFile('ID','SN') 포함)
    links = set(re.findall(r"FileDown\.do\?atchFileId=([^&'\"]+)&(?:amp;)?fileSn=(\d+)", html))
    links |= set(re.findall(r"fn_egov_downFile\('([^']+)'\s*,\s*'(\d+)'\)", html))
    names = re.findall(r'([^<>"/\\|:*?]+\.(?:pdf|hwp|hwpx|zip|xlsx))', html, re.I)
    print(f"[{tag}] 첨부 {len(links)}개 발견 · 파일명 후보 {len(set(names))}")
    got = 0
    for i, (fid, sn) in enumerate(sorted(links)):
        dl = f"https://www.mois.go.kr/cmm/fms/FileDown.do?atchFileId={urllib.parse.quote(fid)}&fileSn={sn}"
        try:
            data = get(dl, referer=url)
            # 파일명: Content-Disposition 대신 순번+태그
            ext = ".bin"
            head = data[:8]
            if head.startswith(b"%PDF"): ext = ".pdf"
            elif head.startswith(b"PK"): ext = ".hwpx.zip_or_hwpx"  # hwpx/xlsx/zip 공통 — 뒤에서 판별
            elif head.startswith(b"\xd0\xcf"): ext = ".hwp"
            if ext == ".hwpx.zip_or_hwpx":
                ext = ".hwpx" if b"Contents/section" in data[:200000] or b"mimetypeapplication/hwp" in data[:400] else ".zip"
            out = outdir / f"{tag}_{i+1}{ext}"
            if save(out, data): got += 1
        except Exception as e:
            print(f"ERR {tag}#{i+1}: {e}")
    return got

jobs_mois = [
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000061&nttId=122660", "회계관리훈령416"),
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=122484", "예산편성운영기준2026"),
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=122796", "지방보조금관리기준2026"),
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000018&nttId=99471", "업무추진비규칙해설집"),
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000062&nttId=123365", "지방공기업예산편성기준2026"),
    ("https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000062&nttId=123366", "출자출연예산편성지침2026"),
]
total = 0
for url, tag in jobs_mois:
    try: total += mois_board(url, K1 / "mois", tag)
    except Exception as e: print(f"ERR 게시글 {tag}: {e}")

# 직링크류
direct = [
    ("https://www.nabo.go.kr/board/file/down.do?fid=33318770", K1 / "etc" / "NABO_2025대한민국지방재정.pdf"),
    ("https://news.seoul.go.kr/gov/files/2026/04/69eff7cbe003c9.28308441.pdf", K1 / "etc" / "서울시_투자출연기관_감사사례집_2026.pdf"),
]
for url, out in direct:
    try:
        if save(out, get(url), min_kb=100): total += 1
    except Exception as e: print(f"ERR {out.name}: {e}")

# KIPF 오류유형 보고서: 페이지에서 첨부 추출
try:
    kurl = "https://www.kipf.re.kr/bbs/gafsc_publication_Opinion/view.do?nttId=B000000014825Ol1nR4q"
    html = get(kurl, binary=False)
    m = re.findall(r'href="([^"]*(?:download|fileDown|atchFile)[^"]*)"', html, re.I)
    print(f"[KIPF] 링크 후보 {len(m)}")
    for i, link in enumerate(m[:3]):
        full = urllib.parse.urljoin(kurl, link.replace("&amp;", "&"))
        data = get(full, referer=kurl)
        if data[:4] == b"%PDF":
            save(K1 / "kipf" / "KIPF_국가재무제표_오류유형분석_2020.pdf", data); total += 1; break
except Exception as e:
    print(f"ERR KIPF: {e}")

print(f"\n=== K1a 완료: {total}건 저장 ===")
