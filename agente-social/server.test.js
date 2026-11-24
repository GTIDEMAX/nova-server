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
