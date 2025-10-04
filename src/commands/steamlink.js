/*
    /link command for Discord bot
    Allows linking Discord users to Steam accounts, removing them,
    updating them, and displaying them grouped by Clan.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

// Replace with your channel ID
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

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);

    // Group users by clan
    const clans = {};
    for (const [userId, data] of Object.entries(linked)) {
        const clan = data.clan || 'No Clan';
        if (!clans[clan]) clans[clan] = [];
        clans[clan].push({ userId, ...data });
    }

    const embed = new EmbedBuilder()
        .setTitle('🔗 Team Member')
        .setColor('#1b2838')
        .setTimestamp();

    for (const [clan, members] of Object.entries(clans)) {
        let fieldValue = members.map(m => {
            let entry = `👤 <@${m.userId}>`;
            if (m.steamId) {
                entry += `\n🎮 [Steam Profile](https://steamcommunity.com/profiles/${m.steamId}/)`;
            }
            if (m.steamFriendCode) {
                entry += `\n🔑 Friend Code: \`${m.steamFriendCode}\``;
            }
            return entry;
        }).join('\n\n');

        embed.addFields({ name: `🏷️ Clan: ${clan}`, value: fieldValue });
    }

    if (Object.keys(clans).length === 0) {
        embed.setDescription('🚫 No users linked yet.');
    }

    // Handle persistent message
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

module.exports = {
    name: 'link',

    getData(client, guildId) {
        return new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link a Discord user to a Steam account')
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription('Link a Discord user to a Steam account')
                .addUserOption(option => option.setName('discorduser').setDescription('The Discord user').setRequired(true))
                .addStringOption(option => option.setName('steamid').setDescription('The Steam ID'))
                .addStringOption(option => option.setName('steamfriendcode').setDescription('Optional Steam friend code'))
                .addStringOption(option => option.setName('clan').setDescription('Clan name')))
            .addSubcommand(subcommand => subcommand
                .setName('update')
                .setDescription('Update a linked user')
                .addUserOption(option => option.setName('discorduser').setDescription('The Discord user').setRequired(true))
                .addStringOption(option => option.setName('steamid').setDescription('The Steam ID'))
                .addStringOption(option => option.setName('steamfriendcode').setDescription('Optional Steam friend code'))
                .addStringOption(option => option.setName('clan').setDescription('Clan name')))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription('Remove a linked user')
                .addUserOption(option => option.setName('discorduser').setDescription('The Discord user to unlink').setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription('Show all linked users'));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        await interaction.deferReply({ ephemeral: true });

        const linked = readLinkedUsers(guildId);
        const sub = interaction.options.getSubcommand();

        try {
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
        } catch (err) {
            console.error('LINK COMMAND ERROR:', err);
            await interaction.editReply({ content: `❌ Command failed: ${err.message}` });
        }
    },
};
