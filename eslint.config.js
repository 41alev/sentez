const js = require('@eslint/js');
const globals = require('globals');

/**
 * Bilinçli olarak dar kapsamlı: bu geçiş, üslup (stil) değil GERÇEK HATA
 * yakalayan kurallara odaklanıyor — tanımsız değişken kullanımı, aynı
 * anahtarın iki kez tanımlanması, ulaşılamayan kod gibi. `npx tsc --noEmit`
 * zaten tip uyumsuzluklarını yakalıyor; ESLint bunun yakalamadığı, tip
 * sisteminden bağımsız hata sınıflarını tamamlıyor. Kod biçimi (noktalı
 * virgül, tırnak türü vb.) kasıtlı olarak zorlanmıyor — mevcut ~90 dosyayı
 * yeniden biçimlendirip gerçek değişikliği gürültüye boğmamak için.
 *
 * `catch {}` boş blokları bilinçli bir kalıptır bu kod tabanında (en iyi
 * çaba / best-effort davranış, ör. restore.js, setup.js) — allowEmptyCatch
 * bunu bozmadan diğer (şüpheli) boş blokları hâlâ yakalar.
 */
const PUBLIC_GLOBALS = {
  // public/js/*.js dosyaları modül değildir; her biri kendi üst seviye
  // sabitini (IIFE) tanımlar ve diğerleri paylaşılan global kapsamdan
  // okur (index.html'de sırayla <script> ile yüklenirler).
  Api: 'writable', UI: 'writable', I18N: 'writable', App: 'writable',
  ViewDashboard: 'writable', ViewItems: 'writable', ViewLots: 'writable',
  ViewCounts: 'writable', ViewProduction: 'writable', ViewPurchasing: 'writable',
  ViewSales: 'writable', ViewPlanning: 'writable', ViewQuality: 'writable',
  ViewReports: 'writable', ViewAdmin: 'writable',
  Chart: 'readonly'
};

module.exports = [
  js.configs.recommended,
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    files: ['server/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...PUBLIC_GLOBALS }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': ['error', { builtinGlobals: false }]
    }
  },
  {
    ignores: ['node_modules/**', 'data/**']
  }
];
