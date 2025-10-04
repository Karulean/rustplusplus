/*
    /link command for Discord bot
    Allows linking Discord users to Steam accounts and clans,
    updating them, and maintaining a persistent embed list.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

// Where to post the persistent list (replace with your channel ID)
const LIST_CHANNEL_ID = 'CHANNEL ID';
const LIST_MESSAGE_FILE = 'linkedUsers.json';

/* -------------------------- File Helpers -------------------------- */

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

/* -------------------------- Embed Formatting -------------------------- */

function formatClanSection(clanName, members) {
    let desc = '```Team Member                 Steam ID / Friend Code```';
    for (const m of members) {
        const user = `<@${m.userId}>`;
        const steam = m.steamId ? `${m.steamId}` : '-';
        const friend = m.steamFriendCode ? `${m.steamFriendCode}` : '-';
        desc += `\n${user.padEnd(27)} ${steam} / ${friend}`;
    }
    desc += '```';
    return { name: `🏴 ${clanName}`, value: desc };
}

/* -------------------------- Embed Update Logic -------------------------- */

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);

    const clanGroups = {};
    for (const [userId, data] of Object.entries(linked)) {
        const clan = data.clan || 'No Clan';
        if (!clanGroups[clan]) clanGroups[clan] = [];
        clanGroups[clan].push({
            userId,
            steamId: data.steamId || null,
            steamFriendCode: data.steamFriendCode || null,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('🛡️ Team Members')
        .setColor('#1b2838')
        .setTimestamp();

    if (Object.keys(clanGroups).length === 0) {
        embed.setDescription('🚫 No users linked yet.');
    } else {
        const sortedClans = Object.keys(clanGroups).sort();
        for (const clan of sortedClans) {
            embed.addFields(formatClanSection(clan, clanGroups[clan]));
        }
        embed.setFooter({ text: `Total linked users: ${Object.keys(linked).length}` });
    }

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
            .setDescription('Link Discord users to Steam accounts and clans')
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription('Link a Discord user with optional Steam info and clan')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to link')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('steamid')
                    .setDescription('Steam ID (optional)')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('steamfriendcode')
                    .setDescription('Steam friend code (optional)')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('clan')
                    .setDescription('Clan this user belongs to')
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('update')
                .setDescription('Update an existing user’s Steam info or clan')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to update')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('steamid')
                    .setDescription('New Steam ID')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('steamfriendcode')
                    .setDescription('New Steam friend code')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('clan')
                    .setDescription('New clan name')
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

        const linked = readLinkedUsers(guildId);
        const sub = interaction.options.getSubcommand();

        switch (sub) {
            case 'add': {
                const user = interaction.options.getUser('discorduser');
                const steamId = interaction.options.getString('steamid') || null;
                const steamFriendCode = interaction.options.getString('steamfriendcode') || null;
                const clan = interaction.options.getString('clan') || 'No Clan';

                linked[user.id] = { steamId, steamFriendCode, clan };
                writeLinkedUsers(guildId, linked);

                await sendOrUpdateList(client, guildId, true, interaction);
                break;
            }

            case 'update': {
                const user = interaction.options.getUser('discorduser');

                if (!linked[user.id]) {
                    await interaction.editReply({ content: '❌ This user is not currently linked.' });
                    return;
                }

                const steamId = interaction.options.getString('steamid');
                const steamFriendCode = interaction.options.getString('steamfriendcode');
                const clan = interaction.options.getString('clan');

                if (steamId !== null) linked[user.id].steamId = steamId;
                if (steamFriendCode !== null) linked[user.id].steamFriendCode = steamFriendCode;
                if (clan !== null) linked[user.id].clan = clan;

                writeLinkedUsers(guildId, linked);
                await sendOrUpdateList(client, guildId, true, interaction);
                break;
            }

            case 'remove': {
                const user = interaction.options.getUser('discorduser');
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
