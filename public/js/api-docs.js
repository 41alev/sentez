// @ts-nocheck
window.addEventListener('load', () => {
  if (typeof SwaggerUIBundle === 'undefined') {
    document.getElementById('offline-note').style.display = 'block';
    return;
  }
  SwaggerUIBundle({
    url: '/api/docs/openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis],
    layout: 'BaseLayout'
  });
});
