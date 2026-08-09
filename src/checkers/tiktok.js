const axios = require('axios');

/**
 * Revisa el estado del directo de TikTok para un usuario específico.
 * @param {string} username - Nombre de usuario de TikTok (sin @)
 * @returns {Promise<{isLive: boolean, title?: string, viewerCount?: number, roomLink?: string, avatarUrl?: string, coverUrl?: string}>}
 */
async function checkTikTokLive(username) {
    const cleanUser = username.replace(/^@/, '');
    const liveUrl = `https://www.tiktok.com/@${cleanUser}/live`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache'
    };

    try {
        const response = await axios.get(liveUrl, { headers, timeout: 12000 });
        const html = response.data;

        // 1. Intentar extraer datos de SIGI_STATE (Formato habitual en /live)
        const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);
        if (sigiMatch && sigiMatch[1]) {
            try {
                const sigi = JSON.parse(sigiMatch[1]);
                const liveRoomUserInfo = sigi.LiveRoom?.liveRoomUserInfo;
                const user = liveRoomUserInfo?.user || sigi.CurrentRoom?.user;
                const liveRoom = liveRoomUserInfo?.liveRoom || sigi.CurrentRoom;

                const roomId = user?.roomId || sigi.CurrentRoom?.roomId || liveRoom?.id || liveRoom?.roomId;
                const userStatus = user?.status;
                const roomStatus = liveRoom?.status;

                // En TikTok, status = 2 indica transmisión EN VIVO activa.
                const isLive = Boolean(roomId && roomId !== '0' && roomId !== '' && (userStatus === 2 || roomStatus === 2));

                const title = liveRoom?.title || sigi.CurrentRoom?.title || `¡Directo de @${cleanUser} en TikTok!`;
                const viewerCount = liveRoom?.user_count || sigi.CurrentRoom?.user_count || 0;
                const avatarUrl = user?.avatarLarger || user?.avatarMedium || user?.avatarThumb;
                const coverUrl = liveRoom?.coverUrl || liveRoom?.cover?.url_list?.[0] || avatarUrl;

                return {
                    isLive,
                    title,
                    viewerCount,
                    roomLink: liveUrl,
                    avatarUrl,
                    coverUrl
                };
            } catch (err) {
                // Ignore parse error and continue to next method
            }
        }

        // 2. Intentar extraer datos de __UNIVERSAL_DATA_FOR_REHYDRATION__
        const uniMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
        if (uniMatch && uniMatch[1]) {
            try {
                const uni = JSON.parse(uniMatch[1]);
                const scope = uni.__DEFAULT_SCOPE__ || {};
                const liveDetail = scope['webapp.live-detail']?.liveRoomUserInfo;
                const userDetail = scope['webapp.user-detail']?.userInfo;
                
                const user = liveDetail?.user || userDetail?.user;
                const liveRoom = liveDetail?.liveRoom;

                const roomId = user?.roomId;
                const userStatus = user?.status;
                const roomStatus = liveRoom?.status;

                const isLive = Boolean(roomId && roomId !== '0' && roomId !== '' && (userStatus === 2 || roomStatus === 2));

                const title = liveRoom?.title || `¡Directo de @${cleanUser} en TikTok!`;
                const viewerCount = liveRoom?.user_count || 0;
                const avatarUrl = user?.avatarLarger || user?.avatarThumb;
                const coverUrl = liveRoom?.coverUrl || avatarUrl;

                return {
                    isLive,
                    title,
                    viewerCount,
                    roomLink: liveUrl,
                    avatarUrl,
                    coverUrl
                };
            } catch (err) {
                // Ignore parse error
            }
        }

        // 3. Fallback a la página de perfil del usuario si no se obtuvo info en /live
        try {
            const profileUrl = `https://www.tiktok.com/@${cleanUser}`;
            const profileRes = await axios.get(profileUrl, { headers, timeout: 10000 });
            const profileHtml = profileRes.data;

            const profUniMatch = profileHtml.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
            if (profUniMatch && profUniMatch[1]) {
                const profData = JSON.parse(profUniMatch[1]);
                const user = profData.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
                if (user) {
                    const isLive = Boolean(user.roomId && user.roomId !== '' && user.roomId !== '0');
                    return {
                        isLive,
                        title: `¡Directo de @${cleanUser} en TikTok!`,
                        viewerCount: 0,
                        roomLink: liveUrl,
                        avatarUrl: user.avatarLarger || user.avatarThumb,
                        coverUrl: user.avatarLarger || user.avatarThumb
                    };
                }
            }
        } catch (e) {
            // Profile fallback error
        }

        return { isLive: false };

    } catch (error) {
        console.error(`[TikTok Checker Error] No se pudo verificar @${cleanUser}:`, error.message);
        return { isLive: false };
    }
}

module.exports = { checkTikTokLive };

