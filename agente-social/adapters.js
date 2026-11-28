// Adaptadores de publicacion por plataforma.
//
// META (Instagram + Facebook) YA ESTA IMPLEMENTADO con la Graph API real.
// Solo necesitas poner tus credenciales en variables de entorno:
//   META_ACCESS_TOKEN  -> token de pagina (long-lived) con permisos de publicacion
//   META_PAGE_ID       -> id de tu pagina de Facebook (para publicar en Facebook)
//   META_IG_USER_ID    -> id de la cuenta de Instagram Business (para Instagram)
//
// Las demas plataformas (LinkedIn, TikTok, web) siguen en MODO SIMULADO hasta
// que conectes sus credenciales: registran la publicacion y devuelven un id
// ficticio, para probar el flujo completo sin cuentas reales.

const store = require('./store');
const imagen = require('./imagen');

const VERSION_GRAPH = 'v27.0';
const GRAPH = 'https://graph.facebook.com/' + VERSION_GRAPH;

const ADAPTADORES = {
  instagram: publicarInstagram,
  facebook: publicarFacebook,
  linkedin: publicarLinkedIn,
  tiktok: publicarTikTok,
  web: publicarWeb,
  blog: publicarWeb,
};

// Publicar puede tardar: evita que un doble clic o el programador suban lo mismo dos veces
const enCurso = new Set();
async function publicar(plataforma, publicacion, empresa) {
  if (enCurso.has(publicacion.id)) {
    return { ok: false, simulado: false, plataforma, error: 'en_curso', nota: 'Esta publicación ya se está publicando, espera un momento.' };
  }
  const vetada = marcaVetada(publicacion, empresa);
  if (vetada) {
    return { ok: false, simulado: false, plataforma, error: 'marca_bloqueada',
      nota: `🛑 Bloqueado: menciona "${vetada}", que está en "No mencionar" de ${empresa.nombre}. No se publicó.` };
  }
  enCurso.add(publicacion.id);
  try {
    const fn = ADAPTADORES[plataforma] || publicarGenerico;
    return await fn(publicacion, empresa);
  } finally {
    enCurso.delete(publicacion.id);
  }
}

// Marcas que una empresa NO debe mencionar (ej. G-TiDE: heysong). Compara sin acentos, mayusculas,
// espacios ni signos: "HEYSONG", "heysōng", "#Hey_Song" y "hey song" cuentan igual.
const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function marcaVetada(pub, empresa) {
  const todas = String((empresa && empresa.noMencionar) || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  // "+palabra" es una excepción permitida (ej. "+celmaxxgtide.com", su propia web): se quita antes de revisar
  const permitidas = todas.filter((m) => m.startsWith('+')).map((m) => m.slice(1).trim()).filter(Boolean);
  const lista = todas.filter((m) => !m.startsWith('+'));
  if (!lista.length) return '';
  let crudo = [pub.texto, (pub.hashtags || []).join(' '), pub.video && pub.video.nombre].join(' ');
  for (const p of permitidas) crudo = crudo.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  const todo = normal(crudo);
  return lista.find((m) => normal(m).length >= 3 && todo.includes(normal(m))) || '';
}

// Une el texto y los hashtags en un solo caption/mensaje.
function caption(pub) {
  const hs = (pub.hashtags || []).join(' ');
  return hs ? `${pub.texto}\n\n${hs}` : pub.texto;
}

// Llama a la Graph API y devuelve JSON, lanzando el error de Meta si lo hay.
async function graph(url, params) {
  const body = new URLSearchParams(params);
  const r = await fetch(url, { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = data.error ? `${data.error.message} (codigo ${data.error.code})` : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Token de cada pagina ---
// META_ACCESS_TOKEN puede ser un token de USUARIO DEL SISTEMA (recomendado: sirve para
// todas tus paginas y no caduca) o un token de una sola pagina. Con el primero se pide
// a Meta el token de cada pagina; con el segundo se usa tal cual.
const tokensPagina = new Map();
async function tokenDePagina(pageId) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || !pageId) return token;
  if (tokensPagina.has(pageId)) return tokensPagina.get(pageId);
  try {
    const r = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`);
    const d = await r.json();
    const t = d.access_token || token;
    tokensPagina.set(pageId, t);
    return t;
  } catch (e) {
    return token;
  }
}

// Pagina/Instagram "de respaldo" de las variables de Render: SOLO si hay una sola empresa.
// Con varias marcas, una empresa sin su pagina conectada NUNCA publica en la pagina de otra.
function respaldo(variable) {
  return (store.estado.empresas || []).length <= 1 ? process.env[variable] : undefined;
}

// Paginas de Facebook (y su Instagram) a las que tiene acceso el token. Para el panel.
async function listarPaginasMeta() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, paginas: [], detalle: 'Falta META_ACCESS_TOKEN en Render.' };
  const campos = 'id,name,instagram_business_account{id,username}';
  const norm = (p) => ({
    id: p.id, nombre: p.name,
    igId: p.instagram_business_account ? p.instagram_business_account.id : '',
    igUsuario: p.instagram_business_account ? p.instagram_business_account.username || '' : '',
  });
  try {
    const r = await fetch(`${GRAPH}/me/accounts?fields=${encodeURIComponent(campos)}&limit=100&access_token=${encodeURIComponent(token)}`);
    const d = await r.json();
    if (!d.error) return { ok: true, paginas: (d.data || []).map(norm) };
    // Si el token es de una sola pagina, /me ES la pagina
    const r2 = await fetch(`${GRAPH}/me?fields=${encodeURIComponent(campos)}&access_token=${encodeURIComponent(token)}`);
    const d2 = await r2.json();
    if (d2.error) throw new Error(d.error.message);
    return { ok: true, paginas: [norm(d2)] };
  } catch (e) {
    return { ok: false, paginas: [], detalle: 'Meta respondió: ' + e.message };
  }
}

// --- Videos: se guardan en la base de datos y se mandan a Meta como archivo ---
async function bufferDeVideo(pub) {
  const buf = await store.leerArchivo(pub.video.archivo);
  if (!buf) throw new Error('No encontré el video guardado; vuelve a subirlo.');
  return buf;
}

// Facebook: sube el archivo de video a la pagina (los verticales salen como video/reel)
async function videoFacebook(pub, pageId, token) {
  const buf = await bufferDeVideo(pub);
  const fd = new FormData();
  fd.append('access_token', token);
  fd.append('description', caption(pub));
  fd.append('source', new Blob([buf], { type: pub.video.tipo || 'video/mp4' }), pub.video.nombre || 'video.mp4');
  const r = await fetch(`https://graph-video.facebook.com/${VERSION_GRAPH}/${pageId}/videos`, { method: 'POST', body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error ? `${data.error.message} (codigo ${data.error.code})` : `HTTP ${r.status}`);
  return data;
}

// Instagram: Reel con subida directa (sin necesitar una URL publica del video).
// 1) crear contenedor REELS reanudable, 2) mandar los bytes, 3) esperar a que Meta lo procese, 4) publicar.
async function reelInstagram(pub, igId, token) {
  const buf = await bufferDeVideo(pub);
  const cont = await graph(`${GRAPH}/${igId}/media`, { media_type: 'REELS', upload_type: 'resumable', caption: caption(pub), share_to_feed: 'true', access_token: token });
  const up = await fetch(`https://rupload.facebook.com/ig-api-upload/${VERSION_GRAPH}/${cont.id}`, {
    method: 'POST', headers: { Authorization: 'OAuth ' + token, offset: '0', file_size: String(buf.length) }, body: buf,
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok || upData.error || upData.success === false) throw new Error('Meta no aceptó el video: ' + (upData.error ? upData.error.message || JSON.stringify(upData.error) : 'HTTP ' + up.status));
  for (let i = 0; i < 60; i++) { // hasta ~5 minutos
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(`${GRAPH}/${cont.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    if (d.status_code === 'FINISHED') return graph(`${GRAPH}/${igId}/media_publish`, { creation_id: cont.id, access_token: token });
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new Error('Instagram no pudo procesar el video: ' + (d.status || d.status_code));
  }
  throw new Error('Instagram sigue procesando el video; intenta publicar de nuevo en unos minutos.');
}

// --- Facebook (publica en el feed de la pagina; permite solo texto, texto+imagen o video) ---
async function publicarFacebook(pub, empresa) {
  const pageId = (empresa && empresa.metaPageId) || respaldo('META_PAGE_ID');
  if (!process.env.META_ACCESS_TOKEN || !pageId) return simulado('facebook', pub, 'Falta conectar la página de Facebook de esta empresa');
  const token = await tokenDePagina(pageId);
  try {
    let data;
    if (pub.video) {
      data = await videoFacebook(pub, pageId, token);
    } else if (pub.imagenUrl) {
      data = await graph(`${GRAPH}/${pageId}/photos`, { url: pub.imagenUrl, caption: caption(pub), access_token: token });
    } else {
      data = await graph(`${GRAPH}/${pageId}/feed`, { message: caption(pub), access_token: token });
    }
    return { ok: true, simulado: false, plataforma: 'facebook', idExterno: data.id || data.post_id, nota: 'Publicado en Facebook ✅' };
  } catch (e) {
    return { ok: false, simulado: false, plataforma: 'facebook', error: e.message, nota: 'Error al publicar en Facebook: ' + e.message };
  }
}

// Meta descarga la foto por su cuenta: publicar antes de FINISHED falla
async function esperarContenedor(contId, token) {
  const pausa = parseInt(process.env.META_ESPERA_MS, 10) || 5000;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${GRAPH}/${contId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    if (d.error) throw new Error(`${d.error.message} (codigo ${d.error.code})`);
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new Error('Instagram rechazó la foto: ' + (d.status || d.status_code));
    await new Promise((ok) => setTimeout(ok, pausa));
  }
  throw new Error('Instagram tardó demasiado en procesar la foto. No se publicó, intenta de nuevo.');
}

// --- Instagram (requiere imagen; 3 pasos: crear contenedor + esperar + publicar) ---
async function publicarInstagram(pub, empresa) {
  const igId = (empresa && empresa.metaIgId) || respaldo('META_IG_USER_ID');
  if (!process.env.META_ACCESS_TOKEN || !igId) return simulado('instagram', pub, 'Falta conectar el Instagram de esta empresa');
  const token = (empresa && empresa.metaPageId) ? await tokenDePagina(empresa.metaPageId) : process.env.META_ACCESS_TOKEN;
  if (pub.video) {
    try {
      const d = await reelInstagram(pub, igId, token);
      return { ok: true, simulado: false, plataforma: 'instagram', idExterno: d.id, nota: 'Reel publicado en Instagram ✅' };
    } catch (e) {
      return { ok: false, simulado: false, plataforma: 'instagram', error: e.message, nota: 'Error al publicar el Reel: ' + e.message };
    }
  }
  if (!pub.imagenUrl) {
    return { ok: false, simulado: false, plataforma: 'instagram', error: 'sin_imagen',
      nota: 'Instagram requiere una imagen: agrega la URL de una imagen a esta publicacion.' };
  }
  const base = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base) {
    return { ok: false, simulado: false, plataforma: 'instagram', error: 'sin_base',
      nota: 'Falta PUBLIC_BASE_URL en Render: Instagram necesita una dirección pública para leer la foto.' };
  }
  let copia;
  try {
    copia = await imagen.prepararInstagram(pub.imagenUrl);
    const cont = await graph(`${GRAPH}/${igId}/media`, { image_url: base.replace(/\/+$/, '') + copia, caption: caption(pub), access_token: token });
    await esperarContenedor(cont.id, token);
    const pubData = await graph(`${GRAPH}/${igId}/media_publish`, { creation_id: cont.id, access_token: token });
    return { ok: true, simulado: false, plataforma: 'instagram', idExterno: pubData.id, nota: 'Publicado en Instagram ✅' };
  } catch (e) {
    return { ok: false, simulado: false, plataforma: 'instagram', error: e.message, nota: 'Error al publicar en Instagram: ' + e.message };
  } finally {
    if (copia) await store.borrarArchivo(copia).catch((e) => console.error('[instagram] no se borró la copia:', e.message));
  }
}

// --- Verifica la conexion con Meta (para mostrar estado en el panel) ---
async function verificarMeta() {
  const token = process.env.META_ACCESS_TOKEN;
  const estado = {
    configurado: !!token,
    facebook: !!(token && process.env.META_PAGE_ID),
    instagram: !!(token && process.env.META_IG_USER_ID),
    ok: false,
    detalle: '',
  };
  if (!token) { estado.detalle = 'Sin META_ACCESS_TOKEN. Modo simulado.'; return estado; }
  try {
    const partes = [];
    if (process.env.META_PAGE_ID) {
      const r = await fetch(`${GRAPH}/${process.env.META_PAGE_ID}?fields=name&access_token=${encodeURIComponent(token)}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      partes.push('Facebook: ' + d.name);
    }
    if (process.env.META_IG_USER_ID) {
      const r = await fetch(`${GRAPH}/${process.env.META_IG_USER_ID}?fields=username&access_token=${encodeURIComponent(token)}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      partes.push('Instagram: @' + d.username);
    }
    if (!partes.length) {
      const l = await listarPaginasMeta();
      if (!l.ok) throw new Error(l.detalle);
      partes.push(`Conectado ✅ · ${l.paginas.length} página(s) disponibles. En Empresas escoge la página de cada marca.`);
      estado.facebook = estado.instagram = l.paginas.length > 0;
    }
    estado.ok = true;
    estado.detalle = partes.join(' · ');
  } catch (e) {
    estado.detalle = 'Error de conexion con Meta: ' + e.message;
  }
  return estado;
}

// --- LinkedIn (pendiente de conectar) ---
async function publicarLinkedIn(pub) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return simulado('linkedin', pub);
  // TODO: POST https://api.linkedin.com/v2/ugcPosts
  return simulado('linkedin (con token, pendiente conectar)', pub);
}

// --- TikTok (pendiente de conectar; requiere video) ---
async function publicarTikTok(pub) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return simulado('tiktok', pub);
  // TODO: TikTok Content Posting API
  return simulado('tiktok (con token, pendiente conectar)', pub);
}

// --- Web / Blog ---
async function publicarWeb(pub, empresa) {
  const webhook = process.env.WEB_PUBLISH_WEBHOOK;
  if (!webhook) return simulado('web/blog', pub);
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: empresa?.nombre, contenido: pub.texto, hashtags: pub.hashtags, imagenUrl: pub.imagenUrl }),
    });
    return { ok: r.ok, plataforma: 'web/blog', idExterno: 'web_' + Date.now(), simulado: false, nota: r.ok ? 'Enviado a tu web ✅' : 'La web respondio error' };
  } catch (e) {
    return { ok: false, plataforma: 'web/blog', error: e.message, simulado: false };
  }
}

async function publicarGenerico(pub) {
  return simulado('desconocida', pub);
}

// --- Envio de mensajes de WhatsApp (atencion al cliente) ---
async function enviarWhatsApp(telefono, texto, phoneId) {
  const token = process.env.WHATSAPP_TOKEN;
  const pid = phoneId || process.env.WHATSAPP_PHONE_ID;
  if (!token || !pid) {
    return { ok: true, simulado: true, canal: 'whatsapp', nota: 'Enviado en modo simulado (sin credenciales de WhatsApp).' };
  }
  try {
    const r = await fetch(`${GRAPH}/${pid}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(telefono).replace(/\D/g, ''),
        type: 'text',
        text: { body: texto },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error ? data.error.message : 'HTTP ' + r.status);
    return { ok: true, simulado: false, canal: 'whatsapp', idExterno: data.messages?.[0]?.id, nota: 'Enviado por WhatsApp ✅' };
  } catch (e) {
    return { ok: false, simulado: false, canal: 'whatsapp', error: e.message, nota: 'Error al enviar por WhatsApp: ' + e.message };
  }
}

// --- Envio con PLANTILLA aprobada (obligatorio para escribir a un cliente fuera de
// la ventana de 24 h de WhatsApp). 'params' llena las variables {{1}}, {{2}}... del cuerpo.
async function enviarPlantillaWhatsApp(telefono, plantilla, idioma, params, phoneId) {
  const token = process.env.WHATSAPP_TOKEN;
  const pid = phoneId || process.env.WHATSAPP_PHONE_ID;
  if (!token || !pid || !plantilla) {
    return { ok: true, simulado: true, canal: 'whatsapp', nota: 'Plantilla enviada en modo simulado (falta configurar WhatsApp o la plantilla).' };
  }
  try {
    const r = await fetch(`${GRAPH}/${pid}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(telefono).replace(/\D/g, ''),
        type: 'template',
        template: {
          name: plantilla,
          language: { code: idioma || 'es_MX' },
          components: [{ type: 'body', parameters: (params || []).map((t) => ({ type: 'text', text: String(t) })) }],
        },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error ? data.error.message : 'HTTP ' + r.status);
    return { ok: true, simulado: false, canal: 'whatsapp', idExterno: data.messages?.[0]?.id, nota: 'Recordatorio enviado por WhatsApp ✅' };
  } catch (e) {
    return { ok: false, simulado: false, canal: 'whatsapp', error: e.message, nota: 'Error al enviar la plantilla: ' + e.message };
  }
}

// --- Verifica la conexion con WhatsApp (para el panel) ---
async function verificarWhatsApp() {
  const token = process.env.WHATSAPP_TOKEN;
  const pid = process.env.WHATSAPP_PHONE_ID;
  const estado = { configurado: !!(token && pid), ok: false, detalle: '' };
  if (!token || !pid) {
    estado.detalle = 'Sin WHATSAPP_TOKEN o WHATSAPP_PHONE_ID. Modo simulado.';
    return estado;
  }
  try {
    const r = await fetch(`${GRAPH}/${pid}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(token)}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    estado.ok = true;
    estado.detalle = `WhatsApp: ${d.verified_name || ''} (${d.display_phone_number || ''})`;
  } catch (e) {
    estado.detalle = 'Error de conexion con WhatsApp: ' + e.message;
  }
  return estado;
}

function simulado(plataforma, pub, motivo) {
  return {
    ok: true,
    simulado: true,
    plataforma,
    idExterno: 'sim_' + Date.now(),
    nota: (motivo ? motivo + ' — ' : '') + 'NO se publicó (modo simulado). Conecta tu cuenta para publicar de verdad.',
  };
}

module.exports = { GRAPH, tokenDePagina, marcaVetada, publicar, listarPaginasMeta, enviarWhatsApp, enviarPlantillaWhatsApp, verificarMeta, verificarWhatsApp };
