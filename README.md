# 재무감사 도우미 (가칭)

지자체·지방공기업·출자·출연기관의 재무회계 감사를 처음 수행하는 감사자를 위한 **절차·점검 유도형** 업무 보조 도구.

- 아키텍처: **정적 웹 + 빌드타임 지식화 + 런타임 LLM 0** — 수치 검산·법조문·산식은 전부 결정론적 처리
- 진입 UX: **기관유형 3분기 강제**(지자체 일반회계 / 지방공기업 / 출자·출연기관) → 5모듈 × 계정과목 플레이북 × 감사 4단계
- 신뢰 규범: 근거 4단계 라벨(기준 직접/사례 직접/유사/미확인) + 원문상태 배지 4종(pdf/hwp/csd/none) 이중 라벨
- 자매 프로젝트: [감사 길잡이](https://hsgamsa00-netizen.github.io/Giljabi/) — 데이터·디자인 토큰·인프라 공유, 상호 deep-link

## 구조

```
assets/tokens.css      디자인 토큰(감사 길잡이 KRDS 계열 상속 + 재무 확장)
data/                  S0 자료 인벤토리 산출물(등록부·매핑·선별·게이트)
tools/                 빌드타임 파이프라인 스크립트(결정론·LLM 0)
docs/                  문서
```

## 데이터 산출물 (S0)

| 파일 | 내용 |
|---|---|
| `data/source_registry.csv` | 원문 등록부(계열·연도·srno·sha256·원문상태) — 경로는 루트 라벨 방식 |
| `data/case_source_map.csv` | 사례카드↔원문 srno 자동 매핑(전 카드) |
| `data/finance_cards.json` | 재무카드 선별 목록(분야축 + 키워드 recall 보조) |
| `data/s0_summary.json` · `data/gate_*.json` | 검증 게이트 결과 |
| `data/gate_report.md` | 게이트 리포트(사람용) |

로컬 실행: `tools/local_paths.json.example`을 `local_paths.json`으로 복사해 경로 기입 후 `python tools/s0_inventory.py`.

---
본 도구는 감사 판단을 대신하지 않으며, 기준·사례·원문 출처를 표시하는 업무 보조 자료입니다.
