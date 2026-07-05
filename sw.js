/* 재무감사 도우미 — 서비스워커(오프라인·망분리 대응)
   전략: 앱 셸=stale-while-revalidate(캐시 즉시 서빙+백그라운드 갱신 → 버전 범프 규율 불요)
        데이터(data/*.json)=network-first(오프라인 시 캐시 폴백) */
'use strict';
const VERSION = 'fa-v13';
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
    // 셸: stale-while-revalidate — 캐시 즉시 응답 + 뒤에서 갱신(다음 로드에 새 버전)
    e.respondWith(caches.match(e.request).then(hit => {
      const refresh = fetch(new Request(e.request, { cache: 'no-cache' })).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return r;
      }).catch(() => hit);
      return hit || refresh;
    }));
  }
});
