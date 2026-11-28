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

// La gente se aburre de lo que suena a IA: guía corta para que los textos suenen a la tienda de verdad
const TONO_REAL =
  `Escribe como el vendedor de la tienda que conoce el producto, no como un anuncio. Español de México natural, frases cortas y concretas. ` +
  `PROHIBIDO: "eleva tu experiencia", "descubre", "sumérgete", "no te lo pierdas", "calidad premium", "revoluciona", "increíble", "el aliado perfecto", ` +
  `más de 3 emojis, signos de exclamación en cada frase, listas de beneficios genéricas. ` +
  `Habla de situaciones reales (la carne asada, el cumple, el gym, el trabajo, el camión), de lo que pregunta la gente en tienda y de pruebas reales (cómo suena, cuánto dura la batería). ` +
  `Prefiere contenido real: foto de un cliente con su compra (solo con su permiso), la tienda, unboxing, prueba de sonido en video, comparación lado a lado. ` +
  `NUNCA inventes reseñas, testimonios, clientes, cifras de ventas ni resultados.`;

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
    `LinkedIn mas profesional, web/blog mas extenso). ` +
    // sin la fecha el modelo pone el ano de su entrenamiento (#Navidad2024)
    `Hoy es ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full' })}: si mencionas un ano o temporada, que sea la actual. ` +
    `NO inventes precios, promociones, descuentos ni envios gratis: usa solo los que vengan en el tema. ` +
    TONO_REAL;

  const user =
    `Genera ${n} publicaciones distintas sobre: "${tema || 'novedades y promociones del negocio'}".\n` +
    `Devuelve UNICAMENTE un array JSON. Cada elemento con esta forma exacta:\n` +
    `{"texto": "cuerpo de la publicacion", "hashtags": ["#uno", "#dos"], "imagenPrompt": "descripcion en INGLES de una imagen promocional profesional y fotorrealista para este post (escena, iluminacion, estilo, ambiente); sin logos ni parrafos de texto; que NO parezca ilustracion de IA"}\n` +
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
    imagenPrompt: String(p.imagenPrompt || '').trim(),
  }));
}

// --- Ideas de publicaciones a partir de resultados reales y fotos reales ---
// resumen: salida de resultados.analizar (o null); fotos: [{producto, nota}] de la biblioteca
async function generarIdeas({ empresa, resumen, fotos, cantidad }) {
  const n = Math.min(Math.max(parseInt(cantidad, 10) || 6, 5), 10);
  const listaFotos = (fotos || []).map((f, i) => `${i}: ${f.producto || 'sin producto'}${f.nota ? ' — ' + f.nota : ''}`).join('\n') || '(no hay fotos reales todavía)';
  const datos = resumen && resumen.total
    ? `Resultados reales de las últimas ${resumen.total} publicaciones (medido por ${resumen.base === 'tasa' ? 'interacciones entre alcance' : 'interacciones'}):\n` +
      `Conclusiones: ${resumen.conclusiones.join(' ')}\n` +
      `Por formato: ${resumen.porTipo.map((x) => `${x.clave} (${x.n})`).join(', ')}. Mejor horario: ${(resumen.porFranja[0] || {}).clave || '—'}.\n` +
      `Las que mejor funcionaron: ${resumen.mejores.map((m) => `[${m.red} ${m.tipo}] ${m.texto.slice(0, 80)}`).join(' | ')}\n` +
      `Las que peor: ${resumen.peores.map((m) => `[${m.red} ${m.tipo}] ${m.texto.slice(0, 80)}`).join(' | ')}`
    : 'Todavía no hay resultados medidos: propón una mezcla variada para empezar a aprender.';

  if (!hayClave) {
    return Array.from({ length: n }, (_, i) => ({
      plataforma: i % 2 ? 'facebook' : 'instagram', formato: ['foto', 'reel', 'carrusel', 'historia'][i % 4],
      texto: `[DEMO] Idea ${i + 1} para ${empresa.nombre}. (Configura ANTHROPIC_API_KEY para ideas reales.)`,
      hashtags: [], foto: fotos && fotos.length ? i % fotos.length : null, porque: 'Modo demo',
    }));
  }

  const system =
    `Eres el estratega de redes de "${empresa.nombre}" (rubro: ${empresa.rubro || 'general'}; público: ${empresa.publico || 'clientes locales'}). ` +
    `Propones publicaciones basadas en datos reales y fotos reales del negocio. ` +
    `Hoy es ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full' })}. ` +
    `NO inventes precios, promociones, descuentos ni envíos gratis. ` + TONO_REAL;
  const user =
    `${datos}\n\nFotos reales disponibles (número: producto — nota):\n${listaFotos}\n\n` +
    `Propón ${n} publicaciones distintas para Instagram y Facebook. Usa primero las fotos reales (pon su número en "foto"); ` +
    `si ninguna sirve, pon null y di en "porque" qué foto o video real conviene tomar (ej. prueba de sonido, unboxing, cliente en tienda). ` +
    `Aprovecha lo que funcionó y evita lo que no. En "porque" explica en una frase por qué, citando el dato real si existe.\n` +
    `Devuelve UNICAMENTE un array JSON. Cada elemento: {"plataforma": "instagram" | "facebook", "formato": "foto" | "carrusel" | "reel" | "historia", ` +
    `"texto": "texto listo para publicar", "hashtags": ["#uno"], "foto": número o null, "porque": "una frase"}`;

  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 6000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const parsed = parsearJSON(textoDe(resp));
  if (!Array.isArray(parsed)) throw new Error('La IA no devolvió ideas válidas, intenta otra vez.');
  return parsed.slice(0, n).map((p) => ({
    plataforma: p.plataforma === 'facebook' ? 'facebook' : 'instagram',
    formato: ['foto', 'carrusel', 'reel', 'historia'].includes(p.formato) ? p.formato : 'foto',
    texto: String(p.texto || '').trim(),
    hashtags: Array.isArray(p.hashtags) ? p.hashtags.filter((h) => typeof h === 'string').slice(0, 30) : [],
    foto: Number.isInteger(p.foto) && fotos && p.foto >= 0 && p.foto < fotos.length ? p.foto : null,
    porque: String(p.porque || '').trim().slice(0, 300),
  })).filter((p) => p.texto);
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
      imagenPrompt: `Modern professional promotional photo for a technology store about ${base}, clean premium look`,
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

// --- Guion de spot de audio (para la seccion Spots) ---
// formato 'spot' = 1 anuncio de 25-40 s; 'dialogo' = spot con 2 personajes (A y B);
// 'bocina' = capsulas cortas para la bocina de la tienda.
async function escribirGuionSpot({ empresa, idea, formato, estilo }) {
  const bocina = formato === 'bocina';
  const dialogo = formato === 'dialogo';
  const n = bocina ? 8 : 1;
  if (!hayClave) return demoGuion(empresa, idea, bocina, n, dialogo);

  const system =
    `Eres un creativo de radio mexicano experto en spots que venden. Escribes guiones para locutor ` +
    `de la empresa "${empresa.nombre}" (rubro: ${empresa.rubro || 'general'}; publico: ${empresa.publico || 'clientes locales'}; ` +
    `tono: ${empresa.tono || 'cercano y con energia'}). Reglas OBLIGATORIAS:\n` +
    `1) NO INVENTES datos: usa solo precios, promociones, telefonos, direcciones, redes y productos que vengan en la idea del dueno. Si no vienen, no los menciones.\n` +
    `2) Escribe para el oido: frases cortas, naturales, como habla un locutor mexicano con energia. Nada de groserias ni burlas.\n` +
    `3) Numeros y telefonos escritos con letras como se dicen (ej. "dos, cuatro, uno... tres, tres, nueve").\n` +
    `4) Escribe el nombre de la marca como se pronuncia en espanol (ej. "Voltum" -> "Vóltum") para que la voz lo diga bien.\n` +
    `5) Usa "..." para pausas y signos de exclamacion para dar energia. No pongas acotaciones ni etiquetas entre corchetes.`;

  const user = dialogo
    ? `Idea del dueno: "${idea}".\nEscribe un spot en DIALOGO entre 2 personajes (A y B) de 30 a 40 segundos leido (80 a 110 palabras en total), ` +
      `natural y con chispa, que termine con una llamada a la accion (solo con datos que esten en la idea). Cada linea es un elemento de "capsulas" con "personaje": "A" o "B".\n`
    : bocina
    ? `Idea del dueno: "${idea}".\nEscribe ${n} capsulas distintas para la bocina de la tienda (para jalar a la gente que pasa). ` +
      `Cada capsula de 15 a 25 segundos leida (40 a 65 palabras). Mezcla capsulas de VENTA y capsulas de TIP util para el cliente (tipo "tip"), ` +
      `y que la ultima invite a visitar o escribir (solo con datos que esten en la idea).\n`
    : `Idea del dueno: "${idea}".\nEscribe UN spot de 25 a 35 segundos leido (70 a 95 palabras), con gancho al inicio y llamada a la accion al final (solo con datos que esten en la idea).\n`;
  const formatoJSON =
    `Ademas, describe en INGLES la musica de fondo ideal (estilo: ${estilo || 'moderna y con energia'}), instrumental, sin voces, apta para radio.\n` +
    `Devuelve UNICAMENTE un objeto JSON con esta forma exacta:\n` +
    `{"titulo": "titulo corto", "capsulas": [{"tipo": "venta" | "tip", "personaje": "A" | "B", "texto": "lo que dice el locutor"}], "musicaPrompt": "descripcion en ingles"}`;

  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user + formatoJSON }],
  });
  const texto = textoDe(resp);
  let obj = null;
  try { obj = JSON.parse(texto); } catch (_) {
    const i = texto.indexOf('{'), f = texto.lastIndexOf('}');
    if (i !== -1 && f !== -1) { try { obj = JSON.parse(texto.slice(i, f + 1)); } catch (_) {} }
  }
  if (!obj || !Array.isArray(obj.capsulas) || !obj.capsulas.length) throw new Error('La IA no devolvió un guion válido, intenta otra vez.');
  return {
    titulo: String(obj.titulo || 'Spot').slice(0, 80),
    capsulas: obj.capsulas.slice(0, 16).map((c) => ({
      tipo: c.tipo === 'tip' ? 'tip' : 'venta', personaje: c.personaje === 'B' ? 'B' : 'A', texto: String(c.texto || '').trim(),
    })).filter((c) => c.texto),
    musicaPrompt: String(obj.musicaPrompt || '').trim() || 'Upbeat modern Latin pop instrumental, energetic, radio-ready, no vocals.',
  };
}

function demoGuion(empresa, idea, bocina, n, dialogo) {
  const base = `¡Atención! En ${empresa.nombre} tenemos lo que buscas... ${idea || 'pásale y conócenos'}. ¡Te esperamos!`;
  if (dialogo) {
    return {
      titulo: 'Diálogo ' + empresa.nombre + ' (demo)',
      capsulas: [
        { tipo: 'venta', personaje: 'A', texto: '¿Oye, y tú dónde compraste eso?' },
        { tipo: 'venta', personaje: 'B', texto: `¡En ${empresa.nombre}! ${idea || 'Pásale y conócelos'}.` },
      ],
      musicaPrompt: 'Upbeat modern Latin pop instrumental, energetic, radio-ready, no vocals.',
    };
  }
  return {
    titulo: (bocina ? 'Bocina' : 'Spot') + ' ' + empresa.nombre + ' (demo)',
    capsulas: Array.from({ length: n }, (_, i) => ({ tipo: bocina && i % 2 ? 'tip' : 'venta', personaje: 'A', texto: base })),
    musicaPrompt: 'Upbeat modern Latin pop instrumental, energetic, radio-ready, no vocals.',
  };
}

module.exports = { generarContenido, generarIdeas, redactarRespuesta, escribirGuionSpot, hayClave, MODELO };
