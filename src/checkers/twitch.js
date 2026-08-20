const axios = require('axios');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const REQUEST_TIMEOUT_MS = 8000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const tokenCache = new Map();

const unknown = (reason) => ({ status: 'unknown', isLive: false, error: true, reason });

function clearCachedToken(clientId) {
    if (clientId === undefined) tokenCache.clear();
    else tokenCache.delete(clientId);
}

async function getTwitchAppToken(clientId, clientSecret, options = {}) {
    const http = options.http || axios;
    const now = options.now || Date.now;
    const timeout = options.timeout || REQUEST_TIMEOUT_MS;
    const cached = tokenCache.get(clientId);

    if (cached && now() < cached.expiresAt) return cached.token;

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    });
    const response = await http.post(TOKEN_URL, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout
    });
    const token = response?.data?.access_token;
    const expiresInMs = Number(response?.data?.expires_in) * 1000;

    if (typeof token !== 'string' || !token.trim() || !Number.isFinite(expiresInMs) || expiresInMs <= 0) {
        throw new Error('invalid_oauth_response');
    }

    tokenCache.set(clientId, {
        token,
        expiresAt: now() + Math.max(0, expiresInMs - TOKEN_EXPIRY_MARGIN_MS)
    });
    return token;
}

function parseStreamResponse(response, username) {
    const streams = response?.data?.data;
    if (!Array.isArray(streams)) return unknown('invalid_helix_response');
    if (streams.length === 0) return { status: 'offline', isLive: false };
    if (streams.length !== 1) return unknown('invalid_helix_response');

    const stream = streams[0];
    if (!stream || typeof stream !== 'object' || Array.isArray(stream) ||
        stream.type !== 'live' || typeof stream.id !== 'string' || !stream.id.trim() ||
        typeof stream.user_login !== 'string' || stream.user_login.toLowerCase() !== username.toLowerCase()) {
        return unknown('invalid_stream');
    }

    const thumbnail = typeof stream.thumbnail_url === 'string'
        ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')
        : null;

    return {
        status: 'live',
        isLive: true,
        sessionId: stream.id.trim(),
        title: stream.title,
        gameName: stream.game_name,
        viewerCount: stream.viewer_count,
        roomLink: `https://twitch.tv/${username}`,
        coverUrl: thumbnail,
        avatarUrl: null
    };
}

async function checkTwitchLive(username, clientId, clientSecret, options = {}) {
    const cleanUser = String(username || '').trim().toLowerCase().replace(/^@/, '');
    const cleanClientId = String(clientId || '').trim();
    const cleanClientSecret = String(clientSecret || '').trim();
    if (!cleanUser) return unknown('missing_username');
    if (!cleanClientId || !cleanClientSecret) return unknown('missing_credentials');

    const http = options.http || axios;
    const requestOptions = { ...options, http };
    const timeout = options.timeout || REQUEST_TIMEOUT_MS;
    let token;

    try {
        token = await getTwitchAppToken(cleanClientId, cleanClientSecret, requestOptions);
    } catch {
        return unknown('oauth_failed');
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
            response = await http.get(STREAMS_URL, {
                params: { user_login: cleanUser },
                headers: {
                    'Client-ID': cleanClientId,
                    Authorization: `Bearer ${token}`
                },
                timeout
            });
        } catch (error) {
            if (error?.response?.status !== 401) return unknown('helix_failed');
            response = error.response;
        }

        if (response?.status !== 401) return parseStreamResponse(response, cleanUser);
        clearCachedToken(cleanClientId);
        if (attempt === 1) return unknown('helix_unauthorized');

        try {
            token = await getTwitchAppToken(cleanClientId, cleanClientSecret, requestOptions);
        } catch {
            return unknown('oauth_failed');
        }
    }

    return unknown('helix_failed');
}

module.exports = { checkTwitchLive, clearCachedToken };
