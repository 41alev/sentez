// @ts-nocheck
/**
 * IndexedDB tabanlı çevrimdışı işlem kuyruğu.
 *
 * Önceki sürüm kuyruğu localStorage'da tek bir JSON dizisi olarak tutuyordu:
 * her ekleme/temizleme tüm diziyi okuyup geri yazıyordu ve tarayıcının
 * senkron, düşük boyut sınırlı (~5MB, paylaşımlı) deposunu kullanıyordu.
 * IndexedDB yapılandırılmış kayıt bazlı çalışır (yarış koşulu daha az),
 * çok daha yüksek depolama sınırına sahiptir ve tarayıcı/işletim sistemi
 * kaynak baskısında localStorage'dan daha geç temizlenir — saha
 * terminalinde günler sürebilecek bir çevrimdışı kuyruk için daha uygun.
 */
(() => {
  'use strict';
  const DB_NAME = 'depo-terminal';
  const DB_VERSION = 1;
  const STORE = 'queue';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.MobileDB = {
    /** Kuyruğa bir işlem ekler. `op` iş alanlarını (type, clientId, queuedAt, ...) taşır. */
    add(op) {
      return withStore('readwrite', (store) => store.add(op));
    },
    /** Kuyruktaki tüm işlemleri eklenme sırasıyla döndürür. */
    async getAll() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    /** Kuyruğu tamamen boşaltır (başarılı gönderim veya elle silme sonrası). */
    clear() {
      return withStore('readwrite', (store) => store.clear());
    }
  };
})();
