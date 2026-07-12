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

const GRAPH = 'https://graph.facebook.com/v21.0';

const ADAPTADORES = {
  instagram: publicarInstagram,
  facebook: publicarFacebook,
  linkedin: publicarLinkedIn,
  tiktok: publicarTikTok,
  web: publicarWeb,
  blog: publicarWeb,
};

async function publicar(plataforma, publicacion, empresa) {
  const fn = ADAPTADORES[plataforma] || publicarGenerico;
  return fn(publicacion, empresa);
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

// --- Facebook (publica en el feed de la pagina; permite solo texto o texto+imagen) ---
async function publicarFacebook(pub) {
  const token = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) return simulado('facebook', pub, 'Falta META_ACCESS_TOKEN o META_PAGE_ID');
  try {
    let data;
    if (pub.imagenUrl) {
      data = await graph(`${GRAPH}/${pageId}/photos`, { url: pub.imagenUrl, caption: caption(pub), access_token: token });
    } else {
      data = await graph(`${GRAPH}/${pageId}/feed`, { message: caption(pub), access_token: token });
    }
    return { ok: true, simulado: false, plataforma: 'facebook', idExterno: data.id || data.post_id, nota: 'Publicado en Facebook ✅' };
  } catch (e) {
    return { ok: false, simulado: false, plataforma: 'facebook', error: e.message, nota: 'Error al publicar en Facebook: ' + e.message };
  }
}

// --- Instagram (requiere imagen; proceso de 2 pasos: crear contenedor + publicar) ---
async function publicarInstagram(pub) {
  const token = process.env.META_ACCESS_TOKEN;
  const igId = process.env.META_IG_USER_ID;
  if (!token || !igId) return simulado('instagram', pub, 'Falta META_ACCESS_TOKEN o META_IG_USER_ID');
  if (!pub.imagenUrl) {
    return { ok: false, simulado: false, plataforma: 'instagram', error: 'sin_imagen',
      nota: 'Instagram requiere una imagen: agrega la URL de una imagen a esta publicacion.' };
  }
  try {
    // Paso 1: crear el contenedor de medios
    const cont = await graph(`${GRAPH}/${igId}/media`, { image_url: pub.imagenUrl, caption: caption(pub), access_token: token });
    // Paso 2: publicar el contenedor
    const pubData = await graph(`${GRAPH}/${igId}/media_publish`, { creation_id: cont.id, access_token: token });
    return { ok: true, simulado: false, plataforma: 'instagram', idExterno: pubData.id, nota: 'Publicado en Instagram ✅' };
  } catch (e) {
    return { ok: false, simulado: false, plataforma: 'instagram', error: e.message, nota: 'Error al publicar en Instagram: ' + e.message };
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
    estado.ok = true;
    estado.detalle = partes.join(' · ') || 'Token presente, pero falta META_PAGE_ID / META_IG_USER_ID.';
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
async function enviarWhatsApp(telefono, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    return { ok: true, simulado: true, canal: 'whatsapp', nota: 'Enviado en modo simulado (sin credenciales de WhatsApp).' };
  }
  // TODO: POST https://graph.facebook.com/v21.0/{phoneId}/messages
  return { ok: true, simulado: false, canal: 'whatsapp' };
}

function simulado(plataforma, pub, motivo) {
  return {
    ok: true,
    simulado: true,
    plataforma,
    idExterno: 'sim_' + Date.now(),
    nota: (motivo ? motivo + ' — ' : '') + 'Publicado en modo simulado. Conecta tu cuenta para publicar de verdad.',
  };
}

module.exports = { publicar, enviarWhatsApp, verificarMeta };
