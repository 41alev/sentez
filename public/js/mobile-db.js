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
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Queue transaction aborted')); };
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
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    },
    /** Only acknowledge the exact sent records; new records remain untouched. */
    acknowledge(sent, results) {
      const byId = new Map(results.map(result => [result.clientId, result]));
      return withStore('readwrite', store => {
        for (const op of sent) {
          const result = byId.get(op.clientId);
          if (result && result.ok) store.delete(op.seq);
          else if (result) store.put({ ...op, lastError: result.error, lastAttempt: Date.now() });
        }
      });
    },
    remove(records) {
      return withStore('readwrite', store => records.forEach(op => store.delete(op.seq)));
    },
    /** Explicit maintenance only; never used to acknowledge a sync batch. */
    clear() {
      return withStore('readwrite', (store) => store.clear());
    }
  };
})();
