// Con varias marcas, una empresa sin su pagina conectada nunca publica en la pagina de otra.
const { test } = require('node:test');
const assert = require('node:assert');

test('cada marca publica solo en su propia página', async () => {
  process.env.META_ACCESS_TOKEN = 'token';
  process.env.META_PAGE_ID = 'PAGINA_GTIDE';
  process.env.META_IG_USER_ID = 'IG_GTIDE';
  const store = require('./store');
  const adapters = require('./adapters');
  const llamadas = [];
  global.fetch = async (url) => {
    llamadas.push(String(url));
    return { ok: true, status: 200, json: async () => ({ id: 'x', access_token: 'tp' }) };
  };
  store.estado.empresas.splice(0, store.estado.empresas.length,
    { id: 'g', nombre: 'G-TiDE', metaPageId: 'PAGINA_GTIDE', metaIgId: 'IG_GTIDE' },
    { id: 'h', nombre: 'heysong' }); // heysong todavia sin conectar
  const pub = { id: 'p1', texto: 'Bocina heysong AURA', hashtags: [] };

  const fb = await adapters.publicar('facebook', pub, store.estado.empresas[1]);
  const ig = await adapters.publicar('instagram', { ...pub, id: 'p2', imagenUrl: 'https://x/y.jpg' }, store.estado.empresas[1]);
  assert.equal(fb.simulado, true);
  assert.equal(ig.simulado, true);
  assert.ok(!llamadas.some((u) => u.includes('PAGINA_GTIDE') || u.includes('IG_GTIDE')), 'no debe tocar la página de G-TiDE: ' + llamadas.join(' | '));

  // la empresa conectada si publica en SU pagina
  await adapters.publicar('facebook', { ...pub, id: 'p3', texto: 'G-TiDE R8 PRO' }, store.estado.empresas[0]);
  assert.ok(llamadas.some((u) => u.includes('PAGINA_GTIDE')));

  // con una sola empresa, las variables de Render siguen sirviendo de respaldo
  store.estado.empresas.splice(0, store.estado.empresas.length, { id: 'u', nombre: 'Única' });
  llamadas.length = 0;
  const unica = await adapters.publicar('facebook', { ...pub, id: 'p4' }, store.estado.empresas[0]);
  assert.equal(unica.simulado, false);
  assert.ok(llamadas.some((u) => u.includes('PAGINA_GTIDE')));
});
