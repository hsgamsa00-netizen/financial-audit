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
};

let CHECKITEMS = [];
let CONCEPTS = [];

const $ = (sel) => document.querySelector(sel);
const views = ['gate', 'home', 'check', 'concepts', 'tie', 'risk', 'cases', 'tree', 'calc', 'report'];
let curMod = '';        // 현재 열려 있는 체크리스트 모듈
let navByHash = false;  // hashchange 유래 전환(중복 push 방지)

function curView() { return views.find(v => !$('#v-' + v).hidden); }

function show(view) {
  views.forEach(v => { $('#v-' + v).hidden = (v !== view); });
  $('#orgChip').hidden = !S.org;
  $('#lvlWrap').hidden = !S.org;
  $('#gateBack').hidden = !(view === 'gate' && S.org);
  if (S.org) $('#orgChip').textContent = '🏛 ' + S.org + ' (변경)';
  if (!navByHash && location.hash !== '#' + view) location.hash = view; // 뒤로가기 지원
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
  if (v === 'gate') { show('gate'); return; }
  if (!S.org) { show('gate'); return; }
  if (v === 'home') { renderHome(); show('home'); }
  else if (v === 'check') { curMod ? renderCheck(curMod) : (renderHome(), show('home')); }
  else if (v === 'concepts') { renderConcepts(''); }
  else if (window.FA_TOOLS) { window.FA_TOOLS.open(v); }
}

function itemsFor(mod) {
  return CHECKITEMS.filter(it =>
    (it.기관유형 || []).includes(S.org) &&
    it.모듈 === mod &&
    (S.lvl === '심화' || it.난이도 !== '심화'));
}

function renderHome() {
  const grid = $('#modGrid');
  grid.innerHTML = '';
  MODULES.forEach(m => {
    const n = itemsFor(m.key).length;
    const b = document.createElement('button');
    b.className = 'mod-card' + (n ? '' : ' empty');
    b.innerHTML = `<h3>${m.icon} ${m.key}</h3><div class="cnt">${n ? `착안질문 ${n}건` : '준비 중'}</div><div class="cnt">${m.desc}</div>`;
    if (n) b.addEventListener('click', () => renderCheck(m.key));
    grid.appendChild(b);
  });
}

function respAll() {
  try { return JSON.parse(localStorage.getItem('fa_resp:' + S.org) || '{}'); } catch { return {}; }
}
function respSave(all) { localStorage.setItem('fa_resp:' + S.org, JSON.stringify(all)); }

function renderCheck(mod) {
  curMod = mod;
  $('#chkTitle').textContent = `${mod} — ${S.org} 점검 착안사항`;
  const list = $('#chkList');
  list.innerHTML = '';
  const resp = respAll();
  itemsFor(mod).forEach(it => {
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
      ${it.근거조문 ? `<div class="quote">${esc(it.근거조문)}</div>` : ''}
      ${it.red_flag ? `<div class="flag">🚩 ${esc(it.red_flag)}</div>` : ''}
      ${(it.필요서류 || []).length ? `<div class="docs">📄 필요서류: ${(it.필요서류 || []).map(esc).join(' · ')}</div>` : ''}
      <div class="ans-row">
        ${['예', '아니오', '해당없음'].map(a =>
          `<label class="rad"><input type="radio" name="a_${esc(it.id)}" value="${a}" ${r.a === a ? 'checked' : ''}>${a === '아니오' ? '아니오(지적 후보)' : a}</label>`).join('')}
        <input type="text" class="doc-in" placeholder="확인한 근거서류" value="${esc(r.doc || '')}">
      </div>`;
    d.querySelectorAll(`input[name="a_${it.id}"]`).forEach(x =>
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
      }));
    d.querySelector('.doc-in').addEventListener('change', (e) => {
      const all = respAll();
      all[it.id] = { ...(all[it.id] || {}), doc: e.target.value };
      respSave(all);
    });
    list.appendChild(d);
  });
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
  b.addEventListener('click', () => { S.org = b.dataset.org; renderHome(); show('home'); }));
$('#orgChip').addEventListener('click', () => show('gate'));
$('#gateBack').addEventListener('click', () => { renderHome(); show('home'); });
document.querySelectorAll('.lvl button').forEach(b =>
  b.addEventListener('click', () => {
    S.lvl = b.dataset.lvl;
    document.querySelectorAll('.lvl button').forEach(x => x.classList.toggle('on', x === b));
    renderHome();
    if (!$('#v-check').hidden && curMod) renderCheck(curMod); // 보던 모듈 유지한 채 갱신
  }));
document.querySelectorAll('.back').forEach(b =>
  b.addEventListener('click', () => show('home')));
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
Promise.all([
  fetch('data/checkitems.json').then(r => r.ok ? r.json() : null).catch(() => null),
  fetch('data/concepts.json').then(r => r.ok ? r.json() : null).catch(() => null),
]).then(([items, concepts]) => {
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
  if (cur && cur !== 'gate') { renderHome(); return; } // 사용자가 이미 다른 뷰에 있으면 강제 이동 금지
  const h = location.hash.slice(1);
  if (S.org && views.includes(h) && h !== 'gate') { renderHome(); openView(h); }
  else if (S.org) { renderHome(); show('home'); }
  else { show('gate'); }
});
