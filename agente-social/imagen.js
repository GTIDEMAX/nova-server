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

// Lee una foto de internet con limite de tiempo y tamano.
async function leerFoto(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('No se pudo leer la foto (HTTP ' + r.status + ')');
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 20 * 1024 * 1024) throw new Error('La foto es muy grande (max 20 MB)');
  return b;
}

// Foto pro: la IA pone el producto REAL (la foto que ya tiene la publicacion) en una escena
// de anuncio. A diferencia de generarImagen, no inventa el producto.
async function fotoPro(url, escena, id) {
  const clave = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!clave) return null;
  const foto = await leerFoto(url);
  const tipo = formato(foto);
  if (!tipo || tipo === 'gif') throw new Error('La foto debe ser JPG, PNG o WEBP');
  const prompt =
    'Professional advertising photo for social media. Keep the product from the input image EXACTLY as it is: ' +
    'same shape, colors, proportions, buttons, logos and printed text. Do not redraw, restyle or invent product details. ' +
    `Place it in a premium scene that suits it: ${escena || 'modern lifestyle setting'}. ` +
    'Dramatic professional lighting, subtle electric-blue accents, realistic shadows and reflections, shallow depth of field. ' +
    'No added text, no extra logos, no watermarks.';
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', process.env.IMAGE_QUALITY || 'medium');
  form.append('image[]', new Blob([foto], { type: 'image/' + tipo.replace('_pipe', '') }), 'producto.' + tipo.replace('_pipe', ''));
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error ? data.error.message : 'HTTP ' + r.status);
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('La IA no devolvio imagen');
  const ruta = '/generated/pro-' + (id || store.id()) + '.png';
  await store.guardarArchivo(ruta, Buffer.from(b64, 'base64'), 'image/png');
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
  const original = await leerFoto(url);
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

// --- Diseno pro gratis: la foto del producto sobre fondo oscuro con brillo azul y textos ---
const FUENTES = path.join(__dirname, 'fonts');
// Ruta para un filtro de ffmpeg (en Windows "E:" rompe el filtro si no se escapa)
const rutaFiltro = (r) => "'" + r.replace(/\\/g, '/').replace(/:/g, '\\:') + "'";

function texto(dir, nombre, valor, fuente, tam, color, y) {
  const archivo = path.join(dir, nombre + '.txt');
  fs.writeFileSync(archivo, valor);
  return `drawtext=fontfile=${rutaFiltro(path.join(FUENTES, fuente))}:textfile=${rutaFiltro(archivo)}:expansion=none:` +
    `fontsize=${tam}:fontcolor=${color}:x=(w-text_w)/2:y=${y}`;
}
// Achica la letra si el texto es largo, para que quepa en 1000 px
const tamPara = (t, max, factor) => Math.min(max, Math.floor(factor / Math.max(t.length, 1)));

async function disenoPro(url, { marca = '', titulo = '', detalle = '', precio = '', antes = '', web = '' } = {}, id) {
  const foto = await leerFoto(url);
  const tipo = formato(foto);
  if (!tipo) throw new Error('La foto debe ser JPG, PNG, WEBP o GIF');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diseno-'));
  try {
    const entrada = path.join(tmp, 'entrada');
    fs.writeFileSync(entrada, foto);
    // Color de la esquina: si es fondo claro y opaco se quita; si ya es transparente se deja
    const esquina = path.join(tmp, 'esquina.rgba');
    await ffmpeg(['-f', tipo, '-i', entrada, '-frames:v', '1', '-vf', 'format=rgba,crop=1:1:3:3', '-f', 'rawvideo', esquina]);
    const [r, g, b, a] = fs.readFileSync(esquina);
    const quitarFondo = a > 128 && (r + g + b) / 3 > 170;
    const hex = (n) => n.toString(16).padStart(2, '0');
    const glow = (base, fuerza) => `'${base}+${fuerza}*exp(-(pow(X-540,2)+pow(Y-640,2))/110000)'`;
    const textos = [
      marca && texto(tmp, 'marca', marca.toUpperCase(), 'Montserrat-ExtraBold.ttf', 34, '0x4da3ff', 56),
      titulo && texto(tmp, 'titulo', titulo, 'Montserrat-ExtraBold.ttf', tamPara(titulo, 76, 1700), 'white', 110),
      detalle && texto(tmp, 'detalle', detalle, 'Montserrat-SemiBold.ttf', tamPara(detalle, 40, 1750), '0xa9cfff', 215),
      precio
        ? texto(tmp, 'precio', precio, 'Montserrat-ExtraBold.ttf', 112, 'white', 1075)
        : texto(tmp, 'precio', 'Pregunta en sucursal', 'Montserrat-ExtraBold.ttf', 64, 'white', 1110),
      antes && texto(tmp, 'antes', 'Antes ' + antes, 'Montserrat-SemiBold.ttf', 40, '0x8892a6', 1205),
      web && texto(tmp, 'web', web, 'Montserrat-SemiBold.ttf', 34, '0xd8e6ff', 1275),
    ].filter(Boolean);
    const filtro = [
      `[0]format=rgb24,geq=r=${glow(7, 22)}:g=${glow(11, 85)}:b=${glow(24, 200)}[fondo]`,
      `[1]scale=860:760:force_original_aspect_ratio=decrease,format=rgba` +
        (quitarFondo ? `,colorkey=0x${hex(r)}${hex(g)}${hex(b)}:0.12:0.06` : '') + '[prod]',
      `[fondo][prod]overlay=(W-w)/2:290+(760-h)/2:format=rgb,drawbox=x=0:y=1060:w=iw:h=290:color=0x050810@0.55:t=fill,` +
        textos.join(',') + ',format=yuvj420p',
    ].join(';');
    const salida = path.join(tmp, 'salida.jpg');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1350', '-f', tipo, '-i', entrada,
      '-filter_complex', filtro, '-frames:v', '1', '-q:v', '2', '-map_metadata', '-1', salida]);
    const ruta = '/generated/diseno-' + (id || store.id()) + '.jpg';
    await store.guardarArchivo(ruta, fs.readFileSync(salida), 'image/jpeg');
    return ruta;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { disenoPro, fotoPro, prepararInstagram, generarImagen, construirPrompt, hayImagen };
