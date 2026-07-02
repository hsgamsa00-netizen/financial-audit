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
    list.push({ ...e, 상태: '미해결', 메모: '', ts: new Date().toISOString().slice(0, 16).replace('T', ' ') });
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
            excAdd({ src: '검산', 이름: r.이름, 내용: `좌변 ${fmt(sum('L'))} ≠ 우변 ${fmt(sum('R'))}`, 금액차이: diff, 근거: r.근거조문 });
            eb.textContent = '✓ 예외 등록됨'; eb.disabled = true;
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
          <select data-ar="cr" aria-label="통제위험"><option value="0.4">낮음 (분리·대사·전산통제 양호)</option><option value="0.7" selected>중간</option><option value="1">높음 (회계직 미분리·비밀번호 공유·장기보직)</option></select></div>
      </div>
      <div class="rule" data-ar-out></div>
    </div>`;
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
    const terms = q ? expandQuery(q) : [];
    caseView.list = all.filter(c =>
      (!q || terms.some(t => c.t.includes(t))) && (!se || c.se === se) && (!st || c.st === st));
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
      d.className = 'case';
      d.innerHTML = `<div class="t"><span class="b ${c.se === '화성' ? 'se-hs' : 'se-bai'}">${esc(c.se === '화성' ? '화성특례시' : c.se)}</span> ${esc(c.t)}</div>
        <div class="m">${esc(c.y)} · srno ${esc(c.s)} ${c.ax && c.ax !== '분야축' ? '· 확장검색' : ''}</div>
        <div class="meta">${(c.b || []).map(b => `<span class="b b-area">${esc(b)}</span>`).join('')}${(c.d || []).map(x => `<span class="b b-lvl">${esc(x)}</span>`).join('')}<span class="b ${cls}">${lb}</span></div>
        <div class="chips"><button class="chip" data-copy>제목 복사</button><a class="chip" href="https://hsgamsa00-netizen.github.io/Giljabi/" target="_blank" rel="noopener">감사 길잡이에서 검색 ↗</a></div>`;
      d.querySelector('[data-copy]').addEventListener('click', (e) => {
        copyText(c.t).then(ok => { e.target.textContent = ok ? '✓ 복사됨' : '복사 실패'; });
      });
      box.appendChild(d);
    });
    $('#caseMore').hidden = caseView.shown >= caseView.list.length;
  }

  /* ═══ 처분수위 판단트리 ═══ */
  function renderTree() {
    const box = $('#treeBox');
    box.innerHTML = `
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
      <div class="note info">본 트리의 결과는 검토 방향 안내이며 처분 확정이 아닙니다. 유사 선례의 처분 분포는 사례 참조에서 확인하십시오.</div>`;
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
    box.querySelectorAll('input[data-t3]').forEach(x => x.addEventListener('change', () => {
      const n = [...box.querySelectorAll('input[data-t3]')].filter(c => c.checked).length;
      t3v.textContent = n === 6 ? '6요건 전부 충족 → 변상판정 검토 (반론·책임조각사유 재확인 필수)'
        : `충족 ${n}/6 → 일부 미충족 시 징계·문책 / 주의요구 검토`;
    }));
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
    $('#repSummary').innerHTML = `<div class="chk"><div class="q">${esc(orgOf())} — 진행 요약</div>
      <div class="rule">응답 ${answered.length}/${items.length}건 · 지적 후보(아니오) ${nos.length}건 · 검산 예외 ${exc.length}건</div></div>`;
    const et = $('#excTable');
    et.innerHTML = exc.length ? `<table class="xt"><tr><th>출처</th><th>항목</th><th>내용</th><th>상태</th><th>메모</th><th></th></tr>${
      exc.map((e, i) => `<tr><td>${esc(e.src)}</td><td>${esc(e.이름)}</td><td>${esc(e.내용)}</td>
        <td><select data-xs="${i}">${['미해결', '설명가능', '지적후보'].map(s => `<option ${e.상태 === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input data-xm="${i}" value="${esc(e.메모 || '')}" placeholder="원인·조치 메모"></td>
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

  function makeDraft() {
    const items = scopedItems();
    const resp = window.FA.respAll();
    const nos = items.filter(it => resp[it.id] && resp[it.id].a === '아니오');
    const exc = excAll();
    const d = new Date().toISOString().slice(0, 10);
    let md = `# 감사조서 초안 — ${orgOf()} 재무감사 점검\n\n작성일: ${d} · 도구: 재무감사 도우미(결정론 점검·초안 보조)\n\n`;
    const answeredN = items.filter(it => resp[it.id] && resp[it.id].a).length; // 화면 요약과 동일 범위
    md += `## 1. 점검 개요\n- 기관유형: ${orgOf()}\n- 적용 기준: ${orgOf() === '지자체' ? '지방자치단체 결산 통합기준' : orgOf() === '지방공기업' ? '2025사업연도 지방공기업 결산기준' : '2025사업연도 지방출자·출연기관 결산기준'}\n- 응답 항목: ${answeredN}건 / 지적 후보 ${nos.length}건 / 검산 예외 ${exc.length}건\n\n`;
    if (exc.length) {
      md += `## 2. 정합성 검산 예외\n`;
      exc.forEach((e, i) => {
        md += `\n### 2-${i + 1}. ${e.이름} [${e.상태}]\n- 검사규칙(근거): ${String(e.근거 || '').replace(/\s+/g, ' ').slice(0, 200)}\n- 예외 내용: ${e.내용}${e.금액차이 ? ` (차이 ${Math.abs(e.금액차이).toLocaleString()}원)` : ''}\n- 원인 가설: ${e.메모 || '(기재 필요)'}\n- 추가 요구자료: (기재 필요)\n- 검토자 결론: (기재 필요)\n`;
      });
      md += '\n';
    }
    if (nos.length) {
      md += `## 3. 체크리스트 지적 후보\n`;
      nos.forEach((it, i) => {
        md += `\n### 3-${i + 1}. ${it.착안질문}\n- 영역: ${it.영역 || ''} · 근거 라벨: 기준 직접근거\n- 근거조문(원문): ${String(it.근거조문 || '').replace(/\s+/g, ' ').slice(0, 300)}\n- 확인 서류: ${resp[it.id].doc || '(기재 필요)'}\n- 사실관계·원인·개선방향·조치: (기재 필요 — 사실+원인+개선+처분 구조로)\n`;
      });
      md += '\n';
    }
    md += `## 4. 유의사항\n- 본 초안은 합리적 확신 수준의 점검 보조 자료이며 처분·지적 확정이 아님.\n- 인용 수치·조문은 원문과 대조 후 사용할 것.\n`;
    const out = $('#draftOut');
    out.value = md; out.hidden = false; $('#draftBar').hidden = false;
  }

  function makeDocs() {
    const items = scopedItems();
    const docs = new Set();
    items.forEach(it => (it.필요서류 || []).forEach(x => docs.add(x)));
    const out = $('#draftOut');
    out.value = `# 자료요구 목록(안) — ${orgOf()}\n\n` + [...docs].map((x, i) => `${i + 1}. ${x}`).join('\n') + '\n\n※ 점검 모듈 범위에 따라 취사선택하십시오.';
    out.hidden = false; $('#draftBar').hidden = false;
  }

  /* ── 진입점·이벤트 ── */
  window.FA_TOOLS = {
    open(tool) {
      if (!orgOf()) { alert('기관유형을 먼저 선택하십시오.'); return; }
      ({ tie: renderTie, risk: renderRisk, cases: renderCases, tree: renderTree, calc: renderCalc, report: renderReport })[tool]();
    },
  };
  let caseQT = 0;
  $('#caseQ').addEventListener('input', () => {
    clearTimeout(caseQT);
    caseQT = setTimeout(() => { if (dataStore['cases_fin.json']) filterCases(); }, 150); // 디바운스
  });
  // 데이터 미로드 상태에서 필터 변경이 LOAD_FAIL 안내를 "0건 일치"로 덮지 않도록 가드
  $('#caseSe').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  $('#caseSt').addEventListener('change', () => { if (dataStore['cases_fin.json']) filterCases(); });
  $('#caseMore').addEventListener('click', moreCases);
  $('#btnDraft').addEventListener('click', makeDraft);
  $('#btnDocs').addEventListener('click', makeDocs);
  $('#btnCopy').addEventListener('click', (e) => copyText($('#draftOut').value).then(ok => { e.target.textContent = ok ? '✓ 복사됨' : '복사 실패'; }));
  $('#btnDown').addEventListener('click', () => {
    const blob = new Blob([$('#draftOut').value], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `감사조서초안_${orgOf()}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  });
})();
