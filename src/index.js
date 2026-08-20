require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const {
    ActivityType,
    Client,
    Events,
    GatewayIntentBits,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const { loadConfig } = require('./config');
const { checkTikTokLive } = require('./checkers/tiktok');
const { checkTwitchLive } = require('./checkers/twitch');
const { createLiveEmbed } = require('./embeds/liveEmbed');
const { applyObservation, CHECK_STATUS } = require('./liveState');
const { createPoller } = require('./poller');
const { loadState, saveState } = require('./stateStore');

function notificationNonce(platform, username, sessionId) {
    return crypto.createHash('sha256')
        .update(`${platform}:${username.toLowerCase()}:${sessionId}`)
        .digest('hex')
        .slice(0, 24);
}

async function commitTransition({ beforeState, nextState, shouldNotify, persist, send }) {
    try {
        persist(nextState);
    } catch (error) {
        return {
            state: shouldNotify ? beforeState : nextState,
            persisted: false,
            delivered: false,
            errorStage: 'persist',
            error
        };
    }

    if (!shouldNotify) {
        return { state: nextState, persisted: true, delivered: false };
    }

    try {
        await send();
        return { state: nextState, persisted: true, delivered: true };
    } catch (error) {
        return {
            state: nextState,
            persisted: true,
            delivered: false,
            errorStage: 'delivery',
            error
        };
    }
}

function buildCommands() {
    const guildOnly = command => command.setContexts(InteractionContextType.Guild);
    const adminOnly = command => guildOnly(command)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

    return [
        guildOnly(new SlashCommandBuilder()
            .setName('status')
            .setDescription('Muestra el último estado confirmado del directo.')),
        adminOnly(new SlashCommandBuilder()
            .setName('test-notify')
            .setDescription('Prueba el canal sin mencionar a nadie.')),
        adminOnly(new SlashCommandBuilder()
            .setName('config-bot')
            .setDescription('Muestra la configuración no secreta del bot.'))
    ].map(command => command.toJSON());
}

function validateNotificationChannel(channel, client, pingRole) {
    if (!channel?.guildId || !channel.isSendable?.()) {
        throw new Error('El canal configurado no es un canal de texto de servidor');
    }

    const permissions = channel.permissionsFor?.(client.user);
    const sendPermission = channel.isThread?.()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages;
    const required = [PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks];
    const missing = required.filter(permission => !permissions?.has(permission));
    if (missing.length) {
        throw new Error('Al bot le faltan permisos para ver el canal, enviar mensajes o adjuntar enlaces');
    }

    const canMentionEveryone = permissions.has(PermissionFlagsBits.MentionEveryone);
    if (['everyone', 'here'].includes(pingRole) && !canMentionEveryone) {
        throw new Error('PING_ROLE requiere el permiso Mencionar @everyone, @here y todos los roles');
    }
    if (/^\d+$/.test(pingRole)) {
        const role = channel.guild?.roles?.cache?.get(pingRole);
        if (!role) throw new Error('El rol configurado no existe en el servidor del canal');
        if (!role.mentionable && !canMentionEveryone) {
            throw new Error('El rol configurado no es mencionable por el bot');
        }
    }

    return channel;
}

async function registerSlashCommands(clientId, token) {
    try {
        const rest = new REST({ version: '10' }).setToken(token);
        await rest.put(Routes.applicationCommands(clientId), { body: buildCommands() });
        console.log('✅ Comandos slash registrados.');
    } catch (error) {
        console.error('❌ No se pudieron registrar los comandos slash:', error.message);
    }
}

function createHealthServer(client, runtime, config) {
    const staleAfterMs = Math.max(config.checkIntervalMs * 3, 180_000);

    return http.createServer((req, res) => {
        const now = Date.now();
        const monitoredPlatforms = [
            config.monitorTikTok && 'tiktok',
            config.monitorTwitch && 'twitch'
        ].filter(Boolean);
        const knownStateIsFresh = monitoredPlatforms.every(platform => {
            const checkedAt = runtime.lastKnownAt[platform];
            return checkedAt > 0 && now >= checkedAt && now - checkedAt <= staleAfterMs;
        });
        const ready = !runtime.stopping
            && client.isReady()
            && runtime.stateHealthy
            && runtime.notificationHealthy
            && knownStateIsFresh;

        let statusCode = 200;
        let body;
        if (req.url === '/healthz') {
            statusCode = runtime.stopping ? 503 : 200;
            body = { ok: statusCode === 200 };
        } else if (req.url === '/readyz') {
            statusCode = ready ? 200 : 503;
            body = {
                ready,
                discord: client.isReady(),
                state: runtime.stateHealthy,
                notifications: runtime.notificationHealthy,
                lastDeliveryErrorAt: runtime.lastDeliveryErrorAt || null,
                lastCycleAt: runtime.lastCycleAt || null,
                lastKnownAt: runtime.lastKnownAt
            };
        } else if (req.url === '/') {
            body = { service: 'discord-live-notifier', ready };
        } else {
            statusCode = 404;
            body = { error: 'not_found' };
        }

        res.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(body));
    });
}

function statusText(platform, username, state) {
    const label = platform === 'tiktok' ? 'TikTok' : 'Twitch';
    const account = `@${username}`;
    const lastCheck = state.lastCheckAt
        ? ` · <t:${Math.floor(state.lastCheckAt / 1000)}:R>`
        : '';

    if (!state.lastCheckAt || state.lastCheckAt > state.lastKnownAt || state.lastKnownAt > Date.now()) {
        const previous = state.status === CHECK_STATUS.LIVE
            ? 'el último estado confirmado era EN VIVO'
            : state.status === CHECK_STATUS.OFFLINE
                ? 'el último estado confirmado era offline'
                : 'todavía no hay una lectura válida';
        return `⚠️ **${label} (${account}):** sin confirmación actual; ${previous}${lastCheck}`;
    }
    if (state.status === CHECK_STATUS.LIVE) {
        return `🔴 **${label} (${account}):** EN VIVO${lastCheck}`;
    }
    return `⚪ **${label} (${account}):** offline${lastCheck}`;
}

async function main() {
    const config = loadConfig();
    for (const warning of config.warnings) console.warn(`⚠️ ${warning}`);

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    let appState = loadState(config.stateFile);
    let notificationChannel = null;
    let lastTestNotificationAt = 0;
    let testNotificationInFlight = false;
    const runtime = {
        lastCycleAt: 0,
        lastKnownAt: {
            tiktok: appState.tiktok.lastKnownAt,
            twitch: appState.twitch.lastKnownAt
        },
        stateHealthy: true,
        notificationHealthy: true,
        lastDeliveryErrorAt: 0,
        lastDeliveryErrorStage: null,
        stopping: false,
        unknownReasons: { tiktok: null, twitch: null }
    };

    function persistState() {
        try {
            saveState(appState, config.stateFile);
            runtime.stateHealthy = true;
            return true;
        } catch (error) {
            runtime.stateHealthy = false;
            console.error('❌ Estado no persistido; aviso bloqueado para evitar duplicados:', error.message);
            return false;
        }
    }

    // Comprueba la ruta antes de permitir cualquier aviso automático.
    persistState();

    function markNotificationFailure(stage) {
        runtime.notificationHealthy = false;
        runtime.lastDeliveryErrorAt = Date.now();
        runtime.lastDeliveryErrorStage = stage;
    }

    function markNotificationHealthy() {
        runtime.notificationHealthy = true;
        runtime.lastDeliveryErrorAt = 0;
        runtime.lastDeliveryErrorStage = null;
    }

    async function getNotificationChannel() {
        try {
            const channel = notificationChannel || await client.channels.fetch(config.channelId);
            notificationChannel = validateNotificationChannel(channel, client, config.pingRole);
            if (runtime.lastDeliveryErrorStage === 'channel') markNotificationHealthy();
            return notificationChannel;
        } catch (error) {
            notificationChannel = null;
            markNotificationFailure('channel');
            throw error;
        }
    }

    async function processObservation(platform, username, originalInfo, checkedAt, channel) {
        const now = Date.now();
        const confirmationWindowMs = config.checkIntervalMs * 3;
        const info = checkedAt > now || now - checkedAt > confirmationWindowMs
            ? { status: CHECK_STATUS.UNKNOWN, isLive: false, error: true, reason: 'stale-result' }
            : originalInfo;
        const beforeAppState = appState;
        const before = beforeAppState[platform];
        const transition = applyObservation(before, {
            ...info,
            username,
            checkedAt
        }, {
            liveThreshold: config.liveConfirmations,
            offlineThreshold: config.offlineThreshold,
            confirmationWindowMs,
            cooldownMs: config.notifyCooldownMs,
            notifyOnStartup: config.notifyOnStartup
        });

        const nextAppState = { ...beforeAppState, [platform]: transition.state };
        if (info.status !== CHECK_STATUS.UNKNOWN) {
            runtime.lastKnownAt[platform] = transition.state.lastKnownAt;
            runtime.unknownReasons[platform] = null;
        } else if (runtime.unknownReasons[platform] !== info.reason) {
            runtime.unknownReasons[platform] = info.reason;
            console.warn(`⚠️ ${platform}: lectura desconocida (${info.reason || 'sin detalle'}); no cambia el estado.`);
        }

        let send = async () => {};
        if (transition.shouldNotify) {
            let payload;
            let nonce;
            try {
                payload = createLiveEmbed({
                    platform,
                    username,
                    title: info.title,
                    roomLink: info.roomLink,
                    viewerCount: info.viewerCount,
                    coverUrl: info.coverUrl,
                    avatarUrl: info.avatarUrl,
                    pingRole: config.pingRole
                });
                nonce = notificationNonce(platform, username, info.sessionId);
            } catch (error) {
                markNotificationFailure('payload');
                console.error(`❌ No se pudo construir el aviso de ${platform}; la reserva se revirtió:`, error.message);
                return;
            }
            send = () => channel.send({ ...payload, nonce, enforceNonce: true });
        }

        const outcome = await commitTransition({
            beforeState: beforeAppState,
            nextState: nextAppState,
            shouldNotify: transition.shouldNotify,
            persist: state => saveState(state, config.stateFile),
            send
        });
        appState = outcome.state;
        runtime.stateHealthy = outcome.persisted;

        if (outcome.errorStage === 'persist') {
            console.error('❌ Estado no persistido; la reserva se revirtió y no se envió nada:', outcome.error.message);
            return;
        }
        if (before.status !== appState[platform].status) {
            console.log(`ℹ️ ${platform} @${username}: ${before.status} → ${appState[platform].status}`);
        }
        if (!transition.shouldNotify) return;

        if (outcome.delivered) {
            markNotificationHealthy();
            console.log(`🎉 Aviso enviado: ${platform} @${username}, sesión ${info.sessionId}.`);
        } else {
            markNotificationFailure('delivery');
            notificationChannel = null;
            // La reserva queda guardada: preferimos omitir un aviso a duplicarlo tras un timeout ambiguo.
            console.error(`❌ Discord no confirmó el aviso de ${platform}; no se reintentará esta sesión:`, outcome.error.message);
        }
    }

    function updatePresence() {
        if (!client.isReady()) return;
        const staleAfterMs = Math.max(config.checkIntervalMs * 3, 180_000);
        const now = Date.now();
        const freshLive = (platform) => appState[platform].status === CHECK_STATUS.LIVE
            && appState[platform].lastKnownAt > 0
            && now >= appState[platform].lastKnownAt
            && now - appState[platform].lastKnownAt <= staleAfterMs;

        if (config.monitorTikTok && freshLive('tiktok')) {
            client.user.setPresence({
                activities: [{
                    name: `TikTok Live @${config.tiktokUsername}`,
                    type: ActivityType.Streaming,
                    url: `https://www.tiktok.com/@${config.tiktokUsername}/live`
                }],
                status: 'online'
            });
        } else if (config.monitorTwitch && freshLive('twitch')) {
            client.user.setPresence({
                activities: [{
                    name: `Twitch Live @${config.twitchUsername}`,
                    type: ActivityType.Streaming,
                    url: `https://twitch.tv/${config.twitchUsername}`
                }],
                status: 'online'
            });
        } else {
            client.user.setPresence({
                activities: [{ name: 'directos', type: ActivityType.Watching }],
                status: 'online'
            });
        }
    }

    async function runCycle() {
        try {
            const channel = await getNotificationChannel();
            const checks = [];
            if (config.monitorTikTok) {
                checks.push({
                    platform: 'tiktok',
                    username: config.tiktokUsername,
                    promise: checkTikTokLive(config.tiktokUsername)
                });
            }
            if (config.monitorTwitch) {
                checks.push({
                    platform: 'twitch',
                    username: config.twitchUsername,
                    promise: checkTwitchLive(
                        config.twitchUsername,
                        config.twitchClientId,
                        config.twitchClientSecret
                    )
                });
            }

            const results = await Promise.all(checks.map(async check => {
                try {
                    const info = await check.promise;
                    return { ...check, info, checkedAt: Date.now() };
                } catch (error) {
                    return {
                        ...check,
                        checkedAt: Date.now(),
                        info: { status: CHECK_STATUS.UNKNOWN, isLive: false, error: true, reason: error.message }
                    };
                }
            }));
            for (const result of results) {
                await processObservation(result.platform, result.username, result.info, result.checkedAt, channel);
            }
            updatePresence();
        } finally {
            runtime.lastCycleAt = Date.now();
        }
    }

    const poller = createPoller(
        runCycle,
        config.checkIntervalMs,
        error => console.error('❌ Falló el ciclo de comprobación:', error.message)
    );
    const server = createHealthServer(client, runtime, config);

    async function handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('❌ No se pudo responder a una interacción:', error.message);
            return;
        }

        const adminCommand = interaction.commandName === 'test-notify'
            || interaction.commandName === 'config-bot';
        if (adminCommand && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.editReply('❌ Necesitas el permiso **Administrar servidor**.').catch(error => {
                console.error('❌ No se pudo enviar el rechazo de permisos:', error.message);
            });
            return;
        }

        try {
            const configuredChannel = await getNotificationChannel();
            if (interaction.guildId !== configuredChannel.guildId) {
                await interaction.editReply('❌ Este bot no está configurado para este servidor.');
                return;
            }

            if (interaction.commandName === 'status') {
                const lines = [];
                if (config.monitorTikTok) {
                    lines.push(statusText('tiktok', config.tiktokUsername, appState.tiktok));
                }
                if (config.monitorTwitch) {
                    lines.push(statusText('twitch', config.twitchUsername, appState.twitch));
                }
                await interaction.editReply(`**Estado del bot**\n\n${lines.join('\n\n')}`);
                return;
            }

            if (interaction.commandName === 'test-notify') {
                const now = Date.now();
                const cooldownMs = config.testNotifyCooldownSeconds * 1000;
                if (now - lastTestNotificationAt < cooldownMs) {
                    const remaining = Math.ceil((cooldownMs - (now - lastTestNotificationAt)) / 1000);
                    await interaction.editReply(`⏳ Espera ${remaining}s antes de repetir la prueba.`);
                    return;
                }
                if (testNotificationInFlight) {
                    await interaction.editReply('⏳ Ya hay una prueba en curso.');
                    return;
                }
                testNotificationInFlight = true;

                const platform = config.monitorTikTok ? 'tiktok' : 'twitch';
                const username = platform === 'tiktok' ? config.tiktokUsername : config.twitchUsername;
                const roomLink = platform === 'tiktok'
                    ? `https://www.tiktok.com/@${username}/live`
                    : `https://twitch.tv/${username}`;
                try {
                    const payload = createLiveEmbed({
                        platform,
                        username,
                        title: 'Prueba de notificación (sin ping)',
                        roomLink,
                        viewerCount: 0,
                        avatarUrl: client.user.displayAvatarURL(),
                        pingRole: ''
                    });
                    await configuredChannel.send({
                        ...payload,
                        nonce: notificationNonce('test', username, String(now)),
                        enforceNonce: true
                    });
                    lastTestNotificationAt = Date.now();
                    markNotificationHealthy();
                } catch (error) {
                    notificationChannel = null;
                    markNotificationFailure('test');
                    throw error;
                } finally {
                    testNotificationInFlight = false;
                }
                await interaction.editReply(`✅ Prueba enviada a <#${config.channelId}> sin mencionar a nadie.`);
                return;
            }

            if (interaction.commandName === 'config-bot') {
                const platforms = [config.monitorTikTok && 'TikTok', config.monitorTwitch && 'Twitch']
                    .filter(Boolean)
                    .join(' + ');
                await interaction.editReply(
                    `⚙️ **Configuración**\n` +
                    `• Plataformas activas: \`${platforms}\`\n` +
                    `• TikTok: \`${config.monitorTikTok ? `@${config.tiktokUsername}` : 'desactivado'}\`\n` +
                    `• Twitch: \`${config.monitorTwitch ? `@${config.twitchUsername}` : 'desactivado'}\`\n` +
                    `• Canal: <#${config.channelId}>\n` +
                    `• Positivos requeridos: \`${config.liveConfirmations}\`\n` +
                    `• Intervalo: \`${config.checkIntervalSeconds}s\`\n` +
                    `• Avisar al arrancar: \`${config.notifyOnStartup}\``
                );
            }
        } catch (error) {
            console.error(`❌ Error en /${interaction.commandName}:`, error.message);
            await interaction.editReply(`❌ No se pudo completar el comando: ${error.message}`).catch(() => {});
        }
    }

    client.once(Events.ClientReady, readyClient => {
        console.log(`🤖 Conectado como ${readyClient.user.tag}.`);
        console.log(`⏱️ Comprobación serial cada ${config.checkIntervalSeconds}s; ${config.liveConfirmations} positivos para avisar.`);
        updatePresence();
        poller.start();
        registerSlashCommands(readyClient.user.id, config.discordToken);
    });
    client.on(Events.InteractionCreate, handleInteraction);

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, '0.0.0.0', resolve);
    });
    console.log(`🌐 Salud HTTP en el puerto ${config.port}.`);

    async function shutdown(signal) {
        if (runtime.stopping) return;
        runtime.stopping = true;
        console.log(`🛑 ${signal}: cerrando de forma segura...`);
        await poller.stop();
        persistState();
        client.destroy();
        await new Promise(resolve => server.close(resolve));
    }

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));

    try {
        await client.login(config.discordToken);
    } catch (error) {
        await shutdown('LOGIN_ERROR');
        throw error;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error fatal:', error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    notificationNonce,
    commitTransition,
    createHealthServer,
    statusText,
    buildCommands,
    validateNotificationChannel
};
