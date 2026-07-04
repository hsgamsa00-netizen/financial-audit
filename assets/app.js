/* 재무감사 도우미 — 앱 로직 (정적·런타임 LLM 0)
   상태: 기관유형(localStorage) → 5모듈 홈 → 체크리스트(checkitems.json) */
'use strict';

const MODULES = [
  { key: '세입', icon: '💰', desc: '부과·징수·감면·결손·제척기간' },
  { key: '세출', icon: '📤', desc: '목적외·회계연도·통계목·인건비·계약' },
  { key: '보조금·출연금', icon: '🤝', desc: '교부·정산·환수·계정분류' },
  { key: '재산·물품', icon: '🏢', desc: '현금·예금·유형자산·대장 대사' },
  { key: '손해·변상', icon: '⚖️', desc: '변상 6요건·회계직 책임' },
  { key: '결산·재무제표', icon: '📊', desc: '결산서 완비·정합성·공시' },
  { key: '재무건전성', icon: '📈', desc: '부채·지표·검산(cross-tie)' },
];

const S = {
  get org() { return localStorage.getItem('fa_org') || ''; },
  set org(v) { localStorage.setItem('fa_org', v); },
  get lvl() { return localStorage.getItem('fa_lvl') || '진입'; },
  set lvl(v) { localStorage.setItem('fa_lvl', v); },
  get theme() {
    return localStorage.getItem('fa_theme')
      || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  },
  set theme(v) { localStorage.setItem('fa_theme', v); },
};

/* 테마는 최우선 적용(깜빡임 최소화) */
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  const b = document.getElementById('themeBtn');
  if (b) b.textContent = S.theme === 'dark' ? '☀️' : '🌙';
}
applyTheme();

let CHECKITEMS = [];
let CONCEPTS = [];

const $ = (sel) => document.querySelector(sel);
const views = ['gate', 'home', 'check', 'concepts', 'tie', 'risk', 'cases', 'tree', 'calc', 'report', 'kb'];
let curMod = '';        // 현재 열려 있는 체크리스트 모듈
let navByHash = false;  // hashchange 유래 전환(중복 push 방지)

function curView() { return views.find(v => !$('#v-' + v).hidden); }

function show(view) {
  views.forEach(v => { $('#v-' + v).hidden = (v !== view); });
  $('#orgChip').hidden = !S.org;
  $('#lvlWrap').hidden = !S.org;
  $('#gateBack').hidden = !(view === 'gate' && S.org);
  if (S.org) $('#orgChip').textContent = '🏛 ' + S.org + ' (변경)';
  if (!navByHash && location.hash !== '#' + view) {
    // 최초 진입(해시 없음)은 replace — 빈 히스토리 항목이 뒤로가기를 한 번 잡아먹지 않도록
    if (!location.hash) history.replaceState(null, '', '#' + view);
    else location.hash = view;
  }
  window.scrollTo(0, 0);
}

/* 해시 → 뷰 (브라우저 뒤로/앞으로) */
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (!views.includes(v) || v === curView()) return;
  navByHash = true;
  try { openView(v); } finally { navByHash = false; }
});

function openView(v) {
  // 폴백으로 다른 뷰를 보여줄 때 해시도 함께 교정(navByHash 중에도 replaceState는 안전)
  const fallback = (view) => {
    renderHome(); show(view === 'home' ? 'home' : view);
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  };
  if (v === 'gate') { show('gate'); return; }
  if (v === 'concepts') { renderConcepts(''); return; } // 개념 온보딩은 기관 미선택도 허용(게이트 도움 진입점)
  if (!S.org) { show('gate'); if (location.hash !== '#gate') history.replaceState(null, '', '#gate'); return; }
  if (v === 'home') { renderHome(); show('home'); }
  else if (v === 'check') {
    if (!curMod) curMod = localStorage.getItem('fa_mod') || ''; // 새로고침 복원
    (curMod && itemsFor(curMod).length) ? renderCheck(curMod) : fallback('home');
  }
  else if (window.FA_TOOLS) { window.FA_TOOLS.open(v); }
}

function itemsFor(mod) {
  return CHECKITEMS.filter(it =>
    (it.기관유형 || []).includes(S.org) &&
    it.모듈 === mod &&
    (S.lvl === '심화' || it.난이도 !== '심화'));
}

function itemsForAllLvl(mod) {
  return CHECKITEMS.filter(it => (it.기관유형 || []).includes(S.org) && it.모듈 === mod);
}

function renderHome() {
  // 첫 방문 1회 권장 순서 안내
  const fg = $('#firstGuide');
  if (!localStorage.getItem('fa_seen') && fg) {
    fg.innerHTML = `<div class="note info" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <span>🧭 <b>처음이신가요?</b> 위 입력창에 감사 중인 문제를 적거나, ① 🧮 자료 넣고 검증 → ② 📒 계정과목별 감사계획 → ③ 📋 조서 생성 순서로 시작하세요. 용어가 낯설면 📘 개념 온보딩.</span>
      <button class="chip" id="fgClose">닫기</button></div>`;
    fg.querySelector('#fgClose').addEventListener('click', () => { localStorage.setItem('fa_seen', '1'); fg.innerHTML = ''; });
  } else if (fg) fg.innerHTML = '';

  const resp = respAll();
  const grid = $('#modGrid');
  grid.innerHTML = '';
  MODULES.forEach(m => {
    const list = itemsFor(m.key);
    const n = list.length;
    const nAll = itemsForAllLvl(m.key).length;
    const done = list.filter(it => resp[it.id] && resp[it.id].a).length;
    const b = document.createElement('button');
    b.className = 'mod-card' + (n ? '' : ' empty');
    // 0건 사유 분기: 심화 전용 vs 이 기관유형 해당 없음
    const cntTxt = n ? `착안질문 ${n}건 · 응답 ${done}/${n}${done === n && n ? ' ✓' : ''}`
      : (nAll ? `심화 전환 시 ${nAll}건` : '이 기관유형은 해당 항목 없음');
    b.innerHTML = `<h3>${m.icon} ${m.key}</h3><div class="cnt">${cntTxt}</div><div class="cnt">${m.desc}</div>`;
    if (n) b.addEventListener('click', () => renderCheck(m.key));
    else b.setAttribute('aria-disabled', 'true');
    grid.appendChild(b);
  });
}

/* 홈 전역 점검항목 검색(동의어 확장) */
function searchItems() {
  const q = ($('#itemQ').value || '').trim();
  const out = $('#itemQOut');
  if (!q) { out.innerHTML = ''; return; }
  const expand = (window.FA_TOOLS && window.FA_TOOLS.expandQuery) ? window.FA_TOOLS.expandQuery : (x) => [x];
  const terms = expand(q);
  const pool = CHECKITEMS.filter(it => (it.기관유형 || []).includes(S.org) && (S.lvl === '심화' || it.난이도 !== '심화'));
  const hits = pool.filter(it => {
    const hay = [it.착안질문, it.영역, ...(it.필요서류 || [])].join(' ');
    return terms.some(t => hay.includes(t));
  }).slice(0, 12);
  out.innerHTML = hits.length
    ? hits.map(it => `<button class="item-hit" data-mod="${esc(it.모듈)}" data-id="${esc(it.id)}"><span class="b b-area">${esc(it.모듈)}</span> ${esc(it.착안질문)}</button>`).join('')
    : `<div class="view-p">일치하는 점검항목이 없습니다${terms.length > 1 ? ` (동의어 확장: ${terms.join(', ')})` : ''}.</div>`;
  out.querySelectorAll('.item-hit').forEach(b => b.addEventListener('click', () => {
    renderCheck(b.dataset.mod);
    setTimeout(() => {
      const el = document.querySelector(`input[name="a_${CSS.escape(b.dataset.id)}"]`);
      if (el) el.closest('.chk').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }));
}

function respAll() {
  try { return JSON.parse(localStorage.getItem('fa_resp:' + S.org) || '{}'); } catch { return {}; }
}
function respSave(all) { localStorage.setItem('fa_resp:' + S.org, JSON.stringify(all)); }

function renderCheck(mod) {
  curMod = mod;
  localStorage.setItem('fa_mod', mod); // 새로고침·딥링크 복원용
  $('#chkTitle').textContent = `${mod} — ${S.org} 점검 착안사항`;
  const list = $('#chkList');
  list.innerHTML = '';
  const resp = respAll();
  const items = itemsFor(mod);
  const done = items.filter(it => resp[it.id] && resp[it.id].a).length;
  // 상단 상태줄: 진행·난이도 범위·미응답 점프
  const head = document.createElement('div');
  head.className = 'chk-head';
  head.innerHTML = `<span>응답 <b>${done}/${items.length}</b>${S.lvl === '심화' ? ' · 심화 포함' : ' · 진입 문항만'}</span>
    ${done < items.length ? '<button class="chip" data-jump>미응답 항목으로 이동</button>' : '<span class="b b-ev">모듈 완료 ✓</span>'}`;
  const jump = head.querySelector('[data-jump]');
  if (jump) jump.addEventListener('click', () => {
    const first = items.find(it => !(resp[it.id] && respAll()[it.id].a));
    const el = first && document.querySelector(`input[name="a_${CSS.escape(first.id)}"]`);
    if (el) el.closest('.chk').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  list.appendChild(head);
  items.forEach(it => {
    const r = resp[it.id] || {};
    const d = document.createElement('div');
    d.className = 'chk';
    d.innerHTML = `
      <div class="q">${esc(it.착안질문)}</div>
      <div class="meta">
        <span class="b b-area">${esc(it.영역 || '')}</span>
        <span class="b b-lvl">${esc(it.난이도 || '진입')}</span>
        <span class="b b-ev">기준 직접근거</span>
        ${it.서식번호 ? `<span class="b b-lvl">서식 ${esc(it.서식번호)}</span>` : ''}
      </div>
      ${it.판정규칙 ? `<div class="rule">판정: ${esc(it.판정규칙)}</div>` : ''}
      ${it.근거조문 ? `<details class="quote-fold"><summary>근거조문(원문) 보기</summary><div class="quote">${esc(it.근거조문)}</div></details>` : ''}
      ${it.red_flag ? `<div class="flag">🚩 ${esc(it.red_flag)}</div>` : ''}
      ${(it.필요서류 || []).length ? `<div class="docs">📄 필요서류: ${(it.필요서류 || []).map(esc).join(' · ')}</div>` : ''}
      <div class="ans-row">
        ${['예', '아니오', '해당없음'].map(a =>
          `<label class="rad"><input type="radio" name="a_${esc(it.id)}" value="${a}" ${r.a === a ? 'checked' : ''}>${a === '아니오' ? '아니오(지적 후보)' : a}</label>`).join('')}
        <input type="text" class="doc-in" placeholder="확인한 근거서류" value="${esc(r.doc || '')}">
      </div>
      <div class="no-extra" ${r.a === '아니오' ? '' : 'hidden'}>
        <span class="no-fb">🚩 조서의 「지적 후보」에 등록됨 — 발견 내용을 메모해 두면 초안에 자동 반영됩니다</span>
        <textarea class="note-in" placeholder="발견 내용 메모 (어느 계좌·얼마·언제 — 조서 초안 사실관계 줄에 프리필)">${esc(r.note || '')}</textarea>
      </div>`;
    d.querySelectorAll(`input[name="a_${CSS.escape(it.id)}"]`).forEach(x =>
      x.addEventListener('click', () => {
        const all = respAll();
        if ((all[it.id] || {}).a === x.value) {
          // 같은 값 재클릭 = 응답 해제(오클릭한 '아니오'가 지적 후보에 남는 것 방지)
          x.checked = false;
          all[it.id] = { ...(all[it.id] || {}), a: '' };
        } else {
          all[it.id] = { ...(all[it.id] || {}), a: x.value };
        }
        respSave(all);
        d.querySelector('.no-extra').hidden = (all[it.id].a !== '아니오');
      }));
    d.querySelector('.doc-in').addEventListener('change', (e) => {
      const all = respAll();
      all[it.id] = { ...(all[it.id] || {}), doc: e.target.value };
      respSave(all);
    });
    d.querySelector('.note-in').addEventListener('change', (e) => {
      const all = respAll();
      all[it.id] = { ...(all[it.id] || {}), note: e.target.value };
      respSave(all);
    });
    list.appendChild(d);
  });
  // 하단 CTA: 다음 행동 안내
  const foot = document.createElement('div');
  foot.className = 'btnbar';
  const noN = items.filter(it => { const r = respAll()[it.id]; return r && r.a === '아니오'; }).length;
  foot.innerHTML = `<button class="btn" data-to-report>📋 지적 후보 ${noN}건 → 감사조서·예외 관리로</button>`;
  foot.querySelector('[data-to-report]').addEventListener('click', () => window.FA_TOOLS && window.FA_TOOLS.open('report'));
  list.appendChild(foot);
  show('check');
}

function renderConcepts(cat) {
  const cats = [...new Set(CONCEPTS.map(c => c.분류))];
  const f = $('#conFilter');
  f.innerHTML = '';
  ['전체', ...cats].forEach(c => {
    const b = document.createElement('button');
    b.className = 'con-chip' + ((c === (cat || '전체')) ? ' on' : '');
    b.textContent = c;
    b.addEventListener('click', () => renderConcepts(c === '전체' ? '' : c));
    f.appendChild(b);
  });
  const list = $('#conList');
  list.innerHTML = '';
  CONCEPTS.filter(c => !cat || c.분류 === cat).forEach(c => {
    const d = document.createElement('div');
    d.className = 'chk';
    d.innerHTML = `
      <div class="q">${esc(c.용어)}</div>
      <div class="meta"><span class="b b-area">${esc(c.분류)}</span></div>
      <div class="rule">${esc(c.초심자설명)}</div>
      ${c.예시 ? `<div class="quote">예시 — ${esc(c.예시)}</div>` : ''}
      ${c.함정 ? `<div class="flag">🚩 ${esc(c.함정)}</div>` : ''}`;
    list.appendChild(d);
  });
  show('concepts');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 이벤트 ── */
document.querySelectorAll('.gate-card').forEach(b =>
  b.addEventListener('click', () => {
    if (S.org && S.org !== b.dataset.org) {
      const d = document.getElementById('draftOut');
      if (d) d.value = ''; // 기관 전환 시 이전 기관 초안 잔존 방지
    }
    S.org = b.dataset.org; renderHome(); show('home');
  }));
$('#gateConcepts').addEventListener('click', () => renderConcepts(''));
$('#itemQ').addEventListener('input', () => { clearTimeout(window.__itemQT); window.__itemQT = setTimeout(searchItems, 150); });
// 점검항목(기관 자기점검) — 부록 토글: 모듈 그리드+검색바 표시
const bc = $('#btnChecklist');
if (bc) bc.addEventListener('click', () => {
  const g = $('#modGrid'), bar = $('#itemQ').closest('.case-bar');
  const showNow = g.hidden;
  g.hidden = !showNow; if (bar) bar.hidden = !showNow;
  if (showNow) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// 감사 4단계 바 → 해당 도구 연결
const STEP_GO = ['risk', null, 'tie', 'report'];
document.querySelectorAll('.steps div').forEach((el, i) => {
  const t = STEP_GO[i];
  if (!t) return;
  el.classList.add('step-link');
  el.setAttribute('role', 'button');
  el.addEventListener('click', () => window.FA_TOOLS && window.FA_TOOLS.open(t));
});
$('#orgChip').addEventListener('click', () => show('gate'));
$('#gateBack').addEventListener('click', () => { renderHome(); show('home'); });
$('#themeBtn').addEventListener('click', () => { S.theme = (S.theme === 'dark' ? 'light' : 'dark'); applyTheme(); });
document.querySelectorAll('.lvl button').forEach(b =>
  b.addEventListener('click', () => {
    S.lvl = b.dataset.lvl;
    document.querySelectorAll('.lvl button').forEach(x => x.classList.toggle('on', x === b));
    renderHome();
    if (!$('#v-check').hidden && curMod) renderCheck(curMod); // 보던 모듈 유지한 채 갱신
    else if (!$('#v-report').hidden && window.FA_TOOLS) window.FA_TOOLS.open('report'); // 조서 요약도 난이도 범위 갱신
  }));
document.querySelectorAll('.back').forEach(b =>
  b.addEventListener('click', () => { S.org ? (renderHome(), show('home')) : show('gate'); }));
$('#btnConcepts').addEventListener('click', () => renderConcepts(''));
document.querySelectorAll('[data-tool]').forEach(b =>
  b.addEventListener('click', () => window.FA_TOOLS && window.FA_TOOLS.open(b.dataset.tool)));

/* tools.js 공유 인터페이스 */
window.FA = {
  get S() { return S; },
  esc, show,
  items: () => CHECKITEMS,
  itemsFor,
  respAll,
};

/* ── 초기화 ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 미지원·file:// 등 — 앱 동작에 영향 없음 */ });
}

// DOMContentLoaded 대기: SW 캐시로 fetch가 수 ms에 끝나면 tools.js 파싱 전에 .then이 돌아
// FA_TOOLS 미정의로 딥링크가 조용히 무시되는 경합이 실측됨 — 전 스크립트 실행 후로 고정
const domReady = new Promise(res =>
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', res) : res());

Promise.all([
  fetch('data/checkitems.json').then(r => r.ok ? r.json() : null).catch(() => null),
  fetch('data/concepts.json').then(r => r.ok ? r.json() : null).catch(() => null),
  domReady,
]).then(([items, concepts]) => {
  try {
  const failed = items === null;
  CHECKITEMS = Array.isArray(items) ? items : [];
  CONCEPTS = Array.isArray(concepts) ? concepts : [];
  document.querySelectorAll('.lvl button').forEach(x => x.classList.toggle('on', x.dataset.lvl === S.lvl));
  if (failed) {
    const n = document.createElement('div');
    n.className = 'note danger';
    n.textContent = '⚠ 점검표 데이터를 불러오지 못했습니다. 네트워크 확인 후 새로고침하십시오.';
    $('#v-home').prepend(n);
  }
  const cur = curView();
  if (cur && cur !== 'gate') {
    // 사용자가 이미 다른 뷰에 있으면 강제 이동 없이 그 뷰만 새 데이터로 재렌더
    renderHome();
    if (cur === 'concepts') renderConcepts('');
    else if (cur === 'check' && curMod) renderCheck(curMod);
    else if (cur === 'report' && window.FA_TOOLS) window.FA_TOOLS.open('report');
    return;
  }
  const h = location.hash.slice(1);
  if (S.org) {
    renderHome();
    if (views.includes(h) && h !== 'gate' && h !== 'home') openView(h);
    else show('home');
  } else { show('gate'); }
  } catch (e) {
    console.error('[FA init]', e); // 초기화 실패가 조용히 게이트에 머무는 것 방지
    try { show(S.org ? 'home' : 'gate'); } catch { /* noop */ }
  }
});
