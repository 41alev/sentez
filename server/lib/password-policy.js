/**
 * Single password policy for every entry point: first-run setup, admin
 * user creation/reset and the user's own password change (Faz 0 AU-04).
 * Returns a bilingual problem description, or null when the password is
 * acceptable.
 */
const COMMON = ['12345678', 'password', 'password1', 'sifre123', 'şifre123', 'admin123', 'admin123!',
  'qwerty123', 'qwertyui', '11111111', 'abc12345', 'parola123', 'dreamplus1'];

function passwordProblem(password) {
  const p = typeof password === 'string' ? password : '';
  if (p.length < 8) return 'En az 8 karakter olmalı / Must be at least 8 characters';
  if (p.length > 200) return 'En fazla 200 karakter olabilir / Must be at most 200 characters';
  if (!/[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(p)) return 'En az bir harf içermeli / Must contain a letter';
  if (!/[0-9]/.test(p)) return 'En az bir rakam içermeli / Must contain a digit';
  if (COMMON.includes(p.toLowerCase())) return 'Bu şifre çok yaygın, başka bir şey seçin / This password is too common';
  if (new Set(p.toLowerCase()).size < 4) return 'Şifre çok tekrarlı / Password is too repetitive';
  return null;
}

module.exports = { passwordProblem };
