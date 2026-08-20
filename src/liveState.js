'use strict';

const CHECK_STATUS = Object.freeze({
    UNKNOWN: 'unknown',
    OFFLINE: 'offline',
    LIVE: 'live'
});

const VALID_STATUSES = new Set(Object.values(CHECK_STATUS));
const HANDLED_SESSION_LIMIT = 256;

function cleanUsername(value) {
    return typeof value === 'string'
        ? value.trim().replace(/^@/, '').toLowerCase()
        : '';
}

function cleanSessionId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const id = String(value).trim();
    return id && id.length <= 256 ? id : null;
}

function handledSessions(raw) {
    const values = Array.isArray(raw.handledSessionIds) ? [...raw.handledSessionIds] : [];
    values.push(raw.lastHandledSessionId, raw.lastNotifiedSessionId);
    return [...new Set(values.map(cleanSessionId).filter(Boolean))].slice(-HANDLED_SESSION_LIMIT);
}

function rememberSession(ids, sessionId) {
    return [...ids.filter(id => id !== sessionId), sessionId].slice(-HANDLED_SESSION_LIMIT);
}

function nonNegativeNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function createPlatformState(username = '') {
    return {
        username: cleanUsername(username),
        status: CHECK_STATUS.UNKNOWN,
        initialized: false,
        activeSessionId: null,
        candidateSessionId: null,
        consecutiveLiveCount: 0,
        consecutiveOfflineCount: 0,
        handledSessionIds: [],
        lastHandledSessionId: null,
        lastNotifiedSessionId: null,
        lastNotifiedAt: 0,
        lastCheckAt: 0,
        lastKnownAt: 0
    };
}

function normalizePlatformState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return createPlatformState();
    }

    const legacyStatus = typeof raw.isLive === 'boolean'
        ? (raw.isLive ? CHECK_STATUS.LIVE : CHECK_STATUS.OFFLINE)
        : CHECK_STATUS.UNKNOWN;
    const status = VALID_STATUSES.has(raw.status) ? raw.status : legacyStatus;
    const initialized = typeof raw.initialized === 'boolean'
        ? raw.initialized
        : status !== CHECK_STATUS.UNKNOWN;
    const candidateSessionId = cleanSessionId(raw.candidateSessionId);
    const handledSessionIds = handledSessions(raw);

    return {
        username: cleanUsername(raw.username),
        status,
        initialized,
        activeSessionId: status === CHECK_STATUS.LIVE
            ? cleanSessionId(raw.activeSessionId)
            : null,
        candidateSessionId,
        consecutiveLiveCount: candidateSessionId
            ? nonNegativeInteger(raw.consecutiveLiveCount)
            : 0,
        consecutiveOfflineCount: nonNegativeInteger(raw.consecutiveOfflineCount),
        handledSessionIds,
        lastHandledSessionId: cleanSessionId(raw.lastHandledSessionId || raw.lastNotifiedSessionId),
        lastNotifiedSessionId: cleanSessionId(raw.lastNotifiedSessionId),
        lastNotifiedAt: nonNegativeNumber(raw.lastNotifiedAt),
        lastCheckAt: nonNegativeNumber(raw.lastCheckAt),
        lastKnownAt: nonNegativeNumber(raw.lastKnownAt)
    };
}

function threshold(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function observationTime(observation, options) {
    if (Number.isFinite(observation.checkedAt) && observation.checkedAt >= 0) {
        return observation.checkedAt;
    }
    if (Number.isFinite(options.now) && options.now >= 0) return options.now;
    return Date.now();
}

function followsPreviousCheck(state, now, options) {
    const windowMs = Number.isFinite(options.confirmationWindowMs) && options.confirmationWindowMs > 0
        ? options.confirmationWindowMs
        : Infinity;
    return state.lastCheckAt > 0 && now >= state.lastCheckAt && now - state.lastCheckAt <= windowMs;
}

/**
 * Applies one checker result without mutating the persisted state.
 * Observations use { username?, status, sessionId?, checkedAt? }.
 */
function applyObservation(current, observation = {}, options = {}) {
    let state = normalizePlatformState(current);
    const now = observationTime(observation, options);
    const hasUsername = Object.prototype.hasOwnProperty.call(observation, 'username');

    if (hasUsername) {
        const username = cleanUsername(observation.username);
        if (state.username && username !== state.username) {
            state = createPlatformState(username);
        } else {
            state = { ...state, username };
        }
    }

    const status = VALID_STATUSES.has(observation.status)
        ? observation.status
        : CHECK_STATUS.UNKNOWN;
    const base = { ...state, lastCheckAt: now };

    if (status === CHECK_STATUS.UNKNOWN) {
        return {
            state: {
                ...base,
                candidateSessionId: null,
                consecutiveLiveCount: 0,
                consecutiveOfflineCount: 0
            },
            shouldNotify: false
        };
    }

    if (status === CHECK_STATUS.OFFLINE) {
        const offlineBase = {
            ...base,
            lastKnownAt: now,
            candidateSessionId: null,
            consecutiveLiveCount: 0
        };

        if (!state.initialized || state.status !== CHECK_STATUS.LIVE) {
            return {
                state: {
                    ...offlineBase,
                    status: CHECK_STATUS.OFFLINE,
                    initialized: true,
                    activeSessionId: null,
                    consecutiveOfflineCount: 0
                },
                shouldNotify: false
            };
        }

        const offlineCount = followsPreviousCheck(state, now, options)
            ? state.consecutiveOfflineCount + 1
            : 1;
        if (offlineCount < threshold(options.offlineThreshold, 3)) {
            return {
                state: { ...offlineBase, consecutiveOfflineCount: offlineCount },
                shouldNotify: false
            };
        }

        return {
            state: {
                ...offlineBase,
                status: CHECK_STATUS.OFFLINE,
                activeSessionId: null,
                consecutiveOfflineCount: 0
            },
            shouldNotify: false
        };
    }

    const sessionId = cleanSessionId(observation.sessionId);
    if (!sessionId) {
        return {
            state: {
                ...base,
                candidateSessionId: null,
                consecutiveLiveCount: 0,
                consecutiveOfflineCount: 0
            },
            shouldNotify: false
        };
    }

    const liveBase = {
        ...base,
        lastKnownAt: now,
        consecutiveOfflineCount: 0
    };

    if (state.status === CHECK_STATUS.LIVE && !state.activeSessionId) {
        return {
            state: {
                ...liveBase,
                initialized: true,
                activeSessionId: sessionId,
                handledSessionIds: rememberSession(state.handledSessionIds, sessionId),
                lastHandledSessionId: sessionId,
                candidateSessionId: null,
                consecutiveLiveCount: 0
            },
            shouldNotify: false
        };
    }

    if (state.status === CHECK_STATUS.LIVE && state.activeSessionId === sessionId) {
        return {
            state: {
                ...liveBase,
                handledSessionIds: rememberSession(state.handledSessionIds, sessionId),
                lastHandledSessionId: sessionId,
                candidateSessionId: null,
                consecutiveLiveCount: 0
            },
            shouldNotify: false
        };
    }

    const liveCount = state.candidateSessionId === sessionId && followsPreviousCheck(state, now, options)
        ? state.consecutiveLiveCount + 1
        : 1;

    if (liveCount < threshold(options.liveThreshold, 2)) {
        return {
            state: {
                ...liveBase,
                candidateSessionId: sessionId,
                consecutiveLiveCount: liveCount
            },
            shouldNotify: false
        };
    }

    const coldStart = !state.initialized;
    const next = {
        ...liveBase,
        status: CHECK_STATUS.LIVE,
        initialized: true,
        activeSessionId: sessionId,
        candidateSessionId: null,
        consecutiveLiveCount: 0,
        handledSessionIds: rememberSession(state.handledSessionIds, sessionId),
        lastHandledSessionId: sessionId
    };
    const cooldownMs = nonNegativeNumber(options.cooldownMs);
    const cooldownElapsed = state.lastNotifiedAt === 0
        || now - state.lastNotifiedAt >= cooldownMs;
    const shouldNotify = (!coldStart || options.notifyOnStartup === true)
        && !state.handledSessionIds.includes(sessionId)
        && cooldownElapsed;

    if (shouldNotify) {
        // Reserve before the caller sends so overlapping checks cannot duplicate it.
        next.lastNotifiedSessionId = sessionId;
        next.lastNotifiedAt = now;
    }

    return { state: next, shouldNotify };
}

module.exports = {
    CHECK_STATUS,
    createPlatformState,
    normalizePlatformState,
    applyObservation
};
