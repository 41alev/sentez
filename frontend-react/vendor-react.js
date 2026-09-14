// @ts-nocheck
/**
 * Paylaşılan React çalışma zamanı — bkz. vite.config.js'teki kod bölme notu.
 *
 * Her ekranın kendi ayrı, isteğe bağlı (lazy) yüklenen bir paket olabilmesi
 * için React/ReactDOM'un HER paket içine ayrı ayrı gömülmemesi gerekiyor —
 * aksi halde 13 ekranın her biri kendi React kopyasını taşırdı. Bu dosya TEK
 * bir paket olarak derlenip sayfa açılışında bir kez yüklenir, React'i
 * `window` üzerinden paylaşılan global olarak sunar; diğer ekran paketleri
 * (vite.config.js'teki `external`/`globals` ile) kendi React kopyalarını
 * GÖMMEK yerine bu global'i kullanır.
 */
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactJSXRuntime from 'react/jsx-runtime';

window.React = React;
window.ReactDOM = ReactDOMClient;
window.ReactJSXRuntime = ReactJSXRuntime;
