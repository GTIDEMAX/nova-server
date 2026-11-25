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
const os = require('os');
const path = require('path');
const store = require('./store');
const { ffmpeg } = require('./spots');

const API_KEY = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const hayImagen = !!API_KEY;

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

// Genera una imagen y la guarda en el almacen. Devuelve la ruta publica.
async function generarImagen(prompt, id) {
  if (!API_KEY) return null;
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
  const ruta = '/generated/' + (id || Date.now().toString(36)) + '.png';
  await store.guardarArchivo(ruta, buffer, 'image/png');
  return ruta;
}

// Formato real segun los primeros bytes. Se le impone a ffmpeg para que un archivo
// disfrazado de foto (p. ej. una lista de reproduccion) no pueda leer otros archivos.
function formato(b) {
  if (b.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpeg_pipe';
  if (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png_pipe';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp_pipe';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  return null;
}

// Instagram: JPEG, hasta 1440 px de ancho y proporcion entre 4:5 y 1.91:1. No se recorta nada:
// lo transparente queda blanco y lo que falte a los lados se rellena con la foto desenfocada.
const FILTRO_IG = [
  "scale='min(1440,iw)':'min(1800,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=rgba,split[x][y]",
  '[x]lutrgb=r=255:g=255:b=255:a=255[blanco]',
  '[blanco][y]overlay=format=rgb,split[a][b]',
  "[a]scale='max(iw,ceil(ih*0.8/2)*2)':'max(ih,ceil(iw/1.91/2)*2)',setsar=1,gblur=sigma=40[fondo]",
  '[fondo][b]overlay=(W-w)/2:(H-h)/2:format=rgb,format=yuvj420p',
].join(';');

// Deja la foto como la pide Instagram y devuelve la ruta publica de la copia.
async function prepararInstagram(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('No se pudo leer la foto (HTTP ' + r.status + ')');
  const original = Buffer.from(await r.arrayBuffer());
  if (original.length > 20 * 1024 * 1024) throw new Error('La foto es muy grande (max 20 MB)');
  const tipo = formato(original);
  if (!tipo) throw new Error('La foto debe ser JPG, PNG, WEBP o GIF');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-'));
  try {
    const entrada = path.join(tmp, 'entrada');
    const salida = path.join(tmp, 'salida.jpg');
    fs.writeFileSync(entrada, original);
    await ffmpeg(['-f', tipo, '-i', entrada, '-filter_complex', FILTRO_IG, '-frames:v', '1', '-q:v', '3', '-map_metadata', '-1', salida]);
    const ruta = '/generated/ig-' + store.id() + '.jpg';
    await store.guardarArchivo(ruta, fs.readFileSync(salida), 'image/jpeg');
    return ruta;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { prepararInstagram, generarImagen, construirPrompt, hayImagen };
