/* 재무감사 도우미 — 도구 뷰(검산기·위험·사례·처분트리·워크시트·조서)
   전부 결정론(런타임 LLM 0). 입력값·응답·예외는 localStorage(이 PC)에만 저장. */
'use strict';
(function () {
  const { esc, show } = window.FA;
  const $ = (s) => document.querySelector(s);
  const orgOf = () => window.FA.S.org;

  /* ── 지연 로딩: cache=진행 중 Promise(중복 fetch 방지) / dataStore=해석 완료 값(동기 접근용).
       실패는 비캐시 → 재진입 시 재시도 ── */
  const cache = {};
  const dataStore = {};
  function load(name) {
    if (cache[name]) return cache[name];
    cache[name] = (async () => {
      try {
        const r = await fetch('data/' + name);
        if (!r.ok) throw new Error(String(r.status));
        const val = await r.json();
        dataStore[name] = val;
        return val;
      } catch {
        delete cache[name];
        return null;
      }
    })();
    return cache[name];
  }
  const LOAD_FAIL = '<div class="chk">⚠ 데이터를 불러오지 못했습니다. 네트워크 확인 후 다시 열어 주십시오.</div>';

  /* ── 예외 항목 관리(localStorage) ── */
  function excAll() {
    try { return JSON.parse(localStorage.getItem('fa_exc:' + orgOf()) || '[]'); } catch { return []; }
  }
  function excSave(list) { localStorage.setItem('fa_exc:' + orgOf(), JSON.stringify(list)); }
  function excAdd(e) {
    const list = excAll();
    list.push({ ...e, 상태: '미해결', 메모: '', 연도: String(new Date().getFullYear()), ts: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    excSave(list);
  }

  // 클립보드: 비보안 컨텍스트(내부망 http)에서도 동작하도록 폴백
  async function copyText(t) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; }
    } catch { /* 폴백으로 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove(); return ok;
    } catch { return false; }
  }

  const fmt = (n) => (isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '-');
  // 한국 회계 관행 음수 표기(△, 괄호) 정규화 + 첫 번째 숫자 그룹만 사용
  // (전각 문자 제거 방식은 "1,234,567원1)" → 12345671처럼 자릿수가 붙는 오류가 있어 금지)
  const num = (v) => {
    let s = String(v || '').trim();
    const neg = /^[△▲(-]/.test(s);
    if (neg) s = s.slice(1).replace(/\)$/, '');
    const m = s.match(/\d[\d,]*(?:\.\d+)?/);
    const n = m ? parseFloat(m[0].replace(/,/g, '')) : 0;
    return neg ? -n : n;
  };

  /* ═══ 검산기 ═══ */
  function tieVals() {
    try { return JSON.parse(localStorage.getItem('fa_tie:' + orgOf()) || '{}'); } catch { return {}; }
  }
  async function renderTie() {
    // 뷰를 먼저 열고 채운다(지연 응답이 다른 뷰를 강탈하지 않도록)
    show('tie');
    const box = $('#tieList');
    $('#tieTitle').textContent = '정합성 검산기 (cross-tie)';
    if (!dataStore['tie_rules.json']) box.innerHTML = '<div class="chk">불러오는 중…</div>';
    const data = await load('tie_rules.json');
    if (!data) { box.innerHTML = LOAD_FAIL; return; }
    const org = orgOf();
    const rules = data.filter(r => r.기관유형 === org);
    $('#tieTitle').textContent = `정합성 검산기 (cross-tie) — ${org} ${rules.length}종`;
    box.innerHTML = rules.length ? '' : '<div class="chk">이 기관유형의 등식형 검산규칙이 없습니다.</div>';
    const saved = tieVals();
    rules.forEach(r => {
      const d = document.createElement('div');
      d.className = 'chk';
      const inp = (side, i, nm) => `<div class="fld"><label>${esc(nm)} (원)</label><input data-side="${side}" data-i="${i}" inputmode="numeric" aria-label="${esc(nm)}"></div>`;
      d.innerHTML = `
        <div class="q">${esc(r.이름)}</div>
        <div class="meta"><span class="b b-ev">기준 직접근거</span><span class="b b-lvl">${esc(r.출처파일.replace('.txt', '').replace(/\s*\(\d+\)$/, ''))}</span></div>
        <details class="quote-fold"><summary>근거조문(원문) 보기</summary><div class="quote">${esc(r.근거조문)}</div></details>
        <div class="tie-grid">
          <div class="tie-side">${r.좌변.map((nm, i) => inp('L', i, nm)).join('')}</div>
          <div class="tie-eq">=</div>
          <div class="tie-side">${r.우변.map((nm, i) => inp('R', i, nm)).join('')}</div>
        </div>
        <div class="tie-foot">
          <span class="verdict" data-v hidden></span>
          <button class="btn line" data-exc hidden>🚩 예외로 등록</button>
        </div>`;
      const calc = () => {
        const sum = (side) => [...d.querySelectorAll(`input[data-side="${side}"]`)].reduce((s, x) => s + num(x.value), 0);
        const touched = [...d.querySelectorAll('input[data-side]')].some(x => x.value.trim());
        const v = d.querySelector('[data-v]'); const eb = d.querySelector('[data-exc]');
        // 입력이 바뀌면 등록 버튼을 새 상태로 리셋(직전 등록 잔존 방지)
        eb.disabled = false; eb.textContent = '🚩 예외로 등록';
        if (!touched) { v.hidden = true; eb.hidden = true; return; }
        const diff = sum('L') - sum('R');
        v.hidden = false;
        if (Math.abs(diff) < 0.5) { v.className = 'verdict ok'; v.textContent = '✓ 일치'; eb.hidden = true; }
        else {
          v.className = 'verdict bad';
          v.textContent = `✗ 불일치 ${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}원 · 조정내역 설명 요구`;
          eb.hidden = false;
          eb.onclick = () => {
            // 재현 가능하도록 항목별 입력값을 함께 보존(제3자 검증용)
            const detail = [...d.querySelectorAll('input[data-side]')].map(x => ({
              side: x.dataset.side, name: (x.getAttribute('aria-label') || ''), val: x.value,
            }));
            excAdd({ src: '검산', 이름: r.이름, 내용: `좌변 ${fmt(sum('L'))} ≠ 우변 ${fmt(sum('R'))}`, 금액차이: diff, 근거: r.근거조문, 입력값: detail });
            eb.textContent = '✓ 예외 등록됨'; eb.disabled = true;
            let go = d.querySelector('[data-go-report]');
            if (!go) {
              go = document.createElement('button');
              go.className = 'chip'; go.setAttribute('data-go-report', '');
              go.textContent = '조서에서 확인 →';
              go.addEventListener('click', () => window.FA_TOOLS.open('report'));
              eb.parentElement.appendChild(go);
            }
          };
        }
      };
      // 입력 영속화: 재진입·새로고침에도 입력값 유지
      const vals = saved[r.id] || {};
      d.querySelectorAll('input[data-side]').forEach(x => {
        const key = x.dataset.side + x.dataset.i;
        if (vals[key] != null) x.value = vals[key];
        x.addEventListener('input', calc); // 판정은 즉시
        x.addEventListener('change', () => { // 저장은 포커스 아웃 시(키 입력마다 전체 blob 직렬화 방지)
          const all = tieVals();
          all[r.id] = all[r.id] || {};
          all[r.id][key] = x.value;
          localStorage.setItem('fa_tie:' + org, JSON.stringify(all));
        });
      });
      calc(); // 복원값 즉시 판정
      box.appendChild(d);
    });
  }

  /* ═══ 위험 스크리닝 ═══ */
  // 임계값: 「지방자치단체 결산 통합기준」 재정위험 판단 지표(원문 실측). dir: over=초과 시 위험 / under=미만 시 위험
  const RISK6 = [
    { nm: '예산대비채무비율(%)', warn: 25, grave: 40, dir: 'over' },
    { nm: '채무상환비비율(%)', warn: 12, grave: 17, dir: 'over' },
    { nm: '지방세 징수액 현황(%)', warn: 50, grave: 0, dir: 'under' },
    { nm: '금고잔액 현황(%)', warn: 20, grave: 10, dir: 'under' },
    { nm: '공기업 부채비율(%)', warn: 400, grave: 600, dir: 'over' },
  ];
  async function renderRisk() {
    show('risk'); // 선표시(지연 응답의 뷰 강탈 방지)
    const w = $('#riskWidgets');
    if (!dataStore['risk_rules.json']) w.innerHTML = '<div class="chk">불러오는 중…</div>';
    const refs = await load('risk_rules.json');
    if (!refs) { w.innerHTML = LOAD_FAIL; $('#riskRef').innerHTML = ''; return; }
    // 내부통제 예비평가(점검표 「내부통제」) 응답 → 통제위험(CR) 기본값 제안
    const icItems = (window.FA.items() || []).filter(it => it.모듈 === '내부통제' && (it.기관유형 || []).includes(orgOf()));
    const icResp = window.FA.respAll();
    const icAns = icItems.filter(it => icResp[it.id] && icResp[it.id].a && icResp[it.id].a !== '해당없음');
    const icNo = icAns.filter(it => icResp[it.id].a === '아니오').length;
    let crDef = '0.7', icNote;
    if (icAns.length >= 5) {
      const ratio = icNo / icAns.length;
      crDef = ratio >= 0.3 ? '1' : ratio >= 0.1 ? '0.7' : '0.4';
      icNote = `내부통제 예비평가 응답 ${icAns.length}건 중 미비(아니오) ${icNo}건 → 통제위험 기본값 「${crDef === '1' ? '높음' : crDef === '0.7' ? '중간' : '낮음'}」 제안(직접 조정 가능)`;
    } else {
      icNote = '내부통제 예비평가 응답이 아직 부족합니다 — 점검표 「내부통제」를 먼저 수행하면 통제위험(CR) 기본값을 제안합니다.';
    }
    const crSel = (v) => crDef === v ? ' selected' : '';
    w.innerHTML = `<div class="chk"><div class="q">재정위험 판단 지표 (주의/심각)</div><div class="meta"><span class="b b-ev">기준 직접근거</span><span class="b b-lvl">지자체 결산 통합기준</span></div><div class="risk-grid">${
      RISK6.map((r, i) => `<div class="fld"><label>${esc(r.nm)}</label><input data-risk="${i}" inputmode="decimal" aria-label="${esc(r.nm)}"><span class="risk-v" data-rv="${i}"></span><span class="risk-th">주의 ${r.warn}% ${r.dir === 'over' ? '초과' : '미만'} · 심각 ${r.grave}% ${r.dir === 'over' ? '초과' : '미만'}</span></div>`).join('')
    }</div></div>
    <div class="chk"><div class="q">공기업 부채비율 관리기준</div><div class="rule">200% 이상=집중관리 · 100–200%=억제관리 · 100% 미만=상시 모니터링 (감사연구원 2021)</div></div>
    <div class="chk"><div class="q">위험기반 감사 위젯 — AR = IR × CR × DR</div>
      <div class="meta"><span class="b b-lvl">감사연구원 2013 위험분석 연구</span><span class="b b-lvl">개념 교보재</span></div>
      <div class="rule">고유위험(IR)·통제위험(CR)은 평가 대상이고, 감사자가 조절할 수 있는 유일한 위험은 <b>적발위험(DR)</b>입니다. IR·CR이 높게 평가될수록 DR을 낮춰야 하므로 증거량과 투입시간이 늘어납니다.</div>
      <div class="risk-grid">
        <div class="fld"><label>고유위험(IR) — 계정 성격상 왜곡 가능성</label>
          <select data-ar="ir" aria-label="고유위험"><option value="0.4">낮음 (단순·현금주의성 계정)</option><option value="0.7" selected>중간</option><option value="1">높음 (평가·추정 계정: 충당부채·감가상각·건설가계정)</option></select></div>
        <div class="fld"><label>통제위험(CR) — 내부통제가 못 거를 가능성</label>
          <select data-ar="cr" aria-label="통제위험"><option value="0.4"${crSel('0.4')}>낮음 (분리·대사·전산통제 양호)</option><option value="0.7"${crSel('0.7')}>중간</option><option value="1"${crSel('1')}>높음 (회계직 미분리·비밀번호 공유·장기보직)</option></select></div>
      </div>
      <div class="m">🛡️ ${esc(icNote)} <button class="chip" data-go-ic type="button">내부통제 예비평가 열기</button></div>
      <div class="rule" data-ar-out></div>
    </div>
    <div class="chk"><div class="q">기관유형별 위험 프로파일 (선례 집계)</div>
      <div class="rule">${esc(({
        '지자체': '일반회계 내부통제 위험의 60.1%가 국유(공유)재산 관리에 집중 — 유형자산·사회기반시설, 보조금 정산부터 보십시오.',
        '지방공기업': '기업회계 프로파일 — 선례상 유형자산(허용오류 초과의 31.8%)·충당부채(평가·추정의 29.3%)·판매비와관리비가 오류 다발 계정입니다.',
        '출자·출연기관': '기금형 프로파일 — 연금·퇴직 충당부채, 장기투자증권(평가·감액손실)이 선례상 위험 계정입니다.',
      })[orgOf()] || '')}</div>
      <div class="m">출처: 감사연구원 2013(2011회계연도 결산검사 실증) — 검사자원 배분 참고용이며 처분 근거가 아닙니다.</div></div>`;
    const gic = w.querySelector('[data-go-ic]');
    if (gic) gic.addEventListener('click', () => { if (window.FA.openCheck) window.FA.openCheck('내부통제'); });
    const arOut = w.querySelector('[data-ar-out]');
    const arCalc = () => {
      const ir = parseFloat(w.querySelector('[data-ar="ir"]').value);
      const cr = parseFloat(w.querySelector('[data-ar="cr"]').value);
      const dr = 0.05 / (ir * cr); // 목표 AR 5% 기준의 상대 수준(교보재용 정성 밴드)
      let band, guide;
      if (dr <= 0.08) { band = '매우 낮게'; guide = '표본 대폭 확대 또는 전수검사 검토 · 외부확인·실사 등 강한 증거 위주 · 투입시간 최대'; }
      else if (dr <= 0.15) { band = '낮게'; guide = '표본 확대 · 실증절차 비중 확대 · 분석적 절차만으로 종결 금지'; }
      else { band = '표준 수준'; guide = '표준 표본 · 분석적 절차와 세부테스트 병행'; }
      arOut.innerHTML = `→ 적발위험(DR)을 <b>${band}</b> 유지해야 합니다. ${guide}. <span class="risk-th">※ 우선순위 안내이며 표본 수를 확정하는 계산이 아닙니다.</span>`;
    };
    w.querySelectorAll('[data-ar]').forEach(s => s.addEventListener('change', arCalc));
    arCalc();
    w.querySelectorAll('input[data-risk]').forEach(x => x.addEventListener('input', () => {
      const r = RISK6[+x.dataset.risk];
      const v = num(x.value);
      const el = w.querySelector(`[data-rv="${x.dataset.risk}"]`);
      if (!x.value.trim()) { el.textContent = ''; return; }
      // 원문 부등호 그대로: 초과(>)·미만(<) — 경계값은 하위 단계
      const bad = r.dir === 'over' ? v > r.grave : v < r.grave;
      const warn = r.dir === 'over' ? v > r.warn : v < r.warn;
      el.className = 'risk-v ' + (bad ? 'rv-bad' : warn ? 'rv-warn' : 'rv-ok');
      el.textContent = bad ? '심각' : warn ? '주의' : '정상';
    }));
    const ref = $('#riskRef');
    ref.innerHTML = refs.map(r => `<div class="chk"><div class="q">${esc(r.이름)} <span class="b b-lvl">${esc(r.type)}</span> <span class="b b-area">${esc(r.기관유형_원 || r.기관유형)}</span></div><div class="quote">${esc(r.산식_원문 || r.근거조문 || '')}</div>${r.임계값 ? `<div class="rule">임계값: ${esc(typeof r.임계값 === 'string' ? r.임계값 : JSON.stringify(r.임계값))}</div>` : ''}</div>`).join('');
  }

  /* ═══ 사례 ═══ */
  const ST_BADGE = { pdf: ['PDF', 'st-pdf'], pdf_conv: ['변환PDF', 'st-conv'], hwp: ['HWP만', 'st-hwp'], zip: ['압축원문', 'st-hwp'], csd: ['CSD-DRM', 'st-csd'], none: ['미보존·주의', 'st-none'] };
  let caseView = { list: [], shown: 0 };
  async function renderCases() {
    show('cases');
    if (!dataStore['cases_fin.json']) {
      $('#caseStats').textContent = '사례 데이터 불러오는 중… (2.3MB · 최초 1회)';
      $('#caseList').innerHTML = '';
    }
    const data = await load('cases_fin.json');
    if (!data) { $('#caseStats').textContent = ''; $('#caseList').innerHTML = LOAD_FAIL; return; }
    filterCases();
  }
  function expandQuery(q) {
    // 감사 길잡이 동의어 사전(norm_dict) 재사용: 검색어가 어느 그룹의 변형이면 그룹 전체로 확장
    const terms = [q];
    const dict = (window.NORM_DICT && window.NORM_DICT.synonyms) || [];
    for (const g of dict) {
      const vs = [g.canon, ...(g.variants || [])];
      if (vs.includes(q)) { vs.forEach(v => { if (!terms.includes(v)) terms.push(v); }); break; }
    }
    return terms;
  }
  function filterCases() {
    const all = dataStore['cases_fin.json'] || [];
    const q = ($('#caseQ').value || '').trim();
    const se = $('#caseSe').value; const st = $('#caseSt').value;
    const fb = $('#caseB').value; const fd = $('#caseD').value;
    const terms = q ? expandQuery(q) : [];
    caseView.list = all.filter(c =>
      (!q || terms.some(t => c.t.includes(t))) && (!se || c.se === se) && (!st || c.st === st)
      && (!fb || (c.b || []).includes(fb)) && (!fd || (c.d || []).some(x => x.includes(fd))));
    caseView.shown = 0;
    $('#caseStats').textContent = `${caseView.list.length.toLocaleString()}건 일치`
      + (terms.length > 1 ? ` · 동의어 확장: ${terms.join(', ')}` : '');
    $('#caseList').innerHTML = '';
    moreCases();
  }
  function moreCases() {
    const box = $('#caseList');
    const next = caseView.list.slice(caseView.shown, caseView.shown + 100);
    caseView.shown += next.length;
    next.forEach(c => {
      const [lb, cls] = ST_BADGE[c.st] || ST_BADGE.none;
      const d = document.createElement('div');
      d.className = 'case case-row';
      d.setAttribute('role', 'button'); d.tabIndex = 0;
      d.innerHTML = `<div class="t"><span class="b ${c.se === '화성' ? 'se-hs' : 'se-bai'}">${esc(c.se === '화성' ? '화성특례시' : c.se)}</span> ${esc(c.t)}</div>
        <div class="m">${esc(c.y)} · srno ${esc(c.s)} ${c.ax && c.ax !== '분야축' ? '· 확장검색' : ''}</div>
        <div class="meta">${(c.b || []).map(b => `<span class="b b-area">${esc(b)}</span>`).join('')}${(c.d || []).map(x => `<span class="b b-lvl">${esc(x)}</span>`).join('')}<span class="b ${cls}">${lb}</span></div>`;
      const open = () => openCaseDetail(c);
      d.addEventListener('click', open);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      box.appendChild(d);
    });
    $('#caseMore').hidden = caseView.shown >= caseView.list.length;
  }

  /* ── 사례 상세 슬라이드오버(본문 내장 · 감사 길잡이 UX 이식) ──
     본문은 fin_body_p{bp}.json 지연 로딩(최초 1샤드만) · 요약카드이므로 원문 대조 경고 상시 */
  function fmtBody(text, kps) {
    let h = esc(text || '');
    (kps || []).forEach(k => {
      const t = esc(String(k)).trim();
      if (t.length >= 4 && h.includes(t)) h = h.split(t).join('<b>' + t + '</b>');
    });
    return h.replace(/\n+/g, '<br>');
  }
  async function openCaseDetail(c) {
    let ov = $('#caseOver');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'caseOver'; ov.className = 'case-over'; ov.hidden = true;
      ov.innerHTML = '<div class="co-panel" role="dialog" aria-modal="false" aria-label="사례 상세"><button class="co-x" aria-label="닫기">✕</button><div class="co-body"></div></div>';
      document.body.appendChild(ov);
      ov.querySelector('.co-x').addEventListener('click', () => { ov.hidden = true; });
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) ov.hidden = true; });
    }
    const bodyEl = ov.querySelector('.co-body');
    ov.hidden = false;
    bodyEl.innerHTML = '<div class="view-p">본문 불러오는 중…</div>';
    const shard = await load(`fin_body_p${c.bp || 1}.json`);
    const b = (shard && shard[c.id]) || null;
    const [lb, cls] = ST_BADGE[c.st] || ST_BADGE.none;
    const sec = (title, html) => html ? `<h4 class="co-h">${title}</h4><div class="co-t">${html}</div>` : '';
    const isBai = c.se !== '화성';
    const srcRow = isBai && /^\d+$/.test(String(c.s))
      ? `<a class="chip" href="https://www.bai.go.kr/bai/result/branch/detail?srno=${esc(c.s)}" target="_blank" rel="noopener">감사원 공개문 페이지 ↗</a>`
      : `<button class="chip" data-copy>제목 복사(원문 열람용)</button>`;
    if (!b) {
      bodyEl.innerHTML = `<div class="co-title">${esc(c.t)}</div><div class="view-p">본문 데이터를 불러오지 못했습니다. 네트워크 확인 후 다시 열어 주십시오.</div>`;
      return;
    }
    bodyEl.innerHTML = `
      <div class="co-title">${esc(c.t)}</div>
      <div class="meta">${esc(c.se === '화성' ? '화성특례시' : c.se)} · ${esc(c.y)}${b.gn ? ' · ' + esc(b.gn) : ''}${b.pd ? ' · 공개 ' + esc(b.pd) : ''}${b.ot ? ' · ' + esc(b.ot) : ''}</div>
      <div class="meta">${(b.disp || []).map(x => `<span class="b b-lvl">${esc(x)}</span>`).join('')}${(c.b || []).map(x => `<span class="b b-area">${esc(x)}</span>`).join('')}<span class="b ${cls}">${lb}</span>${(b.hs || []).length ? '<span class="b st-none">형사연계</span>' : ''}</div>
      ${sec('요지', fmtBody(b.yo))}
      ${sec('위반사실', fmtBody(b.wi, b.kp))}
      ${sec('원인·통제미비점', fmtBody(b.wo))}
      ${sec('착안점', (b.ca || []).map(x => `<div class="co-li">▸ ${esc(x)}</div>`).join(''))}
      ${sec('적신호', b.red ? `<div class="co-red">🚩 ${esc(b.red)}</div>` : '')}
      ${sec('경과', (b.gy || []).map(g => `<div class="co-li">${esc(g.일자 || '')} — ${esc(g.사건 || '')}</div>`).join(''))}
      <h4 class="co-h">출처·원문</h4>
      <div class="co-t"><div class="m">srno ${esc(c.s)}${(b.pg || []).length ? ' · 근거 p.' + (b.pg || []).map(esc).join(', p.') : ''} · <span class="b ${cls}">${lb}</span></div>
      <div class="chips">${srcRow}</div>
      <div class="note" style="margin-top:8px">본 카드는 AI 압축요약입니다. 금액·법조문·처분 인용 전 반드시 원문과 대조하십시오.${c.st === 'none' ? ' <b>이 사례는 원문 미보존 — 요약 검증 불가·인용 주의.</b>' : ''}</div></div>`;
    const cp = bodyEl.querySelector('[data-copy]');
    if (cp) cp.addEventListener('click', (e) => { copyText(c.t).then(ok => { e.target.textContent = ok ? '✓ 제목 복사됨' : '복사 실패'; }); });
  }

  /* 입력 영속화 공용 헬퍼(트리·워크시트) — 뷰 이탈·새로고침에도 입력 유지 */
  function persistInputs(rootEl, key) {
    const store = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
    const saved = store();
    rootEl.querySelectorAll('input, textarea, select').forEach((x, i) => {
      const k = x.id || (x.name ? x.name + '|' + x.value : 'i' + i);
      if (x.type === 'radio' || x.type === 'checkbox') {
        if (saved[k]) { x.checked = true; x.dispatchEvent(new Event('change')); }
        x.addEventListener('change', () => {
          const s = store();
          if (x.type === 'radio' && x.name) Object.keys(s).forEach(kk => { if (kk.startsWith(x.name + '|')) delete s[kk]; });
          if (x.checked) s[k] = 1; else delete s[k];
          localStorage.setItem(key, JSON.stringify(s));
        });
      } else {
        if (saved[k] != null && !x.value) { x.value = saved[k]; x.dispatchEvent(new Event('input')); }
        x.addEventListener('change', () => { const s = store(); s[k] = x.value; localStorage.setItem(key, JSON.stringify(s)); });
      }
    });
  }

  /* ═══ 처분수위 판단트리 ═══ */
  function renderTree() {
    const box = $('#treeBox');
    box.innerHTML = `
      <div class="chk"><div class="q">Q0. 이 발견은 어느 갈래입니까? — 성격에 따라 출구가 다릅니다</div>
        <div class="ans-row">
          <label class="rad"><input type="radio" name="t0" value="fs">① 재무제표 신뢰성(수치·표시 오류)</label>
          <label class="rad"><input type="radio" name="t0" value="ic">② 내부통제 취약성</label>
          <label class="rad"><input type="radio" name="t0" value="il">③ 위법·부당(처분 검토)</label>
          <label class="rad"><input type="radio" name="t0" value="mg">④ 관리상 개선</label>
        </div>
        <div class="rule" data-t0 hidden></div></div>
      <div data-ilwrap hidden>
      <div class="chk"><div class="q">Q1. 금전적 원상회복이 가능한 사안인가?</div>
        <div class="ans-row"><label class="rad"><input type="radio" name="t1" value="y">예</label><label class="rad"><input type="radio" name="t1" value="n">아니오</label></div>
        <div class="rule" data-t1 hidden></div></div>
      <div class="chk" data-q2 hidden><div class="q">Q2. 제도·절차의 결함이 원인인가?</div>
        <div class="ans-row"><label class="rad"><input type="radio" name="t2" value="y">예</label><label class="rad"><input type="radio" name="t2" value="n">아니오(개인 행위)</label></div>
        <div class="rule" data-t2 hidden></div></div>
      <div class="chk" data-q3 hidden><div class="q">Q3. 변상 6요건 — 전부 충족해야 변상판정 검토</div>
        ${['① 회계관계직원에 해당', '② 고의 또는 중과실(출납직=선관주의 위반)', '③ 법령 등 의무 위반', '④ 손해 발생', '⑤ 상당인과관계', '⑥ 책임조각사유 부존재'].map((t, i) => `<label class="rad t3"><input type="checkbox" data-t3="${i}">${t}</label>`).join('')}
        <div class="rule" data-t3v></div>
        <div class="note">ℹ️ <b>「손해로 보지 않는 경우」 먼저 확인</b> — 기관 부담 경비로 사용·상응 대가 취득·기관 간 내부거래 고가·임차물품 망실 등은 손해로 보지 않습니다.</div></div>
      <div class="note danger">🚔 <b>형사연계 임계선</b> — 개인계좌 집행·이중청구·무단반출 신호는 자체감사 범위를 초과합니다. 고발·수사의뢰를 검토하십시오.</div>
      </div>
      <div class="note info">본 트리의 결과는 검토 방향 안내이며 처분 확정이 아닙니다. 유사 선례의 처분 분포는 사례 참조에서 확인하십시오.</div>`;
    const t0 = box.querySelector('[data-t0]'); const ilwrap = box.querySelector('[data-ilwrap]');
    box.querySelectorAll('input[name="t0"]').forEach(x => x.addEventListener('change', () => {
      t0.hidden = false;
      ilwrap.hidden = x.value !== 'il';
      t0.textContent = ({
        fs: '→ 재무제표 신뢰성 갈래 — 수정분개·재작성 요구를 검토하고, 오류 원인이 단순 실수인지 통제 미비인지 확인하십시오(통제 미비면 ② 갈래 병행). 이 도구는 감사의견을 자동 생성하지 않습니다.',
        ic: '→ 내부통제 취약성 갈래 — 「중대한 취약성」(재무제표 신뢰성에 직접 영향·반복 발생 구조)인지 「기타 개선 필요」인지 구분해 개선요구·권고·통보로 구성하십시오.',
        il: '→ 위법·부당 갈래 — 아래 Q1부터 처분수위 검토를 진행하십시오.',
        mg: '→ 관리상 개선 갈래 — 처분요구가 아닌 관리서한(개선 권고)으로 구성하십시오. 조서 초안 생성 시 관리서한 골격이 포함됩니다.',
      })[x.value] || '';
    }));
    const t1 = box.querySelector('[data-t1]'); const q2 = box.querySelector('[data-q2]');
    const t2 = box.querySelector('[data-t2]'); const q3 = box.querySelector('[data-q3]');
    box.querySelectorAll('input[name="t1"]').forEach(x => x.addEventListener('change', () => {
      t1.hidden = false;
      if (x.value === 'y') { t1.textContent = '→ 시정요구 우선 검토(환수·추징·회복). 시정 우선·변상 최후 원칙.'; q2.hidden = true; q3.hidden = true; }
      else { t1.textContent = '→ Q2로 진행'; q2.hidden = false; }
    }));
    box.querySelectorAll('input[name="t2"]').forEach(x => x.addEventListener('change', () => {
      t2.hidden = false;
      if (x.value === 'y') { t2.textContent = '→ 개선요구 · 권고 · 통보 검토(원인이 제도이면 사람 문책보다 제도 개선).'; q3.hidden = true; }
      else { t2.textContent = '→ Q3 변상 6요건 확인'; q3.hidden = false; }
    }));
    const t3v = box.querySelector('[data-t3v]');
    box.querySelectorAll('input[data-t3]').forEach((x, i) => {
      x.id = 't3_' + i; // 영속화 키 안정화
      x.addEventListener('change', () => {
        const n = [...box.querySelectorAll('input[data-t3]')].filter(c => c.checked).length;
        t3v.textContent = n === 6 ? '6요건 전부 충족 → 변상판정 검토 (반론·책임조각사유 재확인 필수)'
          : `충족 ${n}/6 → 일부 미충족 시 징계·문책 / 주의요구 검토`;
      });
    });
    persistInputs(box, 'fa_tree:' + orgOf());
    show('tree');
  }

  /* ═══ 계산 워크시트 ═══ */
  function renderCalc() {
    const box = $('#calcBox');
    box.innerHTML = `
      <div class="chk"><div class="q">① 정액법 감가상각</div>
        <div class="risk-grid">
          <div class="fld"><label>취득원가(원)</label><input id="c1a" inputmode="numeric"></div>
          <div class="fld"><label>잔존가치(원)</label><input id="c1b" inputmode="numeric" value="0"></div>
          <div class="fld"><label>내용연수(년)</label><input id="c1c" inputmode="numeric"></div>
          <div class="fld"><label>경과연수(년)</label><input id="c1d" inputmode="numeric"></div>
        </div><div class="rule" id="c1o"></div></div>
      <div class="chk"><div class="q">② 자산평가 — 재고 MIN / 토지 MAX</div>
        <div class="meta"><span class="b b-ev">기준 직접근거</span><span class="b b-lvl">지방공기업 결산기준 자산평가 판정규칙</span></div>
        <div class="risk-grid">
          <div class="fld"><label>재고: 취득원가(원)</label><input id="c2a" inputmode="numeric"></div>
          <div class="fld"><label>재고: 순실현가능가치(원)</label><input id="c2b" inputmode="numeric"></div>
          <div class="fld"><label>토지: 취득원가(원)</label><input id="c2c" inputmode="numeric"></div>
          <div class="fld"><label>토지: 개별공시지가(원)</label><input id="c2d" inputmode="numeric"></div>
        </div><div class="rule" id="c2o"></div></div>
      <div class="chk"><div class="q">③ 보조금 정산잔액(반납액)</div>
        <div class="risk-grid">
          <div class="fld"><label>교부액(원)</label><input id="c3a" inputmode="numeric"></div>
          <div class="fld"><label>적정 집행액(원)</label><input id="c3b" inputmode="numeric"></div>
          <div class="fld"><label>발생이자(원)</label><input id="c3c" inputmode="numeric" value="0"></div>
        </div><div class="rule" id="c3o"></div></div>`;
    const on = (ids, fn) => ids.forEach(id => $('#' + id).addEventListener('input', fn));
    on(['c1a', 'c1b', 'c1c', 'c1d'], () => {
      const a = num($('#c1a').value), b = num($('#c1b').value), c = num($('#c1c').value), d = num($('#c1d').value);
      $('#c1o').textContent = c > 0 ? `연 상각액 ${fmt((a - b) / c)}원 · 감가상각누계 ${fmt(Math.min(d, c) * (a - b) / c)}원 · 장부가액 ${fmt(a - Math.min(d, c) * (a - b) / c)}원` : '';
    });
    on(['c2a', 'c2b', 'c2c', 'c2d'], () => {
      const parts = [];
      // 두 값이 모두 있어야 계산(한쪽만 입력 시 0과 비교하는 오류 방지)
      if ($('#c2a').value.trim() && $('#c2b').value.trim()) parts.push(`재고 평가액 = MIN → ${fmt(Math.min(num($('#c2a').value), num($('#c2b').value)))}원`);
      if ($('#c2c').value.trim() && $('#c2d').value.trim()) parts.push(`토지 평가액 = MAX → ${fmt(Math.max(num($('#c2c').value), num($('#c2d').value)))}원`);
      $('#c2o').textContent = parts.join(' · ');
    });
    on(['c3a', 'c3b', 'c3c'], () => {
      const r = num($('#c3a').value) - num($('#c3b').value) + num($('#c3c').value);
      $('#c3o').textContent = $('#c3a').value ? `반납 대상액(집행잔액+이자) = ${fmt(r)}원 ${r < 0 ? '· ⚠ 집행액이 교부액 초과 — 확인 필요' : ''}` : '';
    });
    persistInputs(box, 'fa_calc:' + orgOf());
    show('calc');
  }

  /* ═══ 감사조서·예외 관리 ═══ */
  // 분모는 체크리스트 화면과 동일 기준(기관유형+난이도 필터)
  function scopedItems() {
    const lvl = window.FA.S.lvl;
    return window.FA.items().filter(it =>
      (it.기관유형 || []).includes(orgOf()) && (lvl === '심화' || it.난이도 !== '심화'));
  }
  function renderReport() {
    const items = scopedItems();
    const resp = window.FA.respAll();
    // 분자도 분모와 같은 범위(기관+난이도)로 집계
    const answered = items.filter(it => resp[it.id] && resp[it.id].a);
    const nos = items.filter(it => resp[it.id] && resp[it.id].a === '아니오');
    const exc = excAll();
    const carriedN = exc.filter(e => e.상태 === '차기이월').length;
    $('#repSummary').innerHTML = `<div class="chk"><div class="q">${esc(orgOf())} — 진행 요약</div>
      <div class="rule">응답 ${answered.length}/${items.length}건 · 지적 후보(아니오) ${nos.length}건 · 검산 예외 ${exc.length}건${carriedN ? ` · 차기이월 관찰 ${carriedN}건` : ''}</div>
      ${carriedN ? '<div class="m">「차기이월」 = 허용오류 이하이거나 당기 종결이 어려운 관찰 — 조서 초안의 「차기 감사 고려사항」에 모이고, 내보내기(.json)로 차기 감사자에게 전달할 수 있습니다.</div>' : ''}</div>`;
    const et = $('#excTable');
    et.innerHTML = exc.length ? `<table class="xt"><tr><th>출처</th><th>항목</th><th>내용</th><th>상태</th><th>메모</th><th></th></tr>${
      exc.map((e, i) => `<tr><td>${esc(e.src)}</td><td>${esc(e.이름)}${e.연도 ? ` <span class="b b-lvl">${esc(e.연도)}</span>` : ''}</td><td>${esc(e.내용)}</td>
        <td><select data-xs="${i}">${['미해결', '설명가능', '지적후보', '차기이월'].map(s => `<option ${e.상태 === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input data-xm="${i}" value="${esc(e.메모 || '')}" placeholder="원인·조치 메모 (차기이월이면 차기 확인 포인트)"></td>
        <td><button class="chip" data-xd="${i}">삭제</button></td></tr>`).join('')
    }</table>` : '<div class="chk">등록된 예외가 없습니다. 검산기에서 불일치 발생 시 「예외로 등록」을 누르십시오.</div>';
    et.querySelectorAll('[data-xs]').forEach(s => s.addEventListener('change', () => { const l = excAll(); l[+s.dataset.xs].상태 = s.value; excSave(l); }));
    et.querySelectorAll('[data-xm]').forEach(s => s.addEventListener('change', () => { const l = excAll(); l[+s.dataset.xm].메모 = s.value; excSave(l); }));
    et.querySelectorAll('[data-xd]').forEach(b => b.addEventListener('click', () => { const l = excAll(); l.splice(+b.dataset.xd, 1); excSave(l); renderReport(); }));
    $('#noList').innerHTML = nos.length ? nos.map(it => `<div class="chk"><div class="q">${esc(it.착안질문)}</div>
      <div class="meta"><span class="b b-area">${esc(it.영역 || '')}</span><span class="b b-ev">기준 직접근거</span></div>
      <div class="quote">${esc(it.근거조문 || '')}</div>
      ${resp[it.id].doc ? `<div class="docs">📄 확인 서류: ${esc(resp[it.id].doc)}</div>` : ''}</div>`).join('')
      : '<div class="chk">지적 후보가 없습니다. 체크리스트에서 "아니오" 응답 시 여기에 모입니다.</div>';
    // 생성된 초안이 있으면 유지(예외 행 삭제 등 재렌더에 초안이 사라지지 않도록)
    const hasDraft = !!$('#draftOut').value;
    $('#draftOut').hidden = !hasDraft; $('#draftBar').hidden = !hasDraft;
    show('report');
  }

  /* 산출물 상태: 마지막 생성 종류·값(더티 가드·파일명 분기용) */
  let lastGen = { kind: '', value: '' };
  function outputTo(kind, md) {
    const out = $('#draftOut');
    if (out.value && out.value !== lastGen.value &&
        !confirm('출력창에 직접 수정한 내용이 있습니다. 새로 생성해 덮어쓸까요?')) return;
    lastGen = { kind, value: md };
    out.value = md; out.hidden = false; $('#draftBar').hidden = false;
  }

  function makeDraft() {
    const items = scopedItems();
    const resp = window.FA.respAll();
    const nos = items.filter(it => resp[it.id] && resp[it.id].a === '아니오');
    const exc = excAll();
    const open = exc.filter(e => e.상태 !== '설명가능' && e.상태 !== '차기이월');
    const closed = exc.filter(e => e.상태 === '설명가능');
    const carried = exc.filter(e => e.상태 === '차기이월');
    const d = new Date().toISOString().slice(0, 10);
    let md = `# 감사조서 초안 — ${orgOf()} 재무감사 점검\n\n작성일: ${d} · 도구: 재무감사 도우미(결정론 점검·초안 보조)\n\n`;
    const answeredN = items.filter(it => resp[it.id] && resp[it.id].a).length;
    md += `## 1. 점검 개요\n- 기관유형: ${orgOf()}\n- 적용 기준: ${orgOf() === '지자체' ? '지방자치단체 결산 통합기준' : orgOf() === '지방공기업' ? '2025사업연도 지방공기업 결산기준' : '2025사업연도 지방출자·출연기관 결산기준'}\n- 응답 항목: ${answeredN}건 / 지적 후보 ${nos.length}건 / 검산 예외 미해결·지적후보 ${open.length}건(설명가능 ${closed.length}건 별도)\n\n`;
    if (open.length) {
      md += `## 2. 정합성 검산 예외 (미해결·지적 후보)\n`;
      open.forEach((e, i) => {
        md += `\n### 2-${i + 1}. ${e.이름} [${e.상태}] · 등록 ${e.ts || ''}\n- 검사규칙(근거 원문): ${String(e.근거 || '').replace(/\s+/g, ' ')}\n- 예외 내용: ${e.내용}${e.금액차이 ? ` (차이 ${Math.abs(e.금액차이).toLocaleString()}원)` : ''}\n`;
        if (e.입력값 && e.입력값.length) {
          md += `- 입력값(재현용):\n`;
          e.입력값.forEach(v => { md += `    - [${v.side === 'L' ? '좌변' : '우변'}] ${v.name}: ${v.val}\n`; });
        }
        md += `- 원인 가설: ${e.메모 || '(기재 필요)'}\n- 추가 요구자료: (기재 필요)\n- 검토자 결론: (기재 필요)\n`;
      });
      md += '\n';
    }
    if (closed.length) {
      md += `## 2-B. 설명가능(종결) 예외 요약 — ${closed.length}건\n`;
      closed.forEach(e => { md += `- ${e.이름}: ${e.내용} → 해명: ${e.메모 || '(메모 없음)'}\n`; });
      md += '\n';
    }
    if (carried.length) {
      md += `## 2-C. 차기 감사 고려사항(이월 관찰) — ${carried.length}건\n허용오류 이하이거나 당기 종결이 어려운 관찰사항. 차기 결산검사 계획 수립 시 우선 확인(미지적 오류의 지속 관리 — 감사연구원 2013 권고 준용).\n`;
      carried.forEach(e => { md += `- [${e.연도 || String(e.ts || '').slice(0, 4)}] ${e.이름}: ${e.내용} → 차기 확인 포인트: ${e.메모 || '(기재 필요)'}\n`; });
      md += '\n';
    }
    if (nos.length) {
      md += `## 3. 체크리스트 지적 후보\n`;
      nos.forEach((it, i) => {
        const r = resp[it.id];
        md += `\n### 3-${i + 1}. ${it.착안질문}\n- 영역: ${it.영역 || ''} · 항목 ${it.id} · 근거 라벨: ${it.근거라벨 || '기준 직접근거'}${it.서식번호 ? ` · 서식 ${it.서식번호}` : ''}\n`;
        if (it.판정규칙) md += `- 판정규칙: ${it.판정규칙}\n`;
        if (it.red_flag) md += `- red flag: ${it.red_flag}\n`;
        md += `- 근거조문(원문): ${String(it.근거조문 || '').replace(/\s+/g, ' ')}\n- 확인 서류: ${r.doc || '(기재 필요)'}\n- 사실관계: ${r.note || '(기재 필요)'}\n- 원인·개선방향·조치: (기재 필요 — 사실+원인+개선+처분 구조로)\n`;
      });
      md += '\n';
    }
    // 부록: 수행내역(예·해당없음 포함 — 이상 없음 판단의 증적)
    const doneAll = items.filter(it => resp[it.id] && resp[it.id].a);
    if (doneAll.length) {
      md += `## 부록. 점검 수행내역 (${doneAll.length}건)\n\n| 항목 | 응답 | 확인 서류 |\n|---|---|---|\n`;
      doneAll.forEach(it => { md += `| ${it.id} ${it.착안질문.slice(0, 40)} | ${resp[it.id].a} | ${resp[it.id].doc || ''} |\n`; });
      md += '\n';
    }
    md += `## 발견사항 4갈래 분류 안내\n각 발견사항을 아래 4갈래 중 어디에 둘지 먼저 정하십시오(처분수위 판단트리 Q0 참조):\n① 재무제표 신뢰성 → 수정분개·재작성 요구 검토\n② 내부통제 취약성 → 「중대한 취약성 / 기타 개선 필요」 구분 후 개선요구·권고\n③ 위법·부당 → 처분요구서 골격 사용\n④ 관리상 개선 → 관리서한 골격 사용\n\n## 처분요구서 골격(실무 보고서 5단 구조 — 빈칸 프레임)\n지적 후보를 처분요구서로 발전시킬 때 아래 구조 사용(타 기관 재무감사 결과보고서 추출 표준):\n1. 업무 개요: (기재)\n2. 관련 내규·판단기준: (조문 원문 인용)\n3. 문제점(사실관계·차이·영향): (수치는 원문 대조 후)\n4. 관계부서 의견: (기재)\n5. 조치할 사항: (조치권한자를 주어로·명사형 종결)\n\n## 관리서한(개선 권고) 골격 — 처분요구에 이르지 않는 관리상 개선사항\n1. 현황: (기재)\n2. 개선이 필요한 사유(위험): (기재)\n3. 권고 사항: (기재 — 조치계획 회신 요청)\n\n`;
    md += `## 조서 셀프리뷰 체크(제출 전 10항)\n- [ ] 결론마다 근거 증거가 연결되어 있는가 (주장만 있는 결론 없음)\n- [ ] 인용한 수치·조문을 원문과 대조했는가\n- [ ] 재계산·재수행을 실제로 했는가 (계산 결과 기록)\n- [ ] 표본을 어떻게 뽑았는지(범위·방법) 기록했는가\n- [ ] 발견사항의 4갈래 분류(①재무제표 ②내부통제 ③위법·부당 ④관리개선)를 정했는가\n- [ ] 반론·책임조각사유를 검토·기록했는가\n- [ ] 관계부서 의견을 들었는가\n- [ ] 실명·개인정보 마스킹을 확인했는가\n- [ ] 미종결 관찰을 「차기이월」로 남겼는가\n- [ ] 제3자가 이 조서만 읽고 재현할 수 있는가 (문서화 충분성 — 위험평가·문서화는 동료평가의 단골 지적)\n\n## 유의사항\n- 본 초안은 합리적 확신 수준의 점검 보조 자료이며 처분·지적 확정이 아님.\n- 인용 수치·조문은 원문과 대조 후 사용할 것.\n`;
    outputTo('감사조서초안', md);
  }

  function makeDocs() {
    const items = scopedItems();
    // 모듈별 그룹 + 관련 착안 병기(피감기관 송부 가능 수준)
    const byMod = {};
    items.forEach(it => (it.필요서류 || []).forEach(x => {
      byMod[it.모듈] = byMod[it.모듈] || {};
      byMod[it.모듈][x] = byMod[it.모듈][x] || [];
      byMod[it.모듈][x].push(it.id);
    }));
    let md = `# 자료요구 목록(안) — ${orgOf()}\n\n`;
    let n = 0;
    Object.keys(byMod).forEach(mod => {
      md += `## ${mod}\n`;
      Object.entries(byMod[mod]).forEach(([doc, ids]) => { n += 1; md += `${n}. ${doc} (관련 점검: ${ids.slice(0, 4).join(', ')})\n`; });
      md += '\n';
    });
    md += `※ 점검 범위에 따라 취사선택하십시오. 관련 점검 id는 내부 참조용으로 송부 전 삭제 가능합니다.`;
    outputTo('자료요구목록', md);
  }

  /* ═══ 계정과목 검증 (전면 재설계) — 회계 분류 트리 + 검증 카드 + AI회계사 ═══ */
  let kbSel = null;   // 선택 노드 id
  let kbAll = localStorage.getItem('fa_kb_all') === '1';   // C안: 전체 계정 모드 토글
  async function loadKb() {
    const [tree, rec, cards, eps, laws, defs, adv, pf, nx, af, ez, mc] = await Promise.all([
      load('kb/accounts_tree.json'), load('kb/recipes.json'), load('kb/recipe_cards.json'),
      load('kb/error_patterns.json'), load('kb/law_cards.json'), load('kb/account_defs.json'),
      load('kb/advisor_map.json'), load('kb/practice_findings.json'), load('kb/numeric_examples.json'),
      load('kb/accounts_full.json'), load('kb/easy_accounts.json'), load('kb/misclass_pairs.json')]);
    // 래퍼 관용: 배열이면 그대로, 딕셔너리면 첫 배열 값(한국어 키 '노드'·'매핑' 등 포함)
    const arr = (x) => Array.isArray(x) ? x
      : (x && typeof x === 'object' ? (Object.values(x).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object') || []) : []);
    return { tree: arr(tree), rec: arr(rec), cards: arr(cards),
      eps: arr(eps), laws: arr(laws), defs: arr(defs), adv: arr(adv), pf: arr(pf), nx: arr(nx), full: arr(af), ez: arr(ez), mc: arr(mc) };
  }
  function mergedNodes(kb) {   // C안 병합: 지적례 노드(rich) + 전체 계정(basic·중복 제외)
    if (!kbAll || !kb.full.length) return kb.tree;
    const richNames = kb.tree.map(n => n.명칭);
    const org = orgOf();
    const basics = kb.full
      .filter(a => !(a.체계 || []).length || (a.체계 || []).includes(org))
      .filter(a => !a.기존노드_id && !richNames.some(rn => rn.includes(a.명칭) || a.명칭.includes(rn.split('·')[0])))
      .map(a => ({ id: a.id, 명칭: a.명칭, 경로: a.경로 || [], case_kw: a.case_kw || [], basic: true, def: a, 표시순서: a.표시순서 || 9999 }));
    return [...kb.tree, ...basics];
  }
  /* 장문 가독성: 한국어 목록 표지 앞 자동 줄바꿈(가.나.다./1) 2)/①/※/다만·단) — 표시 전용·원문 무변경 */
  function fmtBreaks(t) {
    if (!t || t.length < 90) return t || '';
    return t
      .replace(/\s(?=[가나다라마바사아자차]\.\s)/g, '\n')
      .replace(/\s(?=\d{1,2}\)\s)/g, '\n')
      .replace(/\s(?=[①②③④⑤⑥⑦⑧⑨⑩])/g, '\n')
      .replace(/\s(?=※)/g, '\n')
      .replace(/\s(?=(?:다만|단),)/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }
  /* 안전 산식 계산기(CSP상 eval 불가) — 숫자·변수키·사칙연산·괄호만 허용하는 미니 파서 */
  function safeCalc(expr, vars) {
    if (!/^[a-z0-9+\-*/().\s]+$/i.test(expr)) return null;
    const tokens = expr.match(/[a-z]+|\d+(?:\.\d+)?|[+\-*/()]/gi) || [];
    let pos = 0;
    const peek = () => tokens[pos], next = () => tokens[pos++];
    function prim() {
      const t = next();
      if (t === '(') { const v = add(); next(); return v; }
      if (t === '-') return -prim();
      if (/^[a-z]+$/i.test(t)) { const v = Number(vars[t]); return isFinite(v) ? v : NaN; }
      return Number(t);
    }
    function mul() { let v = prim(); while (peek() === '*' || peek() === '/') { const op = next(); const r = prim(); v = op === '*' ? v * r : v / r; } return v; }
    function add() { let v = mul(); while (peek() === '+' || peek() === '-') { const op = next(); const r = mul(); v = op === '+' ? v + r : v - r; } return v; }
    const out = add();
    return (pos === tokens.length && isFinite(out)) ? out : null;
  }
  function misclassBlock(node, kb) {   // 🔀 자주 헷갈리는 계정 쌍(감사연구원 2013 표24 실증)
    const toks = String(node.명칭 || '').split('·').map(x => x.trim()).filter(x => x.length >= 2);
    const hits = (kb.mc || []).filter(m => toks.some(t => (m.적정 + m.오류).includes(t)));
    if (!hits.length) return '';
    return `<details class="quote-fold"><summary>🔀 자주 헷갈리는 계정 쌍 (${hits.length}) — 선례 실증</summary>${
      hits.map(m => `<div class="chk"><div class="q">${esc(m.오류)} ➜ <b>${esc(m.적정)}</b> <span class="b b-lvl">${esc(m.방향)}</span></div>
        <div class="co-t">증상: ${esc(m.증상)}</div><div class="rule">확인: ${esc(m.확인)}</div><div class="m">출처: ${esc(m.출처)}</div></div>`).join('')
    }<div class="m">경향(감사연구원 2013 실증): 자산을 비용으로 잘못 분류하는 방향이 그 반대보다 많습니다.</div></details>`;
  }
  function easyBlock(nodeId, kb, ids) {   // 🧑‍💼 AI 회계사의 쉬운 설명(재해석·AI 라벨 구분)
    const e = (kb.ez || []).find(x => ids.includes(x.id));
    if (!e) return '';
    return `<div class="easy-box"><div class="q">🧑‍💼 AI 회계사의 쉬운 설명 <span class="b b-lvl">AI 설명 — 원문 아님</span></div>
      <div class="co-t">${esc(e.쉬운설명 || '')}</div>
      ${e.구체예시 ? `<div class="easy-ex">예시: ${esc(e.구체예시)}</div>` : ''}
      ${e.감사포인트 ? `<div class="rule">감사 포인트: ${esc(e.감사포인트)}</div>` : ''}</div>`;
  }
  function numericBlock(r, kb) {   // 🔢 숫자로 검증하기(조합안: 따라하기+실사례+계산기)
    const nx = (kb.nx || []).find(x => x.recipe_id === r.id);
    if (!nx) return '';
    const steps = (nx.따라하기 || []).map(s => `<div class="num-step"><b>${esc(s.단계)}</b><span>${esc(s.내용)}${s.왜 ? ` <span class="why">— ${esc(s.왜)}</span>` : ''}</span></div>`).join('');
    let calc = '';
    if (nx.계산기 && nx.계산기.산식) {
      const c = nx.계산기;
      calc = `<details class="quote-fold"><summary>🖩 직접 계산해보기 — ${esc(c.산식표시 || '')}</summary><div class="num-calc" data-expr="${esc(c.산식)}" data-nm="${esc(r.계정과목 || '')}">
        ${(c.입력 || []).map(i => `<label>${esc(i.라벨)}<input type="number" step="any" data-k="${esc(i.키)}" value="${esc(String(i.예시 ?? ''))}"></label>`).join('')}
        <div class="btnbar" style="margin-top:8px"><button class="btn line num-go" type="button">계산</button></div>
        <div class="num-out" hidden></div>
        <div class="m">해석: 양수=${esc((c.결과해석 || {}).양수 || '')} · 음수=${esc((c.결과해석 || {}).음수 || '')}</div></div></details>`;
    }
    return `<h4 class="co-h">🔢 숫자로 검증하기 (예시)</h4><div class="co-t">${steps}
      ${nx.실사례_한줄 ? `<div class="num-real">📌 ${esc(nx.실사례_한줄)}</div>` : ''}${calc}
      <div class="m">※ 예시 숫자는 이해를 돕는 가공 수치 — 실제 판단은 원문·증빙 대조 후.</div></div>`;
  }
  function wireCalcs(box) {
    box.querySelectorAll('.num-calc').forEach(el => {
      const btn = el.querySelector('.num-go'), out = el.querySelector('.num-out');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const vars = {};
        el.querySelectorAll('input[data-k]').forEach(i => { vars[i.dataset.k] = parseFloat(i.value); });
        const v = safeCalc(el.dataset.expr, vars);
        out.hidden = false;
        if (v === null || !isFinite(v)) { out.textContent = '계산 불가 — 입력값을 확인하세요'; out.className = 'num-out'; return; }
        const abs = Math.round(Math.abs(v)).toLocaleString('ko-KR');
        out.textContent = v > 0 ? `결과: +${abs}원 — 차이·부족 가능성(근거를 요구하세요)` : v < 0 ? `결과: −${abs}원 — 장부가 더 큼(과다·환입 사유 확인)` : '결과: 0원 — 일치(산정 근거 문서만 확인)';
        out.className = 'num-out ' + (v === 0 ? 'ok' : 'bad');
        let xb = el.querySelector('.num-exc');
        if (v !== 0) {
          if (!xb) {
            xb = document.createElement('button'); xb.className = 'chip num-exc'; xb.type = 'button'; out.after(xb);
            xb.addEventListener('click', () => { excAdd({ 이름: '숫자검증: ' + (el.dataset.nm || '계정 검증'), 근거: '숫자로 검증하기(예시 계산기)', 내용: out.textContent, 금액차이: v }); xb.textContent = '✓ 예외로 등록됨'; xb.disabled = true; });
          }
          xb.textContent = '＋ 예외로 등록'; xb.disabled = false; xb.hidden = false;
        } else if (xb) xb.hidden = true;
      });
    });
  }
  async function renderKb(selId) {
    show('kb');
    $('#kbMain').innerHTML = '<div class="view-p">지식 데이터 불러오는 중…</div>';
    const kb = await loadKb();
    if (!kb.tree.length && !kb.rec.length) { $('#kbMain').innerHTML = LOAD_FAIL; return; }
    if (selId) kbSel = selId;
    kbPaint(kb);
  }
  function nodeMatches(n, q) {
    return n.명칭.includes(q) || (n.case_kw || []).some(k => k.includes(q)) || (n.경로 || []).some(p => p.includes(q));
  }
  function kbPaint(kb) {
    const q = ($('#kbQ').value || '').trim();
    let nodes = mergedNodes(kb);
    if (q) {
      const terms = expandQuery(q);
      nodes = nodes.filter(n => terms.some(t => nodeMatches(n, t)));
    }
    // 모드 토글 상태 반영
    document.querySelectorAll('#kbMode button').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'all') === kbAll));
    if (!nodes.length) { $('#kbNav').innerHTML = '<div class="view-p">일치 없음' + (!kbAll && kb.full.length ? ' — 「전체 계정」으로 전환해 보세요' : '') + '</div>'; $('#kbMain').innerHTML = ''; return; }
    if (!kbSel || !nodes.some(n => n.id === kbSel)) kbSel = nodes[0].id;
    // 4계층 트리: 경로[0] → 경로[1](있으면) → 노드 (rich 우선·이후 해설서 순)
    const top = new Map();
    nodes.forEach(n => {
      const l1 = (n.경로 || [])[0] || '기타'; const l2 = (n.경로 || [])[1] || '';
      if (!top.has(l1)) top.set(l1, new Map());
      const m2 = top.get(l1);
      if (!m2.has(l2)) m2.set(l2, []);
      m2.get(l2).push(n);
    });
    top.forEach(m2 => m2.forEach(list => list.sort((a, b) => (a.basic ? 1 : 0) - (b.basic ? 1 : 0) || (a.표시순서 || 0) - (b.표시순서 || 0))));
    const badge = (n) => n.basic ? '<i class="kb-b" title="계정 정의(해설서)">📖</i>' : [
      (n.recipe_ids || []).length ? `<i class="kb-b kb-b-r" title="검증 레시피">${(n.recipe_ids || []).length}</i>` : '',
      (n.ep_ids || []).length ? `<i class="kb-b kb-b-e" title="오류패턴">${(n.ep_ids || []).length}</i>` : '',
      (n.tie_ids || []).length ? `<i class="kb-b kb-b-t" title="검산 가능">🧮</i>` : ''].join('');
    let h = '';
    for (const [l1, m2] of top) {
      h += `<div class="kb-l1">${esc(l1)}</div>`;
      for (const [l2, list] of m2) {
        if (l2) h += `<div class="kb-l2">${esc(l2)}</div>`;
        list.forEach(n => { h += `<button class="kb-item ${n.id === kbSel ? 'on' : ''}${n.basic ? ' basic' : ''}" data-k="${esc(n.id)}"><b>${esc(n.명칭)}</b>${badge(n)}</button>`; });
      }
    }
    $('#kbNav').innerHTML = h;
    $('#kbNav').querySelectorAll('.kb-item').forEach(b => b.addEventListener('click', () => { kbSel = b.dataset.k; kbPaint(kb); }));
    kbDetail(nodes.find(n => n.id === kbSel), kb);
  }
  const stepH = (t, html) => html ? `<h4 class="co-h">${t}</h4><div class="co-t">${html}</div>` : '';
  function lawFold(laws, cardId, quote) {
    const c = (laws || []).find(x => x.id === cardId);
    if (!c) return quote ? `<div class="co-li">📖 ${esc(quote)} <span class="b b-lvl">외부기준</span></div>` : '';
    return `<details class="quote-fold"><summary>📖 ${esc(c.출처)} ${esc(c.조문번호)} ${esc(c.제목 || '')}</summary><div class="quote">${esc(c.원문)}</div></details>`;
  }
  function recipeFull(r, kb) {   // 상세 근거(레시피 7단계 전문) — 접기 안
    return `${stepH('성립 요건', esc((r['1_성립요건'] || {}).요지 || '') + ((r['1_성립요건'] || {}).기준조문 || []).map(j => lawFold(kb.laws, j.card_id, j.인용)).join(''))}
      ${stepH('판단 포인트', esc(r['5_판단포인트'] || ''))}
      ${stepH('선례', (r['6_선례'] || []).map(s => `<button class="co-li kb-case" data-cid="${esc(s.card_id || '')}">▸ ${esc(s.제목)} <span class="b b-lvl">srno ${esc(s.srno)}</span></button>`).join(''))}
      <div class="m">근거: ${(r.근거출처 || []).map(esc).join(' · ')}</div>`;
  }
  function verifyCard(r, kb) {   // ★검증 카드 — 행동 우선 구조(코덱스 P0-3)
    const c = kb.cards.find(x => x.recipe_id === r.id) || {};
    const eps2 = (r['2_오류패턴'] || []);
    return `<div class="chk kb-recipe">
      <div class="q">🧾 ${esc(r.계정과목)} <span class="b b-area">검증</span>${(r.체계 || []).map(x => `<span class="b b-lvl">${esc(x)}</span>`).join('')}</div>
      ${c.한줄위험 ? `<div class="kb-why">⚠ ${esc(c.한줄위험)}</div>` : ''}
      ${stepH('바로 할 일', (c.바로할일 || []).map((x, i) => `<div class="co-li">${i + 1}. ${esc(x)}</div>`).join(''))}
      ${stepH('필요자료', (r['3_확인자료'] || []).map(x => `<span class="b b-ev">${esc(x)}</span>`).join(' '))}
      ${stepH('검증 테스트', (c.검증테스트 || []).map(t => `<div class="kb-test"><b>▶ ${esc(t.이름)}</b><div class="co-t">${esc(t.규칙 || '')}</div>${t.오탐주의 ? `<div class="m">⚠ 오탐주의: ${esc(t.오탐주의)}</div>` : ''}</div>`).join('') || esc(r['4_재계산절차'] || ''))}
      ${numericBlock(r, kb)}
      <div class="layer3-cap">③ 근거·심화 — 필요할 때 펼치세요</div>
      ${eps2.length ? `<details class="quote-fold"><summary>🚩 대표 오류패턴 (${eps2.length})</summary>${eps2.map(p => `<div class="co-li">▸ ${esc(p.패턴)}${p.재무제표영향 ? ` <span class="b b-lvl">${esc(p.재무제표영향)}</span>` : ''}</div>`).join('')}</details>` : ''}
      ${r['7_문안골격'] ? `<details class="quote-fold"><summary>📋 조서 문안 골격(빈칸 프레임)</summary><div class="quote">${esc(r['7_문안골격'])}</div><div class="m">※ 자동 작성 아님 — 사실·수치·기준을 원문 대조 후 채우십시오.</div></details>` : ''}
      <details class="quote-fold"><summary>📚 상세 근거 펼치기 (성립요건·기준조문·판단·선례)</summary>${recipeFull(r, kb)}</details>
    </div>`;
  }
  function kbDetail(node, kb) {
    const box = $('#kbMain');
    if (!node) { box.innerHTML = '<div class="view-p">좌측 트리에서 계정을 선택하십시오.</div>'; return; }
    if (node.basic) {   // 전체 계정 모드의 정의형 노드: 정의+사례검색+유사 지적례 계정 안내
      const a = node.def || {};
      const sibs = kb.tree.filter(t => (t.경로 || [])[1] === (node.경로 || [])[1]).slice(0, 6);
      box.innerHTML = `<div class="kb-crumb">${(node.경로 || []).map(esc).join(' › ')} › <b>${esc(node.명칭)}</b> <span class="b b-lvl">계정 정의</span></div>
        ${easyBlock(node.id, kb, [node.id])}
        <div class="chk"><div class="q">📖 ${esc(node.명칭)} — 표준계정과목 해설서 <span class="b b-lvl">${esc((a.출처 || '').replace(/\[\[|\]\]/g, ''))}</span></div>
        <div class="quote">${esc(fmtBreaks(a.정의_원문 || ''))}</div>
        ${a.유의사항_원문 ? `<h4 class="co-h">회계처리 유의사항</h4><div class="quote">${esc(fmtBreaks(a.유의사항_원문))}</div>` : ''}</div>
        ${misclassBlock(node, kb)}
        <div class="view-p">이 계정은 심화 검증 콘텐츠(레시피)가 아직 없습니다 — 도구가 잡아주지 못하는 영역(적발위험)이 상대적으로 크므로, 관련 사례·같은 분류의 지적례 계정을 참고하고 원장 열람·외부확인으로 보완하십시오.</div>
        <div class="btnbar"><button class="btn line" data-go-kws="${esc((node.case_kw || [node.명칭]).join('|'))}">📚 관련 사례 검색</button></div>
        ${sibs.length ? `<h3 class="home-sub">같은 분류의 지적례 계정</h3>` + sibs.map(s => `<button class="kb-case" data-sib="${esc(s.id)}">▸ ${esc(s.명칭)} <span class="b b-lvl">레시피 ${(s.recipe_ids || []).length}</span></button>`).join('') : ''}`;
      box.querySelectorAll('[data-sib]').forEach(b => b.addEventListener('click', () => { kbSel = b.dataset.sib; kbPaint(kb); }));
      box.querySelectorAll('[data-go-kws]').forEach(b => b.addEventListener('click', () => {
        renderCases().then(() => {
          const all = dataStore['cases_fin.json'] || [];
          const kws = (b.dataset.goKws || '').split('|').filter(Boolean);
          const kw = kws.find(k => all.some(c => c.t.includes(k))) || kws[0] || '';
          const q2 = $('#caseQ'); q2.value = kw; q2.dispatchEvent(new Event('input'));
        });
      }));
      return;
    }
    let h = `<div class="kb-crumb">${(node.경로 || []).map(esc).join(' › ')} › <b>${esc(node.명칭)}</b></div>`;
    if (node.선례신호) h += `<div class="m">📊 선례 신호: ${esc(node.선례신호.문구)} <span class="b b-lvl">선례 집계 — 예측 아님</span> <span class="b b-lvl">${esc(node.선례신호.출처)}</span></div>`;
    const toks = node.명칭.split('·').map(x => x.trim()).filter(x => x.length >= 2);
    const ezIds = kb.full.filter(a => a.기존노드_id === node.id
      || toks.some(t => a.명칭.includes(t) || t.includes(a.명칭))).map(a => a.id);
    h += easyBlock(node.id, kb, ezIds);
    // 계정 정의(해설서 원문) — 상단 접기
    const def = kb.defs.find(d => node.명칭.includes(d.계정) || (d.계정 || '').includes(node.명칭.split('·')[0]));
    if (def) h += `<details class="quote-fold"><summary>📖 계정 정의 — ${esc(def.계정)} <span class="b b-lvl">${esc((def.출처 || '').replace(/\[\[|\]\]/g, ''))}</span></summary><div class="quote">${esc(fmtBreaks(def.정의_원문 || ''))}${def.유의사항_원문 ? '<hr>' + esc(fmtBreaks(def.유의사항_원문)) : ''}</div></details>`;
    // 검증 카드(레시피)
    const recs = (node.recipe_ids || []).map(id => kb.rec.find(r => r.id === id)).filter(Boolean);
    recs.forEach(r => { h += verifyCard(r, kb); });
    // 검산 연결
    if ((node.tie_ids || []).length) h += `<div class="note info">🧮 이 계정은 <b>정합성 검산</b>이 가능합니다 — <button class="chip" data-go-tie>검산기에서 수치 입력</button></div>`;
    // 자주 헷갈리는 계정 쌍(오분류 사전)
    h += misclassBlock(node, kb);
    // 노드 전용 오류패턴(레시피 밖)
    const inRec = new Set(recs.flatMap(r => (r['2_오류패턴'] || []).map(p => p.ep_id)));
    const eps = (node.ep_ids || []).map(id => kb.eps.find(p => p.id === id)).filter(p => p && !inRec.has(p.id));
    if (eps.length) {
      h += `<details class="quote-fold"><summary>🚩 추가 오류패턴 (${eps.length})</summary>` + eps.map(p => `<div class="chk"><div class="q">${esc(p.제목)} <span class="b b-lvl">${esc(p.오류유형 || '')}</span></div>
          <div class="co-t">${esc(p.지적요지_원문 || '')}</div>
          ${p.확인방법 ? `<div class="rule">확인: ${esc(p.확인방법)}</div>` : ''}
          <div class="m">출처: ${esc(p.출처 || '')}</div></div>`).join('') + `</details>`;
    }
    // 실무 지적례(타 기관 재무감사 결과 — ★2025 등에서 역산)
    const kws = [node.명칭.split('·')[0], ...(node.case_kw || [])].filter(k => k && k.length >= 2);
    const pfs = (kb.pf || []).filter(p => {
      const hay = [p.계정과목 || '', p.제목 || ''].join(' ');
      return kws.some(k => hay.includes(k));
    }).slice(0, 5);
    if (pfs.length) {
      h += `<details class="quote-fold"><summary>🏛 실무 지적례 — 타 기관 재무감사 (${pfs.length})</summary>` + pfs.map(p => `<div class="chk"><div class="q">${esc(p.제목)} <span class="b b-lvl">${esc(p.구분 || '')}</span></div>
          <div class="co-t">${esc(p.내용_요지 || '')}</div>
          ${p.검증방법_역산 ? `<div class="rule">어떻게 발견했나: ${esc(p.검증방법_역산)}</div>` : ''}
          ${(p.필요했던_자료 || []).length ? `<div class="m">쓰인 자료: ${(p.필요했던_자료 || []).map(x => `<span class="b b-ev">${esc(x)}</span>`).join(' ')}</div>` : ''}
          <div class="m">출처: ${esc(p.출처 || '')}</div></div>`).join('') + `</details>`;
    }
    // 관련 사례
    if ((node.case_kw || []).length) h += `<div class="btnbar"><button class="btn line" data-go-cases="${esc((node.case_kw || [])[0])}">📚 관련 사례 보기 — "${esc((node.case_kw || [])[0])}"</button></div>`;
    if (!recs.length && !eps.length) h += '<div class="view-p">이 계정의 검증 레시피는 준비 중입니다 — 도구의 심화 검증이 미치지 않는 계정이므로 계정 정의·관련 사례를 참고하고 원장 열람·외부확인으로 보완하십시오.</div>';
    box.innerHTML = h;
    box.querySelectorAll('.kb-case').forEach(b => b.addEventListener('click', async () => {
      const all = dataStore['cases_fin.json'] || await load('cases_fin.json');
      const c = (all || []).find(x => x.id === b.dataset.cid || String(x.s) === b.dataset.cid);
      if (c) openCaseDetail(c);
    }));
    wireCalcs(box);
    const gt = box.querySelector('[data-go-tie]'); if (gt) gt.addEventListener('click', () => renderTie());
    box.querySelectorAll('[data-go-cases]').forEach(b => b.addEventListener('click', () => {
      renderCases().then(() => { const q2 = $('#caseQ'); q2.value = b.dataset.goCases; q2.dispatchEvent(new Event('input')); });
    }));
  }

  /* ── AI회계사 시작 패널(홈) — 증상 → 계정·자료·검증 번역 (런타임 LLM 0 · advisor_map+동의어) ── */
  async function advise() {
    const q = ($('#advQ').value || '').trim();
    const out = $('#advOut');
    if (q.length < 2) { out.hidden = true; return; }
    const kb = await loadKb();
    const terms = expandQuery(q);
    const score = (a) => {
      const hay = [a.증상, ...(a.동의어 || []), a.추정계정 || ''].join(' ');
      let s = 0;
      terms.forEach(t => { if (hay.includes(t)) s += 3; });
      // 부분 단어 매칭(2자 이상 조각)
      q.split(/[\s,·]+/).filter(w => w.length >= 2).forEach(w => { if (hay.includes(w)) s += 1; });
      return s;
    };
    let hits = kb.adv.map(a => [score(a), a]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    // 폴백: 트리 노드 직접 매칭
    if (!hits.length) {
      const ns = kb.tree.filter(n => terms.some(t => nodeMatches(n, t))).slice(0, 3);
      hits = ns.map(n => ({ 증상: n.명칭, 노드: n.id, 추정계정: n.명칭, 먼저볼자료: [], 추천검증: [], recipe_ids: n.recipe_ids || [] }));
    }
    if (!hits.length) { out.hidden = false; out.innerHTML = '<div class="view-p">해당 증상을 인식하지 못했습니다 — 계정과목명(예: 대손충당금)으로 검색하거나 「계정과목별 감사계획」에서 트리를 살펴보십시오.</div>'; return; }
    out.hidden = false;
    out.innerHTML = hits.map(a => `<div class="adv-hit">
      <div class="q">🧑‍💼 <b>${esc(a.추정계정 || a.증상)}</b> 관련으로 보입니다</div>
      ${(a.먼저볼자료 || []).length ? `<div class="m">먼저 볼 자료: ${(a.먼저볼자료 || []).map(x => `<span class="b b-ev">${esc(x)}</span>`).join(' ')}</div>` : ''}
      ${(a.추천검증 || []).length ? `<div class="m">추천 검증: ${(a.추천검증 || []).map(esc).join(' · ')}</div>` : ''}
      ${a.노드 ? `<div class="chips"><button class="chip" data-adv-node="${esc(a.노드)}">📒 검증 카드 열기</button></div>` : ''}
    </div>`).join('');
    out.querySelectorAll('[data-adv-node]').forEach(b => b.addEventListener('click', () => { if (b.dataset.advNode) renderKb(b.dataset.advNode); }));
  }

  /* ═══ 결산서 판독대 (D2 — 파일럿 실증 사양·수기입력·결정론) ═══ */
  const DESK_FIELDS = [
    { g: 'A. 재무상태표', items: [
      ['자산총계', 'a1', 'a0'], ['부채총계', 'b1', 'b0'], ['자본(순자산)총계', 'c1', 'c0'],
      ['유동자산', 'ca1', null], ['유동부채', 'cl1', null], ['현금및현금성자산', 'ch1', 'ch0']] },
    { g: 'B. 손익계산서(재정운영표)', items: [
      ['매출액(사업수익)', 's1', 's0'], ['영업이익(손실은 음수)', 'op1', 'op0'],
      ['영업외수익', 'nr1', null], ['영업외비용', 'ne1', null], ['법인세비용', 'tx1', null], ['당기순이익', 'ni1', 'ni0']] },
    { g: 'C. 현금흐름표', items: [['기초 현금', 'cf0', null], ['현금 증감(감소는 음수)', 'cfd', null], ['기말 현금', 'cf1', null]] },
  ];
  function deskStore() { try { return JSON.parse(localStorage.getItem('fa_desk:' + orgOf()) || '{}'); } catch { return {}; } }
  function renderDesk() {
    show('desk');
    const saved = deskStore();
    $('#deskForm').innerHTML = DESK_FIELDS.map(sec => `<div class="chk"><div class="q">${esc(sec.g)}</div><div class="desk-grid">
      ${sec.items.map(([lb, k1, k0]) => `<label class="desk-f">${esc(lb)}<span class="desk-pair">
        <input type="number" step="any" data-dk="${k1}" placeholder="당기" value="${saved[k1] ?? ''}">
        ${k0 ? `<input type="number" step="any" data-dk="${k0}" placeholder="전기" value="${saved[k0] ?? ''}">` : ''}</span></label>`).join('')}
    </div></div>`).join('')
    + `<div class="chk"><div class="q">D. 차이명세서 대사(선택) — 본표 금액과 「재무제표와 예산결산서 차이명세서」의 재무제표란이 같은지</div>
      <div id="deskDiff"></div><button class="btn line" id="deskDiffAdd" type="button">+ 계정 추가</button></div>`
    + `<details class="gate-cmp"${(saved.mb || saved.mp) ? ' open' : ''}><summary>E. 중요성(허용오류 규모) 설정 — 선택</summary>
      <div class="chk"><div class="risk-grid">
        <div class="fld"><label>기준금액(원) — 예: 총자산·총비용</label><input type="number" step="any" data-dk="mb" value="${saved.mb ?? ''}"></div>
        <div class="fld"><label>비율(%) — 직접 입력</label><input type="number" step="any" data-dk="mp" value="${saved.mp ?? ''}"></div>
      </div>
      <div class="rule" id="matOut"></div>
      <div class="m">공공부문 중요성 비율은 확정 규범이 없어 직접 입력합니다(민간 실무 관행 예시: 총자산의 0.5–2% 등). 산출값은 검사범위 판단 참고치이며 <b>지적·처분의 면책 기준이 아닙니다</b>. 금액이 작아도 질적으로 중요한 사안(이용자 오도·공익 민감·반복 오류)은 별도 검토하십시오.</div></div></details>`
    + `<div class="chk"><div class="q">F. 기대치 대비(선택) — 예산·사업계획 등 기대치와 결산액 비교 <span class="b b-lvl">분석적 검토 4단계: ①기대치 ②한계치 ③차이 ④해석</span></div>
      <div id="deskExp"></div><button class="btn line" id="deskExpAdd" type="button">+ 항목 추가</button></div>`;
    const dd = $('#deskDiff');
    const addRow = (nm, v1, v2) => {
      const row = document.createElement('div'); row.className = 'desk-diffrow';
      row.innerHTML = `<input type="text" placeholder="계정명(예: 임대료수익)" value="${esc(nm || '')}">
        <input type="number" step="any" placeholder="본표 금액" value="${v1 ?? ''}">
        <input type="number" step="any" placeholder="차이명세서 재무제표란" value="${v2 ?? ''}">`;
      dd.appendChild(row);
    };
    (saved._diff || [[], []]).length ? (saved._diff || []).forEach(r => addRow(r[0], r[1], r[2])) : null;
    if (!dd.children.length) { addRow(); addRow(); }
    $('#deskDiffAdd').onclick = () => addRow();
    const de = $('#deskExp');
    const addRowE = (nm, v1, v2) => {
      const row = document.createElement('div'); row.className = 'desk-diffrow';
      row.innerHTML = `<input type="text" placeholder="항목명(예: 사업수익)" value="${esc(nm || '')}">
        <input type="number" step="any" placeholder="결산액" value="${v1 ?? ''}">
        <input type="number" step="any" placeholder="기대치(예산·계획)" value="${v2 ?? ''}">`;
      de.appendChild(row);
    };
    (saved._exp || []).forEach(r => addRowE(r[0], r[1], r[2]));
    if (!de.children.length) addRowE();
    $('#deskExpAdd').onclick = () => addRowE();
    const matCalc = () => {
      const mb = parseFloat(($('#deskForm [data-dk="mb"]') || {}).value), mp = parseFloat(($('#deskForm [data-dk="mp"]') || {}).value);
      const out = $('#matOut');
      if (out) out.textContent = (isFinite(mb) && isFinite(mp) && mb > 0 && mp > 0)
        ? `중요성(허용오류) 금액 ≈ ${fmt(mb * mp / 100)}원 — 이 금액 이상의 전기 대비 변동은 비율과 무관하게 신호로 표시됩니다`
        : '';
    };
    ['mb', 'mp'].forEach(k => { const el = $(`#deskForm [data-dk="${k}"]`); if (el) el.addEventListener('input', matCalc); });
    matCalc();
    $('#deskRun').onclick = runDesk;
    $('#deskClear').onclick = () => { localStorage.removeItem('fa_desk:' + orgOf()); renderDesk(); $('#deskOut').innerHTML = ''; };
    $('#deskOut').innerHTML = '';
  }
  function runDesk() {
    const v = {};
    document.querySelectorAll('#deskForm [data-dk]').forEach(i => { v[i.dataset.dk] = i.value === '' ? null : parseFloat(i.value); });
    const readRows = (sel) => [...document.querySelectorAll(sel + ' .desk-diffrow')].map(r => {
      const [n, x, y] = r.querySelectorAll('input');
      return [n.value.trim(), x.value === '' ? null : parseFloat(x.value), y.value === '' ? null : parseFloat(y.value)];
    }).filter(r => r[0] && r[1] !== null && r[2] !== null);
    const diff = readRows('#deskDiff');
    const exp = readRows('#deskExp');
    localStorage.setItem('fa_desk:' + orgOf(), JSON.stringify({ ...v, _diff: diff, _exp: exp }));
    const F = (n) => n === null || n === undefined || !isFinite(n) ? null : n;
    const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
    const rows = [];   // {name, ok, detail, sig}
    const tie = (name, l, r, need) => {
      if (need.some(x => F(x) === null)) { rows.push({ name, skip: true }); return; }
      const d = l - r;
      rows.push({ name, ok: Math.abs(d) < 1, detail: Math.abs(d) < 1 ? '일치 (차액 0)' : `불일치 — 차액 ${fmt(d)}원`, exc: Math.abs(d) >= 1 });
    };
    tie('① 자산 = 부채 + 자본 (당기)', v.a1, (v.b1 ?? 0) + (v.c1 ?? 0), [v.a1, v.b1, v.c1]);
    tie('①′ 자산 = 부채 + 자본 (전기)', v.a0, (v.b0 ?? 0) + (v.c0 ?? 0), [v.a0, v.b0, v.c0]);
    tie('② 당기순이익 산식 (영업이익+영업외수익−영업외비용−법인세)', v.ni1, (v.op1 ?? 0) + (v.nr1 ?? 0) - (v.ne1 ?? 0) - (v.tx1 ?? 0), [v.ni1, v.op1, v.nr1, v.ne1, v.tx1]);
    tie('③ 현금흐름 (기초+증감 = 기말)', v.cf1, (v.cf0 ?? 0) + (v.cfd ?? 0), [v.cf0, v.cfd, v.cf1]);
    tie('④ 현금흐름표 기말 = 재무상태표 현금 (당기)', v.cf1, v.ch1, [v.cf1, v.ch1]);
    diff.forEach(([nm, x, y]) => tie(`⑤ 차이명세서 대사 — ${nm}`, x, y, [x, y]));
    // 분석적 검토(전기 대비 10% 또는 중요성 금액 이상)
    const mat = (isFinite(v.mb) && isFinite(v.mp) && v.mb > 0 && v.mp > 0) ? v.mb * v.mp / 100 : null;
    const sig = [];
    const chg = (lb, cur, prev) => {
      if (F(cur) === null || F(prev) === null || prev === 0) return;
      const d = cur - prev;
      const p = d / Math.abs(prev) * 100;
      const hitPct = Math.abs(p) >= 10, hitMat = mat !== null && Math.abs(d) >= mat;
      if (hitPct || hitMat) sig.push(`${lb}: ${fmt(prev)} → ${fmt(cur)} (${p > 0 ? '+' : ''}${p.toFixed(1)}%${hitMat && !hitPct ? ' · 10% 미만이지만 중요성 금액 이상' : ''}) — 원인을 구체적 거래로 확인`);
    };
    chg('자산총계', v.a1, v.a0); chg('부채총계', v.b1, v.b0); chg('자본총계', v.c1, v.c0);
    chg('매출액', v.s1, v.s0); chg('영업이익', v.op1, v.op0); chg('당기순이익', v.ni1, v.ni0); chg('현금', v.ch1, v.ch0);
    exp.forEach(([nm, res, ev]) => {
      if (ev === 0) return;
      const d2 = res - ev, p2 = d2 / Math.abs(ev) * 100;
      if (Math.abs(p2) >= 10 || (mat !== null && Math.abs(d2) >= mat)) sig.push(`${nm}(기대치 대비): 기대 ${fmt(ev)} → 결산 ${fmt(res)} (${p2 > 0 ? '+' : ''}${p2.toFixed(1)}%) — 차이 원인을 해석·기록`);
    });
    if (F(v.op1) !== null && v.op1 < 0 && F(v.ni1) !== null && v.ni1 > 0) sig.push('영업손실인데 당기순이익 흑자 — 영업외수익 의존 구조(이자수익·환입 등) 내역 확인');
    // 비율
    const ratio = [];
    if (F(v.b1) !== null && F(v.c1) && v.c1 !== 0) { const r = v.b1 / v.c1 * 100; ratio.push(`부채비율 ${r.toFixed(1)}%` + (r > 200 ? ' ⚠ 200% 초과(공기업 집중관리 기준선)' : '')); }
    if (F(v.ca1) !== null && F(v.cl1) && v.cl1 !== 0) ratio.push(`유동비율 ${(v.ca1 / v.cl1 * 100).toFixed(1)}%`);
    if (F(v.c1) !== null && v.c1 < 0) ratio.push('⚠ 자본총계 음수 — 자본잠식 신호');
    // 렌더
    const done = rows.filter(r => !r.skip), fails = done.filter(r => r.exc);
    let h = `<h3 class="home-sub">검산 결과 — ${done.length}건 수행 · 불일치 ${fails.length}건</h3>`;
    h += done.map(r => `<div class="chk desk-r ${r.ok ? '' : 'bad'}"><div class="q">${r.ok ? '✅' : '🚩'} ${esc(r.name)}</div><div class="co-t">${esc(r.detail)}</div>
      ${r.exc ? `<div class="chips"><button class="chip desk-exc" data-nm="${esc(r.name)}" data-dt="${esc(r.detail)}">＋ 예외로 등록</button></div>` : ''}</div>`).join('');
    const skipped = rows.filter(r => r.skip).length;
    if (skipped) h += `<div class="m">· 입력 미완으로 건너뜀 ${skipped}건</div>`;
    const hasPrev = [v.a0, v.b0, v.c0, v.s0, v.op0, v.ni0, v.ch0].some(x => F(x) !== null);
    const noteKey = 'fa_desknote:' + orgOf();
    let sigNotes = {};
    try { sigNotes = JSON.parse(localStorage.getItem(noteKey) || '{}'); } catch { /* 초기값 */ }
    if (sig.length) h += `<h3 class="home-sub">분석적 검토 신호 (전기 대비 10%${mat !== null ? ' 또는 중요성 금액' : ''} 이상)</h3>` + sig.map(s => {
      const k = s.split(':')[0];
      return `<div class="chk"><div class="co-t">📈 ${esc(s)}</div><input class="doc-in" data-signote="${esc(k)}" placeholder="④ 해석 — 차이 원인 설명(증빙 확인 후 기록)" value="${esc(sigNotes[k] || '')}"></div>`;
    }).join('');
    else if (hasPrev) h += `<h3 class="home-sub">분석적 검토 신호</h3><div class="chk"><div class="co-t">전기 대비 10% 이상 변동 없음</div></div>`;
    if (hasPrev) h += `<div class="m">※ ±10%는 관행적 초기 스크린입니다 — 신호가 없어도 문제가 없다는 뜻이 아니며, 금액이 작아도 질적으로 중요한 사안(채용·수당·반복 오류 등)은 별도 검토가 필요합니다(개념 온보딩 「중요성」 참조).</div>`;
    if (ratio.length) h += `<h3 class="home-sub">비율</h3><div class="chk"><div class="co-t">${ratio.map(esc).join(' · ')}</div></div>`;
    h += `<div class="note">신호는 확인 필요 후보입니다 — 원문·증빙 대조 없이 지적하지 마십시오. 불일치는 예외로 등록해 「감사조서·예외 관리」에서 이어가십시오. <b>검산이 모두 일치해도 「적정」을 뜻하지 않습니다</b> — 이 검사는 결산서 내부 정합만 보며, 장부 대 외부증빙 대사(예금 잔고증명 등)는 별도로 수행해야 합니다.</div>`;
    $('#deskOut').innerHTML = h;
    document.querySelectorAll('#deskOut [data-signote]').forEach(inp => inp.addEventListener('change', () => {
      let ns = {};
      try { ns = JSON.parse(localStorage.getItem(noteKey) || '{}'); } catch { /* 초기값 */ }
      ns[inp.dataset.signote] = inp.value;
      localStorage.setItem(noteKey, JSON.stringify(ns));
    }));
    document.querySelectorAll('.desk-exc').forEach(b => b.addEventListener('click', (e) => {
      excAdd({ 이름: '판독대: ' + b.dataset.nm, 근거: '결산서 판독대 자동 검산', 내용: b.dataset.dt });
      e.target.textContent = '✓ 등록됨'; e.target.disabled = true;
    }));
    $('#deskOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ═══ 예산과목 사전 (통계목 138 — budget_codes 원문) ═══ */
  async function renderBudget() {
    show('budget');
    const data = await load('kb/budget_codes.json');
    if (!data) { $('#bgList').innerHTML = LOAD_FAIL; return; }
    const grps = data.그룹 || [];
    const q = ($('#bgQ').value || '').trim();
    const hit = (t) => !q || (t || '').includes(q);
    let h = '';
    grps.forEach(g => {
      const pms = (g.편성목 || []).filter(p => hit(g.명칭) || hit(p.명칭) || hit(p.코드) || (p.통계목 || []).some(t => hit(t.명칭) || hit(t.코드)));
      if (!pms.length) return;
      h += `<div class="kb-l1">${esc(g.코드)} ${esc(g.명칭)}</div>`;
      pms.forEach(p => {
        h += `<details class="quote-fold" ${q ? 'open' : ''}><summary><b>${esc(p.코드)} ${esc(p.명칭)}</b> · 통계목 ${(p.통계목 || []).length}개</summary>`;
        (p.통계목 || []).forEach(t => {
          if (q && !(hit(t.명칭) || hit(t.코드) || hit(p.명칭))) return;
          h += `<div class="chk"><div class="q">${esc(t.코드)} ${esc(t.명칭)} <span class="b b-lvl">${esc((t.근거 || '').replace(/\[\[|\]\]/g, ''))}</span></div>
            ${t.정의_원문 ? `<div class="quote">${esc(fmtBreaks(t.정의_원문))}</div>` : ''}
            ${(t.편성기준_핵심 || []).length ? `<div class="co-t">${(t.편성기준_핵심 || []).map(x => `<div class="co-li">▸ ${esc(fmtBreaks(x))}</div>`).join('')}</div>` : ''}</div>`;
        });
        if ((p.편성기준_원문요점 || []).length) h += `<div class="m">${(p.편성기준_원문요점 || []).slice(0, 3).map(x => esc(fmtBreaks(x))).join('<br>')}</div>`;
        h += '</details>';
      });
    });
    $('#bgList').innerHTML = h || '<div class="view-p">일치 없음</div>';
  }

  /* ── 진입점·이벤트 ── */
  window.FA_TOOLS = {
    open(tool) {
      if (!orgOf()) { alert('기관유형을 먼저 선택하십시오.'); return; }
      ({ tie: renderTie, risk: renderRisk, cases: renderCases, tree: renderTree, calc: renderCalc, report: renderReport, kb: renderKb, desk: renderDesk, budget: renderBudget,
         lab: () => window.FA_LAB && window.FA_LAB.render() })[tool]();
    },
    expandQuery, // 홈 점검항목 검색이 동일 동의어 확장을 사용
    excAdd,      // 자료 대조실 후보 → 예외 등록 연계
  };
  let caseQT = 0;
  $('#caseQ').addEventListener('input', () => {
    clearTimeout(caseQT);
    caseQT = setTimeout(() => { if (dataStore['cases_fin.json']) filterCases(); }, 150); // 디바운스
  });
  // 데이터 미로드 상태에서 필터 변경이 LOAD_FAIL 안내를 "0건 일치"로 덮지 않도록 가드
  $('#caseSe').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  $('#caseSt').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  $('#caseB').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  $('#caseD').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  let kbQT = 0;
  $('#kbQ').addEventListener('input', () => {
    clearTimeout(kbQT);
    kbQT = setTimeout(async () => { kbPaint(await loadKb()); }, 180);
  });
  let bgQT = 0;
  const bgEl = $('#bgQ');
  if (bgEl) bgEl.addEventListener('input', () => { clearTimeout(bgQT); bgQT = setTimeout(() => { if (dataStore['kb/budget_codes.json']) renderBudget(); }, 200); });
  // C안 토글: 지적례 계정 ↔ 전체 계정
  document.querySelectorAll('#kbMode button').forEach(b => b.addEventListener('click', async () => {
    kbAll = b.dataset.mode === 'all';
    localStorage.setItem('fa_kb_all', kbAll ? '1' : '0');
    kbPaint(await loadKb());
  }));
  // AI회계사 시작 패널(홈)
  let advT = 0;
  const advEl = $('#advQ');
  if (advEl) {
    advEl.addEventListener('input', () => { clearTimeout(advT); advT = setTimeout(advise, 250); });
    advEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(advT); advise(); } });
  }
  $('#caseMore').addEventListener('click', moreCases);
  $('#btnDraft').addEventListener('click', makeDraft);
  $('#btnDocs').addEventListener('click', makeDocs);
  $('#btnCopy').addEventListener('click', (e) => copyText($('#draftOut').value).then(ok => { e.target.textContent = ok ? '✓ 복사됨' : '복사 실패'; }));
  $('#btnDown').addEventListener('click', () => {
    const blob = new Blob([$('#draftOut').value], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${lastGen.kind || '산출물'}_${orgOf()}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  // 예외·관찰 내보내기/가져오기 — 차기 감사(다른 PC·담당자) 이월용
  $('#btnExcExp').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ org: orgOf(), exported: new Date().toISOString().slice(0, 10), items: excAll() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `예외관찰_${orgOf()}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#btnExcImpBtn').addEventListener('click', () => $('#btnExcImp').click());
  $('#btnExcImp').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        const inc = Array.isArray(d) ? d : (d.items || []);
        if (!Array.isArray(inc) || !inc.length) { alert('가져올 예외 항목이 없습니다.'); return; }
        if (d.org && d.org !== orgOf() && !confirm(`파일의 기관유형(${d.org})이 현재(${orgOf()})와 다릅니다. 그래도 가져올까요?`)) return;
        const cur = excAll();
        const key = (x) => [x.이름, x.내용, x.ts].join('|');
        const seen = new Set(cur.map(key));
        let n = 0;
        inc.forEach(x => { if (x && x.이름 && !seen.has(key(x))) { cur.push(x); seen.add(key(x)); n += 1; } });
        excSave(cur); renderReport();
        alert(`${n}건 가져왔습니다 (중복 ${inc.length - n}건 제외).`);
      } catch { alert('JSON 해석 실패 — 「예외 내보내기」로 생성한 파일인지 확인하십시오.'); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });
  $('#btnWipe').addEventListener('click', () => {
    if (!confirm(`「${orgOf()}」의 저장 데이터(응답·검산 입력·예외)를 이 브라우저에서 전부 삭제할까요? 되돌릴 수 없습니다.`)) return;
    ['fa_resp:', 'fa_tie:', 'fa_exc:', 'fa_tree:', 'fa_calc:'].forEach(p => localStorage.removeItem(p + orgOf()));
    $('#draftOut').value = ''; lastGen = { kind: '', value: '' };
    renderReport();
  });

  // 딥링크 보정: 초기 라우팅이 tools.js 로드 전에 실행됨 — 도구 뷰 해시면 여기서 렌더
  const _dv = (location.hash || '').slice(1);
  if (orgOf() && ({ tie: 1, risk: 1, cases: 1, tree: 1, calc: 1, report: 1, kb: 1, desk: 1, budget: 1 })[_dv]) {
    try { window.FA_TOOLS.open(_dv); } catch (e) {}
  }
})();