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
    const cleanUser = (username || '').trim().toLowerCase().replace(/^@/, '');
    if (!cleanUser) return { isLive: false };

    // 1. Usar API Helix si se definieron Client ID y Client Secret
    if (clientId && clientSecret) {
        try {
            const token = await getTwitchAppToken(clientId, clientSecret);
            if (token) {
                const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${cleanUser}`, {
                    headers: {
                        'Client-ID': clientId,
                        'Authorization': `Bearer ${token}`
                    },
                    timeout: 8000
                });

                const data = res.data.data;
                if (data && data.length > 0) {
                    const stream = data[0];
                    return {
                        isLive: true,
                        title: stream.title,
                        gameName: stream.game_name,
                        viewerCount: stream.viewer_count,
                        roomLink: `https://twitch.tv/${cleanUser}`,
                        coverUrl: stream.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
                        avatarUrl: null
                    };
                }
                return { isLive: false };
            }
        } catch (err) {
            console.error(`[Twitch Helix Checker Error] No se pudo verificar @${cleanUser}:`, err.message);
        }
    }

    // 2. Fallback usando decapi.me (no requiere API keys)
    try {
        const uptimeRes = await axios.get(`https://decapi.me/twitch/uptime/${cleanUser}`, { timeout: 8000 });
        const text = (uptimeRes.data || '').toString().toLowerCase();
        
        const isOffline = text.includes('offline') || text.includes('no user') || text.includes('not found') || text.includes('error');
        if (!isOffline && (text.includes('live for') || text.includes('days') || text.includes('hours') || text.includes('minutes') || text.includes('seconds'))) {
            let title = `¡Directo de ${cleanUser} en Twitch!`;
            let avatarUrl = null;

            try {
                const titleRes = await axios.get(`https://decapi.me/twitch/title/${cleanUser}`, { timeout: 5000 });
                if (titleRes.data && !titleRes.data.includes('Error')) title = titleRes.data;
            } catch (e) {}

            try {
                const avatarRes = await axios.get(`https://decapi.me/twitch/avatar/${cleanUser}`, { timeout: 5000 });
                if (avatarRes.data && avatarRes.data.startsWith('http')) avatarUrl = avatarRes.data;
            } catch (e) {}

            return {
                isLive: true,
                title,
                viewerCount: 0,
                roomLink: `https://twitch.tv/${cleanUser}`,
                coverUrl: avatarUrl,
                avatarUrl
            };
        }
    } catch (err) {
        console.error(`[Twitch Decapi Fallback Error] No se pudo verificar @${cleanUser}:`, err.message);
    }

    return { isLive: false };
}

module.exports = { checkTwitchLive };
