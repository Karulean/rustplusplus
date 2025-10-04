/*
    /link command for Discord bot
    Allows linking Discord users to Steam accounts, removing them,
    and maintaining a persistent embed list in a specified channel.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

// Where to post the persistent list (replace with your channel ID)
const LIST_CHANNEL_ID = 'CHANNEL ID';
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

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);

    const members = Object.entries(linked).map(([userId, data]) => {
        let line = `👤 <@${userId}> — 🎮 [Steam Profile](https://steamcommunity.com/profiles/${data.steamId}/)`;
        if (data.steamFriendCode) {
            line += ` — 🔑 Friend Code: \`${data.steamFriendCode}\``;
        }
        return line;
    });

    const description = members.length > 0
        ? members.join('\n')
        : '🚫 No users linked yet.';

    // build embed
    const embed = new EmbedBuilder()
        .setTitle('🔗 Linked Steam Accounts')
        .setDescription(description)
        .setColor('#1b2838') // Steam blue/grey
        .setFooter({ text: `Total linked users: ${members.length}` })
        .setTimestamp();

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

                const linked = readLinkedUsers(guildId);
                linked[user.id] = { steamId, steamFriendCode };
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
