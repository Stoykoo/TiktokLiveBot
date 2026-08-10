# 🔴 TikTok & Twitch Live Notification Discord Bot 24/7

Este bot monitorea automáticamente tu canal de **TikTok** y **Twitch** en simultáneo y envía una notificación atractiva a tu servidor de Discord cada vez que inicies un directo.

---

## ✨ Características Principales

- 📡 **Monitoreo Simultáneo (Dual Platform):** Revisa TikTok y Twitch al mismo tiempo.
- ⚡ **Cero Configuración Compleja en Twitch:** Funciona out-of-the-box sin necesidad de API keys de desarrollador.
- 👥 **Nombres de Usuario Independientes:** Soporta usuarios diferentes en TikTok (`STREAMER_USERNAME`) y Twitch (`TWITCH_STREAMER_USERNAME`).
- 🐳 **Soporte Completo para Docker:** Incluye `Dockerfile` y `docker-compose.yml` preconfigurados para despliegues portables y aislados.
- 🤖 **24/7 en Render / VPS:** Incluye servidor HTTP de salud con **Auto Keep-Alive** interno para evitar que el plan gratuito de Render apague el bot.
- 🎨 **Diseño Premium:** Tarjetas embed avanzadas con contadores de espectadores, miniatura, avatar y botones de enlace directo.
- 🔔 **Menciones Configurables:** `@everyone`, `@here` o menciones de roles específicos por ID.
- 💬 **Comandos Slash:** `/status`, `/test-notify`, `/config-bot`.

---

## 🛠️ Requisitos Previos

- Node.js (v18+) o **Docker**.
- Cuenta en Discord y permisos de Administrador en el servidor.
- Un servicio de Hosting (ej. [Render](https://render.com), Railway, VPS).

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

## 🐳 Ejecución con Docker (Recomendado)

### Opción A: Usando Docker Compose
```bash
# Iniciar el bot en segundo plano
docker compose up -d

# Ver los logs en tiempo real
docker compose logs -f

# Detener el bot
docker compose down
```

### Opción B: Usando Docker CLI
```bash
# Construir la imagen
docker build -t tiktok-live-bot .

# Ejecutar el contenedor
docker run -d --name tiktok_bot --env-file .env -p 3000:3000 tiktok-live-bot
```

---

## ☁️ Despliegue 24/7 en Render

1. Subes este código a tu repositorio de **GitHub**.
2. Entras a **[Render.com](https://render.com)** -> **New Web Service**.
3. Conectas tu repositorio de GitHub.
4. Render detectará automáticamente el `Dockerfile` (o puedes elegir `Node`).
5. En la sección **Environment Variables**, agregas las variables de tu `.env`.
6. ¡Listo! Render desplegará el bot usando Docker y se mantendrá activo 24/7.

---

## 💬 Comandos Slash

- `/status` -> Muestra el estado actual del directo en TikTok y Twitch.
- `/test-notify` -> Envía un mensaje de aviso de prueba al canal configurado.
- `/config-bot` -> Muestra la configuración activa del bot.

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para obtener más detalles.

