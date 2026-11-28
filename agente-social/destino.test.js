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

test('marcas prohibidas: un texto de heysong nunca sale en G-TiDE', async () => {
  const adapters = require('./adapters');
  const llamadas = [];
  global.fetch = async (url) => { llamadas.push(String(url)); return { ok: true, status: 200, json: async () => ({ id: 'x' }) }; };
  const gtide = { id: 'g', nombre: 'g-TIDE MEXICO', metaPageId: 'PAGINA_GTIDE', noMencionar: 'heysong, aura' };
  for (const texto of ['Llegó la bocina HEYSONG Cosmo', 'Nueva heysōng', 'hey song en casa']) {
    const r = await adapters.publicar('facebook', { id: 'v' + texto, texto, hashtags: [] }, gtide);
    assert.equal(r.ok, false, texto); assert.equal(r.error, 'marca_bloqueada');
  }
  const hashtag = await adapters.publicar('facebook', { id: 'h1', texto: 'Fiesta', hashtags: ['#BocinaCosmo', '#HEYSONG'] }, gtide);
  assert.equal(hashtag.error, 'marca_bloqueada');
  assert.equal(llamadas.length, 0, 'no debe llamar a Meta');
  // palabras normales que contienen otra cosa no se bloquean; su propio contenido sí sale
  const ok = await adapters.publicar('facebook', { id: 'ok1', texto: 'Reloj R8 PRO sumergible', hashtags: ['#gtide'] }, gtide);
  assert.equal(ok.ok, true);
  // la pagina de CEL MAXX sin lista puede hablar de heysong
  const cel = await adapters.publicar('facebook', { id: 'c1', texto: 'heysong AURA en CEL MAXX', hashtags: [] }, { id: 'c', nombre: 'Celmaxx', metaPageId: 'PAGINA_CEL' });
  assert.equal(cel.ok, true);
});

test('excepción "+": su propia web celmaxxgtide.com pasa, la palabra Celmaxx sola no', () => {
  const { marcaVetada } = require('./adapters');
  const gtide = { noMencionar: 'HEYSONG,CELMAXX,+celmaxxgtide.com,' };
  assert.equal(marcaVetada({ texto: 'Pídela en https://CelmaxxGtide.com/bocina-sh50/', hashtags: ['#gtide'] }, gtide), '');
  assert.equal(marcaVetada({ texto: 'Pídela en celmaxxgtide.com o en tiendas Celmaxx', hashtags: [] }, gtide), 'CELMAXX');
  assert.equal(marcaVetada({ texto: 'Pídela en celmaxxgtide.com', hashtags: ['#CelMaxx'] }, gtide), 'CELMAXX');
  assert.equal(marcaVetada({ texto: 'heysong en celmaxxgtide.com', hashtags: [] }, gtide), 'HEYSONG');
});
