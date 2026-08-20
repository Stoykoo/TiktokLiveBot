const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { InteractionContextType, PermissionFlagsBits } = require('discord.js');
const {
    buildCommands,
    commitTransition,
    createHealthServer,
    notificationNonce,
    statusText,
    validateNotificationChannel
} = require('../src/index');

function request(server, pathname) {
    const { port } = server.address();
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: pathname }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        }).on('error', reject);
    });
}

test('el nonce es estable por sesión y distinto entre sesiones', () => {
    const first = notificationNonce('tiktok', 'Canal', 'room-1');
    assert.equal(first, notificationNonce('tiktok', 'canal', 'room-1'));
    assert.notEqual(first, notificationNonce('tiktok', 'canal', 'room-2'));
    assert.equal(first.length, 24);
});

test('los comandos peligrosos nacen limitados a administradores del servidor', () => {
    const commands = buildCommands();
    const status = commands.find(command => command.name === 'status');
    const testNotify = commands.find(command => command.name === 'test-notify');
    const config = commands.find(command => command.name === 'config-bot');

    assert.deepEqual(status.contexts, [InteractionContextType.Guild]);
    assert.equal(status.default_member_permissions, undefined);
    for (const command of [testNotify, config]) {
        assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
        assert.equal(command.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
    }
});

test('un fallo al persistir revierte la reserva y no llama Discord', async () => {
    const before = { tiktok: { status: 'offline' } };
    const next = { tiktok: { status: 'live', lastHandledSessionId: 'A' } };
    let failSave = true;
    let sends = 0;
    const args = {
        beforeState: before,
        nextState: next,
        shouldNotify: true,
        persist: () => { if (failSave) throw new Error('disk'); },
        send: async () => { sends += 1; }
    };

    let result = await commitTransition(args);
    assert.equal(result.state, before);
    assert.equal(result.errorStage, 'persist');
    assert.equal(sends, 0);

    failSave = false;
    result = await commitTransition(args);
    assert.equal(result.state, next);
    assert.equal(result.delivered, true);
    assert.equal(sends, 1);
});

test('un fallo ambiguo de Discord conserva la reserva', async () => {
    const before = { value: 'before' };
    const next = { value: 'reserved' };
    const result = await commitTransition({
        beforeState: before,
        nextState: next,
        shouldNotify: true,
        persist: () => {},
        send: async () => { throw new Error('timeout'); }
    });

    assert.equal(result.state, next);
    assert.equal(result.persisted, true);
    assert.equal(result.delivered, false);
    assert.equal(result.errorStage, 'delivery');
});

test('valida permisos reales del canal antes de reservar', () => {
    const granted = new Set([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
    ]);
    const channel = {
        guildId: 'guild',
        guild: { roles: { cache: new Map() } },
        isSendable: () => true,
        isThread: () => false,
        permissionsFor: () => ({ has: permission => granted.has(permission) })
    };
    const client = { user: {} };

    assert.equal(validateNotificationChannel(channel, client, ''), channel);
    assert.throws(
        () => validateNotificationChannel(channel, client, 'everyone'),
        /Mencionar @everyone/
    );
    assert.throws(
        () => validateNotificationChannel(channel, client, '123456789012345678'),
        /rol configurado no existe/
    );
    granted.delete(PermissionFlagsBits.EmbedLinks);
    assert.throws(() => validateNotificationChannel(channel, client, ''), /faltan permisos/);
});

test('readyz exige Discord, estado escribible y lectura reciente', async t => {
    let discordReady = false;
    const client = { isReady: () => discordReady };
    const runtime = {
        lastCycleAt: 0,
        lastKnownAt: { tiktok: 0, twitch: 0 },
        stateHealthy: true,
        notificationHealthy: true,
        lastDeliveryErrorAt: 0,
        stopping: false
    };
    const server = createHealthServer(client, runtime, {
        checkIntervalMs: 60_000,
        monitorTikTok: true,
        monitorTwitch: true
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    assert.equal((await request(server, '/healthz')).status, 200);
    assert.equal((await request(server, '/readyz')).status, 503);

    discordReady = true;
    runtime.lastKnownAt.tiktok = Date.now();
    assert.equal((await request(server, '/readyz')).status, 503);
    runtime.lastKnownAt.twitch = Date.now();
    assert.equal((await request(server, '/readyz')).status, 200);

    runtime.stateHealthy = false;
    assert.equal((await request(server, '/readyz')).status, 503);
    runtime.stateHealthy = true;
    runtime.notificationHealthy = false;
    assert.equal((await request(server, '/readyz')).status, 503);
    runtime.notificationHealthy = true;
    runtime.lastKnownAt.tiktok = Date.now() + 60_000;
    assert.equal((await request(server, '/readyz')).status, 503);
});

test('status distingue una lectura unknown de offline', () => {
    const text = statusText('tiktok', 'canal', {
        status: 'offline',
        lastKnownAt: 1_000,
        lastCheckAt: 2_000
    });
    assert.match(text, /sin confirmación actual/);
    assert.doesNotMatch(text, /\*\*TikTok \(@canal\):\*\* offline/);
});
