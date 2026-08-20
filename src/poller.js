function createPoller(task, intervalMs, onError = console.error) {
    let stopped = true;
    let timer = null;
    let current = null;

    async function runNow() {
        if (stopped) return;
        if (current) return current;

        current = Promise.resolve().then(task);
        try {
            await current;
        } catch (error) {
            onError(error);
        } finally {
            current = null;
            if (!stopped) timer = setTimeout(runNow, intervalMs);
        }
    }

    function start() {
        if (!stopped) return current;
        stopped = false;
        return runNow();
    }

    async function stop() {
        stopped = true;
        clearTimeout(timer);
        if (current) await current.catch(() => {});
    }

    return {
        start,
        stop,
        runNow,
        get running() { return Boolean(current); }
    };
}

module.exports = { createPoller };
