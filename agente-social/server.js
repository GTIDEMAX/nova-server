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

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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
    return enviarJSON(res, 200, { ...estado, iaActiva: ia.hayClave, modelo: ia.MODELO });
  }

  // Estado de conexion con Meta (Instagram + Facebook)
  if (recurso === 'meta' && partes[2] === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, await adapters.verificarMeta());
  }

  // Estado del programador automatico
  if (recurso === 'programador' && partes[2] === 'estado' && req.method === 'GET') {
    return enviarJSON(res, 200, scheduler.estadoScheduler());
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
          estado: 'borrador',
          fechaProgramada: null,
          creado: new Date().toISOString(),
        };
        estado.publicaciones.push(pub);
        return pub;
      });
      guardar();
      return enviarJSON(res, 201, { publicaciones: creadas });
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
    if (partes[3] === 'publicar' && req.method === 'POST') {
      const empresa = buscar('empresas', pub.empresaId);
      const resultado = await adapters.publicar(pub.plataforma, pub, empresa);
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
      let borrador = '';
      try {
        borrador = await ia.redactarRespuesta({
          empresa,
          canal: body.canal || 'whatsapp',
          cliente: body.cliente,
          texto: body.texto || '',
        });
      } catch (e) {
        borrador = 'No se pudo generar la respuesta automatica: ' + e.message;
      }
      const msg = {
        id: id(),
        empresaId: empresa.id,
        canal: body.canal || 'whatsapp',
        cliente: body.cliente || 'Cliente',
        texto: body.texto || '',
        respuestaBorrador: borrador,
        estado: 'pendiente',
        creado: new Date().toISOString(),
      };
      estado.mensajes.push(msg);
      guardar();
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
          envio = await adapters.enviarWhatsApp(msg.cliente, msg.respuestaBorrador);
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
  servirEstatico(req, res);
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  AGENTE SOCIAL en http://localhost:' + PORT);
  console.log('  IA con Claude: ' + (ia.hayClave ? 'ACTIVA (' + ia.MODELO + ')' : 'MODO DEMO (define ANTHROPIC_API_KEY)'));
  console.log('====================================================');
  scheduler.iniciar();
});
