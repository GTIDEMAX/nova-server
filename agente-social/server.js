// AGENTE SOCIAL — Backend + panel web
// Gestiona varias empresas: crea contenido con IA, programa y publica en redes,
// y redacta respuestas de atencion al cliente (WhatsApp, Instagram, etc.).
const http = require('http');
const fs = require('fs');
const path = require('path');

const { estado, guardar, id } = require('./store');
const ia = require('./ia');
const adapters = require('./adapters');
const scheduler = require('./scheduler');
const feed = require('./feed');
const imagen = require('./imagen');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

// Convierte una ruta de imagen relativa (/generated/x.png) en URL absoluta,
// necesaria para publicar en redes (Meta exige URL publica completa).
function absolutizar(url, base) {
  if (url && url.startsWith('/') && base) return base + url;
  return url;
}
function baseDeReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + (req.headers.host || '');
}

// ---------- utilidades ----------
function enviarJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function leerBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function servirEstatico(req, res) {
  let ruta = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const archivo = path.join(PUBLIC_DIR, path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(archivo, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream' });
    res.end(contenido);
  });
}

function buscar(coleccion, idBuscado) {
  return estado[coleccion].find((x) => x.id === idBuscado);
}

// ---------- API ----------
async function manejarAPI(req, res, ruta) {
  const partes = ruta.split('/').filter(Boolean); // ['api', ...]
  const recurso = partes[1];
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await leerBody(req) : {};

  // Estado general (todo lo que necesita el panel)
  if (recurso === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, { ...estado, iaActiva: ia.hayClave, modelo: ia.MODELO, imagenActiva: imagen.hayImagen });
  }

  // Estado de conexion con Meta (Instagram + Facebook)
  if (recurso === 'meta' && partes[2] === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, await adapters.verificarMeta());
  }

  // Estado de conexion con WhatsApp
  if (recurso === 'whatsapp' && partes[2] === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, await adapters.verificarWhatsApp());
  }

  // Estado del programador automatico
  if (recurso === 'programador' && partes[2] === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, scheduler.estadoScheduler());
  }

  // Metricas y reportes
  if (recurso === 'metricas' && req.method === 'GET') {
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    return enviarJSON(res, 200, computarMetricas(q.get('empresaId') || ''));
  }

  // ----- Empresas -----
  if (recurso === 'empresas') {
    if (req.method === 'POST') {
      const empresa = {
        id: id(),
        nombre: body.nombre || 'Empresa sin nombre',
        rubro: body.rubro || '',
        tono: body.tono || 'cercano y profesional',
        publico: body.publico || '',
        plataformas: Array.isArray(body.plataformas) ? body.plataformas : [],
        whatsappPhoneId: body.whatsappPhoneId || '',
        autoResponder: !!body.autoResponder,
        creado: new Date().toISOString(),
      };
      estado.empresas.push(empresa);
      guardar();
      return enviarJSON(res, 201, empresa);
    }
    if (req.method === 'DELETE' && partes[2]) {
      estado.empresas = estado.empresas.filter((e) => e.id !== partes[2]);
      estado.publicaciones = estado.publicaciones.filter((p) => p.empresaId !== partes[2]);
      estado.mensajes = estado.mensajes.filter((m) => m.empresaId !== partes[2]);
      guardar();
      return enviarJSON(res, 200, { ok: true });
    }
  }

  // ----- Contenido: generar con IA -----
  if (recurso === 'contenido' && partes[2] === 'generar' && req.method === 'POST') {
    const empresa = buscar('empresas', body.empresaId);
    if (!empresa) return enviarJSON(res, 400, { error: 'Empresa no encontrada' });
    try {
      const ideas = await ia.generarContenido({
        empresa,
        plataforma: body.plataforma || 'instagram',
        tema: body.tema,
        cantidad: body.cantidad,
      });
      const creadas = ideas.map((idea) => {
        const pub = {
          id: id(),
          empresaId: empresa.id,
          plataforma: body.plataforma || 'instagram',
          texto: idea.texto,
          hashtags: idea.hashtags || [],
          imagenUrl: '',
          imagenPrompt: idea.imagenPrompt || '',
          imagenIA: false,
          estado: 'borrador',
          fechaProgramada: null,
          creado: new Date().toISOString(),
        };
        estado.publicaciones.push(pub);
        return pub;
      });
      guardar();
      // Genera imagenes con IA si se pidio y hay clave de imagen
      if (body.conImagen && imagen.hayImagen) {
        for (const pub of creadas) {
          try {
            const prompt = imagen.construirPrompt({ empresa, plataforma: pub.plataforma, texto: pub.texto, imagenPrompt: pub.imagenPrompt });
            const url = await imagen.generarImagen(prompt, pub.id);
            if (url) { pub.imagenUrl = url; pub.imagenIA = true; }
          } catch (e) {
            pub.imagenError = e.message;
          }
        }
        guardar();
      }
      return enviarJSON(res, 201, { publicaciones: creadas, imagenActiva: imagen.hayImagen });
    } catch (e) {
      return enviarJSON(res, 500, { error: 'Error generando contenido: ' + e.message });
    }
  }

  // ----- Publicaciones -----
  if (recurso === 'publicaciones' && partes[2]) {
    const pub = buscar('publicaciones', partes[2]);
    if (!pub) return enviarJSON(res, 404, { error: 'Publicacion no encontrada' });

    if (req.method === 'DELETE') {
      estado.publicaciones = estado.publicaciones.filter((p) => p.id !== pub.id);
      guardar();
      return enviarJSON(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      // Editar texto, aprobar o programar
      if (typeof body.texto === 'string') pub.texto = body.texto;
      if (typeof body.imagenUrl === 'string') pub.imagenUrl = body.imagenUrl;
      if (Array.isArray(body.hashtags)) pub.hashtags = body.hashtags;
      if (body.accion === 'aprobar') pub.estado = 'aprobado';
      if (body.accion === 'programar') {
        pub.estado = 'programado';
        pub.fechaProgramada = body.fecha || null;
        pub.intentos = 0;
        pub.ultimoError = null;
      }
      guardar();
      return enviarJSON(res, 200, pub);
    }
    // (Re)generar imagen con IA para esta publicacion
    if (partes[3] === 'imagen' && req.method === 'POST') {
      if (!imagen.hayImagen) return enviarJSON(res, 400, { error: 'Falta IMAGE_API_KEY para generar imagenes con IA' });
      const empresa = buscar('empresas', pub.empresaId);
      try {
        const prompt = imagen.construirPrompt({ empresa, plataforma: pub.plataforma, texto: pub.texto, imagenPrompt: pub.imagenPrompt || body.imagenPrompt });
        const url = await imagen.generarImagen(prompt, pub.id + '-' + Date.now().toString(36));
        pub.imagenUrl = url;
        pub.imagenIA = true;
        pub.imagenError = null;
        guardar();
        return enviarJSON(res, 200, { publicacion: pub });
      } catch (e) {
        return enviarJSON(res, 500, { error: 'Error generando imagen: ' + e.message });
      }
    }
    if (partes[3] === 'publicar' && req.method === 'POST') {
      const empresa = buscar('empresas', pub.empresaId);
      const base = baseDeReq(req);
      const pubEnvio = { ...pub, imagenUrl: absolutizar(pub.imagenUrl, base) };
      const resultado = await adapters.publicar(pub.plataforma, pubEnvio, empresa);
      if (resultado.ok) {
        pub.estado = 'publicado';
        pub.publicado = new Date().toISOString();
      }
      pub.resultadoPublicacion = resultado;
      guardar();
      return enviarJSON(res, 200, { publicacion: pub, resultado });
    }
  }

  // ----- Mensajes de clientes -----
  if (recurso === 'mensajes') {
    // Nuevo mensaje entrante -> genera borrador de respuesta con IA
    if (req.method === 'POST' && !partes[2]) {
      const empresa = buscar('empresas', body.empresaId);
      if (!empresa) return enviarJSON(res, 400, { error: 'Empresa no encontrada' });
      const msg = await crearMensajeEntrante({
        empresa,
        canal: body.canal || 'whatsapp',
        cliente: body.cliente,
        texto: body.texto || '',
        telefono: body.telefono,
      });
      return enviarJSON(res, 201, msg);
    }

    if (partes[2]) {
      const msg = buscar('mensajes', partes[2]);
      if (!msg) return enviarJSON(res, 404, { error: 'Mensaje no encontrado' });

      // Regenerar borrador
      if (partes[3] === 'regenerar' && req.method === 'POST') {
        const empresa = buscar('empresas', msg.empresaId);
        msg.respuestaBorrador = await ia.redactarRespuesta({
          empresa,
          canal: msg.canal,
          cliente: msg.cliente,
          texto: msg.texto,
        });
        guardar();
        return enviarJSON(res, 200, msg);
      }
      // Aprobar y enviar la respuesta al cliente
      if (partes[3] === 'responder' && req.method === 'POST') {
        if (typeof body.respuesta === 'string') msg.respuestaBorrador = body.respuesta;
        let envio = { ok: true, simulado: true };
        if (msg.canal === 'whatsapp') {
          envio = await adapters.enviarWhatsApp(msg.telefono || msg.cliente, msg.respuestaBorrador, msg.whatsappPhoneId);
        }
        msg.estado = 'respondido';
        msg.respondido = new Date().toISOString();
        msg.envio = envio;
        guardar();
        return enviarJSON(res, 200, { mensaje: msg, envio });
      }
      if (req.method === 'DELETE') {
        estado.mensajes = estado.mensajes.filter((m) => m.id !== msg.id);
        guardar();
        return enviarJSON(res, 200, { ok: true });
      }
    }
  }

  return enviarJSON(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- mensajes entrantes (usado por API y por el webhook de WhatsApp) ----------
async function crearMensajeEntrante({ empresa, canal, cliente, texto, telefono, whatsappPhoneId }) {
  let borrador = '';
  try {
    borrador = await ia.redactarRespuesta({ empresa, canal, cliente: cliente || 'Cliente', texto: texto || '' });
  } catch (e) {
    borrador = 'No se pudo generar la respuesta automatica: ' + e.message;
  }
  const msg = {
    id: id(),
    empresaId: empresa.id,
    canal: canal || 'whatsapp',
    cliente: cliente || 'Cliente',
    telefono: telefono || '',
    whatsappPhoneId: whatsappPhoneId || '',
    texto: texto || '',
    respuestaBorrador: borrador,
    estado: 'pendiente',
    creado: new Date().toISOString(),
  };
  // Auto-respuesta por empresa (solo WhatsApp): responde solo, sin aprobacion
  if (empresa.autoResponder && (canal || 'whatsapp') === 'whatsapp') {
    const envio = await adapters.enviarWhatsApp(telefono || cliente, borrador, whatsappPhoneId);
    if (envio.ok) {
      msg.estado = 'respondido';
      msg.respondido = new Date().toISOString();
      msg.envio = envio;
      msg.auto = true;
    }
  }
  estado.mensajes.push(msg);
  guardar();
  return msg;
}

// ---------- webhook de WhatsApp Cloud API ----------
function verificarWebhookWhatsApp(req, res) {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const mode = q.get('hub.mode');
  const token = q.get('hub.verify_token');
  const challenge = q.get('hub.challenge');
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN || 'agente-social';
  if (mode === 'subscribe' && token === esperado) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(challenge || '');
  }
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden');
}

async function recibirWebhookWhatsApp(req, res) {
  const body = await leerBody(req);
  // WhatsApp exige un 200 rapido; respondemos y procesamos despues.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('EVENT_RECEIVED');
  try {
    await procesarWhatsApp(body);
  } catch (e) {
    console.error('[whatsapp] error procesando webhook:', e.message);
  }
}

async function procesarWhatsApp(body) {
  const entradas = (body && body.entry) || [];
  for (const entry of entradas) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneId = value.metadata && value.metadata.phone_number_id;
      const contactos = value.contacts || [];
      for (const m of value.messages || []) {
        if (m.type !== 'text') continue; // por ahora solo texto
        const from = m.from;
        const contacto = contactos.find((c) => c.wa_id === from);
        const nombre = (contacto && contacto.profile && contacto.profile.name) || from;
        // Enruta al negocio dueño de ese numero, o al primero registrado
        const empresa = estado.empresas.find((e) => e.whatsappPhoneId && e.whatsappPhoneId === phoneId) || estado.empresas[0];
        if (!empresa) {
          console.log('[whatsapp] mensaje recibido pero no hay empresas registradas');
          continue;
        }
        await crearMensajeEntrante({ empresa, canal: 'whatsapp', cliente: nombre, texto: m.text.body, telefono: from, whatsappPhoneId: phoneId });
        console.log(`[whatsapp] mensaje de ${from} -> ${empresa.nombre}${empresa.autoResponder ? ' (respondido auto)' : ''}`);
      }
    }
  }
}

// ---------- metricas ----------
function computarMetricas(empresaId) {
  const pubs = empresaId ? estado.publicaciones.filter((p) => p.empresaId === empresaId) : estado.publicaciones;
  const msgs = empresaId ? estado.mensajes.filter((m) => m.empresaId === empresaId) : estado.mensajes;

  const contar = (arr, campo) => arr.reduce((acc, x) => { const k = x[campo] || 'otro'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  const porEstado = contar(pubs, 'estado');
  const publicadas = pubs.filter((p) => p.estado === 'publicado');
  const porPlataforma = contar(publicadas, 'plataforma');
  const respondidos = msgs.filter((m) => m.estado === 'respondido').length;

  // Actividad de los ultimos 7 dias (publicaciones publicadas por dia)
  const dias = [];
  const hoy = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - i);
    const clave = d.toISOString().slice(0, 10);
    const etiqueta = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
    const cuenta = publicadas.filter((p) => (p.publicado || p.creado || '').slice(0, 10) === clave).length;
    dias.push({ fecha: etiqueta, publicadas: cuenta });
  }

  // Resumen por empresa (solo en vista general)
  const porEmpresa = empresaId
    ? []
    : estado.empresas.map((e) => ({
        nombre: e.nombre,
        publicadas: estado.publicaciones.filter((p) => p.empresaId === e.id && p.estado === 'publicado').length,
        mensajes: estado.mensajes.filter((m) => m.empresaId === e.id).length,
      }));

  return {
    empresas: empresaId ? 1 : estado.empresas.length,
    publicaciones: {
      total: pubs.length,
      borrador: porEstado.borrador || 0,
      aprobado: porEstado.aprobado || 0,
      programado: porEstado.programado || 0,
      publicado: porEstado.publicado || 0,
      fallido: porEstado.fallido || 0,
    },
    porPlataforma,
    mensajes: {
      total: msgs.length,
      pendientes: msgs.filter((m) => m.estado === 'pendiente').length,
      respondidos,
      porcentajeRespuesta: msgs.length ? Math.round((respondidos / msgs.length) * 100) : 0,
    },
    porCanal: contar(msgs, 'canal'),
    actividad7dias: dias,
    porEmpresa,
  };
}

// ---------- feed publico + widget para la web del cliente ----------
function manejarFeed(req, res, ruta) {
  // /feed/:empresaId  o  /feed/:empresaId/rss
  const partes = ruta.split('/').filter(Boolean); // ['feed', empresaId, ('rss')?]
  const empresa = feed.empresaPorId(partes[1]);
  if (!empresa) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Empresa no encontrada');
  }
  if (partes[2] === 'rss') {
    const origin = 'http://' + (req.headers.host || 'localhost');
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(feed.feedRSS(empresa, origin));
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(feed.feedJSON(empresa)));
}

function manejarWidget(req, res, ruta) {
  const partes = ruta.split('/').filter(Boolean); // ['widget', empresaId]
  const empresa = feed.empresaPorId(partes[1]);
  if (!empresa) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<p>Empresa no encontrada</p>');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(feed.widgetHTML(empresa));
}

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  const ruta = req.url.split('?')[0];
  if (ruta.startsWith('/api/')) {
    try {
      await manejarAPI(req, res, ruta);
    } catch (e) {
      enviarJSON(res, 500, { error: 'Error interno: ' + e.message });
    }
    return;
  }
  if (ruta === '/webhook/whatsapp' && req.method === 'GET') return verificarWebhookWhatsApp(req, res);
  if (ruta === '/webhook/whatsapp' && req.method === 'POST') return recibirWebhookWhatsApp(req, res);
  if (ruta.startsWith('/feed/')) return manejarFeed(req, res, ruta);
  if (ruta.startsWith('/widget/')) return manejarWidget(req, res, ruta);
  servirEstatico(req, res);
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  AGENTE SOCIAL en http://localhost:' + PORT);
  console.log('  IA con Claude: ' + (ia.hayClave ? 'ACTIVA (' + ia.MODELO + ')' : 'MODO DEMO (define ANTHROPIC_API_KEY)'));
  console.log('====================================================');
  scheduler.iniciar();
});
