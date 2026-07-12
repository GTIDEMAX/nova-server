// Adaptadores de publicacion por plataforma.
//
// IMPORTANTE: publicar de verdad en Instagram, Facebook, LinkedIn, TikTok o
// enviar por WhatsApp requiere cuentas de empresa y credenciales/tokens de cada
// plataforma (Meta Graph API, LinkedIn API, TikTok Content API, WhatsApp Cloud
// API, etc.). Aqui dejamos la estructura lista: cada funcion recibe la
// publicacion y, cuando pongas tus credenciales en las variables de entorno,
// solo hay que rellenar la llamada real marcada con TODO.
//
// Mientras no haya credenciales, el adaptador funciona en MODO SIMULADO:
// registra la publicacion y devuelve un id ficticio, para que puedas probar
// todo el flujo (crear -> aprobar -> programar -> publicar) sin cuentas reales.

const ADAPTADORES = {
  instagram: publicarMeta,
  facebook: publicarMeta,
  linkedin: publicarLinkedIn,
  tiktok: publicarTikTok,
  web: publicarWeb,
  blog: publicarWeb,
};

async function publicar(plataforma, publicacion, empresa) {
  const fn = ADAPTADORES[plataforma] || publicarGenerico;
  return fn(publicacion, empresa);
}

// --- Meta (Instagram / Facebook) ---
async function publicarMeta(pub, empresa) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return simulado('instagram/facebook', pub);
  // TODO: llamada real a Meta Graph API
  //   POST https://graph.facebook.com/v21.0/{ig-user-id}/media  (crear)
  //   POST https://graph.facebook.com/v21.0/{ig-user-id}/media_publish (publicar)
  return simulado('instagram/facebook (con token, pendiente conectar)', pub);
}

// --- LinkedIn ---
async function publicarLinkedIn(pub, empresa) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return simulado('linkedin', pub);
  // TODO: POST https://api.linkedin.com/v2/ugcPosts
  return simulado('linkedin (con token, pendiente conectar)', pub);
}

// --- TikTok ---
async function publicarTikTok(pub, empresa) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return simulado('tiktok', pub);
  // TODO: TikTok Content Posting API (requiere video)
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
      body: JSON.stringify({ titulo: empresa?.nombre, contenido: pub.texto, hashtags: pub.hashtags }),
    });
    return { ok: r.ok, plataforma: 'web/blog', idExterno: 'web_' + Date.now(), simulado: false };
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

function simulado(plataforma, pub) {
  return {
    ok: true,
    simulado: true,
    plataforma,
    idExterno: 'sim_' + Date.now(),
    nota: 'Publicado en modo simulado (sin credenciales). Conecta tu cuenta para publicar de verdad.',
  };
}

module.exports = { publicar, enviarWhatsApp };
