# -*- coding: utf-8 -*-
r"""HWP → PDF 배치 변환 (재무카드 참조 문서, G8 대상)
체인: pyhwp hwp5html → headless Chrome print-to-pdf.
산출: <BAI>\..\PDF_변환\<원파일명>.pdf (원본 HWP 무변경). 실패는 로그 후 계속.

사용: python hwp_batch_convert.py [--limit N] [--workers N]
"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PATHS = json.loads((HERE / "local_paths.json").read_text(encoding="utf-8"))
BAI = Path(PATHS["BAI"])
OUT = BAI.parent / "PDF_변환"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HWP5HTML = Path(sys.executable).parent / "Scripts" / "hwp5html.exe"
LOG = REPO / "_scratch" / "conv_progress.log"
FAIL = REPO / "_scratch" / "conv_failures.json"


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


TIMEOUT = 300


def convert_one(name: str) -> tuple[str, str]:
    src = BAI / name
    dst = OUT / (Path(name).stem + ".pdf")
    if dst.exists() and dst.stat().st_size > 10_000:
        return name, "skip(있음)"
    tmp = Path(tempfile.mkdtemp(prefix="hwpconv_"))
    try:
        r = subprocess.run([str(HWP5HTML), "--output", str(tmp / "html"), str(src)],
                           capture_output=True, timeout=TIMEOUT)
        idx = tmp / "html" / "index.xhtml"
        if not idx.exists():
            return name, f"fail(hwp5html rc={r.returncode})"
        r2 = subprocess.run([
            CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
            f"--user-data-dir={tmp / 'chrome'}",
            f"--print-to-pdf={dst}", idx.as_uri(),
        ], capture_output=True, timeout=TIMEOUT)
        if dst.exists() and dst.stat().st_size > 10_000:
            return name, "ok"
        return name, f"fail(chrome rc={r2.returncode})"
    except subprocess.TimeoutExpired:
        return name, "fail(timeout)"
    except Exception as e:  # noqa: BLE001
        return name, f"fail({type(e).__name__})"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    global TIMEOUT
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 3
    if "--timeout" in sys.argv:
        TIMEOUT = int(sys.argv[sys.argv.index("--timeout") + 1])
    targets = json.loads((REPO / "data" / "gate_g8_hwp_targets.json").read_text(encoding="utf-8"))
    if limit:
        targets = targets[:limit]
    OUT.mkdir(exist_ok=True)
    (REPO / "_scratch").mkdir(exist_ok=True)
    log(f"시작 — 대상 {len(targets)}건, workers {workers}")
    t0 = time.time()
    done = ok = 0
    fails = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(convert_one, n): n for n in targets}
        for fut in as_completed(futs):
            name, status = fut.result()
            done += 1
            if status.startswith(("ok", "skip")):
                ok += 1
            else:
                fails.append({"file": name, "status": status})
            if done % 20 == 0 or done == len(targets):
                el = time.time() - t0
                eta = el / done * (len(targets) - done)
                log(f"진행 {done}/{len(targets)} 성공 {ok} 실패 {len(fails)} · 경과 {el/60:.0f}분 · 남은 예상 {eta/60:.0f}분")
    FAIL.write_text(json.dumps(fails, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"완료 — 성공 {ok}/{len(targets)}, 실패 {len(fails)}건은 conv_failures.json")


if __name__ == "__main__":
    main()
