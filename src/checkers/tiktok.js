const axios = require('axios');

/**
 * Revisa el estado del directo de TikTok para un usuario específico.
 * @param {string} username - Nombre de usuario de TikTok (sin @)
 * @returns {Promise<{isLive: boolean, title?: string, viewerCount?: number, roomLink?: string, avatarUrl?: string, coverUrl?: string}>}
 */
async function checkTikTokLive(username) {
    const cleanUser = username.replace(/^@/, '');
    const liveUrl = `https://www.tiktok.com/@${cleanUser}/live`;

    try {
        const response = await axios.get(liveUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache'
            },
            timeout: 10000
        });

        const html = response.data;

        // Intentar parsear el JSON de rehidratación de TikTok
        const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i) ||
                          html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);

        if (jsonMatch && jsonMatch[1]) {
            try {
                const parsedData = JSON.parse(jsonMatch[1]);
                
                // Buscar información del LiveRoom en los datos
                const liveRoomInfo = parsedData.__DEFAULT_SCOPE__?.['webapp.live-detail']?.liveRoomUserInfo ||
                                     parsedData.LiveRoom?.liveRoomUserInfo ||
                                     parsedData.LiveRoom;

                if (liveRoomInfo) {
                    const status = liveRoomInfo.liveRoom?.status || liveRoomInfo.status;
                    // Status 2 suele indicar que el en vivo está ACTIVO
                    const isLive = status === 2 || status === '2';

                    const title = liveRoomInfo.liveRoom?.title || liveRoomInfo.title || `¡Directo de ${cleanUser} en TikTok!`;
                    const viewerCount = liveRoomInfo.liveRoom?.user_count || liveRoomInfo.user_count || 0;
                    const avatarUrl = liveRoomInfo.user?.avatar_thumb?.url_list?.[0] || liveRoomInfo.user?.avatarThumb;
                    const coverUrl = liveRoomInfo.liveRoom?.cover?.url_list?.[0] || liveRoomInfo.liveRoom?.coverUrl;

                    return {
                        isLive,
                        title,
                        viewerCount,
                        roomLink: liveUrl,
                        avatarUrl,
                        coverUrl
                    };
                }
            } catch (err) {
                // Parse error, fallback a regex en el HTML
            }
        }

        // Método de respaldo por patrones en HTML
        const isLiveByRegex = html.includes('"status":2') || html.includes('"liveRoomStatus":2') || html.includes('room_status":2');
        
        // Extraer título si es posible
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
        const title = titleMatch ? titleMatch[1] : `¡Directo de @${cleanUser} en TikTok!`;

        // Extraer avatar si es posible
        const avatarMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
        const avatarUrl = avatarMatch ? avatarMatch[1] : null;

        return {
            isLive: isLiveByRegex,
            title: title,
            viewerCount: 0,
            roomLink: liveUrl,
            avatarUrl: avatarUrl,
            coverUrl: avatarUrl
        };

    } catch (error) {
        console.error(`[TikTok Checker Error] No se pudo verificar @${cleanUser}:`, error.message);
        return { isLive: false };
    }
}

module.exports = { checkTikTokLive };
