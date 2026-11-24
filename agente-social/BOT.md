# Conectar tu bot de WhatsApp a los recordatorios 🤖🔋

Tu bot ya contesta mensajes. Con esto, **también manda los recordatorios de batería solo**,
uno por uno y espaciados, sin que tú toques nada.

## Cómo funciona

1. Tú registras la venta en el panel (**🔋 Clientes**).
2. Cada minuto el bot le pregunta al panel: *"¿le mando a alguien?"*.
3. El panel le da **un solo mensaje, y solo si ya toca**:
   - Solo de **10:00 a 19:00** (hora de México).
   - Entre mensaje y mensaje espera **de 4 a 10 minutos al azar**.
   - Máximo **25 al día**.
   - **Nunca 2 mensajes al mismo cliente el mismo día.**
4. El bot lo manda y le avisa al panel si salió bien o mal.
5. Si un cliente responde **BAJA**, el bot avisa y ese cliente ya no recibe nada.

Mandar despacio, en horario normal y solo a clientes que aceptaron es lo que mejor cuida
la reputación de tu número. Aun así, si tu bot usa WhatsApp con código QR (no la API oficial
de Meta), WhatsApp puede bloquear el número si recibe muchos reportes. No lo uses para
mandar promociones masivas.

## 1) Configura la clave del bot (en Render)

En Render → tu servicio `agente-social` → **Environment**, busca `BOT_TOKEN`
(Render la crea sola con una clave al azar). Si no aparece, agrégala con una clave larga
que inventes (ej. 30 letras y números al azar).

Copia esa clave y ponla **igual** en tu bot (por ejemplo como variable `AGENTE_BOT_TOKEN`).
No la compartas: con ella se pueden leer los mensajes pendientes.

## 2) Lo que el bot tiene que llamar

Todas las llamadas llevan el header `x-bot-token: <tu BOT_TOKEN>`.

| Qué | Llamada | Respuesta |
|---|---|---|
| Pedir el siguiente | `GET /api/bot/siguiente` | `{ "mensaje": { clienteId, recordatorioId, telefono, nombre, empresa, texto } }` o `{ "mensaje": null, "razon": "..." }` |
| Confirmar | `POST /api/bot/confirmar` con `{ clienteId, recordatorioId, ok: true }` (o `ok: false, error: "..."`) | `{ ok: true }` |
| Baja | `POST /api/bot/baja` con `{ telefono }` | `{ ok: true, pausados: 1 }` |

- `telefono` viene como `52` + 10 dígitos (ej. `522411234567`).
- Si el bot no confirma en 15 minutos, el mensaje vuelve a la fila.
- Si falla 3 veces, queda como *fallido* en el panel.

## 3) Ejemplo (bot hecho con whatsapp-web.js)

```js
const PANEL = 'https://TU-AGENTE.onrender.com'; // la URL de tu Agente Social
const TOKEN = process.env.AGENTE_BOT_TOKEN;
const headers = { 'x-bot-token': TOKEN, 'Content-Type': 'application/json' };

async function revisarRecordatorios(client) {
  const r = await fetch(PANEL + '/api/bot/siguiente', { headers });
  const { mensaje } = await r.json();
  if (!mensaje) return; // no toca todavia

  let ok = true, error;
  try {
    const numero = await client.getNumberId(mensaje.telefono); // resuelve el formato de Mexico
    if (!numero) throw new Error('Ese número no tiene WhatsApp');
    await client.sendMessage(numero._serialized, mensaje.texto);
  } catch (e) { ok = false; error = e.message; }

  await fetch(PANEL + '/api/bot/confirmar', {
    method: 'POST', headers,
    body: JSON.stringify({ clienteId: mensaje.clienteId, recordatorioId: mensaje.recordatorioId, ok, error }),
  });
}

// Cuando el bot ya esta listo:
client.on('ready', () => {
  setInterval(() => revisarRecordatorios(client).catch(console.error), 60 * 1000);
});

// Si el cliente responde BAJA
client.on('message', async (msg) => {
  if (/^\s*(baja|stop)\s*\.?\s*$/i.test(msg.body || '')) {
    await fetch(PANEL + '/api/bot/baja', {
      method: 'POST', headers, body: JSON.stringify({ telefono: msg.from.split('@')[0] }),
    });
    await msg.reply('Listo, ya no te enviaremos recordatorios. ¡Gracias! 🙌');
  }
});
```

Si tu bot usa otra librería (Baileys, API oficial de Meta, etc.), la idea es la misma:
pedir `siguiente` cada minuto, enviar `texto` a `telefono` y confirmar.

## Ajustes opcionales (Render → Environment)

| Variable | Default | Qué hace |
|---|---|---|
| `RECORDATORIOS_HORA_INICIO` | `10` | Hora de inicio de envíos |
| `RECORDATORIOS_HORA_FIN` | `19` | Hora en que se dejan de enviar |
| `RECORDATORIOS_MIN_ESPERA_MIN` | `4` | Espera mínima entre mensajes (minutos) |
| `RECORDATORIOS_MAX_ESPERA_MIN` | `10` | Espera máxima entre mensajes (minutos) |
| `RECORDATORIOS_MAX_DIA` | `25` | Máximo de mensajes al día |
| `RECORDATORIOS_ZONA` | `America/Mexico_City` | Zona horaria |

En el panel, la tarjeta de **🔋 Clientes** muestra si el bot está conectado y cuántos van hoy.
