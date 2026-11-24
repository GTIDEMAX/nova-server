// Recordatorios postventa por WhatsApp (cuidado de bateria).
//
// Cada venta registrada genera un plan de mensajes segun el tipo de bateria:
//  - PLOMO (mayoria de modelos): regla de oro "siempre llena"; recordatorio
//    mensual para recargar (las de plomo se sulfatan si se quedan descargadas).
//  - LITIO (patines): no llegar a cero, cargador original, guardar con media carga.
//
// Dos modos de envio:
//  - 1-TOQUE (por defecto, sin API): el panel muestra los recordatorios del dia
//    con un enlace wa.me que abre WhatsApp con el mensaje ya escrito.
//  - AUTOMATICO: con WhatsApp Cloud API + una plantilla aprobada por Meta
//    (RECORDATORIOS_AUTO=1, WHATSAPP_TEMPLATE_RECORDATORIO). WhatsApp exige
//    plantillas para escribir a clientes fuera de la ventana de 24 h.
//
// Solo se registra a clientes que ACEPTARON recibir mensajes (requisito de WhatsApp).

const DIA = 24 * 60 * 60 * 1000;

// consejo: frase de una sola linea (se usa tambien como variable de la plantilla).
const PLANES = {
  plomo: [
    { dia: 0, consejo: 'La regla de oro de las baterías de plomo: cárgala después de cada uso, aunque no se haya acabado. Una batería de plomo siempre debe estar llena.' },
    { dia: 7, consejo: 'No dejes que tu batería llegue a cero y no la dejes al sol. Así le alargas la vida.' },
    { dia: 30, consejo: 'Si casi no has usado tu vehículo este mes, dale una carga completa. Las baterías de plomo se dañan si se quedan descargadas.' },
    { dia: 60, consejo: 'Usa siempre el cargador original. Uno que no es el correcto puede arruinar tu batería.' },
    { dia: 90, consejo: 'Si notas que tu batería rinde menos, pásate a la tienda y te asesoramos.' },
    { dia: 120, consejo: 'Recarga mensual: si la tienes guardada, dale una carga completa para que no se dañe.' },
    { dia: 150, consejo: 'Guárdala en un lugar fresco, lejos del sol y del calor. El calor es el peor enemigo de la batería.' },
    { dia: 180, consejo: 'Seis meses rodando sin gasolina. Recuerda: cárgala después de cada uso y nunca la dejes descargada.' },
    { dia: 210, consejo: 'Recarga mensual: una batería de plomo siempre debe estar llena, aunque no la uses.' },
    { dia: 240, consejo: 'Si tu batería ya no rinde como antes, pregúntanos por opciones de reemplazo.' },
    { dia: 270, consejo: 'Recarga mensual: si casi no la usaste, dale una carga completa hoy.' },
    { dia: 300, consejo: 'Usa el cargador original y evita que la batería llegue a cero. Así te dura mucho más.' },
    { dia: 330, consejo: 'Recarga mensual: una batería de plomo descargada se daña. Dale una carga completa.' },
    { dia: 360, consejo: 'Un año juntos. Si notas que tu batería rinde menos, pásate y te asesoramos.' },
  ],
  litio: [
    { dia: 0, consejo: 'Para tu batería de litio: cárgala antes de que llegue a cero, usa el cargador original y desconéctalo cuando esté llena.' },
    { dia: 7, consejo: 'No dejes tu patín al sol ni cerca del calor, y deja que la batería se enfríe un rato antes de cargarla.' },
    { dia: 30, consejo: 'Si no lo vas a usar unas semanas, guárdalo con media carga, en un lugar fresco y seco, y revísalo de vez en cuando.' },
    { dia: 90, consejo: 'Evita que la batería llegue a cero. Cargarla antes de que se acabe le alarga la vida.' },
    { dia: 150, consejo: 'Usa siempre el cargador original y desconéctalo cuando la batería esté llena.' },
    { dia: 210, consejo: 'Si lo tienes guardado, revisa que tenga alrededor de media carga y guárdalo en un lugar fresco.' },
    { dia: 270, consejo: 'Si notas que rinde menos, pásate a la tienda y te asesoramos.' },
    { dia: 360, consejo: 'Un año juntos. Recuerda: ni muy llena guardada, ni vacía. Así tu batería de litio te dura años.' },
  ],
};

function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d; // numero mexicano de 10 digitos
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3); // formato antiguo 521
  return d;
}

function crearPlan(cliente, generarId) {
  const base = new Date(cliente.fechaCompra || Date.now()).getTime();
  const plan = PLANES[cliente.tipoBateria] || PLANES.plomo;
  return plan.map((p) => ({
    id: generarId(),
    dia: p.dia,
    // La bienvenida (dia 0) queda lista de inmediato para enviarla en la tienda
    fecha: new Date(p.dia === 0 ? Math.min(base, Date.now()) : base + p.dia * DIA).toISOString(),
    consejo: p.consejo,
    estado: 'pendiente',
  }));
}

function textoCompleto(cliente, empresa, rec) {
  const nombre = (cliente.nombre || '').split(' ')[0] || 'hola';
  const negocio = empresa ? empresa.nombre : 'tu tienda';
  const saludo = rec.dia === 0
    ? `¡Hola ${nombre}! 🙌 Gracias por tu compra en ${negocio}.`
    : `¡Hola ${nombre}! 👋 Te saluda ${negocio}.`;
  return `${saludo}\n\n🔋 ${rec.consejo}\n\n¿Dudas? Respóndenos por aquí. Si ya no quieres recibir estos mensajes, responde BAJA.`;
}

function linkWhatsApp(telefono, texto) {
  return `https://wa.me/${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}

function modo() {
  const tieneApi = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  const plantilla = process.env.WHATSAPP_TEMPLATE_RECORDATORIO;
  const auto = process.env.RECORDATORIOS_AUTO === '1' && tieneApi && !!plantilla;
  let detalle = 'Modo 1-toque: cada día te muestro a quién le toca y lo envías con un toque desde tu WhatsApp.';
  if (auto) detalle = 'Modo automático: los recordatorios se envían solos con la plantilla aprobada de WhatsApp.';
  else if (process.env.RECORDATORIOS_AUTO === '1') detalle = 'Modo automático pedido, pero falta WHATSAPP_TOKEN, WHATSAPP_PHONE_ID o WHATSAPP_TEMPLATE_RECORDATORIO. Uso modo 1-toque.';
  return { auto, detalle };
}

// Recordatorios vencidos (de hoy o atrasados) de clientes activos.
function pendientes(estado, ahora = Date.now()) {
  const out = [];
  for (const c of estado.clientes || []) {
    if (!c.activo) continue;
    const empresa = estado.empresas.find((e) => e.id === c.empresaId);
    for (const r of c.recordatorios || []) {
      if (r.estado !== 'pendiente' || new Date(r.fecha).getTime() > ahora) continue;
      const texto = textoCompleto(c, empresa, r);
      out.push({
        clienteId: c.id, recordatorioId: r.id, cliente: c.nombre, telefono: c.telefono,
        producto: c.producto, tipoBateria: c.tipoBateria, empresa: empresa ? empresa.nombre : '',
        dia: r.dia, fecha: r.fecha, texto, link: linkWhatsApp(c.telefono, texto),
      });
    }
  }
  return out.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function proximo(cliente) {
  const r = (cliente.recordatorios || []).find((x) => x.estado === 'pendiente');
  return r ? r.fecha : null;
}

// Envio automatico (solo si el modo automatico esta configurado).
async function procesarAutomaticos(estado, guardar, adapters) {
  if (!modo().auto) return 0;
  const plantilla = process.env.WHATSAPP_TEMPLATE_RECORDATORIO;
  const idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || 'es_MX';
  let enviados = 0;
  for (const p of pendientes(estado)) {
    const c = estado.clientes.find((x) => x.id === p.clienteId);
    const r = c.recordatorios.find((x) => x.id === p.recordatorioId);
    const nombre = (c.nombre || '').split(' ')[0] || 'cliente';
    const res = await adapters.enviarPlantillaWhatsApp(c.telefono, plantilla, idioma, [nombre, p.empresa || 'tu tienda', r.consejo]);
    r.intentos = (r.intentos || 0) + 1;
    if (res.ok) {
      r.estado = 'enviado'; r.enviado = new Date().toISOString(); r.via = res.simulado ? 'simulado' : 'automatico';
      enviados++;
    } else {
      r.ultimoError = res.nota || res.error;
      if (r.intentos >= 3) r.estado = 'fallido';
    }
  }
  if (enviados) guardar();
  return enviados;
}

module.exports = { PLANES, normalizarTelefono, crearPlan, textoCompleto, linkWhatsApp, modo, pendientes, proximo, procesarAutomaticos };
