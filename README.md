# Bot de directos para Discord

Monitorea una cuenta de TikTok y/o Twitch y publica como máximo un aviso por sesión de directo. Está diseñado para fallar de forma segura: una respuesta ambigua, un timeout o un reinicio no se convierten en un ping.

## Qué evita el spam

- Dos detecciones `live` consecutivas de la misma sesión antes de avisar.
- Estados separados `live`, `offline` y `unknown`; los errores nunca cuentan como offline.
- Deduplicación por `roomId` de TikTok o `stream.id` de Twitch.
- Ciclo serial: nunca hay dos comprobaciones ejecutándose al mismo tiempo.
- Estado guardado antes de enviar a Discord y nonce determinista en el mensaje.
- Arranque seguro: sin estado previo, un directo que ya estaba activo se adopta sin avisar otra vez.
- `/test-notify` requiere `Administrar servidor`, no menciona roles y tiene cooldown.

TikTok no publica una API oficial de estado de directos. El checker usa de forma conservadora los datos de sala de la página `/live`; si TikTok cambia el HTML, responde `unknown` y no envía nada. Twitch usa exclusivamente la API oficial Helix.

## Requisitos

- Node.js 20 o superior, o Docker.
- Un bot de Discord con permisos para ver el canal, enviar mensajes y adjuntar enlaces. Si `PING_ROLE` no está vacío, el rol debe ser mencionable o el bot necesita **Mencionar @everyone, @here y todos los roles**.
- Para Twitch: una aplicación en [Twitch Developers](https://dev.twitch.tv/console/apps) y sus credenciales Helix.

## Configuración

```powershell
Copy-Item .env.example .env
npm ci
npm test
npm start
```

Variables principales:

```env
DISCORD_TOKEN=tu_token
NOTIFICATION_CHANNEL_ID=123456789012345678
STREAM_PLATFORM=tiktok
STREAMER_USERNAME=tu_usuario_tiktok
TWITCH_STREAMER_USERNAME=tu_usuario_twitch
PING_ROLE=
CHECK_INTERVAL_SECONDS=60
LIVE_CONFIRMATIONS=2
OFFLINE_THRESHOLD=10
NOTIFY_COOLDOWN_MINUTES=120
NOTIFY_ON_STARTUP=false
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
```

`STREAM_PLATFORM` acepta `tiktok`, `twitch` o `both`. En modo `both`, TikTok seguirá funcionando aunque falten las credenciales de Twitch; el bot lo indicará en los logs. Mantén `NOTIFY_ON_STARTUP=false` si lo más importante es impedir avisos repetidos después de reinicios.

El cooldown es deliberadamente conservador: si empieza otra sesión dentro de `NOTIFY_COOLDOWN_MINUTES`, esa sesión completa se omite; no se manda un aviso tardío cuando vence el tiempo.

Comandos:

- `/status`: muestra el último estado confirmado sin volver a consultar al proveedor.
- `/test-notify`: prueba el canal sin hacer ping; solo administradores y una vez cada cinco minutos por defecto.
- `/config-bot`: muestra la configuración no secreta; solo administradores.

## Docker

```powershell
docker compose up -d --build
docker compose logs -f
```

Compose monta `./data` y guarda el estado en `/app/data/state.json`. `state.json` y `.env` se excluyen de la imagen para no hornear estado viejo ni secretos.

## Render

Para un bot conectado a Discord de forma continua usa una instancia de pago o un host que no duerma. Los Web Services gratuitos de Render se suspenden tras 15 minutos sin tráfico entrante y pierden los cambios del filesystem al reiniciar; un proceso suspendido no puede despertarse a sí mismo. Consulta las [limitaciones del plan gratuito](https://render.com/docs/free).

1. Crea un **Web Service** desde el repositorio y selecciona el `Dockerfile`.
2. Añade las variables de `.env` en **Environment**; no subas el archivo `.env`.
3. Configura `/healthz` como health check de Render. Usa `/readyz` solo para diagnóstico; un proveedor temporalmente caído no debe provocar un ciclo de reinicios. Consulta el comportamiento de los [health checks de Render](https://render.com/docs/health-checks).
4. Para conservar deduplicación entre despliegues, añade un [Persistent Disk](https://render.com/docs/disks) montado en `/var/data` y define `STATE_FILE=/var/data/state.json`.
5. Usa una sola instancia del servicio. Dos instancias sin almacenamiento coordinado pueden publicar por separado.

Sin disco persistente el arranque seguro sigue evitando reavisar un directo que ya estaba activo, pero puede omitir ese aviso inicial. El siguiente directo, después de observar offline, se notificará normalmente.

## Pruebas y salud

```powershell
npm test
npm audit --omit=dev
```

- `/healthz` comprueba que el proceso responde.
- `/readyz` devuelve `200` solo cuando Discord está conectado, el estado se puede guardar, el último envío no falló y cada plataforma activa tiene una comprobación válida reciente.

## Licencia

MIT
