const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTwitchLive, clearCachedToken } = require('../src/checkers/twitch');

function mockHttp(streamResponse = { data: { data: [] } }) {
    const calls = { post: [], get: [] };
    return {
        calls,
        async post(...args) {
            calls.post.push(args);
            return { data: { access_token: 'token', expires_in: 3600 } };
        },
        async get(...args) {
            calls.get.push(args);
            return streamResponse;
        }
    };
}

test.beforeEach(() => clearCachedToken());

test('missing Twitch credentials is unknown', async () => {
    assert.deepEqual(await checkTwitchLive('streamer'), {
        status: 'unknown', isLive: false, error: true, reason: 'missing_credentials'
    });
});

test('OAuth sends the secret only in a URLSearchParams body', async () => {
    const http = mockHttp();
    await checkTwitchLive('@Streamer', 'client-id', 'very-secret', { http });

    const [url, body, config] = http.calls.post[0];
    assert.equal(url, 'https://id.twitch.tv/oauth2/token');
    assert.ok(body instanceof URLSearchParams);
    assert.equal(body.get('client_id'), 'client-id');
    assert.equal(body.get('client_secret'), 'very-secret');
    assert.equal(body.get('grant_type'), 'client_credentials');
    assert.equal(url.includes('very-secret'), false);
    assert.equal(config.params, undefined);
    assert.ok(config.timeout > 0);
});

test('returns strict live metadata and uses Helix params', async () => {
    const http = mockHttp({ data: { data: [{
        id: 'session-123',
        type: 'live',
        user_login: 'streamer',
        title: 'Ahora sí',
        game_name: 'Just Chatting',
        viewer_count: 42,
        thumbnail_url: 'https://img/{width}x{height}.jpg'
    }] } });

    const result = await checkTwitchLive('@Streamer', 'client-id', 'secret', { http });

    assert.deepEqual(result, {
        status: 'live',
        isLive: true,
        sessionId: 'session-123',
        title: 'Ahora sí',
        gameName: 'Just Chatting',
        viewerCount: 42,
        roomLink: 'https://twitch.tv/streamer',
        coverUrl: 'https://img/1280x720.jpg',
        avatarUrl: null
    });
    assert.equal(http.calls.get[0][0], 'https://api.twitch.tv/helix/streams');
    assert.deepEqual(http.calls.get[0][1].params, { user_login: 'streamer' });
    assert.ok(http.calls.get[0][1].timeout > 0);
});

test('an empty Helix data array is offline', async () => {
    const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http: mockHttp() });
    assert.deepEqual(result, { status: 'offline', isLive: false });
});

test('invalid Helix schemas never become live', async (t) => {
    const cases = [
        ['missing data array', { data: {} }],
        ['unexpected stream type', { data: { data: [{ id: '1', type: 'rerun' }] } }],
        ['missing stream id', { data: { data: [{ type: 'live' }] } }],
        ['wrong streamer', { data: { data: [{ id: '1', type: 'live', user_login: 'other' }] } }],
        ['multiple streams', { data: { data: [{ id: '1', type: 'live' }, { id: '2', type: 'live' }] } }]
    ];

    for (const [name, response] of cases) {
        await t.test(name, async () => {
            clearCachedToken();
            const result = await checkTwitchLive('streamer', 'client-id', 'secret', {
                http: mockHttp(response)
            });
            assert.equal(result.status, 'unknown');
            assert.equal(result.isLive, false);
            assert.equal(result.error, true);
        });
    }
});

test('network errors and timeouts are unknown', async (t) => {
    for (const error of [new Error('network down'), Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })]) {
        await t.test(error.message, async () => {
            clearCachedToken();
            const http = mockHttp();
            http.get = async () => { throw error; };
            const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http });
            assert.equal(result.status, 'unknown');
            assert.equal(result.isLive, false);
            assert.equal(result.error, true);
        });
    }
});

test('OAuth inválido o caído es unknown', async t => {
    await t.test('respuesta inválida', async () => {
        const http = mockHttp();
        http.post = async () => ({ data: { expires_in: 3600 } });
        const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http });
        assert.equal(result.reason, 'oauth_failed');
    });
    await t.test('error de red', async () => {
        clearCachedToken();
        const http = mockHttp();
        http.post = async () => { throw new Error('down'); };
        const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http });
        assert.equal(result.reason, 'oauth_failed');
    });
});

test('a Helix 401 invalidates the token and retries exactly once', async () => {
    const http = mockHttp();
    let tokenNumber = 0;
    http.post = async (...args) => {
        http.calls.post.push(args);
        tokenNumber += 1;
        return { data: { access_token: `token-${tokenNumber}`, expires_in: 3600 } };
    };
    http.get = async (...args) => {
        http.calls.get.push(args);
        if (http.calls.get.length === 1) {
            const error = new Error('unauthorized');
            error.response = { status: 401 };
            throw error;
        }
        return { data: { data: [] } };
    };

    const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http });

    assert.deepEqual(result, { status: 'offline', isLive: false });
    assert.equal(http.calls.post.length, 2);
    assert.equal(http.calls.get.length, 2);
    assert.equal(http.calls.get[0][1].headers.Authorization, 'Bearer token-1');
    assert.equal(http.calls.get[1][1].headers.Authorization, 'Bearer token-2');
});

test('dos respuestas Helix 401 terminan en unknown', async () => {
    const http = mockHttp();
    http.get = async () => {
        const error = new Error('unauthorized');
        error.response = { status: 401 };
        throw error;
    };

    const result = await checkTwitchLive('streamer', 'client-id', 'secret', { http });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'helix_unauthorized');
});

test('token cache is isolated by client id and expires with a safety margin', async () => {
    const http = mockHttp();
    let now = 0;

    await checkTwitchLive('streamer', 'client-a', 'secret', { http, now: () => now });
    now = 3_539_999;
    await checkTwitchLive('streamer', 'client-a', 'secret', { http, now: () => now });
    await checkTwitchLive('streamer', 'client-b', 'secret', { http, now: () => now });
    now = 3_540_000;
    await checkTwitchLive('streamer', 'client-a', 'secret', { http, now: () => now });

    assert.equal(http.calls.post.length, 3);
    assert.deepEqual(http.calls.post.map(([, body]) => body.get('client_id')), [
        'client-a', 'client-b', 'client-a'
    ]);
});
