/*
    Link Command Module
    Lets users link/unlink their SteamID to Discord.
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const InstanceUtils = require('../util/instanceUtils.js');

const LINKED_USERS_FILE = 'linkedUsers.json'; // stored per guild
const LIST_MESSAGE_FILE = 'listMessage.json'; // stores the message ID
const LIST_CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE'; // replace with your channel ID

module.exports = {
    name: 'link',

    getData(client, guildId) {
        return new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link or manage your Steam ID')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Link your Steam ID to your Discord')
                    .addStringOption(option =>
                        option.setName('steam_id')
                            .setDescription('Your Steam ID')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Remove your linked Steam ID'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Show all linked users'));
    },

    async execute(client, interaction) {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();

        switch (sub) {
            case 'add':
                await addLink(client, interaction);
                break;
            case 'remove':
                await removeLink(client, interaction);
                break;
            case 'list':
                await sendOrUpdateList(client, interaction.guildId, true, interaction);
                break;
        }
    }
};

// --- Helper functions ---

function readLinkedUsers(guildId) {
    return InstanceUtils.readCustomFile(guildId, LINKED_USERS_FILE) || {};
}

function writeLinkedUsers(guildId, data) {
    InstanceUtils.writeCustomFile(guildId, LINKED_USERS_FILE, data);
}

async function addLink(client, interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const steamId = interaction.options.getString('steam_id');

    const linked = readLinkedUsers(guildId);

    if (linked[userId]) {
        await interaction.editReply('⚠️ You already linked a Steam ID. Use `/link remove` first.');
        return;
    }

    linked[userId] = { steamId };
    writeLinkedUsers(guildId, linked);

    await interaction.editReply(`✅ Linked Steam ID \`${steamId}\` to your Discord.`);
    await sendOrUpdateList(client, guildId);
}

async function removeLink(client, interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const linked = readLinkedUsers(guildId);

    if (!linked[userId]) {
        await interaction.editReply('⚠️ You do not have a linked Steam ID.');
        return;
    }

    delete linked[userId];
    writeLinkedUsers(guildId, linked);

    await interaction.editReply('✅ Removed your linked Steam ID.');
    await sendOrUpdateList(client, guildId);
}

/**
 * Updates the embed list message in the specified channel.
 * If ephemeralInteraction is provided, it will also show the list to the user privately.
 */
async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);
    const members = Object.entries(linked).map(([userId, data]) => {
        return `👤 <@${userId}>  —  🎮 SteamID: \`${data.steamId}\``;
    });

    const description = members.length > 0
        ? members.join('\n')
        : '🚫 No users linked yet.';

    // build embed
    const embed = new EmbedBuilder()
        .setTitle('🔗 Linked Steam Accounts')
        .setDescription(description)
        .setColor('#2f3136')
        .setFooter({ text: `Total linked users: ${members.length}` })
        .setTimestamp();

    // update persistent channel message
    const msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE) || {};
    let msg;
    if (msgStore.messageId) {
        try {
            msg = await channel.messages.fetch(msgStore.messageId);
            await msg.edit({ embeds: [embed] });
        } catch {
            msg = await channel.send({ embeds: [embed] });
            msgStore.messageId = msg.id;
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE, msgStore);
        }
    } else {
        msg = await channel.send({ embeds: [embed] });
        msgStore.messageId = msg.id;
        InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE, msgStore);
    }

    //reply
    if (ephemeral && ephemeralInteraction) {
        await ephemeralInteraction.editReply({ embeds: [embed] });
    }
}
