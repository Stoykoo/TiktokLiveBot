const axios = require('axios');

const LIVE_STATUS = 2;
const OFFLINE_STATUS = 4;
const REQUEST_TIMEOUT_MS = 12000;
const STATE_SCRIPT_IDS = new Set(['SIGI_STATE', '__UNIVERSAL_DATA_FOR_REHYDRATION__']);

function unknown(reason) {
    return { status: 'unknown', isLive: false, error: true, reason };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUsername(value) {
    return typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
}

function extractStateScripts(html) {
    const scripts = [];
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match;

    while ((match = scriptPattern.exec(html)) !== null) {
        const idMatch = match[1].match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
        const id = idMatch && (idMatch[1] || idMatch[2] || idMatch[3]);
        if (STATE_SCRIPT_IDS.has(id)) scripts.push({ id, source: match[2] });
    }

    return scripts;
}

function collectRoomCandidates(states) {
    const candidates = [];
    const add = (user, room) => {
        if (isObject(user) && isObject(room)) candidates.push({ user, room });
    };

    for (const { id, data } of states) {
        if (id === 'SIGI_STATE') {
            const liveInfo = data?.LiveRoom?.liveRoomUserInfo;
            const current = data?.CurrentRoom || data?.LiveRoom?.CurrentRoom || data?.LiveRoom?.currentRoom;
            add(liveInfo?.user, liveInfo?.liveRoom || liveInfo?.room);
            const currentInfo = current?.liveRoomUserInfo;
            add(currentInfo?.user, currentInfo?.liveRoom || currentInfo?.room);
            add(current?.user || liveInfo?.user, current?.liveRoom);
            add(current?.user || liveInfo?.user, current?.room);

            const roomInfo = current?.roomInfo;
            const nestedInfo = roomInfo?.liveRoomUserInfo;
            add(nestedInfo?.user, nestedInfo?.liveRoom || nestedInfo?.room);
            add(roomInfo?.user || current?.user || liveInfo?.user, roomInfo?.liveRoom);
            add(roomInfo?.user || current?.user || liveInfo?.user, roomInfo?.room);

            if (isObject(current) && Object.prototype.hasOwnProperty.call(current, 'status')) {
                add(current.user || liveInfo?.user, current);
            }
            if (isObject(roomInfo) && Object.prototype.hasOwnProperty.call(roomInfo, 'status')) {
                add(roomInfo.user || current?.user || liveInfo?.user, roomInfo);
            }
        } else {
            const detail = data?.__DEFAULT_SCOPE__?.['webapp.live-detail'];
            const info = detail?.liveRoomUserInfo || detail;
            add(info?.user, info?.liveRoom || info?.room || detail?.liveRoom || detail?.room);
        }
    }

    return candidates;
}

function sessionIdFor({ room, user }) {
    for (const value of [room.id, room.roomId, user.roomId, room.streamId]) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value);
    }
    return null;
}

function textValue(values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function numericValue(values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0) {
            return Number(value);
        }
    }
    return 0;
}

function safeUrl(value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const url = safeUrl(item);
            if (url) return url;
        }
        return null;
    }

    if (isObject(value)) {
        return safeUrl(value.url_list || value.urlList || value.url);
    }

    if (typeof value !== 'string' || !value.trim()) return null;
    const candidate = value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim();

    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? candidate : null;
    } catch {
        return null;
    }
}

function firstSafeUrl(values) {
    for (const value of values) {
        const url = safeUrl(value);
        if (url) return url;
    }
    return null;
}

/**
 * Interpreta únicamente los estados de sala embebidos por TikTok.
 * No hace I/O y nunca infiere un directo desde el estado del usuario.
 */
function parseTikTokHtml(html, expectedUsername) {
    const username = normalizeUsername(expectedUsername);
    if (!username) return unknown('invalid-username');
    if (typeof html !== 'string' || !html.trim()) return unknown('empty-html');
    if (/(?:captcha_verify|secsdk-captcha|verifycenter|captcha-verify-container)/i.test(html)) {
        return unknown('captcha');
    }

    const scripts = extractStateScripts(html);
    if (!scripts.length) return unknown('missing-state');

    const states = [];
    for (const script of scripts) {
        try {
            states.push({ id: script.id, data: JSON.parse(script.source.trim()) });
        } catch {
            return unknown('invalid-json');
        }
    }

    const candidates = collectRoomCandidates(states);
    if (!candidates.length) return unknown('missing-room-data');

    const observations = [];
    for (const candidate of candidates) {
        if (normalizeUsername(candidate.user.uniqueId) !== username) {
            return unknown('identity-mismatch');
        }
        if (typeof candidate.room.status !== 'number' || !Number.isFinite(candidate.room.status)) {
            return unknown('missing-status');
        }
        if (candidate.room.status !== LIVE_STATUS && candidate.room.status !== OFFLINE_STATUS) {
            return unknown('unsupported-status');
        }

        const sessionId = candidate.room.status === LIVE_STATUS ? sessionIdFor(candidate) : null;
        if (candidate.room.status === LIVE_STATUS && !sessionId) {
            return unknown('live-without-session-id');
        }
        observations.push({ ...candidate, status: candidate.room.status, sessionId });
    }

    if (new Set(observations.map(({ status }) => status)).size !== 1) {
        return unknown('conflicting-status');
    }
    if (observations[0].status === OFFLINE_STATUS) {
        return { status: 'offline', isLive: false };
    }

    const sessionIds = new Set(observations.map(({ sessionId }) => sessionId));
    if (sessionIds.size !== 1) return unknown('conflicting-session-id');

    const rooms = observations.map(({ room }) => room);
    const users = observations.map(({ user }) => user);
    const avatarUrl = firstSafeUrl(users.flatMap(user => [
        user.avatarLarger,
        user.avatarMedium,
        user.avatarThumb,
        user.avatar_large,
        user.avatar_medium,
        user.avatar_thumb
    ]));
    const coverUrl = firstSafeUrl(rooms.flatMap(room => [
        room.coverUrl,
        room.cover_url,
        room.cover,
        room.background
    ])) || avatarUrl;
    const result = {
        status: 'live',
        isLive: true,
        sessionId: observations[0].sessionId,
        title: textValue(rooms.map(room => room.title)) || `¡Directo de @${username} en TikTok!`,
        viewerCount: numericValue(rooms.flatMap(room => [
            room.user_count,
            room.userCount,
            room.liveRoomStats?.userCount,
            room.liveRoomStats?.totalUser,
            room.stats?.userCount,
            room.stats?.totalUser
        ])),
        roomLink: `https://www.tiktok.com/@${encodeURIComponent(username)}/live`
    };

    if (avatarUrl) result.avatarUrl = avatarUrl;
    if (coverUrl) result.coverUrl = coverUrl;
    return result;
}

async function checkTikTokLive(username) {
    const cleanUser = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
    if (!cleanUser) return unknown('invalid-username');

    const liveUrl = `https://www.tiktok.com/@${encodeURIComponent(cleanUser)}/live`;
    const requestUrl = `${liveUrl}?_=${Date.now()}`;

    try {
        const response = await axios.get(requestUrl, {
            timeout: REQUEST_TIMEOUT_MS,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache, no-store',
                Pragma: 'no-cache'
            }
        });
        return parseTikTokHtml(response.data, cleanUser);
    } catch {
        return unknown('request-failed');
    }
}

module.exports = { checkTikTokLive, parseTikTokHtml };
