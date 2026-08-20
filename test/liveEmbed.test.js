const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveEmbed } = require('../src/embeds/liveEmbed');

function payload(pingRole) {
    return createLiveEmbed({
        platform: 'tiktok',
        username: 'canal',
        title: 'En vivo',
        roomLink: 'https://www.tiktok.com/@canal/live',
        viewerCount: 10,
        coverUrl: 'javascript:alert(1)',
        avatarUrl: 'https://example.com/avatar.png',
        pingRole
    });
}

test('limita las menciones a la mención configurada', () => {
    assert.deepEqual(payload('').allowedMentions, { parse: [] });
    assert.deepEqual(payload('everyone').allowedMentions, { parse: ['everyone'] });
    assert.deepEqual(payload('123456789012345678').allowedMentions, {
        parse: [],
        roles: ['123456789012345678']
    });
});

test('descarta imágenes con protocolos no seguros', () => {
    const embed = payload('').embeds[0].toJSON();
    assert.equal(embed.image, undefined);
    assert.equal(embed.thumbnail.url, 'https://example.com/avatar.png');
});
