require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');

// Servidor HTTP simple para cumplir con el requisito de puerto de Render Web Service
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 TikTok Live Discord Bot está funcionando 24/7!');
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP de salud escuchando en el puerto ${PORT}`);
});
const { checkTikTokLive } = require('./checkers/tiktok');
const { checkTwitchLive } = require('./checkers/twitch');
const { createLiveEmbed } = require('./embeds/liveEmbed');

// Configuración desde .env
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const PLATFORM = (process.env.STREAM_PLATFORM || 'tiktok').toLowerCase();
const STREAMER_USERNAME = process.env.STREAMER_USERNAME || '';
const PING_ROLE = process.env.PING_ROLE || ''; // 'everyone', 'here', o ID del rol
const CHECK_INTERVAL_SECONDS = parseInt(process.env.CHECK_INTERVAL_SECONDS || '60', 10);
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';

if (!DISCORD_TOKEN) {
    console.error('❌ ERROR CRÍTICO: No se ha configurado DISCORD_TOKEN en el archivo .env');
    console.error('Por favor edita el archivo .env e ingresa tu Bot Token.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Estado en memoria para evitar notificaciones duplicadas por plataforma
let wasLiveTikTok = false;
let wasLiveTwitch = false;

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
    if (!STREAMER_USERNAME || !CHANNEL_ID) return;

    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) {
        console.warn(`[WARN] No se pudo encontrar el canal con ID ${CHANNEL_ID}`);
        return;
    }

    const checkTikTok = PLATFORM === 'tiktok' || PLATFORM === 'both' || PLATFORM === 'all';
    const checkTwitch = (PLATFORM === 'twitch' || PLATFORM === 'both' || PLATFORM === 'all') || (TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET);

    // 1. Revisar TikTok
    if (checkTikTok) {
        try {
            const tiktokInfo = await checkTikTokLive(STREAMER_USERNAME);
            if (tiktokInfo.isLive && !wasLiveTikTok) {
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
                wasLiveTikTok = true;

                client.user.setPresence({
                    activities: [{ name: `🔴 TikTok Live @${STREAMER_USERNAME}`, type: ActivityType.Streaming, url: tiktokInfo.roomLink }],
                    status: 'online'
                });
            } else if (!tiktokInfo.isLive && wasLiveTikTok) {
                console.log(`ℹ️ El directo de TikTok de @${STREAMER_USERNAME} ha finalizado.`);
                wasLiveTikTok = false;
            }
        } catch (err) {
            console.error('[TikTok Check Error]', err.message);
        }
    }

    // 2. Revisar Twitch
    if (checkTwitch && TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET) {
        try {
            const twitchInfo = await checkTwitchLive(STREAMER_USERNAME, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
            if (twitchInfo.isLive && !wasLiveTwitch) {
                console.log(`🎉 ¡DIRECTO EN TWITCH DETECTADO! Enviando alerta para ${STREAMER_USERNAME}...`);
                const payload = createLiveEmbed({
                    platform: 'twitch',
                    username: STREAMER_USERNAME,
                    title: twitchInfo.title,
                    roomLink: twitchInfo.roomLink,
                    viewerCount: twitchInfo.viewerCount,
                    coverUrl: twitchInfo.coverUrl,
                    avatarUrl: twitchInfo.avatarUrl,
                    pingRole: PING_ROLE
                });
                await channel.send(payload);
                wasLiveTwitch = true;

                client.user.setPresence({
                    activities: [{ name: `🔴 Twitch Live @${STREAMER_USERNAME}`, type: ActivityType.Streaming, url: twitchInfo.roomLink }],
                    status: 'online'
                });
            } else if (!twitchInfo.isLive && wasLiveTwitch) {
                console.log(`ℹ️ El directo de Twitch de @${STREAMER_USERNAME} ha finalizado.`);
                wasLiveTwitch = false;
            }
        } catch (err) {
            console.error('[Twitch Check Error]', err.message);
        }
    }

    // Si ninguno está en directo, mantener estado normal
    if (!wasLiveTikTok && !wasLiveTwitch) {
        client.user.setPresence({
            activities: [{ name: `👀 Monitoreando @${STREAMER_USERNAME}`, type: ActivityType.Watching }],
            status: 'online'
        });
    }
}

// Evento: Bot Listo
client.once('ready', async () => {
    console.log(`=================================================`);
    console.log(`🤖 Bot iniciado como: ${client.user.tag}`);
    console.log(`📺 Monitoreando canal de ${PLATFORM.toUpperCase()}: @${STREAMER_USERNAME || '(No configurado)'}`);
    console.log(`⏱️ Intervalo de revisión: cada ${CHECK_INTERVAL_SECONDS} segundos`);
    console.log(`=================================================`);

    // Registrar comandos Slash globales
    await registerSlashCommands(client.user.id);

    // Configurar presencia inicial
    client.user.setPresence({
        activities: [{ name: `👀 @${STREAMER_USERNAME || 'TikTok Live'}`, type: ActivityType.Watching }],
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

    const { commandName } = interaction;

    try {
        if (commandName === 'status') {
            await interaction.deferReply({ ephemeral: true });
            
            let streamInfo = { isLive: false };
            if (PLATFORM === 'tiktok') {
                streamInfo = await checkTikTokLive(STREAMER_USERNAME);
            } else if (PLATFORM === 'twitch') {
                streamInfo = await checkTwitchLive(STREAMER_USERNAME, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
            }

            const statusText = streamInfo.isLive 
                ? `🔴 **¡EN VIVO AHORA!**\nTítulo: ${streamInfo.title}\nLink: ${streamInfo.roomLink}`
                : `OFFLINE. @${STREAMER_USERNAME} no está transmitiendo en este momento.`;

            return interaction.editReply({
                content: `**Estado actual para @${STREAMER_USERNAME} (${PLATFORM.toUpperCase()}):**\n${statusText}`
            });
        }

        if (commandName === 'test-notify') {
            await interaction.deferReply({ ephemeral: true });

            if (!CHANNEL_ID) {
                return interaction.editReply({ content: '❌ El `NOTIFICATION_CHANNEL_ID` no está configurado en el archivo .env' });
            }

            const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
            if (!channel) {
                return interaction.editReply({ content: `❌ No se encontró el canal con ID \`${CHANNEL_ID}\`. Revisa los permisos del bot o el ID del canal.` });
            }

            const platformUrl = PLATFORM === 'twitch' ? `https://twitch.tv/${STREAMER_USERNAME || 'TuCanal'}` : `https://tiktok.com/@${STREAMER_USERNAME || 'TuCanal'}`;

            const testPayload = createLiveEmbed({
                platform: PLATFORM,
                username: STREAMER_USERNAME || 'TuCanalTikTok',
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
            await interaction.deferReply({ ephemeral: true });
            return interaction.editReply({
                content: `⚙️ **Configuración Actual del Bot:**\n` +
                         `• **Plataforma:** \`${PLATFORM}\` \n` +
                         `• **Usuario:** \`@${STREAMER_USERNAME || 'Sin configurar'}\` \n` +
                         `• **Canal de Notificaciones:** ${CHANNEL_ID ? `<#${CHANNEL_ID}>` : '`No configurado`'} \n` +
                         `• **Rol Ping:** \`${PING_ROLE || 'Ninguno'}\` \n` +
                         `• **Frecuencia de Check:** \`Cada ${CHECK_INTERVAL_SECONDS} segundos\``
            });
        }
    } catch (err) {
        console.error(`[Interaction Error - /${commandName}]`, err);
        const errorMessage = `❌ Error al ejecutar el comando: ${err.message}`;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMessage }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
        }
    }
});

// Iniciar sesión en Discord
client.login(DISCORD_TOKEN);
