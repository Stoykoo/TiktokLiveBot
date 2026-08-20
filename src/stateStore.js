'use strict';

const fs = require('fs');
const path = require('path');
const { normalizePlatformState } = require('./liveState');

const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'state.json');

function stateFile(filePath) {
    return path.resolve(filePath || process.env.STATE_FILE || DEFAULT_STATE_FILE);
}

function normalizeState(raw, resetTransient = false) {
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const normalizePlatform = platform => {
        const state = normalizePlatformState(platform);
        return resetTransient ? {
            ...state,
            candidateSessionId: null,
            consecutiveLiveCount: 0,
            consecutiveOfflineCount: 0
        } : state;
    };
    return {
        tiktok: normalizePlatform(value.tiktok),
        twitch: normalizePlatform(value.twitch)
    };
}

function loadState(filePath) {
    const target = stateFile(filePath);
    try {
        return normalizeState(JSON.parse(fs.readFileSync(target, 'utf8')), true);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`Could not load ${target}; using a clean state: ${err.message}`);
        }
        return normalizeState();
    }
}

function saveState(state, filePath) {
    const target = stateFile(filePath);
    const temporary = `${target}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    const serialized = `${JSON.stringify(normalizeState(state), null, 2)}\n`;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
        fs.writeFileSync(temporary, serialized, 'utf8');
        fs.renameSync(temporary, target);
    } catch (err) {
        try {
            fs.unlinkSync(temporary);
        } catch {
            // The temporary file may not have been created.
        }
        throw err;
    }
}

module.exports = {
    loadState,
    saveState
};
