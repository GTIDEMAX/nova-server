// Resultados reales de cada publicación (Facebook e Instagram) leídos de la Graph API de Meta.
// Solo lectura. Si a Meta le falta un permiso (instagram_manage_insights, read_insights) se usan
// los números que sí da (me gusta, comentarios, compartidos) y se avisa qué falta. Nunca se inventa nada.
const adapters = require('./adapters');

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

async function get(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (d.error) throw new Error(d.error.message || 'Meta respondió con error');
  return d;
}

function franja(fecha) {
  const h = Number(new Date(fecha).toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false })) % 24;
  return h < 12 ? 'Mañana (antes de 12)' : h < 17 ? 'Tarde (12 a 5 pm)' : h < 21 ? 'Noche (5 a 9 pm)' : 'Muy noche (después de 9)';
}
const valor = (m) => (m.total_value ? m.total_value.value : m.values && m.values[0] ? m.values[0].value : null);
const TIPOS_IG = { IMAGE: 'Foto', VIDEO: 'Video', CAROUSEL_ALBUM: 'Carrusel', REELS: 'Reel' };

async function instagram(igId, token, avisos) {
  const t = encodeURIComponent(token);
  const d = await get(`${adapters.GRAPH}/${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=25&access_token=${t}`);
  const items = [];
  let sinInsights = false;
  for (const m of d.data || []) {
    const it = {
      red: 'instagram', id: m.id, fecha: m.timestamp, texto: String(m.caption || '').slice(0, 140), link: m.permalink,
      tipo: m.media_product_type === 'REELS' ? 'Reel' : TIPOS_IG[m.media_type] || m.media_type,
      likes: m.like_count || 0, comentarios: m.comments_count || 0, guardados: null, compartidos: null, alcance: null, interacciones: null,
    };
    if (!sinInsights) {
      try {
        const ins = await get(`${adapters.GRAPH}/${m.id}/insights?metric=reach,saved,shares,total_interactions&access_token=${t}`);
        for (const x of ins.data || []) {
          if (x.name === 'reach') it.alcance = valor(x);
          if (x.name === 'saved') it.guardados = valor(x);
          if (x.name === 'shares') it.compartidos = valor(x);
          if (x.name === 'total_interactions') it.interacciones = valor(x);
        }
      } catch (e) {
        // Un error de permiso se repetiría en todas: se avisa una vez y se sigue con likes/comentarios
        sinInsights = true;
        avisos.push('Instagram no dio alcance ni guardados: ' + e.message + ' (falta el permiso instagram_manage_insights en el token de Meta).');
      }
    }
    items.push(it);
  }
  return items;
}

async function facebook(pageId, token, avisos) {
  const t = encodeURIComponent(token);
  const campos = 'id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{media_type}';
  const d = await get(`${adapters.GRAPH}/${pageId}/posts?fields=${encodeURIComponent(campos)}&limit=25&access_token=${t}`);
  const items = [];
  let sinInsights = false;
  for (const p of d.data || []) {
    const adj = p.attachments && p.attachments.data && p.attachments.data[0];
    const mt = adj ? String(adj.media_type || '').toLowerCase() : '';
    const it = {
      red: 'facebook', id: p.id, fecha: p.created_time, texto: String(p.message || '').slice(0, 140), link: p.permalink_url,
      tipo: mt === 'photo' ? 'Foto' : mt === 'video' ? 'Video' : mt === 'album' ? 'Carrusel' : mt ? mt : 'Solo texto',
      likes: p.reactions && p.reactions.summary ? p.reactions.summary.total_count : 0,
      comentarios: p.comments && p.comments.summary ? p.comments.summary.total_count : 0,
      compartidos: p.shares ? p.shares.count : 0, guardados: null, alcance: null, clics: null, interacciones: null,
    };
    if (!sinInsights) {
      try {
        const ins = await get(`${adapters.GRAPH}/${p.id}/insights?metric=post_impressions_unique,post_clicks&access_token=${t}`);
        for (const x of ins.data || []) {
          if (x.name === 'post_impressions_unique') it.alcance = valor(x);
          if (x.name === 'post_clicks') it.clics = valor(x);
        }
      } catch (e) {
        sinInsights = true;
        avisos.push('Facebook no dio alcance ni clics: ' + e.message + ' (falta el permiso read_insights en el token de Meta).');
      }
    }
    items.push(it);
  }
  return items;
}

// Liga cada publicación de Meta con la del panel (por id o por el inicio del texto) para saber si la foto era real o IA
function origenDe(it, pubsPanel) {
  const ini = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const p = pubsPanel.find((x) => {
    const idx = x.resultadoPublicacion && x.resultadoPublicacion.idExterno;
    return (idx && (idx === it.id || it.id.endsWith('_' + idx))) || (x.texto && ini(x.texto) && ini(x.texto) === ini(it.texto));
  });
  if (!p) return 'Fuera del panel';
  return p.imagenIA ? 'IA' : 'Real';
}

// Calcula ranking y conclusiones. Función pura (se prueba sin Meta).
function analizar(items) {
  for (const it of items) {
    if (it.interacciones == null) it.interacciones = (it.likes || 0) + (it.comentarios || 0) + (it.guardados || 0) + (it.compartidos || 0);
    it.tasa = it.alcance ? it.interacciones / it.alcance : null;
  }
  const conAlcance = items.filter((i) => i.tasa != null).length;
  const base = items.length && conAlcance >= items.length / 2 ? 'tasa' : 'interacciones';
  const puntos = (i) => (base === 'tasa' ? (i.tasa != null ? i.tasa : -1) : i.interacciones);
  const orden = [...items].sort((a, b) => puntos(b) - puntos(a));
  const grupo = (clave) => {
    const g = {};
    for (const i of items) { const k = i[clave] || '—'; (g[k] = g[k] || []).push(puntos(i)); }
    return Object.entries(g).map(([k, v]) => ({ clave: k, n: v.length, promedio: v.reduce((a, b) => a + b, 0) / v.length }))
      .sort((a, b) => b.promedio - a.promedio);
  };
  const porTipo = grupo('tipo'), porFranja = grupo('franja'), porOrigen = grupo('origen');
  const fmt = (x) => (base === 'tasa' ? (x * 100).toFixed(1) + '% de interacción' : Math.round(x) + ' interacciones');
  const conclusiones = [];
  const compara = (g, que) => {
    const v = g.filter((x) => x.n >= 2);
    if (v.length >= 2 && v[v.length - 1].promedio > 0) {
      const veces = v[0].promedio / v[v.length - 1].promedio;
      if (veces >= 1.2) conclusiones.push(`${que} "${v[0].clave}" rinde ${veces.toFixed(1)} veces más que "${v[v.length - 1].clave}" (${fmt(v[0].promedio)} contra ${fmt(v[v.length - 1].promedio)}).`);
    }
  };
  compara(porTipo, 'El formato');
  compara(porFranja, 'El horario');
  compara(porOrigen.filter((x) => x.clave !== 'Fuera del panel'), 'La foto');
  if (!conclusiones.length && items.length) conclusiones.push('Todavía hay pocas publicaciones para sacar conclusiones firmes: sigue publicando y vuelve a revisar.');
  return { base, total: items.length, mejores: orden.slice(0, 5), peores: orden.length > 5 ? orden.slice(-5).reverse() : [], porTipo, porFranja, porOrigen, conclusiones };
}

async function resultadosEmpresa(empresa, pubsPanel, forzar) {
  const c = cache.get(empresa.id);
  if (!forzar && c && Date.now() - c.t < CACHE_MS) return c.r;
  const avisos = [];
  let items = [];
  if (!process.env.META_ACCESS_TOKEN) avisos.push('Falta META_ACCESS_TOKEN en Render.');
  else {
    const token = await adapters.tokenDePagina(empresa.metaPageId);
    if (empresa.metaIgId) {
      try { items = items.concat(await instagram(empresa.metaIgId, token, avisos)); } catch (e) { avisos.push('Instagram: ' + e.message); }
    }
    if (empresa.metaPageId) {
      try { items = items.concat(await facebook(empresa.metaPageId, token, avisos)); } catch (e) { avisos.push('Facebook: ' + e.message); }
    }
    if (!empresa.metaPageId && !empresa.metaIgId) avisos.push('Esta marca no tiene página de Facebook ni Instagram conectada.');
  }
  for (const it of items) { it.franja = franja(it.fecha); it.origen = origenDe(it, pubsPanel); }
  const r = { empresaId: empresa.id, actualizado: new Date().toISOString(), avisos, ...analizar(items) };
  cache.set(empresa.id, { t: Date.now(), r });
  return r;
}

module.exports = { resultadosEmpresa, analizar };
