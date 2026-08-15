require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActivityType, MessageFlags } = require('discord.js');
const { checkTikTokLive } = require('./checkers/tiktok');
const { checkTwitchLive } = require('./checkers/twitch');
const { createLiveEmbed } = require('./embeds/liveEmbed');
const { loadState, saveState } = require('./stateStore');

// Servidor HTTP simple para cumplir con el requisito de puerto de Render Web Service y Keep-Alive
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL || 'https://tiktoklivebot-6jcs.onrender.com';

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 TikTok Live Discord Bot está funcionando 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP de salud escuchando en el puerto ${PORT}`);
    
    // Auto Keep-Alive: Ping cada 5 minutos para evitar que Render apague la instancia por inactividad
    if (RENDER_URL) {
        setInterval(() => {
            const httpModule = RENDER_URL.startsWith('https') ? require('https') : require('http');
            httpModule.get(RENDER_URL, (res) => {
                console.log(`📡 Keep-Alive Ping enviado a ${RENDER_URL} (Status: ${res.statusCode})`);
            }).on('error', (err) => {
                console.warn(`⚠️ Warning en Keep-Alive Ping: ${err.message}`);
            });
        }, 5 * 60 * 1000);
    }
});

// Configuración desde .env
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const PLATFORM = (process.env.STREAM_PLATFORM || 'tiktok').toLowerCase();
const STREAMER_USERNAME = process.env.STREAMER_USERNAME || '';
const TWITCH_STREAMER_USERNAME = process.env.TWITCH_STREAMER_USERNAME || STREAMER_USERNAME;
const PING_ROLE = process.env.PING_ROLE || ''; // 'everyone', 'here', o ID del rol
const CHECK_INTERVAL_SECONDS = parseInt(process.env.CHECK_INTERVAL_SECONDS || '60', 10);
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';

// Parámetros de protección contra spam y flapping
const OFFLINE_THRESHOLD = 3; // Requiere 3 revisiones offline seguidas antes de marcar finalizado
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000; // Cooldown mínimo de 15 minutos entre avisos

if (!DISCORD_TOKEN) {
    console.error('❌ ERROR CRÍTICO: No se ha configurado DISCORD_TOKEN en el archivo .env');
    console.error('Por favor edita el archivo .env e ingresa tu Bot Token.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Estado persistente en disco/memoria para evitar pings repetidos por reinicios de servidor o flapping
let appState = loadState();

// Registro de comandos Slash
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Muestra el estado actual del directo y del bot.'),
    new SlashCommandBuilder()
        .setName('test-notify')
        .setDescription('Envía una notificación de prueba al canal configurado.'),
    new SlashCommandBuilder()
        .setName('config-bot')
        .setDescription('Muestra la configuración actual del bot.')
].map(cmd => cmd.toJSON());

async function registerSlashCommands(clientId) {
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
        console.log('🔄 Registrando comandos Slash...');
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );
        console.log('✅ Comandos Slash registrados correctamente.');
    } catch (err) {
        console.error('❌ Error registrando comandos Slash:', err.message);
    }
}

// Función principal de verificación de directo (Soporta TikTok y Twitch simultáneamente)
async function checkStreamStatus() {
    if (!CHANNEL_ID) return;

    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) {
        console.warn(`[WARN] No se pudo encontrar el canal con ID ${CHANNEL_ID}`);
        return;
    }

    const checkTikTok = Boolean(STREAMER_USERNAME) && PLATFORM !== 'twitch';
    const checkTwitch = Boolean(TWITCH_STREAMER_USERNAME) && PLATFORM !== 'tiktok';
    const now = Date.now();

    // 1. Revisar TikTok
    if (checkTikTok) {
        try {
            const tiktokInfo = await checkTikTokLive(STREAMER_USERNAME);
            appState.tiktok.lastCheckAt = now;

            if (tiktokInfo.isLive) {
                appState.tiktok.consecutiveOfflineCount = 0;
                const timeSinceLastNotify = now - (appState.tiktok.lastNotifiedAt || 0);

                if (!appState.tiktok.isLive) {
                    if (timeSinceLastNotify >= NOTIFY_COOLDOWN_MS) {
                        console.log(`🎉 ¡DIRECTO EN TIKTOK DETECTADO! Enviando alerta para @${STREAMER_USERNAME}...`);
                        const payload = createLiveEmbed({
                            platform: 'tiktok',
                            username: STREAMER_USERNAME,
                            title: tiktokInfo.title,
                            roomLink: tiktokInfo.roomLink,
                            viewerCount: tiktokInfo.viewerCount,
                            coverUrl: tiktokInfo.coverUrl,
                            avatarUrl: tiktokInfo.avatarUrl,
                            pingRole: PING_ROLE
                        });
                        await channel.send(payload);
                        appState.tiktok.lastNotifiedAt = now;
                        appState.tiktok.isLive = true;
                        saveState(appState);
                    } else {
                        console.log(`⏳ Directo en TikTok detectado para @${STREAMER_USERNAME}, pero omitido aviso por Cooldown (${Math.round(timeSinceLastNotify / 60000)}m desde el último).`);
                        appState.tiktok.isLive = true;
                        saveState(appState);
                    }
                }
            } else if (!tiktokInfo.error) {
                if (appState.tiktok.isLive) {
                    appState.tiktok.consecutiveOfflineCount = (appState.tiktok.consecutiveOfflineCount || 0) + 1;
                    console.log(`ℹ️ TikTok check reportó offline. Consecutivos: ${appState.tiktok.consecutiveOfflineCount}/${OFFLINE_THRESHOLD}`);
                    if (appState.tiktok.consecutiveOfflineCount >= OFFLINE_THRESHOLD) {
                        console.log(`ℹ️ El directo de TikTok de @${STREAMER_USERNAME} ha finalizado.`);
                        appState.tiktok.isLive = false;
                        appState.tiktok.consecutiveOfflineCount = 0;
                        saveState(appState);
                    }
                }
            } else {
                console.warn(`⚠️ Omitiendo cambio de estado de TikTok por error puntual de conexión.`);
            }
        } catch (err) {
            console.error('[TikTok Check Error]', err.message);
        }
    }

    // 2. Revisar Twitch
    if (checkTwitch) {
        try {
            const twitchInfo = await checkTwitchLive(TWITCH_STREAMER_USERNAME, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
            appState.twitch.lastCheckAt = now;

            if (twitchInfo.isLive) {
                appState.twitch.consecutiveOfflineCount = 0;
                const timeSinceLastNotify = now - (appState.twitch.lastNotifiedAt || 0);

                if (!appState.twitch.isLive) {
                    if (timeSinceLastNotify >= NOTIFY_COOLDOWN_MS) {
                        console.log(`🎉 ¡DIRECTO EN TWITCH DETECTADO! Enviando alerta para ${TWITCH_STREAMER_USERNAME}...`);
                        const payload = createLiveEmbed({
                            platform: 'twitch',
                            username: TWITCH_STREAMER_USERNAME,
                            title: twitchInfo.title,
                            roomLink: twitchInfo.roomLink,
                            viewerCount: twitchInfo.viewerCount,
                            coverUrl: twitchInfo.coverUrl,
                            avatarUrl: twitchInfo.avatarUrl,
                            pingRole: PING_ROLE
                        });
                        await channel.send(payload);
                        appState.twitch.lastNotifiedAt = now;
                        appState.twitch.isLive = true;
                        saveState(appState);
                    } else {
                        console.log(`⏳ Directo en Twitch detectado para @${TWITCH_STREAMER_USERNAME}, pero omitido por Cooldown.`);
                        appState.twitch.isLive = true;
                        saveState(appState);
                    }
                }
            } else if (!twitchInfo.error) {
                if (appState.twitch.isLive) {
                    appState.twitch.consecutiveOfflineCount = (appState.twitch.consecutiveOfflineCount || 0) + 1;
                    console.log(`ℹ️ Twitch check reportó offline. Consecutivos: ${appState.twitch.consecutiveOfflineCount}/${OFFLINE_THRESHOLD}`);
                    if (appState.twitch.consecutiveOfflineCount >= OFFLINE_THRESHOLD) {
                        console.log(`ℹ️ El directo de Twitch de @${TWITCH_STREAMER_USERNAME} ha finalizado.`);
                        appState.twitch.isLive = false;
                        appState.twitch.consecutiveOfflineCount = 0;
                        saveState(appState);
                    }
                }
            } else {
                console.warn(`⚠️ Omitiendo cambio de estado de Twitch por error puntual de conexión.`);
            }
        } catch (err) {
            console.error('[Twitch Check Error]', err.message);
        }
    }

    // Actualizar presencia de Discord según el estado persistente
    if (appState.tiktok.isLive) {
        client.user.setPresence({
            activities: [{ name: `🔴 TikTok Live @${STREAMER_USERNAME}`, type: ActivityType.Streaming, url: `https://www.tiktok.com/@${STREAMER_USERNAME}/live` }],
            status: 'online'
        });
    } else if (appState.twitch.isLive) {
        client.user.setPresence({
            activities: [{ name: `🔴 Twitch Live @${TWITCH_STREAMER_USERNAME}`, type: ActivityType.Streaming, url: `https://twitch.tv/${TWITCH_STREAMER_USERNAME}` }],
            status: 'online'
        });
    } else {
        client.user.setPresence({
            activities: [{ name: `👀 Monitoreando @${STREAMER_USERNAME || TWITCH_STREAMER_USERNAME}`, type: ActivityType.Watching }],
            status: 'online'
        });
    }
}

// Evento: Bot Listo
client.once('ready', async () => {
    console.log(`=================================================`);
    console.log(`🤖 Bot iniciado como: ${client.user.tag}`);
    console.log(`📺 Modo Plataforma: ${PLATFORM.toUpperCase()}`);
    console.log(`🎵 TikTok Username: @${STREAMER_USERNAME || '(No configurado)'}`);
    console.log(`💜 Twitch Username: @${TWITCH_STREAMER_USERNAME || '(No configurado)'}`);
    console.log(`⏱️ Intervalo de revisión: cada ${CHECK_INTERVAL_SECONDS} segundos`);
    console.log(`=================================================`);

    // Registrar comandos Slash globales
    await registerSlashCommands(client.user.id);

    // Configurar presencia inicial
    client.user.setPresence({
        activities: [{ name: `👀 Monitoreando directos`, type: ActivityType.Watching }],
        status: 'online'
    });

    // Primera verificación inmediata
    checkStreamStatus();

    // Iniciar bucle periódico
    setInterval(checkStreamStatus, CHECK_INTERVAL_SECONDS * 1000);
});

// Manejo de Interacciones (Comandos Slash)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('[Interaction Defer Error]', err.message);
        return;
    }

    const { commandName } = interaction;

    try {
        if (commandName === 'status') {
            const checkTikTok = Boolean(STREAMER_USERNAME) && PLATFORM !== 'twitch';
            const checkTwitch = Boolean(TWITCH_STREAMER_USERNAME) && PLATFORM !== 'tiktok';

            const results = [];

            if (checkTikTok) {
                const tiktokInfo = await checkTikTokLive(STREAMER_USERNAME);
                results.push(tiktokInfo.isLive
                    ? `🔴 **TikTok (@${STREAMER_USERNAME}):** ¡EN VIVO!\n*${tiktokInfo.title}*\n${tiktokInfo.roomLink}`
                    : `⚪ **TikTok (@${STREAMER_USERNAME}):** Offline`);
            }

            if (checkTwitch) {
                const twitchInfo = await checkTwitchLive(TWITCH_STREAMER_USERNAME, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
                results.push(twitchInfo.isLive
                    ? `🔴 **Twitch (@${TWITCH_STREAMER_USERNAME}):** ¡EN VIVO!\n*${twitchInfo.title}*\n${twitchInfo.roomLink}`
                    : `⚪ **Twitch (@${TWITCH_STREAMER_USERNAME}):** Offline`);
            }

            if (results.length === 0) {
                results.push('⚠️ No se ha configurado ningún usuario o plataforma válida.');
            }

            const headerPlatform = (checkTikTok && checkTwitch) ? 'TIKTOK & TWITCH' : (checkTwitch ? 'TWITCH' : 'TIKTOK');

            return interaction.editReply({
                content: `**Estado actual de Directos (${headerPlatform}):**\n\n` + results.join('\n\n')
            });
        }

        if (commandName === 'test-notify') {
            if (!CHANNEL_ID) {
                return interaction.editReply({ content: '❌ El `NOTIFICATION_CHANNEL_ID` no está configurado en el archivo .env' });
            }

            const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
            if (!channel) {
                return interaction.editReply({ content: `❌ No se encontró el canal con ID \`${CHANNEL_ID}\`. Revisa los permisos del bot o el ID del canal.` });
            }

            const testPlatform = PLATFORM === 'twitch' ? 'twitch' : 'tiktok';
            const testUser = testPlatform === 'twitch' ? TWITCH_STREAMER_USERNAME : STREAMER_USERNAME;
            const platformUrl = testPlatform === 'twitch' ? `https://twitch.tv/${testUser}` : `https://tiktok.com/@${testUser}`;

            const testPayload = createLiveEmbed({
                platform: testPlatform,
                username: testUser || 'TuCanal',
                title: '🎮 ¡ESTA ES UNA PRUEBA DE NOTIFICACIÓN DE DIRECTO!',
                roomLink: platformUrl,
                viewerCount: 123,
                coverUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1000&auto=format&fit=crop',
                avatarUrl: client.user.displayAvatarURL(),
                pingRole: PING_ROLE
            });

            await channel.send(testPayload);
            return interaction.editReply({ content: `✅ Notificación de prueba enviada con éxito al canal <#${CHANNEL_ID}>.` });
        }

        if (commandName === 'config-bot') {
            return interaction.editReply({
                content: `⚙️ **Configuración Actual del Bot:**\n` +
                         `• **Plataforma:** \`${PLATFORM}\` \n` +
                         `• **Usuario TikTok:** \`@${STREAMER_USERNAME || 'Sin configurar'}\` \n` +
                         `• **Usuario Twitch:** \`@${TWITCH_STREAMER_USERNAME || 'Sin configurar'}\` \n` +
                         `• **Canal de Notificaciones:** ${CHANNEL_ID ? `<#${CHANNEL_ID}>` : '`No configurado`'} \n` +
                         `• **Rol Ping:** \`${PING_ROLE || 'Ninguno'}\` \n` +
                         `• **Frecuencia de Check:** \`Cada ${CHECK_INTERVAL_SECONDS} segundos\``
            });
        }
    } catch (err) {
        console.error(`[Interaction Error - /${commandName}]`, err);
        await interaction.editReply({ content: `❌ Error al ejecutar el comando: ${err.message}` }).catch(() => {});
    }
});

// Iniciar sesión en Discord
client.login(DISCORD_TOKEN);
