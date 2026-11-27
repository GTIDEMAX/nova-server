const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLAVE = 'clave-de-prueba-123';
const SECRETO = 'secreto-de-prueba';
const procesos = [];
const dirs = [];
let base, sinClave;

async function arrancar(puerto, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
  dirs.push(dir);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: puerto, DATA_FILE: path.join(dir, 'data.json'), SCHEDULER_INTERVAL_MS: '200', ...extra };
  const p = spawn(process.execPath, ['server.js'], { cwd: __dirname, env });
  procesos.push(p);
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  await new Promise((ok, mal) => {
    p.stdout.on('data', (d) => /AGENTE SOCIAL en/.test(d) && ok());
    p.on('exit', () => mal(new Error(err)));
  });
  return 'http://localhost:' + puerto;
}

before(async () => {
  base = await arrancar(4801, { PANEL_PASSWORD: CLAVE, META_APP_SECRET: SECRETO, BOT_TOKEN: 'bot' });
  sinClave = await arrancar(4802, {});
});
after(() => {
  procesos.forEach((p) => p.kill());
  dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

const auth = (clave) => ({ authorization: 'Basic ' + Buffer.from('x:' + clave).toString('base64') });
const api = async (ruta, method = 'GET', body) => {
  const r = await fetch(base + ruta, { method, headers: { ...auth(CLAVE), 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json();
};

test('el panel exige la contraseña correcta', async () => {
  for (const r of ['/', '/api/estado', '/api/clientes', '/api//estado', '/api/bot/../estado']) {
    assert.equal((await fetch(base + r)).status, 401, r);
  }
  assert.equal((await fetch(base + '/api/estado', { headers: auth('otra') })).status, 401);
  assert.equal((await fetch(base + '/api/empresas', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/api/estado', { headers: auth(CLAVE) })).status, 200);
});

test('sin PANEL_PASSWORD queda cerrado', async () => {
  assert.equal((await fetch(sinClave + '/api/estado')).status, 503);
  assert.equal((await fetch(sinClave + '/api/estado', { headers: auth('') })).status, 503);
});

test('otra web no puede disparar acciones (CSRF)', async () => {
  const r = await fetch(base + '/api/empresas', { method: 'POST', headers: { ...auth(CLAVE), 'content-type': 'text/plain' }, body: '{"nombre":"x"}' });
  assert.equal(r.status, 415);
});

test('rutas publicas siguen abiertas y el bot usa su token', async () => {
  assert.equal((await fetch(base + '/widget/nada')).status, 404);
  assert.equal((await fetch(base + '/feed/nada')).status, 404);
  assert.equal((await fetch(base + '/api/bot/siguiente')).status, 401);
  assert.equal((await fetch(base + '/api/bot/siguiente', { headers: { 'x-bot-token': 'bot' } })).status, 200);
});

test('el webhook solo acepta mensajes firmados por Meta', async () => {
  const body = JSON.stringify({ entry: [] });
  const enviar = (url, firma) => fetch(url + '/webhook/whatsapp', { method: 'POST', body, headers: firma ? { 'x-hub-signature-256': firma } : {} });
  const firmar = (s) => 'sha256=' + crypto.createHmac('sha256', s).update(body).digest('hex');
  assert.equal((await enviar(base)).status, 403);
  assert.equal((await enviar(base, firmar('falso'))).status, 403);
  assert.equal((await enviar(sinClave, firmar(''))).status, 403);
  assert.equal((await enviar(base, firmar(SECRETO))).status, 200);
});

test('lo simulado no se marca como publicado ni respondido, y las fotos se guardan', async () => {
  const e = await api('/api/empresas', 'POST', { nombre: 'Prueba' });
  const { publicaciones: [p] } = await api('/api/contenido/generar', 'POST', { empresaId: e.id, plataforma: 'facebook', cantidad: 1 });
  const { publicacion } = await api(`/api/publicaciones/${p.id}/foto`, 'POST', { data: 'data:image/png;base64,aG9sYQ==' });
  const foto = await fetch(base + publicacion.imagenUrl);
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get('content-type'), 'image/png');
  assert.equal(await foto.text(), 'hola');

  const r = await api(`/api/publicaciones/${p.id}/publicar`, 'POST', {});
  assert.equal(r.resultado.simulado, true);
  assert.equal(r.publicacion.estado, 'borrador');

  await api(`/api/publicaciones/${p.id}`, 'PATCH', { accion: 'programar', fecha: new Date(0).toISOString() });
  let final;
  for (let i = 0; i < 30 && final !== 'fallido'; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    final = (await api('/api/estado')).publicaciones.find((x) => x.id === p.id).estado;
  }
  assert.equal(final, 'fallido');

  const m = await api('/api/mensajes', 'POST', { empresaId: e.id, canal: 'whatsapp', cliente: 'Ana', texto: 'hola' });
  const resp = await api(`/api/mensajes/${m.id}/responder`, 'POST', { respuesta: 'hola' });
  assert.equal(resp.mensaje.estado, 'pendiente');
});

test('el programador no publica dos veces si una vuelta tarda', async () => {
  const { estado } = require('./store');
  const adapters = require('./adapters');
  const scheduler = require('./scheduler');
  let veces = 0;
  const original = adapters.publicar;
  adapters.publicar = async () => { veces++; await new Promise((ok) => setTimeout(ok, 50)); return { ok: true, simulado: false }; };
  const guardarArchivoReal = fs.writeFileSync;
  fs.writeFileSync = () => {};
  try {
    estado.publicaciones.push({ id: 'a', estado: 'programado', plataforma: 'facebook', fechaProgramada: new Date(0).toISOString() });
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    assert.equal(veces, 1);
    assert.equal(estado.publicaciones[0].estado, 'publicado');
  } finally {
    adapters.publicar = original;
    fs.writeFileSync = guardarArchivoReal;
  }
});

test('Instagram: prepara la foto, espera a Meta, publica una sola vez y borra la copia', async () => {
  const adapters = require('./adapters');
  const imagen = require('./imagen');
  const store = require('./store');
  const originales = [globalThis.fetch, imagen.prepararInstagram, store.borrarArchivo];
  const env = { META_ACCESS_TOKEN: 't', META_ESPERA_MS: '1', PUBLIC_BASE_URL: 'https://panel.test/' };
  Object.assign(process.env, env);
  let estados, llamadas, borradas;
  const preparar = (lista) => { estados = lista; llamadas = []; borradas = []; };
  imagen.prepararInstagram = async () => '/generated/ig-1.jpg';
  store.borrarArchivo = async (r) => { borradas.push(r); };
  globalThis.fetch = async (url, op = {}) => {
    const u = new URL(url);
    llamadas.push([op.method || 'GET', u.pathname.split('/').pop(), op.body && op.body.get('image_url')]);
    const datos = op.method === 'POST' ? { id: u.pathname.endsWith('/media') ? 'cont' : 'final' } : { status_code: estados.length > 1 ? estados.shift() : estados[0] };
    return new Response(JSON.stringify(datos));
  };
  const pub = { id: 'ig', texto: 'hola', imagenUrl: 'https://panel.test/generated/x.png' };
  const publicar = () => adapters.publicar('instagram', pub, { metaIgId: '9' });
  const seIntento = () => llamadas.some((l) => l[1] === 'media_publish');
  try {
    preparar(['IN_PROGRESS', 'FINISHED']);
    const [uno, dos] = await Promise.all([publicar(), publicar()]);
    assert.equal(uno.ok, true, uno.nota);
    assert.equal(dos.error, 'en_curso');
    assert.deepEqual(llamadas.map((l) => l[1]), ['media', 'cont', 'cont', 'media_publish']);
    assert.equal(llamadas[0][2], 'https://panel.test/generated/ig-1.jpg');
    assert.deepEqual(borradas, ['/generated/ig-1.jpg']);

    for (const malo of ['ERROR', 'EXPIRED', 'IN_PROGRESS']) {
      preparar([malo]);
      assert.equal((await publicar()).ok, false, malo);
      assert.equal(seIntento(), false, malo);
      assert.equal(borradas.length, 1, malo);
    }

    delete process.env.PUBLIC_BASE_URL;
    preparar(['FINISHED']);
    assert.equal((await publicar()).error, 'sin_base');
    assert.equal(llamadas.length, 0);
  } finally {
    [globalThis.fetch, imagen.prepararInstagram, store.borrarArchivo] = originales;
    Object.keys(env).forEach((k) => delete process.env[k]);
  }
});

const { ffmpeg } = require('./spots');
const hayFfmpeg = ffmpeg(['-version']).then(() => true, () => false);

test('Instagram: convierte cualquier foto a JPEG dentro de 4:5 y 1.91:1', async (t) => {
  if (!(await hayFfmpeg)) return t.skip('no hay ffmpeg en este equipo');
  const imagen = require('./imagen');
  const store = require('./store');
  const originales = [globalThis.fetch, store.guardarArchivo];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-'));
  dirs.push(dir);
  let copia, cuerpo;
  globalThis.fetch = async () => new Response(cuerpo);
  store.guardarArchivo = async (ruta, buf) => { assert.match(ruta, /^\/generated\/ig-.+\.jpg$/); copia = buf; };
  try {
    for (const [w, h, ext] of [[1024, 1536, 'png'], [1025, 1535, 'png'], [3000, 800, 'jpg'], [1000, 1000, 'webp'], [4000, 3000, 'jpg'], [101, 777, 'gif']]) {
      const f = path.join(dir, 'f.' + ext);
      await ffmpeg(['-f', 'lavfi', '-i', `testsrc=s=${w}x${h}`, '-frames:v', '1', f]);
      cuerpo = fs.readFileSync(f);
      await imagen.prepararInstagram('https://x.test/f');
      const sof = copia.indexOf(Buffer.from('ffc0', 'hex'));
      const [alto, ancho] = [copia.readUInt16BE(sof + 5), copia.readUInt16BE(sof + 7)];
      const caso = `${w}x${h} ${ext} -> ${ancho}x${alto}`;
      assert.equal(copia.readUInt16BE(0), 0xffd8, caso);
      assert.ok(ancho / alto >= 0.8 && ancho / alto <= 1.91 && ancho <= 1440, caso);
      assert.ok(copia.length < 8e6, caso);
    }
    cuerpo = '#EXTM3U\nfile:///etc/passwd';
    await assert.rejects(imagen.prepararInstagram('https://x.test/f'), /debe ser JPG/);
  } finally {
    [globalThis.fetch, store.guardarArchivo] = originales;
  }
});

test('videos: se suben con contraseña, se comparten entre redes y se borran al final', async () => {
  const video = Buffer.concat([Buffer.from('....ftypisom'), crypto.randomBytes(300000)]);
  const subir = (headers) => fetch(base + '/api/videos', { method: 'POST', headers, body: video });
  assert.equal((await subir({ 'content-type': 'video/mp4' })).status, 401);
  assert.equal((await subir({ ...auth(CLAVE), 'content-type': 'text/plain' })).status, 415);
  // un formulario de otra web solo puede mandar text/plain, urlencoded o multipart: nunca video/mp4
  assert.equal((await fetch(base + '/api/empresas', { method: 'POST', headers: { ...auth(CLAVE), 'content-type': 'video/mp4' }, body: '{}' })).status, 415);
  const r = await subir({ ...auth(CLAVE), 'content-type': 'video/mp4', 'x-nombre': 'prueba.mp4' });
  assert.equal(r.status, 201);
  const { video: v } = await r.json();
  assert.equal(v.bytes, video.length);
  const emp = await api('/api/empresas', 'POST', { nombre: 'VOLTUM' });
  const { publicaciones } = await api('/api/publicaciones', 'POST', { empresaId: emp.id, plataformas: ['instagram', 'facebook', 'linkedin'], texto: 'hola', video: v });
  assert.deepEqual(publicaciones.map((p) => p.plataforma), ['instagram', 'facebook']);
  const bajar = (h = {}) => fetch(base + '/api/videos/' + v.archivo, { headers: { ...auth(CLAVE), ...h } });
  assert.ok(Buffer.from(await (await bajar()).arrayBuffer()).equals(video));
  const parcial = await bajar({ range: 'bytes=10-19' });
  assert.equal(parcial.status, 206);
  assert.ok(Buffer.from(await parcial.arrayBuffer()).equals(video.subarray(10, 20)));
  // sin cuenta de Meta conectada no se da por publicado
  const pub = await api('/api/publicaciones/' + publicaciones[0].id + '/publicar', 'POST');
  assert.equal(pub.publicacion.estado, 'borrador');
  await api('/api/publicaciones/' + publicaciones[0].id, 'DELETE');
  assert.equal((await bajar()).status, 200, 'la otra red todavía lo usa');
  await api('/api/publicaciones/' + publicaciones[1].id, 'DELETE');
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal((await bajar()).status, 404);
});

test('foto pro: manda la foto real del producto a la IA y guarda el resultado', async () => {
  const imagen = require('./imagen');
  const store = require('./store');
  const originales = [globalThis.fetch, store.guardarArchivo];
  process.env.IMAGE_API_KEY = 'k';
  const jpg = Buffer.from('ffd8ffe000104a464946', 'hex');
  let enviado, guardado;
  globalThis.fetch = async (url, op = {}) => {
    if (url === 'https://tienda.test/sh80.jpg') return new Response(jpg);
    enviado = { url, form: op.body };
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }));
  };
  store.guardarArchivo = async (ruta, b) => { guardado = [ruta, b.toString()]; };
  try {
    const ruta = await imagen.fotoPro('https://tienda.test/sh80.jpg', 'beach party', 'x1');
    assert.equal(enviado.url, 'https://api.openai.com/v1/images/edits');
    const foto = enviado.form.get('image[]');
    assert.equal(foto.type, 'image/jpeg');
    assert.deepEqual(Buffer.from(await foto.arrayBuffer()), jpg);
    assert.match(enviado.form.get('prompt'), /EXACTLY.*beach party/s);
    assert.deepEqual(guardado, ['/generated/pro-x1.png', 'png']);
    assert.equal(ruta, '/generated/pro-x1.png');
  } finally {
    [globalThis.fetch, store.guardarArchivo] = originales;
    delete process.env.IMAGE_API_KEY;
  }
});

test('diseño pro: quita el fondo blanco y deja la imagen en 1080x1350 con textos', async (t) => {
  if (!(await hayFfmpeg)) return t.skip('no hay ffmpeg en este equipo');
  const imagen = require('./imagen');
  const store = require('./store');
  const originales = [globalThis.fetch, store.guardarArchivo];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diseno-'));
  dirs.push(dir);
  // "producto": cuadro rojo sobre fondo blanco
  const f = path.join(dir, 'p.jpg');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=white:s=800x800', '-vf', 'drawbox=x=300:y=300:w=200:h=200:color=red:t=fill', '-frames:v', '1', f]);
  let salida;
  globalThis.fetch = async () => new Response(fs.readFileSync(f));
  store.guardarArchivo = async (ruta, b) => { assert.match(ruta, /^\/generated\/diseno-.+\.jpg$/); salida = b; };
  try {
    await imagen.disenoPro('https://x.test/p', { marca: 'G-TIDE', titulo: 'Bocina 100% "pro" \ ñ', detalle: '40W · RGB', precio: '$759', antes: '$969', web: 'celmaxxgtide.com' });
    const out = path.join(dir, 'o.jpg');
    fs.writeFileSync(out, salida);
    const pixel = async (x, y) => { const p = path.join(dir, 'px'); await ffmpeg(['-i', out, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', p]); return [...fs.readFileSync(p)]; };
    const sof = salida.indexOf(Buffer.from('ffc0', 'hex'));
    assert.deepEqual([salida.readUInt16BE(sof + 7), salida.readUInt16BE(sof + 5)], [1080, 1350]);
    const [r, g, b] = await pixel(540, 670); // centro: el producto rojo
    assert.ok(r > 180 && g < 90 && b < 90, 'producto ' + [r, g, b]);
    const fondo = await pixel(250, 400); // donde estaba el blanco de la foto: ahora fondo oscuro
    assert.ok(fondo.every((v, i) => v < (i === 2 ? 240 : 120)), 'fondo ' + fondo);
  } finally {
    [globalThis.fetch, store.guardarArchivo] = originales;
  }
});

test('una publicación se puede cambiar de empresa mientras no haya salido', async () => {
  const g = await api('/api/empresas', 'POST', { nombre: 'g-TIDE MEXICO' });
  const h = await api('/api/empresas', 'POST', { nombre: 'heysong' });
  const v = await (await fetch(base + '/api/videos', { method: 'POST', headers: { ...auth(CLAVE), 'content-type': 'video/mp4' }, body: crypto.randomBytes(5000) })).json();
  const { publicaciones: [p] } = await api('/api/publicaciones', 'POST', { empresaId: g.id, plataformas: ['facebook'], texto: 'bocina heysong', video: v.video });
  const movida = await api('/api/publicaciones/' + p.id, 'PATCH', { empresaId: h.id });
  assert.equal(movida.empresaId, h.id);
  const mal = await fetch(base + '/api/publicaciones/' + p.id, { method: 'PATCH', headers: { ...auth(CLAVE), 'content-type': 'application/json' }, body: JSON.stringify({ empresaId: 'no-existe' }) });
  assert.equal(mal.status, 400);
});

test('resultados: ranking por % de interacción y conclusiones con datos reales', () => {
  const { analizar } = require('./resultados');
  const it = (tipo, franja, origen, alcance, inter) => ({ red: 'instagram', tipo, franja, origen, alcance, interacciones: inter, texto: tipo, likes: 0, comentarios: 0 });
  const r = analizar([it('Reel', 'Noche (5 a 9 pm)', 'Real', 1000, 90), it('Reel', 'Noche (5 a 9 pm)', 'Real', 800, 64), it('Foto', 'Tarde (12 a 5 pm)', 'IA', 1000, 20), it('Foto', 'Tarde (12 a 5 pm)', 'IA', 500, 10)]);
  assert.equal(r.base, 'tasa');
  assert.equal(r.mejores[0].tasa, 0.09);
  assert.equal(r.porTipo[0].clave, 'Reel');
  assert.ok(r.conclusiones.some((c) => c.includes('"Reel"') && c.includes('"Foto"')));
  assert.ok(r.conclusiones.some((c) => c.includes('"Real"')));
  // Sin alcance (falta permiso) se ordena por interacciones
  assert.equal(analizar([{ likes: 5, comentarios: 1 }, { likes: 9, comentarios: 0 }]).base, 'interacciones');
});

test('resultados: si Meta no da insights avisa el permiso y usa likes/comentarios', async () => {
  const resultados = require('./resultados');
  const fetchReal = global.fetch, tokenReal = process.env.META_ACCESS_TOKEN;
  process.env.META_ACCESS_TOKEN = 'tok';
  global.fetch = async (url) => {
    const u = String(url);
    const json = (d) => ({ ok: true, json: async () => d });
    if (u.includes('fields=access_token')) return json({ access_token: 'tok-pagina' });
    if (u.includes('/media?')) return json({ data: [{ id: 'm1', caption: 'Prueba de sonido', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-11-20T02:00:00+0000', like_count: 40, comments_count: 5 }] });
    if (u.includes('/insights')) return json({ error: { message: '(#10) Application does not have permission for this action' } });
    if (u.includes('/posts?')) return json({ data: [{ id: 'p_1', message: 'Hola', created_time: '2026-11-20T20:00:00+0000', shares: { count: 2 }, reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 1 } }, attachments: { data: [{ media_type: 'photo' }] } }] });
    return json({});
  };
  try {
    const r = await resultados.resultadosEmpresa({ id: 'e-test', metaPageId: 'pg', metaIgId: 'ig' }, [{ texto: 'Prueba de sonido', imagenIA: false }], true);
    assert.equal(r.total, 2);
    assert.equal(r.base, 'interacciones');
    assert.equal(r.mejores[0].tipo, 'Reel');
    assert.equal(r.mejores[0].interacciones, 45);
    assert.equal(r.mejores[0].origen, 'Real');
    assert.equal(r.mejores[1].interacciones, 10);
    assert.ok(r.avisos.some((a) => a.includes('instagram_manage_insights')));
    assert.ok(r.avisos.some((a) => a.includes('read_insights')));
  } finally {
    global.fetch = fetchReal;
    if (tokenReal === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = tokenReal;
  }
});

test('fotos reales y Dame ideas: crea borradores con la foto real, nada se publica', async () => {
  const emp = await api('/api/empresas', 'POST', { nombre: 'Tienda Ideas' });
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');
  const foto = await api('/api/biblioteca', 'POST', { empresaId: emp.id, producto: 'Bocina X', nota: 'cliente en tienda', data: png });
  assert.match(foto.url, /^\/uploads\/bib-/);
  assert.equal((await fetch(base + foto.url)).status, 200);
  assert.equal((await api('/api/biblioteca', 'POST', { empresaId: emp.id, data: 'data:text/plain;base64,aG9sYQ==' })).error.includes('Formato'), true);

  const res = await api('/api/resultados/' + emp.id);
  assert.equal(res.total, 0);
  assert.ok(res.avisos.length);

  const r = await api('/api/ideas', 'POST', { empresaId: emp.id, cantidad: 6 });
  assert.equal(r.publicaciones.length, 6);
  assert.ok(r.publicaciones.every((p) => p.estado === 'borrador' && !p.fechaProgramada));
  assert.ok(r.publicaciones.some((p) => p.imagenUrl === foto.url && p.idea.fotoId === foto.id));

  await api('/api/biblioteca/' + foto.id, 'DELETE');
  const est = await api('/api/estado');
  assert.equal(est.biblioteca.filter((f) => f.id === foto.id).length, 0);
  assert.equal(est.publicaciones.filter((p) => p.empresaId === emp.id && p.estado === 'borrador').length, 6);
});
