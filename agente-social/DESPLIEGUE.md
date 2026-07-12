# 🚀 Cómo desplegar tu Agente Social en internet (paso a paso)

Al terminar tendrás un **link** (ej. `https://agente-social.onrender.com`) que abres desde tu celular, y el agente funcionará **24/7**.

Usaremos **Render** porque tiene plan **gratis** y se conecta directo a tu GitHub (que ya está listo).

---

## Antes de empezar necesitas
- Tu cuenta de **GitHub** (donde ya está el código: `GTIDEMAX/nova-server`).
- 15 minutos.

---

## Pasos

### 1) Crea una cuenta en Render
- Entra a **https://render.com** y pulsa **Get Started**.
- Elige **"Sign in with GitHub"** (inicia sesión con GitHub). Así se conecta solo.

### 2) Autoriza el repositorio
- Render te pedirá permiso para ver tus repositorios.
- Autoriza el repositorio **nova-server** (o "todos", como prefieras).

### 3) Crea el servicio con el blueprint
- En Render, pulsa **New +** (arriba a la derecha) → **Blueprint**.
- Selecciona el repositorio **nova-server**.
- En la rama (branch), elige **`claude/hola-ngr9y5`**.
- Render detectará el archivo `render.yaml` y te mostrará el servicio **agente-social**. Pulsa **Apply**.

> Si no ves "Blueprint", usa **New + → Web Service**, elige el repo y la rama `claude/hola-ngr9y5`, y pon:
> - **Root Directory:** `agente-social`
> - **Build Command:** `npm install`
> - **Start Command:** `npm start`

### 4) (Opcional) Pon tus credenciales
En la sección **Environment** del servicio puedes agregar tus claves (si aún no las tienes, déjalo así y funcionará en **modo demo**):
- `ANTHROPIC_API_KEY` → para textos reales con IA (Claude).
- `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID` → Instagram + Facebook.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` → WhatsApp.

Puedes agregarlas ahora o después (cada vez que guardas, se vuelve a desplegar solo).

### 5) Espera el despliegue
- Render instalará y arrancará el agente (2–4 min).
- Cuando diga **Live**, verás tu link arriba: algo como
  **`https://agente-social.onrender.com`**
- ¡Ábrelo desde tu celular! 🎉

---

## Después de desplegar

### Conectar tu web (gtidemexico.com)
En la pestaña **Mi web** del panel, ahora el código del `<iframe>` usará tu link real de Render en vez de `localhost`. Copia ese código y pégalo en tu página.

### Conectar el webhook de WhatsApp
En el panel de Meta (WhatsApp → Configuración → Webhooks) pon:
- **URL de callback:** `https://TU-LINK.onrender.com/webhook/whatsapp`
- **Token de verificación:** el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`.

---

## Cosas que debes saber del plan GRATIS
- **Se "duerme" tras 15 min sin uso** y tarda ~30 seg en despertar en la siguiente visita. Para un negocio activo esto se nota (el programador no publica mientras duerme y el primer mensaje de WhatsApp puede tardar).
- **Los datos se reinician** al reiniciar/re-desplegar (no hay disco permanente en el plan gratis).

### Para uso real (recomendado cuando ya lo uses con clientes)
- Sube al plan **Starter** de Render (~7 USD/mes): siempre encendido, sin dormir.
- Agrega un **disco persistente** y define la variable `DATA_FILE=/var/data/data.json` para que tus datos **no se borren**.
- Más adelante se puede cambiar el guardado por una base de datos.

---

¿Dudas en algún paso? Pídeme y te explico esa parte con más detalle.
