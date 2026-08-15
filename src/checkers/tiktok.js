const axios = require('axios');

/**
 * Revisa el estado del directo de TikTok para un usuario específico.
 * Retorna status estricto. NUNCA retorna isLive: true salvo que status === 2.
 * @param {string} username - Nombre de usuario de TikTok (sin @)
 * @returns {Promise<{isLive: boolean, title?: string, viewerCount?: number, roomLink?: string, avatarUrl?: string, coverUrl?: string, error?: boolean}>}
 */
async function checkTikTokLive(username) {
    const cleanUser = username.replace(/^@/, '').trim();
    if (!cleanUser) return { isLive: false };

    const liveUrl = `https://www.tiktok.com/@${cleanUser}/live`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    try {
        const response = await axios.get(liveUrl, { headers, timeout: 12000 });
        const html = response.data;

        // 1. Intentar extraer datos de SIGI_STATE
        const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);
        if (sigiMatch && sigiMatch[1]) {
            try {
                const sigi = JSON.parse(sigiMatch[1]);
                const liveRoomUserInfo = sigi.LiveRoom?.liveRoomUserInfo;
                const user = liveRoomUserInfo?.user || sigi.CurrentRoom?.user;
                const liveRoom = liveRoomUserInfo?.liveRoom || sigi.CurrentRoom;

                const userStatus = Number(user?.status);
                const roomStatus = Number(liveRoom?.status);

                // En TikTok, status === 2 indica transmisión EN VIVO activa en tiempo real.
                const isLive = Boolean(userStatus === 2 || roomStatus === 2);

                if (isLive) {
                    const title = liveRoom?.title || sigi.CurrentRoom?.title || `¡Directo de @${cleanUser} en TikTok!`;
                    const viewerCount = Number(liveRoom?.user_count || sigi.CurrentRoom?.user_count || 0);
                    const avatarUrl = user?.avatarLarger || user?.avatarMedium || user?.avatarThumb;
                    const coverUrl = liveRoom?.coverUrl || liveRoom?.cover?.url_list?.[0] || avatarUrl;

                    return {
                        isLive: true,
                        title,
                        viewerCount,
                        roomLink: liveUrl,
                        avatarUrl,
                        coverUrl
                    };
                }
            } catch (err) {
                // Parse error ignored
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

                const userStatus = Number(user?.status);
                const roomStatus = Number(liveRoom?.status);

                // ESTRICTO: Solo es EN VIVO si status === 2
                const isLive = Boolean(userStatus === 2 || roomStatus === 2);

                if (isLive) {
                    const title = liveRoom?.title || `¡Directo de @${cleanUser} en TikTok!`;
                    const viewerCount = Number(liveRoom?.user_count || 0);
                    const avatarUrl = user?.avatarLarger || user?.avatarThumb;
                    const coverUrl = liveRoom?.coverUrl || avatarUrl;

                    return {
                        isLive: true,
                        title,
                        viewerCount,
                        roomLink: liveUrl,
                        avatarUrl,
                        coverUrl
                    };
                }
            } catch (err) {
                // Parse error ignored
            }
        }

        // 3. Fallback a la página de perfil con verificación estricta de status === 2
        try {
            const profileUrl = `https://www.tiktok.com/@${cleanUser}`;
            const profileRes = await axios.get(profileUrl, { headers, timeout: 10000 });
            const profileHtml = profileRes.data;

            const profUniMatch = profileHtml.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
            if (profUniMatch && profUniMatch[1]) {
                const profData = JSON.parse(profUniMatch[1]);
                const user = profData.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
                const liveRoom = profData.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.liveRoom;

                const userStatus = Number(user?.status);
                const roomStatus = Number(liveRoom?.status);

                // ESTRICTO: NUNCA usar solo user.roomId (dado que roomId existe incluso offline)
                const isLive = Boolean(userStatus === 2 || roomStatus === 2);

                if (isLive) {
                    return {
                        isLive: true,
                        title: liveRoom?.title || `¡Directo de @${cleanUser} en TikTok!`,
                        viewerCount: Number(liveRoom?.user_count || 0),
                        roomLink: liveUrl,
                        avatarUrl: user?.avatarLarger || user?.avatarThumb,
                        coverUrl: liveRoom?.coverUrl || user?.avatarLarger || user?.avatarThumb
                    };
                }
            }
        } catch (e) {
            // Profile fallback error
        }

        return { isLive: false };

    } catch (error) {
        console.error(`[TikTok Checker Error] No se pudo verificar @${cleanUser}:`, error.message);
        return { isLive: false, error: true };
    }
}

module.exports = { checkTikTokLive };
