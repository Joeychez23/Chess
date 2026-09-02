const { offlineFallback, warmStrategyCache } = require('workbox-recipes');
const { CacheFirst, StaleWhileRevalidate } = require('workbox-strategies');
const { registerRoute } = require('workbox-routing');
const { CacheableResponsePlugin } = require('workbox-cacheable-response');
const { ExpirationPlugin } = require('workbox-expiration');
const { precacheAndRoute } = require('workbox-precaching/precacheAndRoute');

precacheAndRoute(self.__WB_MANIFEST);

const pageCache = 
  new CacheFirst({
    cacheName: 'page-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  });

warmStrategyCache({
  urls: ['/index.html', '/'],
  strategy: pageCache,
});

const pageCasheParams = registerRoute(({ request }) => request.mode === 'navigate', pageCache);

const assetCasheParams = function ({ request }) {
  return (  request.destination === 'style' || request.destination === 'script' || request.destination === 'worker'
  );
}

registerRoute(
  assetCasheParams,
  new StaleWhileRevalidate({
    cacheName: 'asset-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      })
    ],
  }));

  addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
	  self.skipWaiting();
	}
  });
