const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');

const defaultState = {
    tiktok: {
        isLive: false,
        consecutiveOfflineCount: 0,
        lastNotifiedAt: 0,
        lastCheckAt: 0
    },
    twitch: {
        isLive: false,
        consecutiveOfflineCount: 0,
        lastNotifiedAt: 0,
        lastCheckAt: 0
    }
};

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return {
                tiktok: { ...defaultState.tiktok, ...parsed.tiktok },
                twitch: { ...defaultState.twitch, ...parsed.twitch }
            };
        }
    } catch (err) {
        console.warn('⚠️ Could not load state.json, using default state:', err.message);
    }
    return JSON.parse(JSON.stringify(defaultState));
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Failed to save state.json:', err.message);
    }
}

module.exports = {
    loadState,
    saveState
};
