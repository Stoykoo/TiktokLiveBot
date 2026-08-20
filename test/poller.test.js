const test = require('node:test');
const assert = require('node:assert/strict');
const { createPoller } = require('../src/poller');

test('varios ticks simultáneos comparten una sola ejecución', async () => {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const poller = createPoller(async () => {
        calls += 1;
        await gate;
    }, 60_000);

    const first = poller.start();
    await Promise.resolve();
    const duplicates = [poller.runNow(), poller.runNow(), poller.runNow()];
    release();
    await Promise.all([first, ...duplicates]);
    await poller.stop();

    assert.equal(calls, 1);
});

test('el intervalo se programa después de terminar, nunca encima', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let done;
    const finished = new Promise(resolve => { done = resolve; });
    const poller = createPoller(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 8));
        active -= 1;
        if (calls === 3) done();
    }, 1);

    poller.start();
    await finished;
    await poller.stop();

    assert.equal(maxActive, 1);
    assert.equal(calls, 3);
});
