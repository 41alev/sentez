// @ts-nocheck
/**
 * Visual audit — the measurable part.
 *
 * This cannot judge whether a screen *looks* good. What it can do is check the
 * things that have objective thresholds: WCAG contrast ratios, touch-target sizes,
 * responsive breakpoints, and font sizes that fall below readable limits.
 *
 *   node test/visual-audit.js
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let pass = 0, warn = 0, fail = 0;
const findings = [];

function check(name, level, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); return; }
  if (level === 'warn') { warn++; findings.push(['UYARI', name, detail]); console.log(`  ⚠ ${name} — ${detail}`); }
  else { fail++; findings.push(['HATA', name, detail]); console.log(`  ✗ ${name} — ${detail}`); }
}

/* ---------- colour maths ---------- */
function hexToRgb(h) {
  h = h.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Relative luminance per WCAG 2.1. */
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(hexToRgb(a)), l2 = luminance(hexToRgb(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- pull the palette out of :root ---------- */
const vars = {};
const rootBlock = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
rootBlock.replace(/--([\w-]+)\s*:\s*([^;]+);/g, (_, k, v) => { vars[k] = v.trim(); return ''; });

console.log('=== PALET / PALETTE ===');
Object.entries(vars).filter(([, v]) => v.startsWith('#')).forEach(([k, v]) => console.log(`  --${k}: ${v}`));

console.log('\n=== METİN KONTRASTI (WCAG 2.1) ===');
// WCAG AA: 4.5:1 for body text, 3:1 for large text (>=18.66px bold or >=24px).
const textPairs = [
  ['gövde metni / body text', vars.text, vars.bg, 4.5, 'fail'],
  ['panel üzerinde metin / text on panel', vars.text, vars.panel, 4.5, 'fail'],
  ['ikincil metin / muted text', vars['text-muted'], vars.panel, 4.5, 'fail'],
  ['soluk metin / faint text', vars['text-faint'], vars.panel, 4.5, 'warn'],
  ['tablo başlığı / table header', vars['text-faint'], vars['panel-2'], 3.0, 'warn'],
  ['vurgu rengi metin / accent text', vars.accent, vars.panel, 4.5, 'fail'],
  ['hata metni / danger text', vars.danger, vars.panel, 4.5, 'fail'],
  ['başarı metni / success text', vars.success, vars.panel, 4.5, 'fail'],
  ['bilgi metni / info text', vars.info, vars.panel, 4.5, 'fail'],
  ['mor metin / purple text', vars.purple, vars.panel, 4.5, 'fail'],
];
for (const [name, fg, bg, min, level] of textPairs) {
  const r = contrast(fg, bg);
  check(`${name} ${r.toFixed(2)}:1 (min ${min})`, level, r >= min, `${fg} / ${bg} → ${r.toFixed(2)}:1`);
}

console.log('\n=== BUTON KONTRASTI / BUTTON CONTRAST ===');
// Primary button paints dark text on the accent colour.
const btnPrimaryText = '#211804';
const rPrimary = contrast(btnPrimaryText, vars.accent);
check(`birincil buton / primary button ${rPrimary.toFixed(2)}:1`, 'fail', rPrimary >= 4.5,
  `${btnPrimaryText} / ${vars.accent}`);
const rAvatar = contrast('#211804', vars.accent);
check(`kullanıcı rozeti / user avatar ${rAvatar.toFixed(2)}:1`, 'fail', rAvatar >= 4.5, '');
const rNavBadge = contrast('#2A0F0C', vars.danger);
check(`bildirim rozeti / nav badge ${rNavBadge.toFixed(2)}:1`, 'warn', rNavBadge >= 3.0, '');

console.log('\n=== ARAYÜZ SINIRLARI / NON-TEXT CONTRAST ===');
// WCAG 1.4.11: UI component boundaries need 3:1 against their surroundings.
const uiPairs = [
  // WCAG 1.4.11 applies to controls that carry meaning, not decorative separators.
  ['form alanı kenarlığı / input border', vars['border-input'], vars['panel-2'], 3.0],
  ['form alanı kenarlığı (panel) / input border on panel', vars['border-input'], vars.panel, 3.0],
  ['odak halkası / focus ring', vars.accent, vars.bg, 3.0],
];
{
  const r = contrast(vars.border, vars.panel);
  console.log(`  · dekoratif ayırıcı / decorative separator ${r.toFixed(2)}:1 (eşik uygulanmaz / not gated)`);
}
for (const [name, a, b, min] of uiPairs) {
  const r = contrast(a, b);
  check(`${name} ${r.toFixed(2)}:1 (min ${min})`, 'warn', r >= min, `${a} / ${b}`);
}

console.log('\n=== DOKUNMA HEDEFLERİ / TOUCH TARGETS ===');
// WCAG 2.5.8 (AA) asks for 24x24 CSS px minimum; 44px is the comfortable mobile size.
function ruleBlock(selector) {
  const i = css.indexOf(selector + '{');
  if (i === -1) return null;
  return css.slice(i, css.indexOf('}', i));
}
const iconBtn = ruleBlock('.icon-btn');
const iconSize = iconBtn && /width:(\d+)px/.exec(iconBtn);
check('ikon buton ≥24px / icon button', 'fail', iconSize && Number(iconSize[1]) >= 24,
  iconSize ? `${iconSize[1]}px` : 'bulunamadı');
// Touch devices get larger targets through a pointer:coarse query rather than the base rule.
const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.icon-btn\{width:(\d+)px/.exec(css);
check('dokunmatikte ikon buton ≥44px / ≥44px on touch devices', 'warn',
  coarse && Number(coarse[1]) >= 44, coarse ? `${coarse[1]}px` : 'pointer:coarse kuralı yok');

const btnSm = ruleBlock('.btn-sm');
const smPad = btnSm && /padding:(\d+)px (\d+)px/.exec(btnSm);
const smHeight = smPad ? Number(smPad[1]) * 2 + 16 : 0;   // padding + ~16px line box
check('küçük buton yüksekliği ≥24px / small button height', 'fail', smHeight >= 24, `${smHeight}px`);

const chip = ruleBlock('.chip');
const chipPad = chip && /padding:(\d+)px (\d+)px/.exec(chip);
const chipH = chipPad ? Number(chipPad[1]) * 2 + 16 : 0;
check('sekme çipi yüksekliği ≥24px / tab chip height', 'fail', chipH >= 24, `${chipH}px`);

console.log('\n=== YAZI BOYUTLARI / FONT SIZES ===');
const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => Number(m[1]));
const tooSmall = sizes.filter(s => s < 11);
check('11px altında yazı yok / no text under 11px', 'warn', tooSmall.length === 0,
  tooSmall.length ? `${tooSmall.length} yer: ${[...new Set(tooSmall)].join(', ')}px` : '');
// 'body{' also matches 'html,body{'; look for the block that actually styles text
const bodyBlocks = [...css.matchAll(/(?:^|\n)body\s*\{([^}]*)\}/g)].map(m => m[1]);
check('gövde yazı tipi tanımlı / body font defined', 'fail',
  bodyBlocks.some(b => /font-family/.test(b)), '');

console.log('\n=== DUYARLI TASARIM / RESPONSIVE ===');
const mediaQueries = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
check('mobil kırılma noktası var / mobile breakpoint exists', 'fail',
  mediaQueries.some(w => w <= 700), `bulunanlar / found: ${mediaQueries.join(', ')}px`);
check('tablet kırılma noktası var / tablet breakpoint exists', 'warn',
  mediaQueries.some(w => w > 700 && w <= 1100), `${mediaQueries.join(', ')}px`);
check('kenar çubuğu mobilde yığılıyor / sidebar stacks on mobile', 'fail',
  /max-width:960px\)\{\.shell\{grid-template-columns:1fr\}/.test(css.replace(/\s+/g, '')), '');
check('form satırları mobilde tek sütun / form rows collapse', 'fail',
  /max-width:640px\)\{\.field-row/.test(css.replace(/\s+/g, '')), '');
check('geniş tablolar yatay kaydırılabilir / wide tables scroll', 'fail',
  /\.table-wrap\{overflow-x:auto\}/.test(css.replace(/\s+/g, '')), '');
check('viewport meta etiketi var / viewport meta present', 'fail',
  /name="viewport"[^>]*width=device-width/.test(html), '');

console.log('\n=== ERİŞİLEBİLİRLİK / ACCESSIBILITY ===');
check('klavye odak göstergesi tanımlı / focus-visible styled', 'fail',
  /:focus-visible\{outline/.test(css.replace(/\s+/g, '')), '');
check('sayfa dili tanımlı / html lang set', 'fail', /<html lang="/.test(html), '');
check('karakter kodlaması UTF-8 / charset utf-8', 'fail', /charset="UTF-8"/i.test(html), '');
// Icon-only controls need an accessible name; the app uses title=, which screen readers read.
const iconOnly = [...html.matchAll(/<button class="icon-btn"(?![^>]*title=)[^>]*>/g)];
check('ikon butonlarda erişilebilir ad / icon buttons have a name', 'warn',
  iconOnly.length === 0, iconOnly.length ? `${iconOnly.length} buton title= içermiyor` : '');
check('hareket azaltma tercihi / prefers-reduced-motion', 'warn',
  /prefers-reduced-motion/.test(css), 'dönen yükleme göstergesi için eklenmeli');

console.log('\n=== RENGE BAĞIMLILIK / COLOUR RELIANCE ===');
// Status must not be conveyed by colour alone — the app pairs a dot with a word.
check('stok durumu renkle birlikte metin gösteriyor / status has text', 'fail',
  /statusOut|statusLow|statusOk/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8')), '');

console.log(`\n${'='.repeat(52)}`);
console.log(`GEÇTİ / PASSED: ${pass}   UYARI / WARN: ${warn}   HATA / FAIL: ${fail}`);
if (findings.length) {
  console.log('\nBulgular / Findings:');
  findings.forEach(([lvl, name, d]) => console.log(`  [${lvl}] ${name}${d ? ' — ' + d : ''}`));
}
console.log('='.repeat(52));
console.log('\nNot: Bu denetim ölçülebilir eşikleri kontrol eder. Hizalama, boşluk dengesi ve');
console.log('genel görsel bütünlük hâlâ gerçek bir tarayıcıda insan gözüyle bakılmalıdır.');
process.exit(fail > 0 ? 1 : 0);
