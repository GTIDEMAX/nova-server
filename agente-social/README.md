# Agente Social 🤖

Agente con IA para llevar las redes sociales, WhatsApp y la atención al cliente de tus empresas a otro nivel. Incluye un **backend** y un **panel web** donde ves, apruebas, programas y publicas todo desde un solo lugar.

## ¿Qué hace?

- **Gestiona varias empresas/marcas** con su propio tono, rubro y público.
- **Crea contenido con IA (Claude)**: genera borradores de publicaciones adaptados a cada red (Instagram, Facebook, LinkedIn, TikTok, web/blog).
- **Flujo de aprobación**: la IA propone, tú apruebas antes de publicar. Puedes editar, programar o publicar al instante.
- **Atención al cliente**: cuando llega un mensaje (WhatsApp, Instagram, etc.), la IA redacta un borrador de respuesta que apruebas antes de enviar.
- **Adaptadores por plataforma**: la estructura está lista para conectar tus cuentas reales; mientras tanto todo funciona en **modo simulado** para que pruebes el flujo completo.

## Cómo arrancarlo

```bash
cd agente-social
npm install
npm start
```

Luego abre **http://localhost:4000** en tu navegador.

> Sin configuración, arranca en **modo demo**: el panel funciona completo, pero los textos son de ejemplo y las publicaciones/mensajes son simulados. Perfecto para conocer el flujo.

## Activar la IA real (Claude)

Define tu clave de Anthropic antes de arrancar:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

A partir de ahí, los textos de publicaciones y las respuestas a clientes los genera Claude (`claude-opus-4-8`).

## Conectar Instagram + Facebook (Meta) — ¡ya implementado!

La publicación real en Meta ya está lista. Solo necesitas configurar 3 variables:

```bash
export META_ACCESS_TOKEN="EAAG..."   # token de página (long-lived)
export META_PAGE_ID="123456789"       # id de tu página de Facebook
export META_IG_USER_ID="178414..."    # id de tu cuenta de Instagram Business
```

### Cómo obtener las credenciales de Meta

1. Crea una app en **developers.facebook.com** (tipo Business).
2. Conecta una **página de Facebook** con una **cuenta de Instagram Business/Creator**.
3. Pide los permisos: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`.
4. Genera un **token de página de larga duración** (`META_ACCESS_TOKEN`).
5. Obtén el **id de la página** (`META_PAGE_ID`) y el **id de Instagram** (`META_IG_USER_ID`) desde la Graph API Explorer.

Cuando arranques con estas variables, la pestaña **Publicaciones** mostrará *"Conectado ✅"* y el botón **Publicar ahora** publicará de verdad.

> ⚠️ **Instagram exige una imagen** (no permite posts solo de texto). En cada publicación de Instagram, pega la **URL de una imagen pública** en el campo correspondiente. Facebook sí permite texto solo (o texto + imagen).

## Otras plataformas (pendientes de conectar)

| Plataforma          | Qué necesitas                                   |
|---------------------|-------------------------------------------------|
| Instagram / Facebook| ✅ **Listo** — Meta Graph API (`META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`) |
| LinkedIn            | LinkedIn Marketing API (`LINKEDIN_ACCESS_TOKEN`)|
| TikTok             | TikTok Content Posting API (`TIKTOK_ACCESS_TOKEN`) — requiere video |
| Web / blog         | Un webhook en tu sitio (`WEB_PUBLISH_WEBHOOK`)  |
| WhatsApp           | WhatsApp Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`) |

Para LinkedIn, TikTok y WhatsApp, completa las llamadas marcadas con `TODO` en `adapters.js`.

## Estructura

```
agente-social/
├── server.js        # Servidor HTTP + API (sin dependencias extra)
├── ia.js            # Capa de IA con Claude (genera contenido y respuestas)
├── adapters.js      # Publicación/envío por plataforma (simulado hasta conectar)
├── store.js         # Almacenamiento en data.json (cambiable por una BD)
├── public/index.html# Panel web (una sola página)
└── .env.example     # Variables de entorno
```

## Programador automático 🤖

El servidor incluye un **programador** que revisa las publicaciones periódicamente y publica solo las que están **programadas** cuando llega su fecha/hora — sin que tengas que estar pendiente.

- En la pestaña **Publicaciones**, elige fecha y hora en el campo "Programar para" y pulsa **Programar**.
- El programador publica automáticamente a esa hora (usando el adaptador de la plataforma).
- Si una publicación falla, reintenta hasta 3 veces y luego la marca como **fallida** para que la revises.
- Intervalo configurable con `SCHEDULER_INTERVAL_MS` (por defecto 60000 = 1 minuto).

```bash
# Ejemplo: revisar cada 30 segundos
export SCHEDULER_INTERVAL_MS=30000
npm start
```

> El estado del programador (activo, cada cuánto revisa, cuántas hay programadas) se muestra en la parte superior de la pestaña Publicaciones.

## Conectar tu página de ventas / web 🌐

En la pestaña **Mi web** puedes mostrar tus publicaciones en tu propio sitio (por ejemplo, gtidemexico.com) **sin programar nada**:

- **Widget embebible**: copia un `<iframe>` y pégalo en tu página. Se actualiza solo cada vez que publicas.
  ```html
  <iframe src="http://TU-SERVIDOR/widget/ID_EMPRESA" style="width:100%;border:0;min-height:520px"></iframe>
  ```
- **Feed JSON**: `http://TU-SERVIDOR/feed/ID_EMPRESA` — para consumir desde tu propio código.
- **Feed RSS**: `http://TU-SERVIDOR/feed/ID_EMPRESA/rss` — para lectores de feeds e integraciones.

Solo aparecen las publicaciones en estado **publicado** (crea contenido para la plataforma "web" o "blog", apruébalo y publícalo).

> Si tienes tu propio backend y prefieres recibir cada publicación por POST, configura `WEB_PUBLISH_WEBHOOK` con la URL de tu endpoint; el agente le enviará `{titulo, contenido, hashtags, imagenUrl}`.

> Para publicar en internet real (no solo localhost), despliega el servidor en un hosting con Node.js (Render, Railway, un VPS, etc.) y usa esa URL pública en el `<iframe>`.

## Reportes 📊

La pestaña **Reportes** muestra un tablero con:

- **Resumen** (stat tiles): empresas, contenido creado, publicadas, programadas, mensajes recibidos, sin responder y tasa de respuesta.
- **Publicaciones de los últimos 7 días** (mini gráfico de barras).
- **Publicadas por plataforma** y **estado del contenido**.
- **Mensajes por canal** y **actividad por empresa**.
- **Descargar reporte** en `.txt` con un clic.

Puedes filtrar por empresa o ver todas juntas. Las métricas de **alcance/likes** de cada red aparecerán aquí cuando conectes las cuentas (Meta, etc.).

## Autonomía (mixta, como pediste)

- **Contenido** → siempre pasa por tu aprobación antes de publicarse.
- **Respuestas a clientes** → la IA redacta, tú apruebas y envías.
- **Programar/publicar** → tú apruebas y eliges la hora; el programador lo publica solo a esa hora (automático por tarea).

## Próximos pasos sugeridos

1. Conectar WhatsApp Cloud API (lo más inmediato para atención al cliente).
2. Conectar Meta (Instagram + Facebook) para publicar de verdad.
3. Añadir un programador (cron) que publique automáticamente lo aprobado en su fecha.
4. Guardar métricas (alcance, likes, mensajes) para reportes.
