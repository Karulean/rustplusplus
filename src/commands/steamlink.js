/*
    /link command for Discord bot
    Allows linking Discord users to Steam accounts, removing them,
    updating them, and maintaining a persistent embed list in a specified channel.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

// Where to post the persistent list (replace with your channel ID)
const LIST_CHANNEL_ID = 'CHANNEL_ID';
const LIST_MESSAGE_FILE = 'linkedUsers.json';

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

function buildClanTables(linked) {
    const clans = {};

    for (const [userId, data] of Object.entries(linked)) {
        const clan = data.clan || 'No Clan';
        if (!clans[clan]) clans[clan] = [];

        clans[clan].push({
            discord: `<@${userId}>`,
            steamId: data.steamId || null,
            friendCode: data.steamFriendCode || '-',
            clan: clan,
        });
    }

    // Sort clans alphabetically
    const sortedClans = Object.keys(clans).sort();

    const fields = sortedClans.map(clanName => {
        const members = clans[clanName]
            .map(m => {
                return `${m.discord.padEnd(18)} | ${m.friendCode.padEnd(14)} | ${m.clan}`;
            })
            .join('\n');

        const tableHeader = `Discord${' '.repeat(13)} | Friend Code   | Clan\n` +
                            `------------------|---------------|------------\n`;

        return {
            name: `🏷️ Clan: ${clanName}`,
            value: "```" + tableHeader + members + "```",
            inline: false,
        };
    });

    return fields;
}

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);

    const fields = buildClanTables(linked);

    const embed = new EmbedBuilder()
        .setTitle('🔗 Linked Steam Accounts')
        .setColor('#1b2838')
        .setFooter({ text: `Total linked users: ${Object.keys(linked).length}` })
        .setTimestamp();

    if (fields.length > 0) {
        embed.addFields(fields);
    } else {
        embed.setDescription('🚫 No users linked yet.');
    }

    const msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE + '.store') || {};
    let msg;
    if (msgStore.messageId) {
        try {
            msg = await channel.messages.fetch(msgStore.messageId);

            if (!msg.embeds || msg.embeds.length === 0) {
                msg = await channel.send({ embeds: [embed] });
                msgStore.messageId = msg.id;
                InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
            } else {
                await msg.edit({ embeds: [embed] });
            }
        } catch {
            msg = await channel.send({ embeds: [embed] });
            msgStore.messageId = msg.id;
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
        }
    } else {
        msg = await channel.send({ embeds: [embed] });
        msgStore.messageId = msg.id;
        InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
    }

    if (ephemeral && ephemeralInteraction) {
        await ephemeralInteraction.editReply({ embeds: [embed] });
    }
}

module.exports = {
    name: 'link',

    getData(client, guildId) {
        return new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link a Discord user to a Steam account')
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription('Link a Discord user to a Steam account')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to link')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('steamid')
                    .setDescription('The Steam ID')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('steamfriendcode')
                    .setDescription('Optional Steam friend code')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('clan')
                    .setDescription('Clan name')
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription('Remove a linked user')
                .addUserOption(option => option
                    .setName('discorduser')
                    .setDescription('The Discord user to unlink')
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('update')
                .setDescription('Update a linked user')
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
                .setName('list')
                .setDescription('Show all linked users'));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'add': {
                const user = interaction.options.getUser('discorduser');
                const steamId = interaction.options.getString('steamid');
                const steamFriendCode = interaction.options.getString('steamfriendcode') || null;
                const clan = interaction.options.getString('clan') || 'No Clan';

                const linked = readLinkedUsers(guildId);
                linked[user.id] = { steamId, steamFriendCode, clan };
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

            case 'update': {
                const user = interaction.options.getUser('discorduser');
                const steamId = interaction.options.getString('steamid');
                const steamFriendCode = interaction.options.getString('steamfriendcode');
                const clan = interaction.options.getString('clan');

                const linked = readLinkedUsers(guildId);
                if (linked[user.id]) {
                    if (steamId !== null) linked[user.id].steamId = steamId;
                    if (steamFriendCode !== null) linked[user.id].steamFriendCode = steamFriendCode;
                    if (clan !== null) linked[user.id].clan = clan;
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
