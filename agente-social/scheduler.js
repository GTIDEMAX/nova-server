// Programador automatico.
// Revisa cada cierto tiempo las publicaciones en estado "programado" y, cuando
// llega su fecha/hora, las publica automaticamente usando los adaptadores.
// Si una publicacion falla, reintenta en la siguiente vuelta hasta MAX_INTENTOS
// y luego la marca como "fallido" para que la revises en el panel.

const { estado, guardar } = require('./store');
const adapters = require('./adapters');

const INTERVALO = parseInt(process.env.SCHEDULER_INTERVAL_MS, 10) || 60000; // 1 min por defecto
const MAX_INTENTOS = 3;

let timer = null;
let ultimaEjecucion = null;

function buscarEmpresa(id) {
  return estado.empresas.find((e) => e.id === id);
}

async function tick() {
  ultimaEjecucion = new Date().toISOString();
  const ahora = Date.now();
  const vencidas = estado.publicaciones.filter(
    (p) => p.estado === 'programado' && p.fechaProgramada && new Date(p.fechaProgramada).getTime() <= ahora
  );

  let cambios = false;
  for (const p of vencidas) {
    cambios = true;
    try {
      const empresa = buscarEmpresa(p.empresaId);
      const resultado = await adapters.publicar(p.plataforma, p, empresa);
      p.resultadoPublicacion = resultado;
      if (resultado.ok) {
        p.estado = 'publicado';
        p.publicado = new Date().toISOString();
        p.publicadoPor = 'programador';
        console.log(`[programador] ✅ Publicado ${p.id} (${p.plataforma})`);
      } else {
        p.intentos = (p.intentos || 0) + 1;
        p.ultimoError = resultado.nota || resultado.error || 'Error desconocido';
        if (p.intentos >= MAX_INTENTOS) {
          p.estado = 'fallido';
          console.log(`[programador] ❌ Fallido ${p.id} tras ${p.intentos} intentos: ${p.ultimoError}`);
        }
      }
    } catch (e) {
      p.intentos = (p.intentos || 0) + 1;
      p.ultimoError = e.message;
      if (p.intentos >= MAX_INTENTOS) p.estado = 'fallido';
    }
  }
  if (cambios) guardar();
}

function iniciar() {
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.error('[programador]', e.message)), INTERVALO);
  if (timer.unref) timer.unref();
  console.log(`[programador] Activo, revisando cada ${INTERVALO / 1000}s`);
  // Una primera pasada al arrancar (por si hay programadas ya vencidas)
  tick().catch(() => {});
}

function estadoScheduler() {
  return {
    activo: !!timer,
    intervaloMs: INTERVALO,
    ultimaEjecucion,
    programadas: estado.publicaciones.filter((p) => p.estado === 'programado').length,
    fallidas: estado.publicaciones.filter((p) => p.estado === 'fallido').length,
  };
}

module.exports = { iniciar, tick, estadoScheduler };
