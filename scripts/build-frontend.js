#!/usr/bin/env node
// @ts-nocheck
/**
 * `frontend-react/`'i public/dist/'e derler — bkz. vite.config.js'teki kod
 * bölme notu için ORADAKİ yorum.
 *
 * `vite build` (Vite CLI) tek bir config'te TEK bir Rollup derlemesi
 * çalıştırır; bu derleme birden çok giriş noktasını `format:'iife'` ile
 * KABUL ETMİYOR ("UMD and IIFE are not supported for code-splitting
 * builds" — Rolldown/Rollup, iki veya daha fazla giriş noktasını daima
 * "kod bölme" sayıyor, aralarında gerçek bir paylaşım olmasa bile).
 *
 * Çözüm: Vite'ın programatik `build()` API'sini BİR VENDOR + 13 EKRAN için
 * AYRI AYRI, art arda çağırmak — her çağrı kendi başına "tek girişli"
 * (single-entry) bir derleme olduğundan `format:'iife'` sorunsuz kabul
 * edilir. `emptyOutDir` yalnızca İLK çağrıda açık, aksi halde her ekran
 * bir öncekinin çıktısını silerdi.
 *
 *   node scripts/build-frontend.js   (npm run build bunu çağırır)
 */
const path = require('path');
const { build } = require('vite');
const react = require('@vitejs/plugin-react');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public/dist');
const REACT_SPECIFIERS = ['react', 'react-dom/client', 'react/jsx-runtime'];

const VIEW_ENTRIES = [
  'dashboard', 'items', 'counts', 'lots', 'production', 'reports',
  'planning', 'purchasing', 'quality', 'sales', 'crm', 'support', 'admin'
];

async function buildOne({ name, entry, externalizeReact, first }) {
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    plugins: [react()],
    publicDir: false,
    build: {
      outDir: OUT_DIR,
      emptyOutDir: !!first,
      // Bir öncekini SİLMEDEN üstüne yaz — emptyOutDir yalnızca ilk
      // çağrıda true.
      rollupOptions: {
        input: entry,
        external: externalizeReact ? REACT_SPECIFIERS : [],
        output: {
          entryFileNames: `${name}.js`,
          format: 'iife',
          globals: { react: 'React', 'react-dom/client': 'ReactDOM', 'react/jsx-runtime': 'ReactJSXRuntime' }
        }
      }
    }
  });
  console.log(`  ✓ ${name}.js`);
}

async function buildAll() {
  console.log('React vendor paketi (React/ReactDOM BİR KEZ, paylaşılan global olarak)...');
  await buildOne({
    name: 'vendor-react',
    entry: path.join(ROOT, 'frontend-react/vendor-react.js'),
    externalizeReact: false,
    first: true
  });

  console.log('Ekran paketleri (her biri React\'i vendor-react.js\'ten paylaşır)...');
  for (const view of VIEW_ENTRIES) {
    await buildOne({
      name: `view-${view}`,
      entry: path.join(ROOT, `frontend-react/entries/${view}.js`),
      externalizeReact: true,
      first: false
    });
  }

  console.log('\nTamamlandı — public/dist/ içinde 1 vendor + ' + VIEW_ENTRIES.length + ' ekran paketi.');
}

(async () => {
  await buildAll();

  if (process.argv.includes('--watch')) {
    const fs = require('fs');
    console.log('\nİzleniyor: frontend-react/ değişince yeniden derlenecek (Ctrl+C ile çık)...');
    let pending = false, timer = null;
    const rebuild = () => {
      if (pending) return;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { await buildAll(); } catch (e) { console.error(e.message); }
        pending = false;
      }, 200); // ardışık kayıt olaylarını tek derlemeye topla
    };
    fs.watch(path.join(ROOT, 'frontend-react'), { recursive: true }, rebuild);
  }
})().catch((e) => { console.error(e); process.exit(1); });
