/*
    /link command for Discord bot
    Allows linking Discord users to Steam accounts, removing them,
    grouping them by Clan, and maintaining a persistent embed list.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

// Where to post the persistent list (replace with your channel ID)
const LIST_CHANNEL_ID = 'CHANNEL ID';
const LIST_MESSAGE_FILE = 'linkedUsers.json';

/* -------------------------- File Utilities -------------------------- */

function readLinkedUsers(guildId) {
    try {
        return InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE) || {};
    } catch {
        return {};
    }
}

function writeLinkedUsers(guildId, data) {
    InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE, data);
}

/* -------------------------- Table Formatting -------------------------- */

function formatTable(clanMembers) {
    const header = '`Team Member           | Status | Location`\n';
    const divider = '`-----------------------|--------|----------`\n';

    const rows = clanMembers.map(member => {
        const name = `<@${member.userId}>`.padEnd(23, ' ');
        const status = (member.status || '☠️').padEnd(6, ' ');
        const location = (member.location || '-').padEnd(8, ' ');
        return `\`${name}| ${status}| ${location}\``;
    });

    return header + divider + rows.join('\n');
}

/* -------------------------- Embed Update Logic -------------------------- */

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);

    // Group by clan
    const clanGroups = {};
    for (const [userId, data] of Object.entries(linked)) {
        const clan = data.clan || 'No Clan';
        if (!clanGroups[clan]) clanGroups[clan] = [];
        clanGroups[clan].push({
            userId,
            status: data.status || '☠️',
            location: data.location || '-',
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('🛡️ Team Member Information')
        .setColor('#1b2838')
        .setTimestamp();

    if (Object.keys(clanGroups).length === 0) {
        embed.setDescription('🚫 No users linked yet.');
    } else {
        const sortedClans = Object.keys(clanGroups).sort();
        for (const clan of sortedClans) {
            const tableText = formatTable(clanGroups[clan]);
            embed.addFields({ name: `🏴 ${clan}`, value: tableText });
        }
        embed.setFooter({ text: `Total linked users: ${Object.keys(linked).length}` });
    }

    // Manage persistent message
    const msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE + '.store') || {};
    let msg;

    try {
        if (msgStore.messageId) {
            msg = await channel.messages.fetch(msgStore.messageId);
            await msg.edit({ embeds: [embed] });
        } else {
            msg = await channel.send({ embeds: [embed] });
            msgStore.messageId = msg.id;
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
        }
    } catch {
        msg = await channel.send({ embeds: [embed] });
        msgStore.messageId = msg.id;
        InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
    }

    if (ephemeral && ephemeralInteraction) {
        await ephemeralInteraction.editReply({ embeds: [embed] });
    }
}

/* -------------------------- Command Export -------------------------- */

module.exports = {
    name: 'link',

    getData(client, guildId) {
        return new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link a Discord user to a Steam account')
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription('Link a Discord user and assign optional clan/status/location')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to link')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('clan')
                    .setDescription('The clan this user belongs to')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('status')
                    .setDescription('Optional status emoji or text')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('location')
                    .setDescription('Optional player location')
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription('Remove a linked user')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to unlink')
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription('Show all linked users by clan'));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'add': {
                const user = interaction.options.getUser('discorduser');
                const clan = interaction.options.getString('clan') || 'No Clan';
                const status = interaction.options.getString('status') || '☠️';
                const location = interaction.options.getString('location') || '-';

                const linked = readLinkedUsers(guildId);
                linked[user.id] = { clan, status, location };
                writeLinkedUsers(guildId, linked);

                await sendOrUpdateList(client, guildId, true, interaction);
                break;
            }

            case 'remove': {
                const user = interaction.options.getUser('discorduser');
                const linked = readLinkedUsers(guildId);

                if (linked[user.id]) {
                    delete linked[user.id];
                    writeLinkedUsers(guildId, linked);
                }

                await sendOrUpdateList(client, guildId, true, interaction);
                break;
            }

            case 'list': {
                await sendOrUpdateList(client, guildId, true, interaction);
                break;
            }
        }
    },
};
