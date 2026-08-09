# 🔴 TikTok Live & Stream Notification Discord Bot

Este bot monitorea automáticamente tu canal de **TikTok** (o Twitch) y envía una notificación atractiva a tu servidor de Discord cada vez que inicies un directo.

---

## 🛠️ Requisitos Previos

- Node.js instalado (v18+).
- Una cuenta en Discord y permisos para invitar un Bot a tu servidor.

---

## 🚀 Guía de Configuración Paso a Paso

### Paso 1: Crear el Bot en Discord

1. Ve al Portal de Desarrolladores de Discord: [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Haz clic en **New Application**, dale un nombre a tu aplicación (ej: `DirectosBot`) y acepta los términos.
3. En el menú de la izquierda, ve a **Bot**.
4. Haz clic en **Reset Token** para generar y copiar el **Token de tu Bot**. *(🔒 Guardalo muy bien y no lo compartas con nadie)*.
5. *(Opcional)* Desmarca **Public Bot** si solo quieres que tú puedas añadirlo a servidores.

---

### Paso 2: Invitar el Bot a tu Servidor de Discord

1. En el portal de desarrolladores, ve a **OAuth2** -> **URL Generator** en el menú de la izquierda.
2. En **SCOPES**, selecciona `bot` y `applications.commands`.
3. En **BOT PERMISSIONS**, marca las siguientes casillas:
   - **Send Messages** (Enviar mensajes)
   - **Embed Links** (Insertar enlaces)
   - **Attach Files** (Adjuntar archivos)
   - **Mention Everyone** (Mencionar a todos - si vas a usar @everyone)
   - **Read Message History** (Leer historial de mensajes)
4. Copia la **Generated URL** que aparece abajo, pégala en tu navegador e invita al bot a tu servidor de Discord.

---

### Paso 3: Obtener el ID del Canal de Discord

1. En tu aplicación de Discord, ve a **Ajustes de Usuario** -> **Avanzado** -> activa el **Modo Desarrollador**.
2. Ve al canal donde quieres que el bot publique los avisos (ej: `#anuncios-directos`).
3. Haz clic derecho sobre el nombre del canal y selecciona **Copiar ID del canal**.

---

### Paso 4: Configurar el archivo `.env`

Abre el archivo `.env` ubicado en la carpeta del proyecto `c:\Users\Administrator\Proyectos\TiktokLiveBot\.env` y completa los datos:

```env
DISCORD_TOKEN=TU_TOKEN_DE_DISCORD_AQUI
NOTIFICATION_CHANNEL_ID=123456789012345678
STREAM_PLATFORM=tiktok
STREAMER_USERNAME=tu_usuario_de_tiktok
PING_ROLE=everyone
CHECK_INTERVAL_SECONDS=60
```

---

## ▶️ Cómo Ejecutar el Bot

Para iniciar el bot en producción:
```bash
npm start
```

Para iniciar en modo desarrollo (se reinicia automáticamente si haces cambios):
```bash
npm run dev
```

---

## 💬 Comandos Slash Disponibles

- `/status` -> Comprueba en tiempo real si el creador está en directo.
- `/test-notify` -> Envía un mensaje de aviso de prueba al canal configurado para verificar que los permisos y la apariencia estén bien.
- `/config-bot` -> Muestra la configuración activa del bot.

---

## 🎨 Características Destacadas

- **Diseño Premium:** Tarjetas embed con botones interactivos que dirigen directamente a tu directo.
- **Sin Notificaciones Repetidas:** El bot recuerda si ya envió la notificación y no volverá a notificar hasta que abras un nuevo directo.
- **Estado Dinámico:** El bot actualizará su actividad a `🔴 Directo de @tu_usuario` cuando estés transmitiendo.
