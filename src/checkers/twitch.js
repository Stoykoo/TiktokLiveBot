const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getTwitchAppToken(clientId, clientSecret) {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }
    try {
        const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'client_credentials'
            }
        });
        cachedToken = res.data.access_token;
        tokenExpiresAt = Date.now() + (res.data.expires_in - 300) * 1000;
        return cachedToken;
    } catch (err) {
        console.error('[Twitch Token Error]', err.message);
        return null;
    }
}

async function checkTwitchLive(username, clientId, clientSecret) {
    if (!clientId || !clientSecret) {
        return { isLive: false, error: 'Credenciales de Twitch faltantes en .env' };
    }
    try {
        const token = await getTwitchAppToken(clientId, clientSecret);
        if (!token) return { isLive: false };

        const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${username.toLowerCase()}`, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`
            }
        });

        const data = res.data.data;
        if (data && data.length > 0) {
            const stream = data[0];
            return {
                isLive: true,
                title: stream.title,
                gameName: stream.game_name,
                viewerCount: stream.viewer_count,
                roomLink: `https://twitch.tv/${username}`,
                coverUrl: stream.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
                avatarUrl: null
            };
        }
        return { isLive: false };
    } catch (err) {
        console.error(`[Twitch Checker Error] No se pudo verificar ${username}:`, err.message);
        return { isLive: false };
    }
}

module.exports = { checkTwitchLive };
