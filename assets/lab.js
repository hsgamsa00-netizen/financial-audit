/* 재무감사 도우미 — 자료 대조실(lab)
   알파라이저식 전수 대조를 브라우저-로컬로 수행. 파일은 이 브라우저 메모리에만 올라가며
   서버 전송이 없다(정적 웹·CSP connect-src 'self'). 원자료·중간 테이블은 저장하지 않는다.
   결과는 자동 점검 「후보」이며 최종 판단은 감사자가 원자료·증빙으로 확인한다. */
'use strict';
(function () {
  const { esc, show } = window.FA;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => (isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '-');

  /* ── 표준 테이블 유형·필드·동의어 사전(실측: 화성시연구원·여가재단 2020-2026 자료) ── */
  const TYPES = {
    pay: {
      label: '지급명령', icon: '🧾',
      kw: ['지급명령'],
      fields: {
        no: { nm: '명령번호', syn: ['명령번호', '지급번호'] },
        date: { nm: '지급일자', syn: ['지급일자', '지급일'] },
        amt: { nm: '지급금액', syn: ['지급금액', '지급액'] },
        acct: { nm: '출금계좌', syn: ['출금계좌', '출금계좌번호'] },
        biz: { nm: '사업명', syn: ['사업명', '세부사업'] },
        budget: { nm: '예산과목', syn: ['예산과목명', '예산과목', '통계목'] },
        desc: { nm: '적요', syn: ['적요', '내용', '건명'] },
        resol: { nm: '결의번호', syn: ['결의번호'] },
      },
      need: ['date', 'amt'],
    },
    bank: {
      label: '통장거래', icon: '🏦',
      kw: ['입출금', '거래내역', '통장'],
      fields: {
        date: { nm: '거래일자', syn: ['거래일자', '거래일', '거래일시'] },
        out: { nm: '출금액', syn: ['출금액', '출금', '찾으신금액', '지급금액', '출금금액'] },
        inn: { nm: '입금액', syn: ['입금액', '입금', '맡기신금액', '입금금액'] },
        bal: { nm: '잔액', syn: ['잔액', '거래후잔액'] },
        desc: { nm: '적요', syn: ['적요', '내용', '기재내용', '거래내용', '거래기록사항'] },
        time: { nm: '거래시각', syn: ['거래시각', '시간', '거래시간'] },
        acct: { nm: '계좌번호', syn: ['계좌번호'] },
      },
      need: ['date', 'out'],
    },
    card: {
      label: '카드사용', icon: '💳',
      kw: ['카드'],
      fields: {
        date: { nm: '매출일자', syn: ['매출일자', '사용일자', '이용일자', '승인일자'] },
        amt: { nm: '매출금액', syn: ['매출금액', '이용금액', '승인금액', '사용금액'] },
        mer: { nm: '가맹점명', syn: ['가맹점명', '가맹점', '이용가맹점'] },
        cardno: { nm: '카드번호', syn: ['카드번호'] },
        kind: { nm: '매출구분', syn: ['매출구분', '거래구분'] },
        time: { nm: '승인시각', syn: ['승인시각', '승인시간', '이용시간', '매출시간'] },
      },
      need: ['date', 'amt'],
    },
    payroll: {
      label: '급여·보수', icon: '💰',
      kw: ['급여', '보수'],
      fields: {
        name: { nm: '사원', syn: ['사원', '성명', '사원명', '이름'] },
        pid: { nm: '사번', syn: ['사번', '사원번호'] },
        dept: { nm: '부서', syn: ['부서', '부서명', '소속'] },
        month: { nm: '귀속월', syn: ['귀속월', '적용연월', '지급월', '급여월'] },
        total: { nm: '지급총액', syn: ['지급총액', '지급계', '급여총액', '보수총액'] },
        net: { nm: '실지급액', syn: ['실지급액', '차인지급액', '차감지급액'] },
      },
      need: ['name'],
    },
    ot: {
      label: '시간외수당', icon: '⏱', kw: ['시간외', '초과', '휴일'],
      fields: {
        name: { nm: '사원', syn: ['사원', '사원명', '성명', '이름'] },
        dept: { nm: '부서', syn: ['부서', '부서명'] },
        hours: { nm: '시간외시간', syn: ['시간외시간', '시간외근무시간', '초과시간', '시간외수당지급시간'] },
        amt: { nm: '시간외수당', syn: ['시간외근무수당', '시간외수당'] },
        nightAmt: { nm: '야간수당', syn: ['야간근무수당', '야간수당'] },
        total: { nm: '지급총액', syn: ['지급총액', '합계', '총지급액'] },
        rate: { nm: '단가(통상임금)', syn: ['통상임금', '시간외단가', '단가', '시간당'] },
      },
      need: ['name'],
    },
  };

  /* ── 상태(메모리 전용 — 저장 안 함) ── */
  const L = { files: [], tables: {}, results: null, nameKeys: {} };

  /* ── 유틸 ── */
  const norm = (s) => String(s ?? '').replace(/[\s \n\r()（）]/g, '').toLowerCase();
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return isoD(v);
    if (typeof v === 'number' && v > 20000 && v < 60000) { // 엑셀 시리얼
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isoD(d);
    }
    const s = String(v).trim();
    let m = s.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  function isoD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function toAmt(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/[,원\s]/g, '');
    const neg = /^[△▲(-]/.test(s);
    if (neg) s = s.replace(/^[△▲(-]/, '').replace(/\)$/, '');
    const n = parseFloat(s);
    return isFinite(n) ? (neg ? -n : n) : null;
  }
  const acctKey = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-6) : ''; };
  const maskAcct = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d ? '****' + d.slice(-4) : ''; };
  function nameKey(nm) { // 실명 → 내부키(표시·내보내기 공통 마스킹)
    const s = String(nm ?? '').trim();
    if (!s) return '';
    if (!L.nameKeys[s]) L.nameKeys[s] = 'P-' + String(Object.keys(L.nameKeys).length + 1).padStart(3, '0');
    return L.nameKeys[s];
  }
  const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
  const isWeekend = (iso) => { const d = new Date(iso).getDay(); return d === 0 || d === 6; };

  /* ── 파일 시그니처 판별 ── */
  function sniff(buf, name) {
    const u = new Uint8Array(buf.slice(0, 512));
    if (u[0] === 0x50 && u[1] === 0x4B) return 'xlsx';
    if (u[0] === 0xD0 && u[1] === 0xCF) return 'xls-ole';
    if (u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46) return 'pdf';
    const head = new TextDecoder('utf-8', { fatal: false }).decode(u).trim().toLowerCase();
    if (head.startsWith('<html') || head.startsWith('<!doctype') || head.includes('<table')) return 'html';
    if (/\.(csv|txt)$/i.test(name) || head.includes(',')) return 'csv';
    if (head.startsWith('<')) return 'html';
    return 'unknown';
  }

  /* ── 파서: 각 파일 → 시트 목록 [{sheet, aoa, meta}] ── */
  function parseXlsx(buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    return wb.SheetNames.map(sn => ({
      sheet: sn,
      aoa: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null }),
      meta: {},
    })).filter(t => t.aoa.length > 1);
  }
  function decodeBuf(buf) {
    let txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const badRatio = (txt.match(/�/g) || []).length / Math.max(txt.length, 1);
    if (badRatio > 0.01) { try { txt = new TextDecoder('euc-kr').decode(buf); } catch { /* utf-8 유지 */ } }
    return txt;
  }
  function parseHtml(buf) {
    const doc = new DOMParser().parseFromString(decodeBuf(buf), 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    const meta = {};
    const bodyTxt = doc.body ? doc.body.textContent : '';
    const am = bodyTxt.match(/계좌번호\s*[:：]?\s*([\d\-*]{6,})/);
    if (am) meta.계좌번호 = am[1];
    const out = [];
    tables.forEach((tb, i) => {
      const aoa = [...tb.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim()));
      if (aoa.length > 2 && Math.max(...aoa.map(r => r.length)) >= 3) out.push({ sheet: 'html표' + (i + 1), aoa, meta });
    });
    // 거래 본문일 가능성이 큰 표(행수 최다) 우선
    out.sort((a, b) => b.aoa.length - a.aoa.length);
    return out.slice(0, 3);
  }
  function parseCsv(buf) {
    const txt = decodeBuf(buf);
    const sep = (txt.split('\t').length > txt.split(',').length) ? '\t' : ',';
    const aoa = txt.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()));
    return [{ sheet: 'csv', aoa, meta: {} }];
  }

  /* ── 헤더 탐지(병합 2행 헤더 대응) + 데이터 추출 ── */
  function detectTable(aoa) {
    const strScore = (r) => (r || []).filter(c => typeof c === 'string' && c.trim() && !/^\d+$/.test(c.trim())).length;
    let hi = 0, best = -1;
    for (let i = 0; i < Math.min(aoa.length, 12); i++) { const s = strScore(aoa[i]); if (s > best) { best = s; hi = i; } }
    let header = (aoa[hi] || []).map(c => String(c ?? '').trim());
    // 병합 상위행(고유값 적음) + 하위행 조합(여가재단 은행식: 순번/거래정보/금액정보 + 세부)
    const next = aoa[hi + 1] || [];
    const uniq = new Set(header.filter(Boolean)).size;
    if (uniq <= 5 && strScore(next) >= uniq && strScore(next) >= 3) {
      let last = '';
      header = header.map((c, j) => {
        if (c) last = c;
        const sub = String(next[j] ?? '').trim();
        return sub ? (last && last !== sub ? last + ' ' + sub : sub) : (c || last);
      });
      hi += 1;
    }
    const rows = [];
    for (let i = hi + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      if (!r.some(c => c !== null && c !== '' && c !== undefined)) continue;
      const f = String(r[0] ?? '').replace(/\s/g, '');
      if (/^(합계|총계|소계)/.test(f)) continue;
      rows.push({ i: i + 1, c: r }); // i = 원자료 행번호(1기점)
    }
    return { header, rows, headerRow: hi + 1 };
  }

  /* ── 유형 분류 + 컬럼 자동 매핑 ── */
  function classify(fileName, header) {
    const fn = norm(fileName);
    const scores = {};
    Object.entries(TYPES).forEach(([k, t]) => {
      let s = 0;
      t.kw.forEach(w => { if (fn.includes(norm(w))) s += 4; });
      Object.values(t.fields).forEach(f => f.syn.forEach(syn => { if (header.some(h => norm(h).includes(norm(syn)))) { s += 1; } }));
      scores[k] = s;
    });
    const bestK = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
    return scores[bestK] >= 3 ? bestK : null;
  }
  function autoMap(typeK, header) {
    const map = {};
    Object.entries(TYPES[typeK].fields).forEach(([fk, f]) => {
      let idx = -1;
      for (const syn of f.syn) {
        idx = header.findIndex(h => norm(h) === norm(syn));
        if (idx >= 0) break;
      }
      if (idx < 0) for (const syn of f.syn) {
        idx = header.findIndex(h => norm(h).includes(norm(syn)));
        if (idx >= 0) break;
      }
      if (idx >= 0) map[fk] = idx;
    });
    return map;
  }

  /* ── 파일 수용(메모리) ── */
  async function ingestFiles(fileList) {
    const files = [...fileList];
    for (const f of files) {
      const rec = { name: f.name, size: f.size, status: '읽는 중', type: null, sheets: [], reason: '' };
      L.files.push(rec);
      renderStatus();
      try {
        const buf = await f.arrayBuffer();
        const sig = sniff(buf, f.name);
        if (sig === 'pdf') { rec.status = '판독불가'; rec.reason = 'PDF는 자동 판독 정확도가 낮습니다 — 원시 엑셀/CSV를 요구하십시오.'; continue; }
        if (sig === 'unknown') { rec.status = '실패'; rec.reason = '파일 형식을 판별하지 못했습니다.'; continue; }
        const parsed = (sig === 'xlsx' || sig === 'xls-ole') ? parseXlsx(buf) : sig === 'html' ? parseHtml(buf) : parseCsv(buf);
        if (!parsed.length) { rec.status = '실패'; rec.reason = '표를 찾지 못했습니다.'; continue; }
        rec.sig = sig;
        parsed.forEach(p => {
          const t = detectTable(p.aoa);
          if (!t.rows.length) return;
          const typeK = classify(f.name + ' ' + p.sheet, t.header);
          rec.sheets.push({ file: f.name, sheet: p.sheet, header: t.header, rows: t.rows, meta: p.meta, typeK, map: typeK ? autoMap(typeK, t.header) : {} });
        });
        rec.type = rec.sheets.length ? (rec.sheets.find(s => s.typeK) || {}).typeK : null;
        rec.status = rec.sheets.length ? '읽음' : '부분';
        if (!rec.sheets.length) rec.reason = '데이터 행을 찾지 못했습니다.';
      } catch (e) {
        rec.status = '실패'; rec.reason = '파싱 오류: ' + (e && e.message || e);
      }
      await new Promise(r => setTimeout(r, 0)); // UI 양보
      renderStatus();
    }
    renderMapping();
  }

  /* ── 표준 레코드 추출 ── */
  function collect(typeK) {
    const out = [];
    L.files.forEach(f => f.sheets.forEach(sh => {
      if (sh.typeK !== typeK) return;
      const m = sh.map;
      sh.rows.forEach(r => {
        const g = (fk) => (m[fk] != null ? r.c[m[fk]] : null);
        out.push({ file: sh.file, sheet: sh.sheet, row: r.i, meta: sh.meta, g, raw: r.c });
      });
    }));
    return out;
  }

  /* ═══ 자동 점검 엔진(전부 결정론 · 결과는 「후보」) ═══ */
  function runTests() {
    const R = { cands: [], info: [], counts: { '직접 매칭': 0, '추가 확인': 0, '복수 후보': 0, '미확인': 0 } };
    const pays = collect('pay').map(x => ({
      date: toDate(x.g('date')), amt: toAmt(x.g('amt')), acct: acctKey(x.g('acct')), acctRaw: x.g('acct'),
      no: x.g('no'), biz: String(x.g('biz') ?? ''), budget: String(x.g('budget') ?? ''), desc: String(x.g('desc') ?? ''),
      file: x.file, row: x.row,
    })).filter(p => p.date && p.amt != null);
    const banks = collect('bank').map(x => ({
      date: toDate(x.g('date')), out: toAmt(x.g('out')), desc: String(x.g('desc') ?? ''),
      acct: acctKey(x.g('acct') ?? x.meta.계좌번호 ?? x.sheet), file: x.file, sheet: x.sheet, row: x.row, used: false,
    })).filter(b => b.date && b.out != null && b.out > 0);
    const cards = collect('card').map(x => ({
      date: toDate(x.g('date')), amt: toAmt(x.g('amt')), mer: String(x.g('mer') ?? ''), kind: String(x.g('kind') ?? ''),
      time: String(x.g('time') ?? ''), file: x.file, row: x.row,
    })).filter(c => c.date && c.amt != null);

    const add = (test, level, title, why, src, next, soothe) =>
      R.cands.push({ test, level, title, why, src, next, soothe });

    /* T001·T002 지급명령-통장출금 단계 매칭 */
    if (pays.length && banks.length) {
      const byAmt = {};
      banks.forEach(b => { (byAmt[b.out] = byAmt[b.out] || []).push(b); });
      pays.forEach(p => {
        const pool = byAmt[p.amt] || [];
        const same = pool.filter(b => b.date === p.date);
        const acctHit = same.filter(b => p.acct && b.acct && (b.acct.endsWith(p.acct.slice(-4)) || p.acct.endsWith(b.acct.slice(-4))));
        if (acctHit.length === 1) { R.counts['직접 매칭'] += 1; acctHit[0].used = true; return; }
        if (acctHit.length > 1 || same.length > 1) {
          R.counts['복수 후보'] += 1;
          add('T001 대조', '복수 후보', `지급명령 ${esc(String(p.no ?? ''))} — 동일 조건 출금 ${Math.max(acctHit.length, same.length)}건`,
            `같은 날짜(${p.date})·같은 금액(${fmt(p.amt)}원)의 통장 출금이 여러 건입니다.`,
            `${p.file} ${p.row}행`, '적요·결의번호로 해당 출금 특정', '같은 날 같은 금액의 정당한 반복 지급일 수 있음');
          return;
        }
        if (same.length === 1) { R.counts['직접 매칭'] += 1; same[0].used = true; return; }
        const near = pool.filter(b => dayDiff(b.date, p.date) <= 3);
        if (near.length) {
          R.counts['추가 확인'] += 1;
          add('T002 ±3일', '추가 확인', `지급명령 ${esc(String(p.no ?? ''))} — 출금일 차이(${near[0].date})`,
            `지급일(${p.date})과 실제 출금일이 다릅니다(금액 ${fmt(p.amt)}원 일치).`,
            `${p.file} ${p.row}행 ↔ ${near[0].file} ${near[0].row}행`, '지연 사유·회계처리일 확인', '주말·은행 처리일 지연일 수 있음');
          return;
        }
        R.counts['미확인'] += 1;
        add('T001 대조', '미확인', `지급명령 ${esc(String(p.no ?? ''))} — ${fmt(p.amt)}원 (${p.date})`,
          '같은 조건(±3일 포함)의 통장 출금이 자동 확인되지 않았습니다.',
          `${p.file} ${p.row}행 · ${esc(p.desc.slice(0, 30))}`, '지출결의서·묶음지급 여부·통장 조회기간 확인', '여러 지급명령이 한 출금으로 묶였거나 조회기간 밖일 수 있음');
      });

      /* T101 묶음지급(동일 일자 미확인 지급명령 합계 = 미사용 출금) */
      const unPay = {}, unBank = {};
      pays.forEach(p => { /* 미확인만 다시 수집 */ });
      const unmatched = R.cands.filter(c => c.level === '미확인');
      const payByDate = {};
      pays.forEach(p => { (payByDate[p.date] = payByDate[p.date] || []).push(p); });
      Object.entries(payByDate).forEach(([d, list]) => {
        const freeBank = banks.filter(b => !b.used && b.date === d);
        if (!freeBank.length || list.length < 2 || list.length > 14) return;
        const daySum = list.reduce((s, p) => s + p.amt, 0);
        freeBank.forEach(b => {
          if (b.out === daySum) add('T101 묶음지급', '추가 확인', `${d} 지급명령 ${list.length}건 합계 = 출금 1건(${fmt(b.out)}원)`,
            '여러 지급명령이 하나의 통장 출금으로 묶였을 가능성이 있습니다.', `${b.file} ${b.row}행`, '이체 명세·집계표 확인', '급여·세금·카드대금 일괄 이체는 정상 관행');
          else if (list.length <= 10) { // 2건 조합
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
              if (list[i].amt + list[j].amt === b.out) {
                add('T101 묶음지급', '추가 확인', `${d} 지급명령 2건 합(${fmt(b.out)}원) = 출금 1건`,
                  `명령 ${esc(String(list[i].no ?? ''))}+${esc(String(list[j].no ?? ''))} 합계가 출금과 일치합니다.`,
                  `${b.file} ${b.row}행`, '이체 명세 확인', '동일 수취인 묶음 이체 가능'); return;
              }
            }
          }
        });
      });
    } else if (pays.length || banks.length) {
      R.info.push('지급명령·통장거래가 모두 있어야 대조(T001)가 실행됩니다 — 현재 ' + (pays.length ? '통장거래' : '지급명령') + ' 자료가 없습니다.');
    }

    /* T003 반복 지급 그룹 */
    {
      const g = {};
      collect('pay').forEach(x => {
        const d = toDate(x.g('date')), a = toAmt(x.g('amt'));
        if (!d || a == null) return;
        const k = `${d}|${a}|${acctKey(x.g('acct'))}`;
        (g[k] = g[k] || []).push({ x, desc: String(x.g('desc') ?? '') });
      });
      Object.entries(g).filter(([, v]) => v.length >= 2).forEach(([k, v]) => {
        const [d, a] = k.split('|');
        const exempt = v.some(e => /급여|수당|보험|연금|원천|세금|공과|임차료|사용료/.test(e.desc));
        add('T003 반복지급', exempt ? '추가 확인' : '복수 후보',
          `${d} 동일 금액(${fmt(+a)}원) ${v.length}건 반복`,
          '같은 날짜·금액·계좌의 지급이 반복되어 중복 또는 분할 여부 확인이 필요합니다.' + (exempt ? ' (적요상 정기성 지급 가능)' : ''),
          v.map(e => `${e.x.file} ${e.x.row}행`).join(' · ').slice(0, 120), '결의서·수취인 대조', '다수 대상자 동일 금액 지급(수당 등)은 정상');
      });
    }

    /* T004 명령번호 연속성 */
    {
      const nos = pays.map(p => parseInt(String(p.no ?? '').replace(/\D/g, ''), 10)).filter(n => isFinite(n)).sort((a, b) => a - b);
      if (nos.length > 10) {
        const dup = nos.filter((n, i) => i && n === nos[i - 1]).length;
        let gaps = 0;
        for (let i = 1; i < nos.length; i++) if (nos[i] - nos[i - 1] > 1) gaps += nos[i] - nos[i - 1] - 1;
        if (dup || gaps) R.info.push(`T004 명령번호: 중복 ${dup}건 · 결번 ${gaps}개 — 번호 체계(연도 리셋·시스템별 채번)를 확인한 뒤 판단하십시오.`);
        else R.info.push('T004 명령번호: 중복·결번 없음.');
      }
    }

    /* T102 분할 의심(동일 사업·과목 7일 내 반복) */
    {
      const g = {};
      pays.forEach(p => { if (p.biz || p.budget) { const k = p.biz + '|' + p.budget; (g[k] = g[k] || []).push(p); } });
      Object.entries(g).forEach(([k, v]) => {
        if (v.length < 2) return;
        v.sort((a, b) => a.date < b.date ? -1 : 1);
        for (let i = 0; i + 1 < v.length; i++) {
          let j = i, sum = v[i].amt;
          while (j + 1 < v.length && dayDiff(v[j + 1].date, v[i].date) <= 7) { j++; sum += v[j].amt; }
          if (j - i + 1 >= 3) {
            add('T102 분할의심', '추가 확인', `${esc(k.split('|')[0].slice(0, 24))} — 7일 내 ${j - i + 1}건(합 ${fmt(sum)}원)`,
              '같은 사업·예산과목에서 근접일자 반복 지급 — 분할 발주(금액기준 회피) 여부 확인이 필요합니다.',
              `${v[i].file} ${v[i].row}행 외`, '계약·발주 단위 확인(수의계약 레시피 R-33)', '단계별 기성·정기 지급은 정상');
            i = j;
          }
        }
      });
    }

    /* T103 예산과목-적요 불일치 후보(보수적 사전) */
    {
      const RULES = [
        { kw: /기념품|판촉|홍보물/, ex: /사무관리|홍보|행사/, nm: '기념품·홍보물' },
        { kw: /간담회|오찬|만찬|다과|식대/, ex: /업무추진|급량|행사|회의/, nm: '식비성 지출' },
        { kw: /노트북|컴퓨터|프린터|비품|장비구입/, ex: /자산|취득|비품/, nm: '자산성 물품' },
      ];
      pays.forEach(p => {
        RULES.forEach(r => {
          if (r.kw.test(p.desc) && p.budget && !r.ex.test(p.budget)) {
            add('T103 과목-적요', '추가 확인', `${esc(r.nm)} 적요 ↔ 「${esc(p.budget.slice(0, 20))}」`,
              '적요 성격과 예산과목이 달라 보입니다 — 지출결의서와 예산편성 기준 확인이 필요합니다.',
              `${p.file} ${p.row}행 · ${esc(p.desc.slice(0, 30))}`, '예산과목 사전(편성목·통계목)과 대조', '기관 편성 기준상 적정일 수 있음');
          }
        });
      });
    }

    /* T104 월말·연말 집중 */
    if (pays.length >= 30) {
      const byBud = {};
      pays.forEach(p => { const k = p.budget || '(과목없음)'; const dd = +p.date.slice(8); (byBud[k] = byBud[k] || { n: 0, sum: 0, late: 0, dec: 0 }); byBud[k].n++; byBud[k].sum += p.amt; if (dd >= 25) byBud[k].late += p.amt; if (p.date.slice(5, 7) === '12') byBud[k].dec += p.amt; });
      Object.entries(byBud).filter(([, v]) => v.n >= 5 && v.sum > 0).forEach(([k, v]) => {
        if (v.late / v.sum >= 0.6) add('T104 월말집중', '추가 확인', `「${esc(k.slice(0, 22))}」 월말(25일 이후) 집행 ${(v.late / v.sum * 100).toFixed(0)}%`,
          '특정 과목의 지출이 월말에 집중 — 예산 소진성 집행·검수 전 지출 여부 확인이 필요합니다.', `${v.n}건 · 합 ${fmt(v.sum)}원`, '검수·납품 시점 대조', '월말 정기 지급(임차료 등)은 정상');
      });
    }

    /* T105 집중도(정보 제공) */
    if (pays.length >= 20) {
      const g = {};
      pays.forEach(p => { const k = (p.desc.split(/[ (\[]/)[0] || '(적요없음)').slice(0, 14); (g[k] = g[k] || { n: 0, sum: 0 }); g[k].n++; g[k].sum += p.amt; });
      const top = Object.entries(g).sort((a, b) => b[1].sum - a[1].sum).slice(0, 8);
      R.info.push('T105 지급 집중 상위(적요 기준): ' + top.map(([k, v]) => `${k}(${v.n}건·${fmt(v.sum)}원)`).join(' · '));
    }

    /* T204 카드 이상 후보 */
    if (cards.length) {
      cards.forEach(c => {
        if (isWeekend(c.date) && c.amt >= 100000) add('T204 카드', '추가 확인', `휴일 사용 ${fmt(c.amt)}원 — ${esc(c.mer.slice(0, 16))}`,
          `휴일(${c.date}) 고액 카드 사용입니다.`, `${c.file} ${c.row}행`, '사용 목적·출장/행사 근거 확인', '휴일 행사·비상근무는 정상');
        const hm = c.time.match(/(\d{1,2})[:시]/);
        if (hm && (+hm[1] >= 23 || +hm[1] < 5)) add('T204 카드', '추가 확인', `심야 사용 ${fmt(c.amt)}원 — ${esc(c.mer.slice(0, 16))}`,
          `심야(${esc(c.time)}) 사용입니다.`, `${c.file} ${c.row}행`, '사용자·목적 확인', '');
      });
      const g = {};
      cards.forEach(c => { const k = c.date + '|' + c.mer; (g[k] = g[k] || []).push(c); });
      Object.entries(g).filter(([, v]) => v.length >= 2).forEach(([k, v]) => {
        add('T204 카드', '추가 확인', `동일일·동일 가맹점 ${v.length}건(합 ${fmt(v.reduce((s, c) => s + c.amt, 0))}원)`,
          '같은 날 같은 가맹점 반복 결제 — 분할 결제(한도 회피) 여부 확인이 필요합니다.',
          `${v[0].file} ${v.map(c => c.row).join(',')}행 · ${esc(v[0].mer.slice(0, 16))}`, '결제 시각·품목 확인', '테이블 분리 결제 등 정상 사유 가능');
      });
      /* T205 카드대금 대조(간이 표) */
      const mon = {};
      cards.forEach(c => { const m = c.date.slice(0, 7); mon[m] = (mon[m] || 0) + c.amt; });
      R.info.push('T205 카드 월별 사용 합계: ' + Object.entries(mon).sort().map(([m, s]) => `${m} ${fmt(s)}원`).join(' · ') + ' — 지급명령의 카드대금 건과 대조하십시오.');
    }

    /* T201·T202 시간외수당 */
    {
      const ots = collect('ot').map(x => ({
        key: nameKey(x.g('name')), dept: String(x.g('dept') ?? ''), hours: toAmt(x.g('hours')),
        amt: toAmt(x.g('amt')), rate: toAmt(x.g('rate')), sheet: x.sheet, file: x.file, row: x.row,
      })).filter(o => o.key);
      const mult = parseFloat(($('#labOtMult') || {}).value) || 1.5;
      let calcN = 0;
      ots.forEach(o => {
        if (o.rate && o.hours != null && o.amt != null) {
          calcN += 1;
          const calc = Math.round(o.rate * o.hours * mult);
          if (Math.abs(calc - o.amt) > 1000) add('T201 시간외산식', '추가 확인', `${o.key} — 재계산 차이 ${fmt(o.amt - calc)}원`,
            `단가×시간×${mult} 재계산(${fmt(calc)}원)과 지급액(${fmt(o.amt)}원)이 다릅니다.`,
            `${o.file} [${o.sheet}] ${o.row}행`, '근무명령서·산식 기준(배율·통상임금 산정) 확인', '수당 상한·분 단위 절사 등 기준 차이 가능');
        }
      });
      if (ots.length && !calcN) R.info.push('T201: 단가(통상임금) 컬럼이 매핑되지 않아 산식 재계산을 건너뜀 — 매핑을 보완하거나 산정 기준 자료를 요구하십시오.');
      const per = {};
      ots.forEach(o => { if (o.amt != null) (per[o.key] = per[o.key] || []).push({ m: o.sheet, amt: o.amt + (0) }); });
      Object.entries(per).forEach(([k, v]) => {
        if (v.length < 4) return;
        const amts = v.map(x => x.amt).sort((a, b) => a - b);
        const med = amts[Math.floor(amts.length / 2)];
        const mx = v.reduce((a, b) => a.amt > b.amt ? a : b);
        if (med > 0 && mx.amt >= med * 2.5 && mx.amt >= 300000) add('T202 시간외급증', '추가 확인', `${k} — ${esc(String(mx.m).slice(0, 12))} ${fmt(mx.amt)}원(중위 ${fmt(med)}원)`,
          '특정 월 시간외수당이 평월 대비 급증했습니다.', '시트별 월 합산', '근무명령·출퇴근 기록 대조', '사업 성수기·행사월 집중은 정상 가능');
      });
    }

    /* T203 급여 월별 변동·중복 */
    {
      const prs = collect('payroll').map(x => ({
        key: nameKey(x.g('name')), pid: String(x.g('pid') ?? ''), month: String(x.g('month') ?? x.sheet ?? ''),
        total: toAmt(x.g('total')) ?? toAmt(x.g('net')), file: x.file, row: x.row,
      })).filter(p => p.key && p.total != null);
      const per = {};
      prs.forEach(p => { (per[p.key] = per[p.key] || []).push(p); });
      Object.values(per).forEach(v => {
        // 동일 귀속월 중복 행
        const mm = {};
        v.forEach(p => { (mm[p.month] = mm[p.month] || []).push(p); });
        Object.entries(mm).filter(([, w]) => w.length >= 2 && w[0].month).forEach(([m, w]) => {
          add('T203 급여', '추가 확인', `${w[0].key} — 동일 귀속월(${esc(String(m).slice(0, 10))}) ${w.length}행`,
            '같은 사람·같은 귀속월 급여 행이 중복됩니다(재정산·소급이면 정상).', w.map(p => `${p.file} ${p.row}행`).join(' · ').slice(0, 100), '재정산 근거 확인', '소급·정정 지급 가능');
        });
        // 월별 급변(30%+ & 30만+)
        const sv = v.filter(p => p.month).sort((a, b) => a.month < b.month ? -1 : 1);
        for (let i = 1; i < sv.length; i++) {
          const a = sv[i - 1].total, b = sv[i].total;
          if (a > 0 && Math.abs(b - a) / a >= 0.3 && Math.abs(b - a) >= 300000)
            add('T203 급여', '추가 확인', `${sv[i].key} — ${esc(String(sv[i].month).slice(0, 10))} 급여 ${b > a ? '급증' : '급감'}(${fmt(a)}→${fmt(b)}원)`,
              '월별 급여 총액이 30% 이상 변동했습니다.', `${sv[i].file} ${sv[i].row}행`, '임용·승진·퇴직·수당 변경 근거 확인', '입·퇴사, 성과급 지급월은 정상');
        }
      });
    }

    L.results = R;
    renderResults();
  }

  /* ═══ 렌더 ═══ */
  function renderStatus() {
    const box = $('#labFiles');
    if (!box) return;
    if (!L.files.length) { box.innerHTML = '<div class="view-p">아직 넣은 파일이 없습니다.</div>'; return; }
    const ST = { '읽음': 'rv-ok', '부분': 'rv-warn', '판독불가': 'rv-warn', '실패': 'rv-bad', '읽는 중': '' };
    box.innerHTML = `<table class="xt"><tr><th>파일</th><th>유형</th><th>판독</th><th>표·행</th><th>비고</th></tr>${
      L.files.map(f => `<tr><td>${esc(f.name.slice(0, 42))}</td><td>${f.type ? esc(TYPES[f.type].icon + ' ' + TYPES[f.type].label) : '-'}</td>
        <td><span class="risk-v ${ST[f.status] || ''}">${esc(f.status)}</span></td>
        <td>${f.sheets.length ? `${f.sheets.length}표 · ${fmt(f.sheets.reduce((s, x) => s + x.rows.length, 0))}행` : '-'}</td>
        <td>${esc(f.reason || '')}</td></tr>`).join('')}</table>
      <div class="m">T005 판독 상태 — 읽지 못한 자료는 자동 점검에서 빠집니다. 결과 과신을 막기 위해 반드시 확인하십시오.</div>`;
  }
  function renderMapping() {
    const box = $('#labMap');
    if (!box) return;
    const byType = {};
    L.files.forEach(f => f.sheets.forEach(sh => { if (sh.typeK) (byType[sh.typeK] = byType[sh.typeK] || []).push(sh); }));
    if (!Object.keys(byType).length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3 class="home-sub">② 컬럼 매핑 확인 — 자동 제안이 틀린 것만 고치십시오</h3>' + Object.entries(byType).map(([tk, sheets]) => {
      const t = TYPES[tk];
      const rep = sheets[0]; // 대표 시트 기준(같은 유형은 같은 매핑 적용)
      return `<div class="chk"><div class="q">${t.icon} ${esc(t.label)} <span class="b b-lvl">${sheets.length}표 · ${fmt(sheets.reduce((s, x) => s + x.rows.length, 0))}행</span></div>
        <div class="risk-grid">${Object.entries(t.fields).map(([fk, f]) => `
          <div class="fld"><label>${esc(f.nm)}${(t.need || []).includes(fk) ? ' *' : ''}</label>
          <select data-lab-map="${tk}|${fk}"><option value="">(없음)</option>${rep.header.map((h, i) => `<option value="${i}" ${rep.map[fk] === i ? 'selected' : ''}>${esc(String(h).slice(0, 18) || '(열' + (i + 1) + ')')}</option>`).join('')}</select></div>`).join('')}
        </div></div>`;
    }).join('');
    box.querySelectorAll('[data-lab-map]').forEach(sel => sel.addEventListener('change', () => {
      const [tk, fk] = sel.dataset.labMap.split('|');
      L.files.forEach(f => f.sheets.forEach(sh => { if (sh.typeK === tk) { if (sel.value === '') delete sh.map[fk]; else sh.map[fk] = +sel.value; } }));
    }));
    $('#labRunBar').hidden = false;
  }
  function renderResults() {
    const box = $('#labOut');
    const R = L.results;
    if (!R) { box.innerHTML = ''; return; }
    const lv = { '직접 매칭': 'rv-ok', '추가 확인': 'rv-warn', '복수 후보': 'rv-warn', '미확인': 'rv-bad' };
    let h = `<h3 class="home-sub">③ 점검 결과 — 자동 점검 「후보」입니다</h3>
      <div class="chk"><div class="q">대조 요약 (T001·T002)</div><div class="co-t">${Object.entries(R.counts).map(([k, v]) => `<span class="risk-v ${lv[k]}" style="margin-right:14px">${k} ${fmt(v)}건</span>`).join('')}</div>
      <div class="m">미확인·복수 후보는 부적정 판정이 아니라 원자료·증빙으로 확인할 후보입니다.</div></div>`;
    if (R.info.length) h += `<div class="chk"><div class="q">참고 집계</div>${R.info.map(i => `<div class="co-li">▸ ${esc(i)}</div>`).join('')}</div>`;
    const byTest = {};
    R.cands.forEach(c => { (byTest[c.test] = byTest[c.test] || []).push(c); });
    h += Object.entries(byTest).map(([test, list]) => `
      <details class="quote-fold"${list.length <= 8 ? ' open' : ''}><summary>${esc(test)} — 후보 ${list.length}건</summary>${
      list.slice(0, 300).map((c, i) => `<div class="chk"><div class="q">${c.title} <span class="b b-lvl">${esc(c.level)}</span></div>
        <div class="co-t">${esc(c.why)}</div>
        <div class="m">원자료: ${esc(c.src)}</div>
        <div class="rule">먼저 확인: ${esc(c.next)}</div>
        ${c.soothe ? `<div class="m">정상 소명 가능성: ${esc(c.soothe)}</div>` : ''}
        <div class="chips"><button class="chip" data-lab-exc="${esc(test)}|${i}">🚩 예외로 등록(조서 연계)</button></div></div>`).join('')
      }${list.length > 300 ? `<div class="m">… 외 ${list.length - 300}건은 CSV 내보내기로 확인</div>` : ''}</details>`).join('');
    h += `<div class="btnbar"><button class="btn line" id="labCsv">⬇ 결과 내보내기(.csv · 마스킹)</button></div>
      <div class="note">이 결과는 자동 점검 <b>후보</b>입니다. 최종 판단 전 원자료·증빙·내부규정·현행 기준을 확인하십시오. 미확인은 부적정을 뜻하지 않습니다. 분석은 이 브라우저 안에서만 수행되었고 파일·결과는 저장되지 않았습니다(내보내기 제외).</div>`;
    box.innerHTML = h;
    box.querySelectorAll('[data-lab-exc]').forEach(b => b.addEventListener('click', (e) => {
      const [test, i] = b.dataset.labExc.split('|');
      const c = (byTest[test] || [])[+i];
      if (!c) return;
      if (window.FA_TOOLS && window.FA_TOOLS.excAdd) {
        window.FA_TOOLS.excAdd({ src: '대조실', 이름: `${test}: ${c.title.replace(/<[^>]*>/g, '')}`.slice(0, 80), 근거: '자료 대조실 자동 점검(' + test + ')', 내용: `${c.why} [원자료: ${c.src}]`.slice(0, 300) });
        e.target.textContent = '✓ 등록됨'; e.target.disabled = true;
      }
    }));
    const csvBtn = $('#labCsv');
    if (csvBtn) csvBtn.addEventListener('click', () => {
      const rows = [['테스트', '등급', '제목', '사유', '원자료', '먼저 확인']];
      R.cands.forEach(c => rows.push([c.test, c.level, c.title.replace(/<[^>]*>/g, ''), c.why, c.src, c.next]));
      const csv = '﻿' + rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `대조실결과_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    show('lab');
    renderStatus(); renderMapping(); renderResults();
  }

  /* ── 이벤트 ── */
  const inp = $('#labFile'), dirInp = $('#labDir');
  if (inp) inp.addEventListener('change', (e) => { ingestFiles(e.target.files); e.target.value = ''; });
  if (dirInp) dirInp.addEventListener('change', (e) => { ingestFiles([...e.target.files].filter(f => /\.(xlsx|xls|csv|txt)$/i.test(f.name))); e.target.value = ''; });
  const pick = $('#labPick'), pickDir = $('#labPickDir');
  if (pick) pick.addEventListener('click', () => inp.click());
  if (pickDir) pickDir.addEventListener('click', () => dirInp.click());
  const run = $('#labRun');
  if (run) run.addEventListener('click', runTests);
  const clr = $('#labClear');
  if (clr) clr.addEventListener('click', () => { L.files = []; L.tables = {}; L.results = null; L.nameKeys = {}; render(); $('#labRunBar').hidden = true; });

  window.FA_LAB = {
    render,
    _ingest: ingestFiles,   // 테스트 훅
    _run: runTests,
    _state: L,
  };
})();
