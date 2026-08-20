'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CHECK_STATUS } = require('../src/liveState');
const { loadState, saveState } = require('../src/stateStore');

function temporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-state-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('save/load conserva tiktok y twitch normalizados mediante rename atómico', t => {
    const directory = temporaryDirectory(t);
    const file = path.join(directory, 'nested', 'state.json');
    const input = {
        ignored: { value: true },
        tiktok: {
            username: '@Alice',
            status: CHECK_STATUS.LIVE,
            initialized: true,
            activeSessionId: 123,
            lastNotifiedSessionId: 123,
            lastNotifiedAt: 50
        },
        twitch: { isLive: false }
    };

    saveState(input, file);
    saveState({ ...input, tiktok: { ...input.tiktok, lastNotifiedAt: 51 } }, file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const loaded = loadState(file);

    assert.deepEqual(Object.keys(saved), ['tiktok', 'twitch']);
    assert.deepEqual(loaded, saved);
    assert.equal(loaded.tiktok.username, 'alice');
    assert.equal(loaded.tiktok.activeSessionId, '123');
    assert.equal(loaded.tiktok.lastNotifiedAt, 51);
    assert.equal(loaded.twitch.status, CHECK_STATUS.OFFLINE);
    assert.deepEqual(
        fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')),
        []
    );
});

test('STATE_FILE se usa cuando no se proporciona una ruta', t => {
    const directory = temporaryDirectory(t);
    const previous = process.env.STATE_FILE;
    process.env.STATE_FILE = path.join(directory, 'from-env.json');
    t.after(() => {
        if (previous === undefined) delete process.env.STATE_FILE;
        else process.env.STATE_FILE = previous;
    });

    saveState({ tiktok: { isLive: true }, twitch: { isLive: false } });
    const loaded = loadState();

    assert.equal(loaded.tiktok.status, CHECK_STATUS.LIVE);
    assert.equal(loaded.twitch.status, CHECK_STATUS.OFFLINE);
});

test('archivo ausente o corrupto carga un estado limpio', t => {
    const directory = temporaryDirectory(t);
    const missing = loadState(path.join(directory, 'missing.json'));
    assert.deepEqual(Object.keys(missing), ['tiktok', 'twitch']);
    assert.equal(missing.tiktok.status, CHECK_STATUS.UNKNOWN);
    assert.equal(missing.twitch.status, CHECK_STATUS.UNKNOWN);

    const corrupt = path.join(directory, 'corrupt.json');
    fs.writeFileSync(corrupt, '{not-json', 'utf8');
    const originalWarn = console.warn;
    console.warn = () => {};
    let loaded;
    try {
        loaded = loadState(corrupt);
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(loaded.tiktok.initialized, false);
    assert.equal(loaded.twitch.initialized, false);
});

test('saveState lanza el error y limpia el temporal si rename falla', t => {
    const directory = temporaryDirectory(t);

    assert.throws(() => saveState({}, directory));
    assert.deepEqual(
        fs.readdirSync(path.dirname(directory))
            .filter(name => name.startsWith(`${path.basename(directory)}.`) && name.endsWith('.tmp')),
        []
    );
});

test('reiniciar descarta contadores transitorios de confirmación', t => {
    const directory = temporaryDirectory(t);
    const file = path.join(directory, 'state.json');
    saveState({
        tiktok: {
            status: CHECK_STATUS.OFFLINE,
            initialized: true,
            candidateSessionId: 'candidate',
            consecutiveLiveCount: 1,
            consecutiveOfflineCount: 1
        }
    }, file);

    const loaded = loadState(file).tiktok;
    assert.equal(loaded.candidateSessionId, null);
    assert.equal(loaded.consecutiveLiveCount, 0);
    assert.equal(loaded.consecutiveOfflineCount, 0);
});
