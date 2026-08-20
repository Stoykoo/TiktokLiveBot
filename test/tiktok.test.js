const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { checkTikTokLive, parseTikTokHtml } = require('../src/checkers/tiktok');

const script = (id, value) => `<html><script id="${id}" type="application/json">${
    typeof value === 'string' ? value : JSON.stringify(value)
}</script></html>`;

const liveInfo = (uniqueId, room, user = {}) => ({
    __DEFAULT_SCOPE__: {
        'webapp.live-detail': {
            liveRoomUserInfo: { user: { uniqueId, ...user }, liveRoom: room }
        }
    }
});

test('acepta live solamente con sala 2, identidad y sessionId', () => {
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('StoyKoxs', {
        status: 2,
        id: 'room-123',
        title: 'Prueba estricta',
        user_count: '42',
        coverUrl: 'javascript:alert(1)',
        cover: { url_list: ['https://cdn.example/cover.jpg'] }
    }, {
        status: 4,
        avatarLarger: 'data:image/png;base64,bad',
        avatarMedium: { urlList: ['https://cdn.example/avatar.jpg'] }
    }));

    assert.deepEqual(parseTikTokHtml(html, '@stoykoxs'), {
        status: 'live',
        isLive: true,
        sessionId: 'room-123',
        title: 'Prueba estricta',
        viewerCount: 42,
        roomLink: 'https://www.tiktok.com/@stoykoxs/live',
        avatarUrl: 'https://cdn.example/avatar.jpg',
        coverUrl: 'https://cdn.example/cover.jpg'
    });
});

test('ignora el contenedor CurrentRoom sin status cuando LiveRoom es concluyente', () => {
    const html = script('SIGI_STATE', {
        LiveRoom: {
            liveRoomUserInfo: {
                user: { uniqueId: 'stoykxs', roomId: 'room-actual' },
                liveRoom: {
                    status: 2,
                    streamId: 'stream-actual',
                    title: 'En vivo',
                    liveRoomStats: { userCount: 3 }
                }
            }
        },
        CurrentRoom: { loadingState: 0, roomInfo: null, roomId: '' }
    });

    const result = parseTikTokHtml(html, 'stoykxs');
    assert.equal(result.status, 'live');
    assert.equal(result.sessionId, 'room-actual');
    assert.equal(result.viewerCount, 3);
});

test('acepta offline explícito aunque el usuario conserve un roomId histórico', () => {
    const html = script('SIGI_STATE', {
        LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'StoyKoxs', roomId: 'old-room' } } },
        CurrentRoom: { status: 4, roomId: 'old-room' }
    });

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), { status: 'offline', isLive: false });
});

test('un user.status 2 viejo no puede revocar una sala offline', () => {
    const offline = script('SIGI_STATE', {
        LiveRoom: {
            liveRoomUserInfo: {
                user: { uniqueId: 'stoykxs', status: 4, roomId: 'old-room' },
                liveRoom: { status: 4, streamId: 'old-stream' }
            }
        }
    });
    const staleProfile = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', {
        __DEFAULT_SCOPE__: {
            'webapp.user-detail': {
                userInfo: { user: { uniqueId: 'stoykxs', status: 2, roomId: 'old-room' } }
            }
        }
    });

    assert.deepEqual(parseTikTokHtml(`${offline}${staleProfile}`, 'stoykxs'), {
        status: 'offline',
        isLive: false
    });
});

test('no usa user.status 2 cuando no existe una sala verificable', () => {
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', {
        __DEFAULT_SCOPE__: {
            'webapp.user-detail': { userInfo: { user: { uniqueId: 'stoykoxs', status: 2, roomId: 'old' } } }
        }
    });

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'missing-room-data'
    });
});

test('marca unknown cuando SIGI y UNIVERSAL se contradicen', () => {
    const sigi = script('SIGI_STATE', {
        LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'stoykoxs' }, liveRoom: { status: 2, id: '123' } } }
    });
    const universal = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('stoykoxs', { status: 4 }));
    const html = `${sigi}${universal}`;

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'conflicting-status'
    });
});

test('rechaza una sala que pertenece a otro usuario', () => {
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('otra-cuenta', { status: 2, id: '123' }));

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'identity-mismatch'
    });
});

test('trata JSON roto como unknown', () => {
    const html = script('SIGI_STATE', '{"LiveRoom":');

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'invalid-json'
    });
});

test('rechaza live sin sessionId', () => {
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('stoykoxs', { status: 2 }));

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'live-without-session-id'
    });
});

test('no convierte un status de sala textual en señal live', () => {
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('stoykoxs', { status: '2', id: '123' }));

    assert.deepEqual(parseTikTokHtml(html, 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'missing-status'
    });
});

test('trata HTML vacío como unknown', () => {
    assert.deepEqual(parseTikTokHtml('   ', 'stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'empty-html'
    });
});

test('captcha y status no reconocido son unknown', () => {
    assert.equal(parseTikTokHtml('<div id="secsdk-captcha"></div>', 'stoykxs').reason, 'captcha');
    const html = script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('stoykxs', {
        status: 0,
        id: 'room'
    }));
    assert.equal(parseTikTokHtml(html, 'stoykxs').reason, 'unsupported-status');
});

test('hace una sola petición al endpoint live, con cache-buster y timeout', async t => {
    const originalGet = axios.get;
    const calls = [];
    t.after(() => { axios.get = originalGet; });
    axios.get = async (...args) => {
        calls.push(args);
        return { data: script('__UNIVERSAL_DATA_FOR_REHYDRATION__', liveInfo('StoyKoxs', { status: 4 })) };
    };

    assert.deepEqual(await checkTikTokLive('@StoyKoxs'), { status: 'offline', isLive: false });
    assert.equal(calls.length, 1);
    const [requestUrl, config] = calls[0];
    const parsedUrl = new URL(requestUrl);
    assert.equal(parsedUrl.origin + parsedUrl.pathname, 'https://www.tiktok.com/@StoyKoxs/live');
    assert.ok(parsedUrl.searchParams.get('_'));
    assert.equal(config.timeout, 12000);
    assert.equal(config.responseType, 'text');
});

test('mantiene unknown cuando falla la única petición', async t => {
    const originalGet = axios.get;
    t.after(() => { axios.get = originalGet; });
    axios.get = async () => { throw new Error('timeout'); };

    assert.deepEqual(await checkTikTokLive('stoykoxs'), {
        status: 'unknown', isLive: false, error: true, reason: 'request-failed'
    });
});
