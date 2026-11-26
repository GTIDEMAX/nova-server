// Spots de audio con ElevenLabs (voz + musica + efectos) y mezcla con ffmpeg.
//
// Formatos:
//  - spot:    lineas seguidas (25-40 s) sobre musica. Cada linea con su voz.
//  - dialogo: igual que spot, pensado para 2 personajes con voces distintas.
//  - bocina:  capsulas para la bocina de la tienda, una cada ~45 s, con efecto de
//             radio antes de las de venta y campanita antes de los tips.
//
// Requiere ELEVENLABS_API_KEY. ffmpeg: usa FFMPEG_PATH, el paquete ffmpeg-static
// o el ffmpeg del sistema, en ese orden.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const API = 'https://api.elevenlabs.io';
const VOZ_DEFAULT = process.env.ELEVENLABS_VOICE_ID || 'JjHBC66wF58p4ogebCNA'; // Eduardo
const MODELO_VOZ = process.env.ELEVENLABS_MODEL || 'eleven_v4';
const SR = 44100;

// Estilo de lectura -> etiqueta de emocion para la voz
const ESTILOS = {
  emocionado: '[excited]',
  amigable: '[friendly, upbeat]',
  serio: '',
  dramatico: '[dramatic]',
};

function hayEleven() { return !!process.env.ELEVENLABS_API_KEY; }

function rutaFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return 'ffmpeg';
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(rutaFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 24 }, (err, _o, stderr) => {
      if (err) reject(new Error('ffmpeg: ' + (stderr || err.message).slice(0, 300)));
      else resolve();
    });
  });
}

async function eleven(ruta, body) {
  const r = await fetch(API + ruta, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok) {
    let msg = buf.toString('utf8').slice(0, 300);
    try { const j = JSON.parse(buf.toString('utf8')); msg = (j.detail && (j.detail.message || j.detail.status || JSON.stringify(j.detail))) || msg; } catch (e) {}
    throw new Error(`ElevenLabs (${r.status}): ${msg}`);
  }
  return buf;
}

// ---------- Voces disponibles en la cuenta ----------
let cacheVoces = null;
let cacheVocesHora = 0;
async function listarVoces() {
  if (!hayEleven()) return { ok: false, voces: [], detalle: 'Falta ELEVENLABS_API_KEY en Render.' };
  if (cacheVoces && Date.now() - cacheVocesHora < 10 * 60000) return { ok: true, voces: cacheVoces };
  try {
    const r = await fetch(API + '/v1/voices', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
    const d = await r.json();
    if (!r.ok) throw new Error((d.detail && d.detail.message) || 'HTTP ' + r.status);
    const voces = (d.voices || []).map((v) => {
      const l = v.labels || {};
      return {
        id: v.voice_id,
        nombre: v.name,
        idioma: l.language || '',
        genero: l.gender === 'female' ? 'mujer' : l.gender === 'male' ? 'hombre' : '',
        descripcion: (v.description || l.description || '').slice(0, 90),
        muestra: v.preview_url || '',
      };
    });
    // Primero las de espanol
    voces.sort((a, b) => (b.idioma === 'es') - (a.idioma === 'es') || a.nombre.localeCompare(b.nombre));
    cacheVoces = voces;
    cacheVocesHora = Date.now();
    return { ok: true, voces };
  } catch (e) {
    return { ok: false, voces: [], detalle: 'No se pudo leer tus voces: ' + e.message };
  }
}

// ---------- Produccion ----------
const FILTRO_VOZ = 'highpass=f=100,equalizer=f=3000:t=q:w=1:g=3,' +
  'acompressor=threshold=-22dB:ratio=4:attack=5:release=100,loudnorm=I=-15:TP=-1.5:LRA=6';

// Duracion de un WAV PCM 16 bits estereo
function durWav(f) { return Math.max(0, (fs.statSync(f).size - 44) / (SR * 4)); }

async function aWav(origen, destino, filtro) {
  await ffmpeg(['-i', origen, ...(filtro ? ['-af', filtro] : []), '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', destino]);
}

// spot: { formato, capsulas: [{texto, vozId, estilo, tipo}], musicaPrompt, conMusica }
// progreso(texto): callback opcional para mostrar el avance en el panel.
async function producir(spot, progreso = () => {}) {
  if (!hayEleven()) throw new Error('Falta ELEVENLABS_API_KEY en Render (Environment).');
  const lineas = (spot.capsulas || []).filter((c) => (c.texto || '').trim());
  if (!lineas.length) throw new Error('El guion está vacío.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-'));
  try {
    // 1) Voces
    const wavs = [];
    for (let i = 0; i < lineas.length; i++) {
      progreso(`Grabando voz ${i + 1} de ${lineas.length}…`);
      const c = lineas[i];
      const etiqueta = ESTILOS[c.estilo] !== undefined ? ESTILOS[c.estilo] : ESTILOS.emocionado;
      const audio = await eleven(`/v1/text-to-speech/${encodeURIComponent(c.vozId || VOZ_DEFAULT)}?output_format=mp3_44100_192`, {
        text: (etiqueta ? etiqueta + ' ' : '') + c.texto.trim(),
        model_id: MODELO_VOZ,
        voice_settings: { stability: 0.0, similarity_boost: 0.8 },
      });
      const mp3 = path.join(tmp, `v${i}.mp3`);
      fs.writeFileSync(mp3, audio);
      const wav = path.join(tmp, `v${i}.wav`);
      await aWav(mp3, wav, FILTRO_VOZ);
      wavs.push({ wav, dur: durWav(wav), tipo: c.tipo });
    }

    // 2) Linea de tiempo
    const bocina = spot.formato === 'bocina';
    const tiempos = [];
    let t = bocina ? 12 : 1.8;
    for (const w of wavs) {
      tiempos.push(t);
      t += bocina ? Math.max(45, w.dur + 8) : w.dur + 0.35;
    }
    const ultimo = wavs.length - 1;
    const L = Math.ceil(tiempos[ultimo] + wavs[ultimo].dur + (bocina ? 6 : 3));

    // 3) Efectos (solo bocina): barrido de radio para venta, campanita para tips
    let efectos = {};
    if (bocina) {
      progreso('Creando efectos de radio…');
      const sw = path.join(tmp, 'sweeper.mp3');
      fs.writeFileSync(sw, await eleven('/v1/sound-generation', { text: 'Short energetic radio station sweeper whoosh with bright synth riser, punchy ending', duration_seconds: 1.8, prompt_influence: 0.6 }));
      const ch = path.join(tmp, 'chime.mp3');
      fs.writeFileSync(ch, await eleven('/v1/sound-generation', { text: "Short bright 'idea' notification chime, two quick sparkling bell notes, friendly and clean", duration_seconds: 1.2, prompt_influence: 0.6 }));
      efectos = { venta: path.join(tmp, 'sweeper.wav'), tip: path.join(tmp, 'chime.wav') };
      await aWav(sw, efectos.venta, 'loudnorm=I=-16:TP=-1.5');
      await aWav(ch, efectos.tip, 'loudnorm=I=-17:TP=-1.5');
    }

    // 4) Pista de voces (cada linea en su tiempo)
    const args = [];
    const fc = [];
    const etiquetas = [];
    let k = 0;
    wavs.forEach((w, i) => {
      const ms = Math.round(tiempos[i] * 1000);
      if (bocina) {
        const ef = w.tipo === 'tip' ? efectos.tip : efectos.venta;
        const adelanto = w.tipo === 'tip' ? 1300 : 1600;
        args.push('-i', ef);
        fc.push(`[${k}:a]adelay=${Math.max(0, ms - adelanto)}|${Math.max(0, ms - adelanto)}[e${i}]`);
        etiquetas.push(`[e${i}]`);
        k++;
      }
      args.push('-i', w.wav);
      fc.push(`[${k}:a]adelay=${ms}|${ms}[v${i}]`);
      etiquetas.push(`[v${i}]`);
      k++;
    });
    fc.push(`${etiquetas.join('')}amix=inputs=${etiquetas.length}:normalize=0:duration=longest,apad=whole_dur=${L},atrim=0:${L}[v]`);
    const voces = path.join(tmp, 'voces.wav');
    await ffmpeg([...args, '-filter_complex', fc.join(';'), '-map', '[v]', '-ar', String(SR), '-ac', '2', voces]);

    const salida = path.join(tmp, 'final.mp3');
    if (spot.conMusica === false) {
      await ffmpeg(['-i', voces, '-af', 'loudnorm=I=-14:TP=-1.2', '-ar', String(SR), '-b:a', '192k', salida]);
    } else {
      // 5) Musica de fondo (en bocina se repite para no gastar de mas)
      progreso('Componiendo la música…');
      const segMusica = Math.min(bocina ? 150 : L + 2, 300);
      const musica = path.join(tmp, 'musica.mp3');
      fs.writeFileSync(musica, await eleven('/v1/music?output_format=mp3_44100_192', {
        prompt: spot.musicaPrompt || 'Upbeat modern Latin pop instrumental, energetic, radio-ready, no vocals.',
        music_length_ms: Math.max(10, Math.ceil(segMusica)) * 1000,
        force_instrumental: true,
      }));
      progreso('Mezclando…');
      const cama = path.join(tmp, 'cama.wav');
      await ffmpeg(['-stream_loop', '-1', '-i', musica, '-af',
        `atrim=0:${L},asetpts=N/SR/TB,afade=t=in:d=1.5,afade=t=out:st=${L - 2.5}:d=2.5,highpass=f=45,loudnorm=I=-17:TP=-2:LRA=8`,
        '-ar', String(SR), '-ac', '2', cama]);
      // 6) Mezcla final: la musica baja sola cuando habla el locutor (ducking)
      await ffmpeg(['-i', cama, '-i', voces, '-filter_complex',
        '[1:a]asplit=2[vk][vm];' +
        '[0:a][vk]sidechaincompress=threshold=0.03:ratio=4:attack=10:release=450:makeup=1[md];' +
        '[md][vm]amix=inputs=2:normalize=0:weights=1.0 1.0,highpass=f=50,loudnorm=I=-13:TP=-1.2:LRA=8[o]',
        '-map', '[o]', '-ar', String(SR), '-ac', '2', '-b:a', '192k', salida]);
    }
    return { buffer: fs.readFileSync(salida), duracion: L };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { ffmpeg, hayEleven, listarVoces, producir, ESTILOS, VOZ_DEFAULT };
