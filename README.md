# 🔴 TikTok & Twitch Live Notification Discord Bot 24/7

Este bot monitorea automáticamente tu canal de **TikTok** y **Twitch** en simultáneo y envía una notificación atractiva a tu servidor de Discord cada vez que inicies un directo.

---

## ✨ Características Principal

- 📡 **Monitoreo Simultáneo (Dual Platform):** Revisa TikTok y Twitch al mismo tiempo.
- ⚡ **Cero Configuración Compleja en Twitch:** Funciona out-of-the-box sin necesidad de API keys de desarrollador.
- 👥 **Nombres de Usuario Independientes:** Soporta usuarios diferentes en TikTok (`STREAMER_USERNAME`) y Twitch (`TWITCH_STREAMER_USERNAME`).
- 🤖 **24/7 en Render:** Incluye servidor HTTP de salud con **Auto Keep-Alive** interno para evitar que el plan gratuito de Render apague el bot.
- 🎨 **Diseño Premium:** Tarjetas embed avanzadas con contadores de espectadores, miniatura, avatar y botones de enlace directo.
- 🔔 **Menciones Configurables:** `@everyone`, `@here` o menciones de roles específicos por ID.
- 💬 **Comandos Slash:** `/status`, `/test-notify`, `/config-bot`.

---

## 🛠️ Requisitos Previos

- Node.js (v18+).
- Cuenta en Discord y permisos de Administrador en el servidor.
- Un servicio de Hosting (ej. [Render](https://render.com)).

---

## 🚀 Guía de Configuración Paso a Paso

### 1. Crear el Bot en Discord

1. Entra a [Discord Developer Portal](https://discord.com/developers/applications).
2. Haz clic en **New Application**, asígnale un nombre (ej: `DirectosBot`).
3. Ve a **Bot** -> Haz clic en **Reset Token** y copia el **Token de tu Bot**.
4. Ve a **OAuth2** -> **URL Generator**:
   - Marca **Scopes**: `bot`, `applications.commands`.
   - Marca **Bot Permissions**: `Send Messages`, `Embed Links`, `Mention Everyone`, `Read Message History`.
5. Copia la URL generada, ábrela en tu navegador e invita al bot a tu servidor.

---

## ⚙️ Variables de Entorno (`.env`)

```env
# Token del Bot de Discord
DISCORD_TOKEN=MTUzNTg1MzEy...

# ID del Canal de Notificaciones
NOTIFICATION_CHANNEL_ID=1535850158275952670

# Modo de Plataforma: 'tiktok', 'twitch' o 'both' (ambas)
STREAM_PLATFORM=both

# Nombre de usuario en TikTok (sin @)
STREAMER_USERNAME=stoykxs

# Nombre de usuario en Twitch (sin @)
TWITCH_STREAMER_USERNAME=stoykoooooooo

# Rol a mencionar: 'everyone', 'here', o ID de rol
PING_ROLE=everyone

# Frecuencia de escaneo en segundos
CHECK_INTERVAL_SECONDS=60

# URL de tu app en Render (para Keep-Alive automático)
RENDER_EXTERNAL_URL=https://tu-app-en-render.onrender.com
```

---

## ☁️ Despliegue 24/7 en Render

1. Subes este código a tu repositorio de **GitHub**.
2. Entras a **[Render.com](https://render.com)** -> **New Web Service**.
3. Conectas tu repositorio de GitHub.
4. Configuras:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node src/index.js`
5. En la sección **Environment Variables**, agregas las variables de tu `.env`.
6. ¡Listo! Render desplegará el bot y se mantendrá activo 24/7.

---

## 💬 Comandos Slash

- `/status` -> Muestra el estado actual del directo en TikTok y Twitch.
- `/test-notify` -> Envía un mensaje de aviso de prueba al canal configurado.
- `/config-bot` -> Muestra la configuración activa del bot.
