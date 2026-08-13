const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Genera un embed profesional y elegante para avisar que inició directo.
 */
function createLiveEmbed({ platform, username, title, roomLink, viewerCount, coverUrl, avatarUrl, pingRole }) {
    const isTikTok = platform.toLowerCase() === 'tiktok';
    const color = isTikTok ? 0xFE2C55 : 0x9146FF; // Rojo TikTok o Morado Twitch
    const platformName = isTikTok ? 'TikTok Live' : 'Twitch';
    const iconUrl = isTikTok 
        ? 'https://cdn-icons-png.flaticon.com/512/3046/3046124.png' 
        : 'https://cdn-icons-png.flaticon.com/512/5968/5968819.png';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: `🔴 ¡Estamos EN VIVO en ${platformName}!`,
            iconURL: iconUrl
        })
        .setTitle(title || `¡Acompáñanos en el directo de @${username}!`)
        .setURL(roomLink)
        .setDescription(`**${username}** acaba de iniciar transmisión en vivo.\n¡No te lo pierdas y ven a saludar en el chat! 🚀`)
        .addFields(
            { name: '📺 Canal', value: `[@${username}](${roomLink})`, inline: true },
            { name: '🌐 Plataforma', value: platformName, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Notificaciones de Directos' });

    if (viewerCount && viewerCount > 0) {
        embed.addFields({ name: '👥 Espectadores', value: `${viewerCount}`, inline: true });
    }

    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    }

    if (coverUrl) {
        embed.setImage(coverUrl);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('▶️ Ir al Directo')
            .setStyle(ButtonStyle.Link)
            .setURL(roomLink)
    );

    let content = null;
    if (pingRole) {
        if (pingRole === 'everyone') {
            content = '@everyone 🔴 ¡ESTAMOS EN DIRECTO!';
        } else if (pingRole === 'here') {
            content = '@here 🔴 ¡ESTAMOS EN DIRECTO!';
        } else {
            content = `<@&${pingRole}> 🔴 ¡ESTAMOS EN DIRECTO!`;
        }
    }

    return { content, embeds: [embed], components: [row] };
}

module.exports = { createLiveEmbed };
