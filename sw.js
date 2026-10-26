// Guarda o app no celular para abrir mesmo sem internet. A escala em si vem do servidor
// (e o app guarda a última versão baixada). Ao publicar uma versão nova do app, troque o número abaixo.
const VERSAO = 'minha-escala-v2';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // servidor da escala: sempre direto
  e.respondWith(
    fetch(e.request).then(r => { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

// Aviso de fim do intervalo (enviado pelo servidor através do Firebase)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { corpo: e.data ? e.data.text() : '' }; }
  const p = d.data || d.notification || d;
  const titulo = p.titulo || p.title || 'Minha Escala';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: p.corpo || p.body || '', icon: './icon-192.png', badge: './icon-192.png',
    tag: p.tag || 'minha-escala', renotify: true, requireInteraction: true, vibrate: [300, 120, 300, 120, 300]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const aberto = lista.find(c => c.url.startsWith(self.registration.scope));
    return aberto ? aberto.focus() : self.clients.openWindow('./');
  }));
});
