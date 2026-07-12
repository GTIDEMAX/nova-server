// Feed publico + widget embebible para la pagina de ventas / web del cliente.
// Expone las publicaciones ya publicadas de una empresa como:
//   - JSON  (para consumir desde JavaScript en su web)
//   - RSS   (para lectores de feeds / integraciones)
//   - Widget HTML (para incrustar con un <iframe> en su pagina de ventas)
const { estado } = require('./store');

function empresaPorId(id) {
  return estado.empresas.find((e) => e.id === id);
}

// Publicaciones ya publicadas de una empresa (mas recientes primero).
function publicacionesDe(empresaId) {
  return estado.publicaciones
    .filter((p) => p.empresaId === empresaId && p.estado === 'publicado')
    .sort((a, b) => new Date(b.publicado || b.creado) - new Date(a.publicado || a.creado));
}

function escXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
function escHtml(s) {
  return String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// --- JSON ---
function feedJSON(empresa) {
  return {
    empresa: { id: empresa.id, nombre: empresa.nombre, rubro: empresa.rubro || '' },
    actualizado: new Date().toISOString(),
    publicaciones: publicacionesDe(empresa.id).map((p) => ({
      id: p.id,
      plataforma: p.plataforma,
      texto: p.texto,
      hashtags: p.hashtags || [],
      imagenUrl: p.imagenUrl || '',
      publicado: p.publicado || p.creado,
    })),
  };
}

// --- RSS 2.0 ---
function feedRSS(empresa, origin) {
  const items = publicacionesDe(empresa.id)
    .map((p) => {
      const titulo = (p.texto || '').split('\n')[0].slice(0, 80) || 'Publicacion';
      const fecha = new Date(p.publicado || p.creado).toUTCString();
      const desc = escXml((p.texto || '') + (p.hashtags && p.hashtags.length ? '\n\n' + p.hashtags.join(' ') : ''));
      return `    <item>
      <title>${escXml(titulo)}</title>
      <description>${desc}</description>
      <pubDate>${fecha}</pubDate>
      <guid isPermaLink="false">${escXml(p.id)}</guid>
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escXml(empresa.nombre)}</title>
    <link>${escXml(origin)}</link>
    <description>Publicaciones de ${escXml(empresa.nombre)}</description>
${items}
  </channel>
</rss>`;
}

// --- Widget HTML (incrustable con iframe) ---
function widgetHTML(empresa) {
  const pubs = publicacionesDe(empresa.id);
  const tarjetas = pubs.length
    ? pubs
        .map(
          (p) => `<article class="w-card">
      ${p.imagenUrl ? `<img class="w-img" src="${escHtml(p.imagenUrl)}" alt="" loading="lazy">` : ''}
      <div class="w-body">
        <p class="w-text">${escHtml(p.texto).replace(/\n/g, '<br>')}</p>
        <div class="w-tags">${(p.hashtags || []).map((h) => `<span>${escHtml(h)}</span>`).join('')}</div>
        <time class="w-date">${new Date(p.publicado || p.creado).toLocaleDateString('es')}</time>
      </div>
    </article>`
        )
        .join('\n')
    : '<p class="w-empty">Aun no hay publicaciones.</p>';

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(empresa.nombre)}</title>
<style>
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:transparent; color:#1a1a2e; }
  .w-head { font-size:18px; font-weight:800; padding:12px 14px 4px; }
  .w-grid { display:grid; gap:14px; padding:12px 14px 20px; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
  .w-card { border:1px solid #e6e6ef; border-radius:14px; overflow:hidden; background:#fff; box-shadow:0 2px 10px rgba(0,0,0,.05); }
  .w-img { width:100%; height:170px; object-fit:cover; display:block; }
  .w-body { padding:12px 14px; }
  .w-text { margin:0 0 8px; font-size:14px; line-height:1.45; }
  .w-tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .w-tags span { font-size:11px; color:#6d5efc; }
  .w-date { font-size:11px; color:#9aa0c0; }
  .w-empty { padding:20px; color:#9aa0c0; }
  @media (prefers-color-scheme: dark){ body{ color:#e8eaf5;} .w-card{ background:#181c2e; border-color:#2c3255;} .w-date{color:#9aa0c0;} }
</style></head>
<body>
  <div class="w-head">${escHtml(empresa.nombre)}</div>
  <div class="w-grid">${tarjetas}</div>
</body></html>`;
}

module.exports = { empresaPorId, feedJSON, feedRSS, widgetHTML };
