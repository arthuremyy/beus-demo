/* Service worker BeUs — les notifications, rien d'autre.

   Pas de cache hors ligne ici, volontairement : l'app est en modification
   permanente, et un cache de service worker survit aux purges Cloudflare —
   on verrait d'anciennes versions sans savoir pourquoi. Ce fichier n'existe
   que parce qu'iOS n'accepte les notifications que d'une app installée avec
   un service worker. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { /* charge illisible */ }
    e.waitUntil((async () => {
        // Point sur l'icône de l'écran d'accueil ; l'app pose le vrai compte
        // (ou l'efface) dès qu'elle s'ouvre.
        try { await self.navigator.setAppBadge?.(); } catch { /* non géré */ }
        await self.registration.showNotification(d.title || 'BeUs', {
            body: d.body || '',
            tag: d.tag || undefined,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data: { url: d.url || '/#/feed' },
        });
    })());
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = e.notification.data?.url || '/#/feed';
    e.waitUntil((async () => {
        const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const f = fenetres[0];
        if (f) {
            // L'app est déjà ouverte : on lui dit où aller plutôt que de la
            // recharger (la session et le journal restent en mémoire).
            f.postMessage({ type: 'beus-ouvre', url });
            if ('focus' in f) await f.focus();
            return;
        }
        await self.clients.openWindow(url);
    })());
});
