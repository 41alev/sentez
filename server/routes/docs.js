// @ts-nocheck
/**
 * OpenAPI şemasını servis eder. Kimlik doğrulama GEREKTİRMEZ — bu bir
 * belge/şema, iş verisi değil; Postman/Insomnia/kod üretici gibi araçların
 * önden token almadan URL'i doğrudan içe aktarabilmesi için kasıtlı.
 */
const express = require('express');
const { buildOpenApiSpec } = require('../lib/openapi');

const router = express.Router();

router.get('/openapi.json', (req, res) => {
  res.json(buildOpenApiSpec());
});

module.exports = router;
