/*
    /link command for Discord bot
    Displays users grouped by clan with unique embed colors.
    Columns: Team Member | Friend Code | Clan
*/

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const InstanceUtils = require('../util/instanceUtils.js');

const LIST_CHANNEL_ID = 'CHANNEL_ID'; // ← Replace with your actual channel ID
const LIST_MESSAGE_FILE = 'linkedUsers.json';

/* ---------- Helpers ---------- */
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

// Convert clan name to consistent color
function clanToColor(clanName) {
    const hash = crypto.createHash('md5').update(clanName).digest('hex');
    return parseInt(hash.slice(0, 6), 16);
}

function buildClanEmbeds(linked) {
    const clans = {};

    for (const [userId, data] of Object.entries(linked)) {
        const clan = data.clan || 'No Clan';
        if (!clans[clan]) clans[clan] = [];
        clans[clan].push({
            discord: `<@${userId}>`,
            friendCode: data.steamFriendCode || '-',
        });
    }

    const sortedClans = Object.keys(clans).sort();
    const embeds = [];

    for (const clanName of sortedClans) {
        const members = clans[clanName];
        const memberCol = members.map(m => m.discord).join('\n');
        const codeCol = members.map(m => m.friendCode).join('\n');
        const clanCol = members.map(() => clanName).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`🏷️ ${clanName}`)
            .setColor(clanToColor(clanName))
            .addFields(
                { name: 'Team Member', value: memberCol || '-', inline: true },
                { name: 'Friend Code', value: codeCol || '-', inline: true },
                { name: 'Clan', value: clanCol || '-', inline: true }
            )
            .setFooter({ text: `Total members: ${members.length}` })
            .setTimestamp();

        embeds.push(embed);
    }

    if (embeds.length === 0) {
        embeds.push(new EmbedBuilder()
            .setTitle('👥 Team Member Information')
            .setDescription('🚫 No members linked yet.')
            .setColor('#2b2d31'));
    }

    return embeds;
}

async function sendOrUpdateList(client, guildId, ephemeral = false, ephemeralInteraction = null) {
    const channel = client.channels.cache.get(LIST_CHANNEL_ID);
    if (!channel) return;

    const linked = readLinkedUsers(guildId);
    const embeds = buildClanEmbeds(linked);

    const msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE + '.store') || {};
    let msg;

    try {
        if (msgStore.messageId) {
            msg = await channel.messages.fetch(msgStore.messageId);
            await msg.edit({ embeds });
        } else {
            msg = await channel.send({ embeds });
            msgStore.messageId = msg.id;
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
        }
    } catch {
        msg = await channel.send({ embeds });
        msgStore.messageId = msg.id;
        InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
    }

    if (ephemeral && ephemeralInteraction) {
        await ephemeralInteraction.editReply({ embeds });
    }
}

/* ---------- Command ---------- */
module.exports = {
    name: 'link',

    getData(client, guildId) {
        return new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link or update members with their clan information')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add a new member to the list')
                .addUserOption(o => o.setName('discorduser').setDescription('Discord user').setRequired(true))
                .addStringOption(o => o.setName('steamfriendcode').setDescription('Steam Friend Code').setRequired(false))
                .addStringOption(o => o.setName('clan').setDescription('Clan name').setRequired(false)))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a member from the list')
                .addUserOption(o => o.setName('discorduser').setDescription('Discord user').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('update')
                .setDescription('Update a member’s info')
                .addUserOption(o => o.setName('discorduser').setDescription('Discord user').setRequired(true))
                .addStringOption(o => o.setName('steamfriendcode').setDescription('New Steam Friend Code').setRequired(false))
                .addStringOption(o => o.setName('clan').setDescription('New Clan').setRequired(false)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('Show all members'));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        await interaction.deferReply({ ephemeral: true });

        const sub = interaction.options.getSubcommand();
        const linked = readLinkedUsers(guildId);

        if (sub === 'add') {
            const user = interaction.options.getUser('discorduser');
            const steamFriendCode = interaction.options.getString('steamfriendcode') || '-';
            const clan = interaction.options.getString('clan') || 'No Clan';

            linked[user.id] = { steamFriendCode, clan };
            writeLinkedUsers(guildId, linked);

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'remove') {
            const user = interaction.options.getUser('discorduser');
            delete linked[user.id];
            writeLinkedUsers(guildId, linked);

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'update') {
            const user = interaction.options.getUser('discorduser');
            const steamFriendCode = interaction.options.getString('steamfriendcode');
            const clan = interaction.options.getString('clan');

            if (linked[user.id]) {
                if (steamFriendCode !== null) linked[user.id].steamFriendCode = steamFriendCode;
                if (clan !== null) linked[user.id].clan = clan;
                writeLinkedUsers(guildId, linked);
            }

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'list') {
            await sendOrUpdateList(client, guildId, true, interaction);
        }
    },
};
