/* 재무감사 도우미 — 서비스워커(오프라인·망분리 대응)
   전략: 앱 셸(assets·index)=cache-first / 데이터(data/*.json)=network-first(오프라인 시 캐시 폴백)
   → 데이터는 온라인이면 항상 최신, 셸은 VERSION 범프로 갱신 */
'use strict';
const VERSION = 'fa-v3';
const SHELL = [
  './', 'index.html',
  'assets/tokens.css', 'assets/app.css',
  'assets/norm_dict.js', 'assets/app.js', 'assets/tools.js',
];

self.addEventListener('install', (e) => {
  // no-cache: 브라우저 HTTP 캐시의 구본이 새 캐시에 담기는 것 방지(스테일 셸 사고)
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (url.pathname.includes('/data/')) {
    // 데이터: network-first — 신선도 우선, 오프라인만 캐시
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  } else {
    // 셸: cache-first
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    })));
  }
});
