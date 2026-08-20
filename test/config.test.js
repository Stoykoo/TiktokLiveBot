const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

function validEnv(overrides = {}) {
    return {
        DISCORD_TOKEN: 'token',
        NOTIFICATION_CHANNEL_ID: '123456789012345678',
        STREAM_PLATFORM: 'tiktok',
        STREAMER_USERNAME: 'canal',
        ...overrides
    };
}

test('configura TikTok con límites seguros', () => {
    const config = loadConfig(validEnv());
    assert.equal(config.monitorTikTok, true);
    assert.equal(config.monitorTwitch, false);
    assert.equal(config.checkIntervalSeconds, 60);
    assert.equal(config.liveConfirmations, 2);
    assert.equal(config.notifyOnStartup, false);
});

test('rechaza intervalos peligrosos y valores inválidos', () => {
    for (const value of ['0', '-1', 'abc', '29']) {
        assert.throws(() => loadConfig(validEnv({ CHECK_INTERVAL_SECONDS: value })), /CHECK_INTERVAL_SECONDS/);
    }
    assert.throws(() => loadConfig(validEnv({ STREAM_PLATFORM: 'lo-que-sea' })), /STREAM_PLATFORM/);
    assert.throws(() => loadConfig(validEnv({ LIVE_CONFIRMATIONS: '1' })), /LIVE_CONFIRMATIONS/);
    assert.throws(() => loadConfig(validEnv({ PING_ROLE: '<@&123>' })), /PING_ROLE/);
    assert.throws(() => loadConfig(validEnv({ STREAMER_USERNAME: '../otra-cuenta' })), /STREAMER_USERNAME/);
});

test('Twitch solo funciona con Helix configurado', () => {
    assert.throws(
        () => loadConfig(validEnv({ STREAM_PLATFORM: 'twitch', TWITCH_STREAMER_USERNAME: 'canal' })),
        /TWITCH_CLIENT_ID/
    );

    const config = loadConfig(validEnv({
        STREAM_PLATFORM: 'twitch',
        TWITCH_STREAMER_USERNAME: '@Canal',
        TWITCH_CLIENT_ID: 'id',
        TWITCH_CLIENT_SECRET: 'secret'
    }));
    assert.equal(config.monitorTwitch, true);
    assert.equal(config.twitchUsername, 'Canal');
});

test('modo both conserva TikTok y avisa si Twitch no tiene credenciales', () => {
    const config = loadConfig(validEnv({ STREAM_PLATFORM: 'both', TWITCH_STREAMER_USERNAME: 'canal2' }));
    assert.equal(config.monitorTikTok, true);
    assert.equal(config.monitorTwitch, false);
    assert.equal(config.warnings.length, 1);
});

test('valida booleanos y snowflakes', () => {
    assert.equal(loadConfig(validEnv({ NOTIFY_ON_STARTUP: 'true', PING_ROLE: '123456789012345678' })).notifyOnStartup, true);
    assert.throws(() => loadConfig(validEnv({ NOTIFY_ON_STARTUP: 'yes' })), /NOTIFY_ON_STARTUP/);
    assert.throws(() => loadConfig(validEnv({ NOTIFICATION_CHANNEL_ID: '123' })), /NOTIFICATION_CHANNEL_ID/);
});
