const { z } = require('zod');

/** Validate req.body against a zod schema; returns 422 with field-level details. */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
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

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
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

module.exports = { limitedText, shortText, mediumText, longText, validate, validateQuery, z, currency, nonEmpty, posNum, nonNegNum, dateStr, pageQuery };
