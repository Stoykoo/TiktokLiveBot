const path = require('path');

function required(env, name) {
    const value = (env[name] || '').trim();
    if (!value) throw new Error(`Falta la variable ${name}`);
    return value;
}

function integer(env, name, fallback, min, max) {
    const raw = (env[name] || '').trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);

    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
    }
    return value;
}

function boolean(env, name, fallback) {
    const raw = (env[name] || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} debe ser true o false`);
}

function username(value) {
    return (value || '').trim().replace(/^@/, '');
}

function loadConfig(env = process.env) {
    const discordToken = required(env, 'DISCORD_TOKEN');
    const channelId = required(env, 'NOTIFICATION_CHANNEL_ID');
    if (!/^\d{17,20}$/.test(channelId)) {
        throw new Error('NOTIFICATION_CHANNEL_ID debe ser un ID válido de Discord');
    }

    const platform = (env.STREAM_PLATFORM || 'tiktok').trim().toLowerCase();
    if (!['tiktok', 'twitch', 'both'].includes(platform)) {
        throw new Error('STREAM_PLATFORM debe ser tiktok, twitch o both');
    }

    const tiktokUsername = username(env.STREAMER_USERNAME);
    const twitchUsername = username(env.TWITCH_STREAMER_USERNAME || env.STREAMER_USERNAME);
    if (tiktokUsername && !/^[a-zA-Z0-9._-]{1,64}$/.test(tiktokUsername)) {
        throw new Error('STREAMER_USERNAME contiene caracteres no válidos');
    }
    if (twitchUsername && !/^[a-zA-Z0-9._-]{1,64}$/.test(twitchUsername)) {
        throw new Error('TWITCH_STREAMER_USERNAME contiene caracteres no válidos');
    }
    const twitchClientId = (env.TWITCH_CLIENT_ID || '').trim();
    const twitchClientSecret = (env.TWITCH_CLIENT_SECRET || '').trim();
    const warnings = [];

    const wantsTikTok = platform !== 'twitch';
    const wantsTwitch = platform !== 'tiktok';
    const monitorTikTok = wantsTikTok && Boolean(tiktokUsername);
    const hasTwitchCredentials = Boolean(twitchClientId && twitchClientSecret);
    const monitorTwitch = wantsTwitch && Boolean(twitchUsername) && hasTwitchCredentials;

    if (wantsTikTok && !tiktokUsername) {
        if (platform === 'tiktok') throw new Error('Falta STREAMER_USERNAME para TikTok');
        warnings.push('TikTok desactivado: falta STREAMER_USERNAME.');
    }

    if (wantsTwitch && (!twitchUsername || !hasTwitchCredentials)) {
        if (platform === 'twitch') {
            throw new Error('Twitch requiere usuario, TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET');
        }
        warnings.push('Twitch desactivado: el monitoreo fiable requiere usuario, TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET.');
    }

    if (!monitorTikTok && !monitorTwitch) {
        throw new Error('No hay ninguna plataforma configurada para monitorear');
    }

    const pingRole = (env.PING_ROLE || '').trim().toLowerCase();
    if (pingRole && !['everyone', 'here'].includes(pingRole) && !/^\d{17,20}$/.test(pingRole)) {
        throw new Error('PING_ROLE debe estar vacío, ser everyone, here o un ID de rol');
    }

    const checkIntervalSeconds = integer(env, 'CHECK_INTERVAL_SECONDS', 60, 30, 3600);
    const liveConfirmations = integer(env, 'LIVE_CONFIRMATIONS', 2, 2, 10);
    const offlineThreshold = integer(env, 'OFFLINE_THRESHOLD', 10, 2, 120);
    const notifyCooldownMinutes = integer(env, 'NOTIFY_COOLDOWN_MINUTES', 120, 1, 1440);

    return {
        discordToken,
        channelId,
        platform,
        tiktokUsername,
        twitchUsername,
        twitchClientId,
        twitchClientSecret,
        pingRole,
        monitorTikTok,
        monitorTwitch,
        checkIntervalSeconds,
        checkIntervalMs: checkIntervalSeconds * 1000,
        liveConfirmations,
        offlineThreshold,
        notifyCooldownMinutes,
        notifyCooldownMs: notifyCooldownMinutes * 60 * 1000,
        notifyOnStartup: boolean(env, 'NOTIFY_ON_STARTUP', false),
        testNotifyCooldownSeconds: integer(env, 'TEST_NOTIFY_COOLDOWN_SECONDS', 300, 30, 3600),
        port: integer(env, 'PORT', 3000, 1, 65535),
        stateFile: path.resolve(env.STATE_FILE || path.join(__dirname, '..', 'state.json')),
        warnings
    };
}

module.exports = { loadConfig };
