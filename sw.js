/* 서비스 워커: 앱 파일을 캐시하고(오프라인 실행), 캐시 우선 + 뒤에서 갱신한다.
   http/https에서만 실행되므로 이 파일 안에서는 fetch/caches를 쓴다.
   배포할 때마다 CACHE_VERSION을 올린다(새 버전 안내와 이전 캐시 삭제의 기준). */
var CACHE_VERSION = 'v5';
var CACHE_PREFIX = 'todo-app-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// 이 파일(sw.js) 위치 기준 상대 경로. tests.html은 일부러 넣지 않는다.
var ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

function abs(path) { return new URL(path, self.location).href; }
var ASSET_URLS = ASSETS.map(abs);
var INDEX_URL = abs('index.html');

// 쿼리·해시를 뗀 캐시 키. 캐시 대상이 아니면 null.
function cacheKey(requestUrl) {
  var u = new URL(requestUrl);
  u.search = '';
  u.hash = '';
  return ASSET_URLS.indexOf(u.href) === -1 ? null : u.href;
}

self.addEventListener('install', function (event) {
  // cache: 'reload' — 브라우저 HTTP 캐시의 묵은 파일이 새 캐시에 들어가지 않게
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS.map(function (p) { return new Request(p, { cache: 'reload' }); }));
    })
  );
  // 자동으로 skipWaiting 하지 않는다: 화면의 [새로고침]을 눌렀을 때 SKIP_WAITING 메시지로 교체.
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names
        .filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE_NAME; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 캐시 우선 + 뒤에서 갱신(stale-while-revalidate)
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var key = cacheKey(req.url);
  if (!key) return;   // 캐시 대상이 아닌 요청(tests.html 등)은 건드리지 않고 네트워크로

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(key).then(function (cached) {
        var network = fetch(req, { cache: 'no-cache' }).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        });
        if (cached) {
          event.waitUntil(network.catch(function () { /* 오프라인이면 캐시본 유지 */ }));
          return cached;
        }
        return network.catch(function () {
          // 캐시에도 없고 오프라인: 화면 이동이면 앱 첫 화면으로
          return req.mode === 'navigate' ? cache.match(INDEX_URL) : Response.error();
        });
      });
    })
  );
});
