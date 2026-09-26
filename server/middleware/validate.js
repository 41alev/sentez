// @ts-nocheck
const { z } = require('zod');

/**
 * Strict input normalisation for `z.coerce.number()` / `z.coerce.boolean()`.
 *
 * Zod's coercion runs `Number(value)` / `Boolean(value)`, so '' , null, false
 * and [] silently become 0 and the text 'false' becomes true (Faz 0 CO-01..05,
 * CNT-03). Before parsing we walk the schema: a coerced number accepts only a
 * finite number or a numeric string; a coerced boolean accepts only a boolean,
 * 'true'/'false', '1'/'0' or 1/0. Anything else is reported as a validation
 * error instead of being guessed. `null` is still allowed where the schema is
 * explicitly nullable.
 */
const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const WRAPPERS = new Set(['optional', 'default', 'prefault', 'nullable', 'readonly', 'catch', 'nonoptional']);

function normalizeInput(schema, value, path, issues) {
  const def = schema && schema._zod && schema._zod.def;
  if (!def) return value;
  if (WRAPPERS.has(def.type)) {
    if (value === undefined) return value;
    if (value === null && def.type === 'nullable') return value;
    return normalizeInput(def.innerType, value, path, issues);
  }
  if (def.type === 'pipe') return normalizeInput(def.in, value, path, issues);
  if (def.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = { ...value };
    for (const [key, child] of Object.entries(def.shape)) {
      if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = normalizeInput(child, out[key], [...path, key], issues);
    }
    return out;
  }
  if (def.type === 'array') {
    return Array.isArray(value) ? value.map((item, i) => normalizeInput(def.element, item, [...path, i], issues)) : value;
  }
  if (def.type === 'number' && def.coerce) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && NUMERIC_TEXT.test(value.trim())) return value.trim();
    issues.push({ field: path.join('.'), message: 'Sayı gerekli / Number required' });
    return value;
  }
  if (def.type === 'boolean' && def.coerce) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
    issues.push({ field: path.join('.'), message: 'true/false gerekli / Boolean required' });
    return value;
  }
  return value;
}

/** Validate req.body against a zod schema; returns 422 with field-level details. */
function validate(schema) {
  return (req, res, next) => {
    const issues = [];
    const input = normalizeInput(schema, req.body, [], issues);
    if (issues.length) {
      return res.status(422).json({ error: 'Geçersiz veri / Validation failed', details: issues });
    }
    const result = schema.safeParse(input);
    if (!result.success) {
      return res.status(422).json({
        error: 'Geçersiz veri / Validation failed',
        details: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
      });
    }
    req.body = result.data;
    req.valid = result.data;   // alias used by route handlers
    next();
  };
}

/** Updates preserve omitted fields, including fields with create-time defaults.
 * Zod's partial() alone still applies inner defaults to absent properties.
 */
function validatePartial(schema) {
  const partial = schema.partial();
  return (req, res, next) => {
    const supplied = req.body;
    return validate(partial)(req, res, () => {
      const data = Object.fromEntries(Object.entries(req.body)
        .filter(([key]) => Object.prototype.hasOwnProperty.call(supplied, key)));
      req.body = data;
      req.valid = data;
      next();
    });
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const issues = [];
    const input = normalizeInput(schema, req.query, [], issues);
    if (issues.length) {
      return res.status(422).json({ error: 'Geçersiz sorgu / Invalid query', details: issues });
    }
    const result = schema.safeParse(input);
    if (!result.success) {
      return res.status(422).json({
        error: 'Geçersiz sorgu / Invalid query',
        details: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

const { isValidLocalDate } = require('../lib/dates');
/**
 * Calendar date (YYYY-MM-DD) that really exists, within a sane business range.
 * `optionalDate` also accepts '' from empty form inputs and stores it as null.
 */
const localDate = z.string().refine(v => isValidLocalDate(v) && v >= '1900-01-01' && v <= '2199-12-31',
  'Geçerli takvim tarihi gerekli / Valid calendar date required');
const optionalDate = z.preprocess(v => (v === '' ? null : v), localDate.nullable().optional());

const currency = z.enum(['TRY', 'USD', 'EUR', 'GBP']);
const nonEmpty = z.string().trim().min(1);
const posNum = z.coerce.number().positive();
const nonNegNum = z.coerce.number().min(0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').nullable().optional();

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().optional(),
  sort: z.string().optional()
}).passthrough();

/**
 * Serbest metin alanları için üst sınırlı doğrulayıcılar.
 * Sınırsız metin, veritabanını şişirmenin ve arayüzü kilitlemenin en kolay yoludur;
 * gövde boyutu sınırı tek başına yetmez çünkü 2 MB'lık tek bir alan da geçerdi.
 */
const limitedText = (max = 200) => z.string().trim().max(max, `En fazla ${max} karakter / At most ${max} characters`);
const shortText = limitedText(200);
const mediumText = limitedText(1000);
const longText = limitedText(5000);

module.exports = { localDate, optionalDate, normalizeInput, limitedText, shortText, mediumText, longText, validate, validatePartial, validateQuery, z, currency, nonEmpty, posNum, nonNegNum, dateStr, pageQuery };
