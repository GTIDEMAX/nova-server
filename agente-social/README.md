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

## Conectar tus redes de verdad

Publicar en Instagram/Facebook/LinkedIn/TikTok o enviar por WhatsApp requiere **cuentas de empresa y tokens** de cada plataforma. Copia `.env.example` a `.env`, rellena los tokens que tengas, y completa las llamadas marcadas con `TODO` en `adapters.js`. Cada plataforma:

| Plataforma          | Qué necesitas                                   |
|---------------------|-------------------------------------------------|
| Instagram / Facebook| Meta Graph API + cuenta business (`META_ACCESS_TOKEN`) |
| LinkedIn            | LinkedIn Marketing API (`LINKEDIN_ACCESS_TOKEN`)|
| TikTok             | TikTok Content Posting API (`TIKTOK_ACCESS_TOKEN`) — requiere video |
| Web / blog         | Un webhook en tu sitio (`WEB_PUBLISH_WEBHOOK`)  |
| WhatsApp           | WhatsApp Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`) |

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

## Autonomía (mixta, como pediste)

- **Contenido** → siempre pasa por tu aprobación antes de publicarse.
- **Respuestas a clientes** → la IA redacta, tú apruebas y envías.
- **Programar/publicar** → lo decides tú por publicación.

Cuando quieras, se puede activar modo totalmente automático por tarea (por ejemplo, auto-publicar lo ya aprobado a la hora programada).

## Próximos pasos sugeridos

1. Conectar WhatsApp Cloud API (lo más inmediato para atención al cliente).
2. Conectar Meta (Instagram + Facebook) para publicar de verdad.
3. Añadir un programador (cron) que publique automáticamente lo aprobado en su fecha.
4. Guardar métricas (alcance, likes, mensajes) para reportes.
