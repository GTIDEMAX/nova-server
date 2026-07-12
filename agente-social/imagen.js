// Generacion de imagenes con IA para las publicaciones.
//
// Claude (Anthropic) genera TEXTO; para IMAGENES se usa un modelo de imagen.
// Aqui usamos la API de imagenes de OpenAI (gpt-image-1) porque es accesible y
// de buena calidad. Se activa con la variable IMAGE_API_KEY (u OPENAI_API_KEY).
// Sin clave, el agente sigue funcionando: simplemente no genera la imagen y tu
// puedes subir una foto real.
//
// Importante: estas imagenes son para GRAFICOS/PROMOS/FONDOS/ESCENAS, no para
// mostrar el producto exacto (la IA no conoce tu producto real). Para el
// producto real, sube tu propia foto en el campo de la publicacion.
const fs = require('fs');
const path = require('path');

const DIR = process.env.GENERATED_DIR || path.join(__dirname, 'public', 'generated');
const API_KEY = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const hayImagen = !!API_KEY;

function asegurarDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
}

// Construye el prompt final de imagen a partir de la marca y la publicacion.
function construirPrompt({ empresa, plataforma, texto, imagenPrompt }) {
  const base = imagenPrompt || `Professional promotional image for this social post: "${texto}"`;
  return (
    `${base}. Brand context: ${empresa?.nombre || ''} (${empresa?.rubro || 'modern technology retail'}). ` +
    `Style: photorealistic, premium, clean and modern, professional studio lighting, ` +
    `subtle electric-blue / black / white color accents. Vertical composition for Instagram Reels / TikTok. ` +
    `Leave clean negative space for a text overlay. Do NOT render brand logos or long paragraphs of text. ` +
    `It must look like a real professional photo/graphic, NOT an obvious AI illustration.`
  );
}

// Genera una imagen y la guarda en public/generated. Devuelve la ruta publica.
async function generarImagen(prompt, id) {
  if (!API_KEY) return null;
  asegurarDir();
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: '1024x1536', n: 1 }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error ? data.error.message : 'HTTP ' + r.status);
  const item = data.data && data.data[0];
  if (!item) throw new Error('Respuesta de imagen vacia');
  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const ir = await fetch(item.url);
    buffer = Buffer.from(await ir.arrayBuffer());
  } else {
    throw new Error('La API no devolvio imagen');
  }
  const nombre = (id || Date.now().toString(36)) + '.png';
  fs.writeFileSync(path.join(DIR, nombre), buffer);
  return '/generated/' + nombre;
}

module.exports = { generarImagen, construirPrompt, hayImagen };
