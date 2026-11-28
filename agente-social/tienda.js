// TIENDA — catalogo publico de productos de un cliente (ej. VTL en Plaza Uruguay).
//
// - /tienda/:slug                pagina publica (sin contrasena)
// - /tienda/:slug/admin          la misma pagina; el dueno entra con su PIN y sube productos desde el celular
// - /api/tienda/:slug...         datos publicos y acciones del dueno (header X-Tienda-Pin)
// - /tienda-foto/:archivoId      fotos de los productos (solo las de la tienda, nunca otros archivos)
//
// Las tiendas viven en estado.tiendas (Mongo o data.json, como todo lo demas) y las fotos
// en el almacen de archivos (guardarArchivo/leerArchivo/borrarArchivo).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const { estado, guardar, id } = store;

const PAGINA = path.join(__dirname, 'public', 'tienda.html');
const DIR_SEMILLAS = path.join(__dirname, 'tiendas');
const CATEGORIAS = ['tablets', 'infantiles', 'arcade', 'juguetes', 'luces', 'gtide'];
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO = 6 * 1024 * 1024;
const DIAS_NUEVO = 7;

// Tiendas que se crean solas al arrancar si todavia no existen
const SEMILLAS = {
  vtl: {
    nombre: 'VTL',
    completo: 'Ventas de Todo Leal',
    whatsapp: '525539986380',
    direccion: 'Plaza Uruguay 17, piso 2, local 215, Centro, CDMX',
    mapsQuery: 'Plaza Uruguay 17, Centro, Ciudad de México',
    saludo: 'Gracias por su comprensión y por comprar con nosotros.',
  },
};

// ---------- utilidades ----------
function enviar(res, code, obj, extra) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

function lista() {
  if (!Array.isArray(estado.tiendas)) estado.tiendas = [];
  return estado.tiendas;
}
const porSlug = (slug) => lista().find((t) => t.slug === slug);

function productoPorArchivo(archivoId) {
  for (const t of lista()) {
    const p = (t.productos || []).find((x) => x.archivoId === archivoId);
    if (p) return p;
  }
  return null;
}

// Lo que ve cualquiera: nunca el PIN ni la empresa
function vistaTienda(t) {
  return { slug: t.slug, nombre: t.nombre, completo: t.completo, whatsapp: t.whatsapp, direccion: t.direccion, mapsQuery: t.mapsQuery, saludo: t.saludo };
}
function vistaProducto(p, conActivo) {
  const edad = Date.now() - new Date(p.creado).getTime();
  const v = { id: p.id, nombre: p.nombre, cat: p.cat, foto: '/tienda-foto/' + p.archivoId, orden: p.orden, nuevo: !p.semilla && edad >= 0 && edad < DIAS_NUEVO * 864e5 };
  if (conActivo) v.activo = p.activo !== false;
  return v;
}
function catalogo(t, todo) {
  const prods = (t.productos || []).filter((p) => todo || p.activo !== false).sort((a, b) => a.orden - b.orden);
  return { tienda: vistaTienda(t), productos: prods.map((p) => vistaProducto(p, todo)) };
}
// Para el panel (detras de PANEL_PASSWORD)
function vistaPanel(t) {
  return { slug: t.slug, nombre: t.nombre, completo: t.completo, pin: t.pin, empresaId: t.empresaId || null, whatsapp: t.whatsapp, direccion: t.direccion,
    productos: (t.productos || []).length, url: '/tienda/' + t.slug, admin: '/tienda/' + t.slug + '/admin' };
}

const pinNuevo = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');

// Revisa los primeros bytes: que de verdad sea la imagen que dice ser
function esImagen(buf, tipo) {
  if (tipo === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (tipo === 'image/png') return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (tipo === 'image/webp') return buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  return false;
}

// Lee el cuerpo sin pasar de 'max'; devuelve null si se pasa
function leerHasta(req, max) {
  return new Promise((resolve, reject) => {
    const trozos = []; let total = 0, grande = false;
    req.on('data', (c) => { total += c.length; if (total > max) { grande = true; trozos.length = 0; } else if (!grande) trozos.push(c); });
    req.on('end', () => resolve(grande ? null : Buffer.concat(trozos)));
    req.on('error', reject);
  });
}
function muyGrande(req, res) {
  res.on('finish', () => req.destroy());
  enviar(res, 413, { error: 'La foto pesa más de 6 MB' }, { Connection: 'close' });
}

// ---------- PIN del dueno, con limite de intentos por IP ----------
const VENTANA = 15 * 60 * 1000;
const MAX_FALLOS = 8;
const fallos = new Map(); // ip -> [marcas de tiempo de PIN equivocado]

// En Render hay un proxy delante: la ultima IP de X-Forwarded-For es la que vio el proxy
function ipDe(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || '');
}
function recientes(ip) {
  const ahora = Date.now();
  const l = (fallos.get(ip) || []).filter((t) => ahora - t < VENTANA);
  if (l.length) fallos.set(ip, l); else fallos.delete(ip);
  return l;
}
function pinCorrecto(dado, pin) {
  const a = Buffer.from(String(dado || '')), b = Buffer.from(String(pin || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
// true si puede pasar; si no, ya respondio (401 o 429)
function verificarPin(req, res, t) {
  const ip = ipDe(req);
  if (recientes(ip).length >= MAX_FALLOS) {
    enviar(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' }, { 'Retry-After': String(VENTANA / 1000) });
    return false;
  }
  if (pinCorrecto(req.headers['x-tienda-pin'], t.pin)) return true;
  if (fallos.size > 10000) fallos.clear(); // nunca crece sin limite
  fallos.set(ip, [...recientes(ip), Date.now()]);
  enviar(res, 401, { error: 'PIN incorrecto' });
  return false;
}

// ---------- publicacion para redes al subir un producto ----------
function telefonoBonito(wa) {
  const d = String(wa || '').replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}` : d;
}
function direccionCorta(dir) {
  const partes = String(dir || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [partes[0], ...partes.slice(1).filter((p) => !/^(piso|local|int|interior|depto)\b/i.test(p))].filter(Boolean).join(', ');
}
function textoProducto(t, p) {
  const venta = p.cat === 'gtide' ? 'Pregunta por tu modelo' : ['juguetes', 'luces'].includes(p.cat) ? 'Solo por caja cerrada' : 'Mayoreo y por caja';
  const partes = [`Nuevo en ${t.nombre}: ${p.nombre}.`];
  const dir = direccionCorta(t.direccion);
  partes.push(dir ? `${venta} en ${dir}.` : `${venta}.`);
  if (t.whatsapp) partes.push(`Pedidos por WhatsApp ${telefonoBonito(t.whatsapp)}.`);
  const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (base) partes.push(`Catálogo: ${base}/tienda/${t.slug}`);
  return partes.join(' ');
}
// Deja un borrador por red para que el dueno del panel lo apruebe: nunca se publica solo.
// La foto va como ruta local (/tienda-foto/...); al publicar se vuelve URL completa, igual que /uploads.
function borradoresProducto(t, p) {
  if (!t.empresaId) return [];
  const empresa = (estado.empresas || []).find((e) => e.id === t.empresaId);
  if (!empresa) return [];
  const redes = ['facebook'];
  if (empresa.metaIgId || (empresa.plataformas || []).includes('instagram')) redes.push('instagram');
  const texto = textoProducto(t, p);
  const creadas = redes.map((plataforma) => ({
    id: id(), empresaId: empresa.id, plataforma, texto, hashtags: [],
    imagenUrl: '/tienda-foto/' + p.archivoId, imagenPrompt: '', imagenIA: false,
    estado: 'borrador', fechaProgramada: null, creado: new Date().toISOString(),
    origen: 'tienda', tiendaSlug: t.slug, productoId: p.id,
  }));
  estado.publicaciones.push(...creadas);
  guardar();
  return creadas;
}

// ---------- rutas publicas: pagina y fotos ----------
function servirPagina(req, res, ruta) {
  const m = /^\/tienda\/([a-z0-9-]+)(\/admin)?\/?$/.exec(ruta);
  if (!m || !porSlug(m[1]) || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Tienda no encontrada');
  }
  fs.readFile(PAGINA, (err, html) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
}

async function servirFoto(req, res, ruta) {
  const archivoId = ruta.slice('/tienda-foto/'.length);
  const p = /^tf-[a-z0-9-]+$/.test(archivoId) && productoPorArchivo(archivoId);
  const buf = p && (await store.leerArchivo(archivoId));
  if (!buf) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Foto no encontrada');
  }
  res.writeHead(200, { 'Content-Type': p.tipo || 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}

// ---------- API publica + dueno: /api/tienda/:slug/... ----------
async function manejarAPI(req, res, ruta) {
  const partes = ruta.split('/').filter(Boolean); // ['api', 'tienda', slug, ...]
  const t = porSlug(partes[2]);
  if (!t) return enviar(res, 404, { error: 'Tienda no encontrada' });
  const [, , , accion, pid] = partes;

  if (!accion && req.method === 'GET') return enviar(res, 200, catalogo(t, false));

  // De aqui en adelante, solo el dueno con su PIN
  if (!['entrar', 'productos', 'todo'].includes(accion)) return enviar(res, 404, { error: 'Ruta no encontrada' });
  if (!verificarPin(req, res, t)) return;

  if (accion === 'entrar' && !pid && req.method === 'POST') return enviar(res, 200, { ok: true });
  if (accion === 'todo' && !pid && req.method === 'GET') return enviar(res, 200, catalogo(t, true));

  if (accion === 'productos' && !pid && req.method === 'POST') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const nombre = String(q.get('nombre') || '').trim().slice(0, 80);
    const cat = String(q.get('cat') || '');
    if (!nombre) return enviar(res, 400, { error: 'Escribe el nombre del producto' });
    if (!CATEGORIAS.includes(cat)) return enviar(res, 400, { error: 'Categoría no válida' });
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.includes(tipo)) return enviar(res, 415, { error: 'Sube una foto JPG, PNG o WEBP' });
    if (+req.headers['content-length'] > MAX_FOTO) return muyGrande(req, res);
    const buf = await leerHasta(req, MAX_FOTO);
    if (!buf) return muyGrande(req, res);
    if (!esImagen(buf, tipo)) return enviar(res, 400, { error: 'La foto llegó dañada o no es una imagen' });
    const archivoId = 'tf-' + id();
    await store.guardarArchivo(archivoId, buf, tipo);
    const ordenes = (t.productos || []).map((p) => p.orden).filter(Number.isFinite);
    const p = { id: id(), nombre, cat, archivoId, tipo, activo: true, orden: ordenes.length ? Math.min(...ordenes) - 1 : 0, creado: new Date().toISOString() };
    if (!Array.isArray(t.productos)) t.productos = [];
    t.productos.push(p);
    guardar();
    // Que falle la publicacion para redes nunca tumba la subida del producto
    try { borradoresProducto(t, p); } catch (e) { console.error('[tienda] no se creó la publicación:', e.message); }
    return enviar(res, 201, vistaProducto(p, true));
  }

  if (accion === 'productos' && pid) {
    const p = (t.productos || []).find((x) => x.id === pid);
    if (!p) return enviar(res, 404, { error: 'Producto no encontrado' });
    if (req.method === 'PATCH') {
      const crudo = await leerHasta(req, 64 * 1024);
      if (!crudo) return enviar(res, 413, { error: 'Demasiado contenido' });
      let body;
      try { body = JSON.parse(crudo.toString('utf8') || '{}') || {}; } catch (e) { return enviar(res, 400, { error: 'JSON no válido' }); }
      const cambios = {};
      if (body.nombre !== undefined) {
        const n = String(body.nombre).trim().slice(0, 80);
        if (!n) return enviar(res, 400, { error: 'Escribe el nombre del producto' });
        cambios.nombre = n;
      }
      if (body.cat !== undefined) {
        if (!CATEGORIAS.includes(body.cat)) return enviar(res, 400, { error: 'Categoría no válida' });
        cambios.cat = body.cat;
      }
      if (body.activo !== undefined) {
        if (typeof body.activo !== 'boolean') return enviar(res, 400, { error: 'activo debe ser true o false' });
        cambios.activo = body.activo;
      }
      if (body.orden !== undefined) {
        if (typeof body.orden !== 'number' || !Number.isFinite(body.orden)) return enviar(res, 400, { error: 'orden debe ser un número' });
        cambios.orden = body.orden;
      }
      Object.assign(p, cambios);
      guardar();
      return enviar(res, 200, vistaProducto(p, true));
    }
    if (req.method === 'DELETE') {
      t.productos = t.productos.filter((x) => x.id !== p.id);
      // Un producto que ya no se vende no se anuncia: sus borradores pendientes se descartan
      for (const pub of estado.publicaciones) {
        if (pub.productoId === p.id && pub.tiendaSlug === t.slug && pub.estado !== 'publicado') pub.estado = 'descartado';
      }
      guardar();
      await store.borrarArchivo(p.archivoId).catch((e) => console.error('[tienda] no se borró la foto:', e.message));
      return enviar(res, 200, { ok: true });
    }
  }
  return enviar(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- panel: /api/tiendas (ya paso por PANEL_PASSWORD) ----------
function manejarPanel(req, res, partes, body) {
  if (req.method === 'GET' && !partes[2]) return enviar(res, 200, lista().map(vistaPanel));
  if (req.method === 'PATCH' && partes[2]) {
    const t = porSlug(partes[2]);
    if (!t) return enviar(res, 404, { error: 'Tienda no encontrada' });
    const cambios = {};
    if (body.pin !== undefined) {
      if (!/^\d{4,8}$/.test(String(body.pin))) return enviar(res, 400, { error: 'El PIN debe tener de 4 a 8 números' });
      cambios.pin = String(body.pin);
    }
    if (body.empresaId !== undefined) {
      if (body.empresaId === null || body.empresaId === '') cambios.empresaId = null;
      else if ((estado.empresas || []).some((e) => e.id === body.empresaId)) cambios.empresaId = body.empresaId;
      else return enviar(res, 400, { error: 'Esa empresa no existe' });
    }
    if (body.whatsapp !== undefined) {
      const w = String(body.whatsapp).replace(/\D/g, '');
      if (w.length < 10 || w.length > 13) return enviar(res, 400, { error: 'WhatsApp no válido' });
      cambios.whatsapp = w.length === 10 ? '52' + w : w;
    }
    if (body.direccion !== undefined) {
      const d = String(body.direccion).trim().slice(0, 200);
      if (!d) return enviar(res, 400, { error: 'Escribe la dirección' });
      cambios.direccion = d;
    }
    Object.assign(t, cambios);
    guardar();
    return enviar(res, 200, vistaPanel(t));
  }
  return enviar(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- semillas: crea las tiendas que falten (una sola vez, nunca dos a la vez) ----------
let sembrando = null;
function sembrar() {
  if (!sembrando) sembrando = sembrarTodas().finally(() => { sembrando = null; });
  return sembrando;
}
async function sembrarTodas() {
  for (const [slug, datos] of Object.entries(SEMILLAS)) {
    if (porSlug(slug)) continue;
    const dir = path.join(DIR_SEMILLAS, slug);
    let entradas = [];
    try { entradas = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8')); } catch (e) { console.error(`[tienda] sin seed.json para ${slug}:`, e.message); }
    const productos = [];
    for (const [i, s] of entradas.entries()) {
      if (!CATEGORIAS.includes(s.cat) || !/^[\w.-]+\.(jpe?g|png|webp)$/i.test(s.archivo || '')) continue;
      let buf;
      try { buf = fs.readFileSync(path.join(dir, 'img', s.archivo)); } catch (e) { console.error(`[tienda] falta la foto ${s.archivo}`); continue; }
      const tipo = /\.png$/i.test(s.archivo) ? 'image/png' : /\.webp$/i.test(s.archivo) ? 'image/webp' : 'image/jpeg';
      // Nombre fijo por semilla: si se corta a la mitad, la siguiente vez reescribe los mismos archivos
      const archivoId = `tf-${slug}-s${i}`;
      await store.guardarArchivo(archivoId, buf, tipo);
      productos.push({ id: id(), nombre: String(s.nombre || '').trim().slice(0, 80) || 'Producto', cat: s.cat, archivoId, tipo, activo: true,
        orden: Number.isFinite(s.orden) ? s.orden : i, creado: new Date().toISOString(), semilla: true });
    }
    if (porSlug(slug)) continue; // por si se creo mientras se subian las fotos
    // Las semillas nunca generan publicaciones para redes
    lista().push({ slug, ...datos, pin: pinNuevo(), empresaId: null, productos, creado: new Date().toISOString() });
    guardar();
    console.log(`[tienda] Creada la tienda ${slug} con ${productos.length} productos`);
  }
}

module.exports = { servirPagina, servirFoto, manejarAPI, manejarPanel, sembrar, textoProducto, CATEGORIAS };
