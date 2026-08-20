'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CHECK_STATUS,
    createPlatformState,
    normalizePlatformState,
    applyObservation
} = require('../src/liveState');

const opts = { liveThreshold: 2, offlineThreshold: 2, cooldownMs: 1_000 };

function observe(state, status, sessionId, checkedAt, extra = {}) {
    return applyObservation(
        state,
        { status, sessionId, checkedAt, ...extra },
        opts
    );
}

function offlineBaseline(username = 'alice') {
    return observe(createPlatformState(username), CHECK_STATUS.OFFLINE, null, 1).state;
}

test('100 muestras live de la misma sesión producen exactamente un aviso', () => {
    let state = offlineBaseline();
    let notifications = 0;

    for (let i = 0; i < 100; i += 1) {
        const result = observe(state, CHECK_STATUS.LIVE, 'session-1', 2_000 + i);
        state = result.state;
        notifications += Number(result.shouldNotify);
    }

    assert.equal(notifications, 1);
    assert.equal(state.status, CHECK_STATUS.LIVE);
    assert.equal(state.activeSessionId, 'session-1');
    assert.equal(state.lastNotifiedSessionId, 'session-1');
});

test('flapping no completa confirmaciones y un live estable sí', () => {
    let state = offlineBaseline();

    state = observe(state, CHECK_STATUS.LIVE, 's1', 10).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 11).state;
    let result = observe(state, CHECK_STATUS.LIVE, 's1', 12);
    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.status, CHECK_STATUS.OFFLINE);

    result = observe(result.state, CHECK_STATUS.LIVE, 's1', 13);
    assert.equal(result.shouldNotify, true);
    state = result.state;

    state = observe(state, CHECK_STATUS.OFFLINE, null, 14).state;
    result = observe(state, CHECK_STATUS.LIVE, 's1', 15);
    assert.equal(result.state.status, CHECK_STATUS.LIVE);
    assert.equal(result.state.consecutiveOfflineCount, 0);
    assert.equal(result.shouldNotify, false);
});

test('unknown y live sin sessionId rompen confirmaciones sin cambiar status', () => {
    let state = offlineBaseline();
    state = observe(state, CHECK_STATUS.LIVE, 's1', 10).state;
    state = observe(state, CHECK_STATUS.UNKNOWN, null, 11).state;

    assert.equal(state.status, CHECK_STATUS.OFFLINE);
    assert.equal(state.consecutiveLiveCount, 0);
    assert.equal(state.lastKnownAt, 10);
    assert.equal(state.lastCheckAt, 11);

    state = observe(state, CHECK_STATUS.LIVE, 's1', 12).state;
    const invalidLive = observe(state, CHECK_STATUS.LIVE, null, 13);
    assert.equal(invalidLive.state.status, CHECK_STATUS.OFFLINE);
    assert.equal(invalidLive.state.consecutiveLiveCount, 0);
    assert.equal(invalidLive.shouldNotify, false);
});

test('la misma sesión no repite tras offline; una nueva respeta cooldown', () => {
    let state = offlineBaseline();
    state = observe(state, CHECK_STATUS.LIVE, 's1', 2_000).state;
    let result = observe(state, CHECK_STATUS.LIVE, 's1', 2_001);
    assert.equal(result.shouldNotify, true);
    assert.equal(result.state.lastNotifiedSessionId, 's1');
    assert.equal(result.state.lastNotifiedAt, 2_001);
    state = result.state;

    state = observe(state, CHECK_STATUS.OFFLINE, null, 2_002).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 2_003).state;
    state = observe(state, CHECK_STATUS.LIVE, 's1', 2_004).state;
    result = observe(state, CHECK_STATUS.LIVE, 's1', 2_005);
    assert.equal(result.shouldNotify, false);

    state = observe(result.state, CHECK_STATUS.OFFLINE, null, 2_006).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 2_007).state;
    state = observe(state, CHECK_STATUS.LIVE, 's2', 2_008).state;
    result = observe(state, CHECK_STATUS.LIVE, 's2', 2_009);
    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.activeSessionId, 's2');
    assert.equal(result.state.lastNotifiedSessionId, 's1');

    state = observe(result.state, CHECK_STATUS.OFFLINE, null, 3_010).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 3_011).state;
    state = observe(state, CHECK_STATUS.LIVE, 's3', 3_012).state;
    result = observe(state, CHECK_STATUS.LIVE, 's3', 3_013);
    assert.equal(result.shouldNotify, true);
    assert.equal(result.state.lastNotifiedSessionId, 's3');
    assert.equal(result.state.lastNotifiedAt, 3_013);
});

test('cold start y reinicio adoptan el live sin avisar', () => {
    let state = createPlatformState('alice');
    state = observe(state, CHECK_STATUS.LIVE, 's1', 10).state;
    let result = observe(state, CHECK_STATUS.LIVE, 's1', 11);

    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.status, CHECK_STATUS.LIVE);
    assert.equal(result.state.activeSessionId, 's1');
    assert.equal(result.state.lastHandledSessionId, 's1');

    state = normalizePlatformState(JSON.parse(JSON.stringify(result.state)));
    result = observe(state, CHECK_STATUS.LIVE, 's1', 12);
    assert.equal(result.shouldNotify, false);

    state = observe(result.state, CHECK_STATUS.OFFLINE, null, 13).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 14).state;
    state = observe(state, CHECK_STATUS.LIVE, 's1', 15).state;
    result = observe(state, CHECK_STATUS.LIVE, 's1', 16);
    assert.equal(result.shouldNotify, false);

    state = createPlatformState('alice');
    state = observe(state, CHECK_STATUS.LIVE, 's2', 20).state;
    result = applyObservation(
        state,
        { status: CHECK_STATUS.LIVE, sessionId: 's2', checkedAt: 21 },
        { ...opts, notifyOnStartup: true }
    );
    assert.equal(result.shouldNotify, true);
    assert.equal(result.state.lastNotifiedSessionId, 's2');
});

test('cambiar de usuario borra de forma segura toda sesión anterior', () => {
    let state = offlineBaseline('old-user');
    state = observe(state, CHECK_STATUS.LIVE, 'old-session', 2_000).state;
    state = observe(state, CHECK_STATUS.LIVE, 'old-session', 2_001).state;

    let result = observe(
        state,
        CHECK_STATUS.LIVE,
        'new-session',
        2_002,
        { username: '@New-User' }
    );
    assert.equal(result.state.username, 'new-user');
    assert.equal(result.state.status, CHECK_STATUS.UNKNOWN);
    assert.equal(result.state.lastNotifiedSessionId, null);
    assert.equal(result.shouldNotify, false);

    result = observe(
        result.state,
        CHECK_STATUS.LIVE,
        'new-session',
        2_003,
        { username: 'new-user' }
    );
    assert.equal(result.state.status, CHECK_STATUS.LIVE);
    assert.equal(result.shouldNotify, false);
});

test('migra isLive legacy y adopta su primera sessionId sin aviso', () => {
    let state = normalizePlatformState({
        isLive: true,
        lastNotifiedAt: 500,
        consecutiveOfflineCount: 1
    });

    assert.equal(state.status, CHECK_STATUS.LIVE);
    assert.equal(state.initialized, true);
    assert.equal(state.activeSessionId, null);

    const result = observe(state, CHECK_STATUS.LIVE, 'legacy-session', 600);
    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.activeSessionId, 'legacy-session');

    state = normalizePlatformState({ isLive: false });
    assert.equal(state.status, CHECK_STATUS.OFFLINE);
    assert.equal(state.initialized, true);
});

test('el cooldown legacy sigue vigente aunque todavía no tenga sessionId', () => {
    let state = normalizePlatformState({ isLive: false, lastNotifiedAt: 500 });
    state = observe(state, CHECK_STATUS.LIVE, 'new-session', 600).state;
    const result = observe(state, CHECK_STATUS.LIVE, 'new-session', 601);

    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.lastNotifiedAt, 500);
    assert.equal(result.state.lastHandledSessionId, 'new-session');

    state = observe(result.state, CHECK_STATUS.OFFLINE, null, 2_000).state;
    state = observe(state, CHECK_STATUS.OFFLINE, null, 2_001).state;
    state = observe(state, CHECK_STATUS.LIVE, 'new-session', 2_002).state;
    const repeated = observe(state, CHECK_STATUS.LIVE, 'new-session', 2_003);
    assert.equal(repeated.shouldNotify, false);
});

test('una sesión vieja nunca reaparece como nueva después de otras sesiones', () => {
    let state = offlineBaseline();
    const notifications = [];

    for (const [sessionId, at] of [['A', 2_000], ['B', 4_000], ['A', 6_000]]) {
        state = observe(state, CHECK_STATUS.LIVE, sessionId, at).state;
        const result = observe(state, CHECK_STATUS.LIVE, sessionId, at + 1);
        state = result.state;
        notifications.push(result.shouldNotify);
        state = observe(state, CHECK_STATUS.OFFLINE, null, at + 2).state;
        state = observe(state, CHECK_STATUS.OFFLINE, null, at + 3).state;
    }

    assert.deepEqual(notifications, [true, true, false]);
    assert.deepEqual(state.handledSessionIds, ['B', 'A']);
});

test('una pausa larga rompe la consecutividad de las confirmaciones', () => {
    let state = offlineBaseline();
    state = applyObservation(state, {
        status: CHECK_STATUS.LIVE,
        sessionId: 'A',
        checkedAt: 10
    }, { ...opts, confirmationWindowMs: 100 }).state;

    let result = applyObservation(state, {
        status: CHECK_STATUS.LIVE,
        sessionId: 'A',
        checkedAt: 1_000
    }, { ...opts, confirmationWindowMs: 100 });
    assert.equal(result.shouldNotify, false);
    assert.equal(result.state.consecutiveLiveCount, 1);

    result = applyObservation(result.state, {
        status: CHECK_STATUS.LIVE,
        sessionId: 'A',
        checkedAt: 1_001
    }, { ...opts, confirmationWindowMs: 100 });
    assert.equal(result.shouldNotify, true);
});
