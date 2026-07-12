// Capa de IA con Claude (Anthropic).
// Genera ideas/textos de publicaciones y redacta respuestas a clientes.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY.
// Si no esta configurada, funciona en MODO DEMO devolviendo textos de ejemplo,
// para que puedas probar el panel sin clave. Al poner la clave, se usa Claude real.

const Anthropic = require('@anthropic-ai/sdk');

const MODELO = 'claude-opus-4-8';
const hayClave = !!process.env.ANTHROPIC_API_KEY;
const client = hayClave ? new Anthropic() : null;

// Extrae el primer bloque de texto de la respuesta de Claude.
function textoDe(resp) {
  const bloque = (resp.content || []).find((b) => b.type === 'text');
  return bloque ? bloque.text : '';
}

// Intenta parsear JSON aunque venga con texto alrededor o en un bloque de codigo.
function parsearJSON(texto) {
  try {
    return JSON.parse(texto);
  } catch (_) {}
  const m = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch (_) {}
  }
  const inicio = texto.indexOf('[');
  const fin = texto.lastIndexOf(']');
  if (inicio !== -1 && fin !== -1) {
    try {
      return JSON.parse(texto.slice(inicio, fin + 1));
    } catch (_) {}
  }
  return null;
}

// --- Generar contenido para publicaciones ---
async function generarContenido({ empresa, plataforma, tema, cantidad }) {
  const n = Math.min(Math.max(parseInt(cantidad, 10) || 3, 1), 6);

  if (!hayClave) {
    return demoContenido(empresa, plataforma, tema, n);
  }

  const system =
    `Eres un experto en marketing y redes sociales para PYMES. ` +
    `Escribes en espanol, con un tono ${empresa.tono || 'cercano y profesional'}. ` +
    `Creas publicaciones para la plataforma "${plataforma}" de la empresa "${empresa.nombre}" ` +
    `(rubro: ${empresa.rubro || 'general'}, publico objetivo: ${empresa.publico || 'clientes locales'}). ` +
    `Adapta la longitud y el estilo a la plataforma (Instagram/TikTok mas visual y corto, ` +
    `LinkedIn mas profesional, web/blog mas extenso).`;

  const user =
    `Genera ${n} publicaciones distintas sobre: "${tema || 'novedades y promociones del negocio'}".\n` +
    `Devuelve UNICAMENTE un array JSON. Cada elemento con esta forma exacta:\n` +
    `{"texto": "cuerpo de la publicacion", "hashtags": ["#uno", "#dos"]}\n` +
    `Sin explicaciones, solo el JSON.`;

  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  });

  const parsed = parsearJSON(textoDe(resp));
  if (!Array.isArray(parsed)) {
    return [{ texto: textoDe(resp).trim(), hashtags: [] }];
  }
  return parsed.slice(0, n).map((p) => ({
    texto: String(p.texto || '').trim(),
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
  }));
}

// --- Redactar respuesta a un cliente ---
async function redactarRespuesta({ empresa, canal, cliente, texto }) {
  if (!hayClave) {
    return demoRespuesta(empresa, cliente, texto);
  }

  const system =
    `Eres el asistente de atencion al cliente de la empresa "${empresa.nombre}" ` +
    `(rubro: ${empresa.rubro || 'general'}). Respondes por ${canal} en espanol, ` +
    `con un tono ${empresa.tono || 'amable, cercano y resolutivo'}. ` +
    `Se breve, util y humano. Si falta informacion para cerrar una venta o resolver ` +
    `una duda, pide con amabilidad el dato que falta. No inventes precios ni datos que no conozcas.`;

  const user =
    `Un cliente llamado "${cliente || 'cliente'}" escribio:\n"${texto}"\n\n` +
    `Redacta la mejor respuesta para enviarle. Devuelve solo el texto de la respuesta.`;

  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 1000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });

  return textoDe(resp).trim();
}

// --- Fallbacks de demostracion (sin ANTHROPIC_API_KEY) ---
function demoContenido(empresa, plataforma, tema, n) {
  const base = tema || 'nuestras novedades';
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      texto:
        `[DEMO] ${empresa.nombre}: ${base}. ` +
        `Descubre lo que tenemos para ti en ${plataforma}. ` +
        `Escribenos y te atendemos al momento. (Configura ANTHROPIC_API_KEY para texto real con IA.)`,
      hashtags: ['#' + (empresa.rubro || 'negocio').replace(/\s+/g, ''), '#promo', '#' + empresa.nombre.replace(/\s+/g, '')],
    });
  }
  return arr;
}

function demoRespuesta(empresa, cliente, texto) {
  return (
    `[DEMO] Hola ${cliente || ''}, gracias por escribir a ${empresa.nombre}. ` +
    `Con gusto te ayudamos con: "${texto}". ` +
    `Cuentanos un poco mas y te damos toda la informacion. ` +
    `(Configura ANTHROPIC_API_KEY para respuestas reales con IA.)`
  );
}

module.exports = { generarContenido, redactarRespuesta, hayClave, MODELO };
