/*
    /link command for Discord bot
    Displays users grouped by clan with unique embed colors.
    Columns: Team Member | SteamID | SteamName
*/

var Builder = require('@discordjs/builders');
var EmbedBuilder = require('discord.js').EmbedBuilder;
var crypto = require('crypto');
var InstanceUtils = require('../util/instanceUtils.js');

var LIST_CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE'; // Replace with your actual channel ID
var LIST_MESSAGE_FILE = 'linkedUsers.json';
var INACTIVE_AFTER_MS = 24 * 60 * 60 * 1000;

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

function findLinkedUser(linked, steamId, name) {
    for (var userId in linked) {
        var data = linked[userId];
        if (steamId && data.steamFriendCode && data.steamFriendCode.toString() === steamId.toString()) {
            return userId;
        }
        if (steamId && data.steamId && data.steamId.toString() === steamId.toString()) {
            return userId;
        }
        if (name && data.name && data.name.toLowerCase() === name.toLowerCase()) {
            return userId;
        }
    }
    return null;
}

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSimilarName(a, b) {
    var normA = normalizeName(a);
    var normB = normalizeName(b);
    if (normA === normB) return true;

    if (normA.length < 3 || normB.length < 3) return false;

    var lenA = normA.length;
    var lenB = normB.length;
    var minLen = Math.min(lenA, lenB);
    var maxLen = Math.max(lenA, lenB);

    if (minLen / maxLen < 0.6) return false;

    var setA = {};
    for (var i = 0; i < normA.length; i++) setA[normA[i]] = true;
    var setB = {};
    for (var i = 0; i < normB.length; i++) setB[normB[i]] = true;

    var intersection = 0;
    var unionSet = {};
    for (var c in setA) {
        unionSet[c] = true;
        if (setB[c]) intersection++;
    }
    for (var c in setB) {
        unionSet[c] = true;
    }
    var union = Object.keys(unionSet).length;

    var jaccard = union > 0 ? intersection / union : 0;
    return jaccard >= 0.95;
}

function syncActiveStatus(linked, rustplus) {
    if (!rustplus || !rustplus.team) return false;

    var changed = false;
    var players = rustplus.team.players;
    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        var userId = findLinkedUser(linked, player.steamId, player.name);
        if (!userId) continue;

        var entry = linked[userId];
        if (player.isOnline) {
            if (entry.status !== 'active') {
                entry.status = 'active';
                changed = true;
            }
            continue;
        }

        var offlineMs = player.wentOfflineTime
            ? (Date.now() - new Date(player.wentOfflineTime).getTime())
            : INACTIVE_AFTER_MS;
        if (offlineMs >= INACTIVE_AFTER_MS) {
            if (entry.status !== 'inactive') {
                entry.status = 'inactive';
                changed = true;
            }
        } else if (entry.status !== 'active') {
            entry.status = 'active';
            changed = true;
        }
    }
    return changed;
}

function syncRemoveLeftPlayers(linked, rustplus) {
    if (!rustplus || !rustplus.team) return false;

    var changed = false;
    var currentSteamIds = {};
    var players = rustplus.team.players;
    for (var i = 0; i < players.length; i++) {
        if (players[i].steamId) {
            currentSteamIds[players[i].steamId.toString()] = true;
        }
    }

    for (var userId in linked) {
        var data = linked[userId];
        if (data.isPlaceholder) continue;
        var steamIdStr = data.steamFriendCode ? data.steamFriendCode.toString() : null;
        if (steamIdStr && currentSteamIds[steamIdStr]) continue;

        delete linked[userId];
        changed = true;
    }

    return changed;
}

function autoMatchTeamMembers(linked, client, guildId, rustplus) {
    if (!rustplus || !rustplus.team) return false;

    var guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    var changed = false;
    var linkedSteamIds = {};
    for (var uid in linked) {
        var sf = linked[uid].steamFriendCode;
        if (sf) linkedSteamIds[sf.toString()] = true;
    }

    var availableMembers = [];
    guild.members.cache.forEach(function(member) {
        if (!linked[member.id]) {
            availableMembers.push(member);
        }
    });

    var players = rustplus.team.players;
    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        if (!player.steamId) continue;
        if (linkedSteamIds[player.steamId.toString()]) continue;

        var bestMatch = null;
        var bestScore = 0;
        for (var j = 0; j < availableMembers.length; j++) {
            var member = availableMembers[j];
            if (linked[member.id]) continue;
            var score = isSimilarName(member.user.username, player.name) ? 1 : 0;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = member;
            }
        }

        if (bestMatch && bestScore > 0) {
            linked[bestMatch.id] = {
                steamFriendCode: player.steamId,
                steamId: player.steamId,
                name: player.name,
                steamName: '',
                clan: 'No Clan',
                status: player.isOnline ? 'active' : 'inactive'
            };
            availableMembers.splice(availableMembers.indexOf(bestMatch), 1);
            linkedSteamIds[player.steamId.toString()] = true;
            changed = true;
        } else {
            var placeholderId = 'placeholder_' + player.steamId;
            linked[placeholderId] = {
                steamFriendCode: player.steamId,
                steamId: player.steamId,
                name: player.name,
                steamName: '',
                clan: 'No Clan',
                status: player.isOnline ? 'active' : 'inactive',
                isPlaceholder: true
            };
            changed = true;
        }
    }

    return changed;
}

function syncSteamNames(linked, rustplus) {
    if (!rustplus || !rustplus.team) return false;

    var changed = false;
    var players = rustplus.team.players;
    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        var userId = findLinkedUser(linked, player.steamId, player.name);
        if (!userId) continue;

        var entry = linked[userId];
        if (entry.steamName !== player.name) {
            entry.steamName = player.name;
            changed = true;
        }
    }
    return changed;
}

function clanToColor(clanName) {
    var hash = crypto.createHash('md5').update(clanName).digest('hex');
    return parseInt(hash.slice(0, 6), 16);
}

function truncate(str, max) {
    max = max || 1000;
    if (str.length <= max) return str;
    return str.slice(0, max - 20) + '\n... (truncated)';
}

function buildClanEmbeds(linked) {
    var clans = {};

    for (var userId in linked) {
        var data = linked[userId];
        var clan = data.clan || 'No Clan';
        var status = data.status === 'inactive' ? '\u{1F534}' : '\u{1F7E2}';
        var memberDisplay = data.isPlaceholder
            ? status + ' ' + data.name
            : status + ' <@' + userId + '>';
        if (!clans[clan]) clans[clan] = [];
        clans[clan].push({
            discord: memberDisplay,
            friendCode: data.steamFriendCode && data.steamFriendCode !== '-'
                ? '[' + data.steamFriendCode + '](https://steamcommunity.com/profiles/' + data.steamFriendCode + ')'
                : '-',
            steamName: data.steamName || '-'
        });
    }

    var sortedClans = Object.keys(clans).sort();
    var embeds = [];

    for (var i = 0; i < sortedClans.length; i++) {
        var clanName = sortedClans[i];
        var members = clans[clanName];
        var memberCol = '';
        var codeCol = '';
        var steamNameCol = '';
        for (var j = 0; j < members.length; j++) {
            memberCol += members[j].discord + '\n';
            codeCol += members[j].friendCode + '\n';
            steamNameCol += members[j].steamName + '\n';
        }

        var embed = new EmbedBuilder()
            .setTitle('\u{1F3F3}\u{FE0F} ' + clanName)
            .setColor(clanToColor(clanName))
            .addFields(
                { name: 'Team Member', value: truncate(memberCol) || '-', inline: true },
                { name: 'SteamID', value: truncate(codeCol) || '-', inline: true },
                { name: 'SteamName', value: truncate(steamNameCol) || '-', inline: true }
            )
            .setFooter({ text: 'Total members: ' + members.length + ' (\u{1F7E2} active, \u{1F534} inactive)' })
            .setTimestamp();

        embeds.push(embed);
    }

    if (embeds.length === 0) {
        embeds.push(new EmbedBuilder()
            .setTitle('Team Member Information')
            .setDescription('\u{1F6AB} No members linked yet.')
            .setColor('#2b2d31'));
    }

    return embeds;
}

async function sendOrUpdateList(client, guildId, ephemeral, ephemeralInteraction) {
    console.log('[steamlink] sendOrUpdateList: guild=' + guildId + ' ephemeral=' + ephemeral);
    try {
        var channel = client.channels.cache.get(LIST_CHANNEL_ID);
        console.log('[steamlink] channel found: ' + !!channel);
        if (!channel) {
            if (ephemeral && ephemeralInteraction) {
                await ephemeralInteraction.editReply({
                    content: 'List channel not found. Please contact an admin.',
                    ephemeral: true
                });
            }
            return;
        }

        var linked = readLinkedUsers(guildId);
        var embeds = buildClanEmbeds(linked);

        var msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE + '.store') || {};
        var msg;

        try {
            if (msgStore.messageId) {
                msg = await channel.messages.fetch(msgStore.messageId);
                await msg.edit({ embeds: embeds });
            } else {
                msg = await channel.send({ embeds: embeds });
                msgStore.messageId = msg.id;
                InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
            }
        } catch (err) {
            msg = await channel.send({ embeds: embeds });
            msgStore.messageId = msg.id;
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', msgStore);
        }

        if (ephemeral && ephemeralInteraction) {
            await ephemeralInteraction.editReply({ embeds: embeds });
        }
    } catch (err) {
        console.error('sendOrUpdateList error:', err);
        if (ephemeral && ephemeralInteraction) {
            try {
                await ephemeralInteraction.editReply({
                    content: 'Failed to update list: ' + err.message,
                    ephemeral: true
                });
            } catch (replyErr) {
                console.error('Failed to send error reply:', replyErr);
            }
        }
    }
}

/* ---------- Command ---------- */
module.exports = {
    name: 'link',

    getData(client, guildId) {
        var builder = new Builder.SlashCommandBuilder()
            .setName('link')
            .setDescription('Link or update members with their clan information');

        builder.addSubcommand(function(sub) {
            return sub
                .setName('add')
                .setDescription('Add a new member to the list')
                .addUserOption(function(o) { return o.setName('discorduser').setDescription('Discord user').setRequired(true); })
                .addStringOption(function(o) { return o.setName('steamfriendcode').setDescription('SteamID').setRequired(false); })
                .addStringOption(function(o) { return o.setName('clan').setDescription('Clan name').setRequired(false); });
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('remove')
                .setDescription('Remove a member from the list')
                .addUserOption(function(o) { return o.setName('discorduser').setDescription('Discord user').setRequired(false); })
                .addStringOption(function(o) { return o.setName('steamfriendcode').setDescription('SteamID').setRequired(false); })
                .addStringOption(function(o) { return o.setName('name').setDescription('Rust player name').setRequired(false); });
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('update')
                .setDescription('Update a member\'s info')
                .addUserOption(function(o) { return o.setName('discorduser').setDescription('Discord user to update').setRequired(false); })
                .addStringOption(function(o) { return o.setName('steamfriendcode').setDescription('SteamID').setRequired(false); })
                .addStringOption(function(o) { return o.setName('clan').setDescription('New Clan').setRequired(false); })
                .addStringOption(function(o) { return o.setName('name').setDescription('New Rust player name').setRequired(false); })
                .addStringOption(function(o) { return o.setName('status').setDescription('New status (active/inactive)').setRequired(false); });
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('list')
                .setDescription('Show all members');
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('claim')
                .setDescription('Claim a team member by name')
                .addStringOption(function(o) { return o.setName('name').setDescription('Rust player name to claim').setRequired(true); });
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('reset')
                .setDescription('Clear all linked members and reset the list');
        });

        builder.addSubcommand(function(sub) {
            return sub
                .setName('sync')
                .setDescription('Sync list to current Rust team members');
        });

        return builder;
    },

    async execute(client, interaction) {
        var guildId = interaction.guildId;
        var sub = interaction.options.getSubcommand();
        console.log('[steamlink] execute called: guild=' + guildId + ' sub=' + sub + ' user=' + interaction.user.tag);
        await interaction.deferReply({ ephemeral: true });

        var linked = readLinkedUsers(guildId);
        console.log('[steamlink] loaded linked users: ' + Object.keys(linked).length + ' entries');

        if (sub === 'add') {
            var user = interaction.options.getUser('discorduser');
            var steamFriendCode = interaction.options.getString('steamfriendcode') || '-';
            var clan = interaction.options.getString('clan') || 'No Clan';

            linked[user.id] = {
                steamFriendCode: steamFriendCode,
                steamId: steamFriendCode !== '-' ? steamFriendCode : undefined,
                clan: clan,
                steamName: '',
                status: 'active'
            };
            writeLinkedUsers(guildId, linked);

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'remove') {
            var user = interaction.options.getUser('discorduser', false);
            var steamFriendCode = interaction.options.getString('steamfriendcode');
            var name = interaction.options.getString('name');

            var targetId = null;

            if (user) {
                if (linked[user.id]) {
                    targetId = user.id;
                } else {
                    await interaction.editReply({ content: 'That Discord user is not in the list.', ephemeral: true });
                    return;
                }
            } else if (steamFriendCode) {
                targetId = findLinkedUser(linked, steamFriendCode, null);
                if (!targetId) {
                    await interaction.editReply({ content: 'No linked entry found with that SteamID.', ephemeral: true });
                    return;
                }
            } else if (name) {
                targetId = findLinkedUser(linked, null, name);
                if (!targetId) {
                    await interaction.editReply({ content: 'No linked entry found with that name.', ephemeral: true });
                    return;
                }
            } else {
                await interaction.editReply({ content: 'Provide a Discord user, SteamID, or name to remove.', ephemeral: true });
                return;
            }

            delete linked[targetId];
            writeLinkedUsers(guildId, linked);

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'update') {
            var user = interaction.options.getUser('discorduser', false);
            var steamFriendCode = interaction.options.getString('steamfriendcode');
            var clan = interaction.options.getString('clan');
            var nameOpt = interaction.options.getString('name');
            var statusOpt = interaction.options.getString('status');

            var existingEntryId = null;
            var entry = null;

            if (nameOpt) {
                var nameLower = nameOpt.trim().toLowerCase();
                for (var uid in linked) {
                    if (linked[uid].name && linked[uid].name.toLowerCase() === nameLower) {
                        entry = linked[uid];
                        existingEntryId = uid;
                        break;
                    }
                }
            }

            if (!entry && steamFriendCode) {
                existingEntryId = findLinkedUser(linked, steamFriendCode, null);
                if (existingEntryId) {
                    entry = linked[existingEntryId];
                }
            }

            if (!entry && user && linked[user.id]) {
                entry = linked[user.id];
                existingEntryId = user.id;
            }

            if (!entry) {
                await interaction.editReply({ content: 'No matching entry found. Use /link add, /link claim, or provide an existing name/SteamID to update.', ephemeral: true });
                return;
            }

            var changed = false;
            var updates = [];

            if (steamFriendCode !== null) {
                entry.steamFriendCode = steamFriendCode;
                entry.steamId = steamFriendCode;
                changed = true;
                updates.push('SteamID \u2192 `' + steamFriendCode + '`');
            }

            if (clan !== null) {
                entry.clan = clan;
                changed = true;
                updates.push('clan \u2192 `' + clan + '`');
            }

            if (nameOpt !== null && nameOpt.trim() !== '') {
                entry.name = nameOpt.trim();
                changed = true;
                updates.push('name \u2192 `' + nameOpt.trim() + '`');
            }

            if (statusOpt !== null) {
                var normalized = statusOpt.toLowerCase().trim();
                if (normalized === 'active' || normalized === 'inactive') {
                    entry.status = normalized;
                    changed = true;
                    updates.push('status \u2192 `' + normalized + '`');
                } else {
                    await interaction.editReply({ content: 'Invalid status. Use "active" or "inactive".', ephemeral: true });
                    return;
                }
            }

            var userIdForReassign = user ? user.id : null;
            if (existingEntryId !== userIdForReassign && userIdForReassign && !linked[userIdForReassign]) {
                delete linked[existingEntryId];
                linked[userIdForReassign] = entry;
                delete entry.isPlaceholder;
                changed = true;
                updates.push('reassigned from <@' + existingEntryId + '> to ' + user.tag);
            }

            if (changed) {
                writeLinkedUsers(guildId, linked);
                var displayName = (existingEntryId !== userIdForReassign && userIdForReassign && !linked[userIdForReassign]) ? user.tag : ('`' + entry.name + '`');
                await interaction.editReply({
                    content: 'Updated ' + displayName + ':\n' + updates.join('\n'),
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'No changes specified. Provide at least one field to update.',
                    ephemeral: true
                });
            }

            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'list') {
            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'claim') {
            var user = interaction.options.getUser('discorduser', false) || interaction.user;
            var name = interaction.options.getString('name').trim();

            var existingUserId = findLinkedUser(linked, null, name);
            if (existingUserId) {
                var entry = linked[existingUserId];
                if (entry.isPlaceholder) {
                    delete linked[existingUserId];
                    linked[user.id] = {
                        steamFriendCode: entry.steamFriendCode,
                        steamId: entry.steamId,
                        name: entry.name,
                        steamName: entry.steamName || '',
                        clan: entry.clan || 'No Clan',
                        status: entry.status || 'inactive'
                    };
                    writeLinkedUsers(guildId, linked);
                    await sendOrUpdateList(client, guildId, true, interaction);
                    return;
                }
                if (existingUserId === user.id) {
                    await interaction.editReply({ content: 'You already own this player.', ephemeral: true });
                } else {
                    await interaction.editReply({ content: 'That name is already linked.', ephemeral: true });
                }
                return;
            }

            var rustplus = client.rustplusInstances[guildId];
            if (!rustplus || !rustplus.team) {
                await interaction.editReply({ content: 'Rust instance not available.', ephemeral: true });
                return;
            }

            var player = rustplus.team.players.find(function(p) {
                return p.name && p.name.toLowerCase() === name.toLowerCase();
            });

            if (!player) {
                var partialMatch = rustplus.team.players.find(function(p) {
                    return p.name && p.name.toLowerCase().indexOf(name.toLowerCase()) >= 0 && name.length >= 3;
                });
                if (partialMatch) {
                    var existingId = findLinkedUser(linked, partialMatch.steamId, partialMatch.name);
                    if (existingId) {
                        if (existingId === user.id) {
                            await interaction.editReply({ content: 'You already own this player.', ephemeral: true });
                        } else {
                            await interaction.editReply({ content: 'That name is already linked.', ephemeral: true });
                        }
                        return;
                    }

                    linked[user.id] = {
                        steamFriendCode: partialMatch.steamId || '-',
                        steamId: partialMatch.steamId,
                        name: partialMatch.name,
                        steamName: '',
                        clan: 'No Clan',
                        status: partialMatch.isOnline ? 'active' : 'inactive'
                    };
                    writeLinkedUsers(guildId, linked);
                    await sendOrUpdateList(client, guildId, true, interaction);
                    return;
                }

                await interaction.editReply({ content: 'No current team member with that name found.', ephemeral: true });
                return;
            }

            linked[user.id] = {
                steamFriendCode: player.steamId || '-',
                steamId: player.steamId,
                name: player.name,
                steamName: '',
                clan: 'No Clan',
                status: player.isOnline ? 'active' : 'inactive'
            };
            writeLinkedUsers(guildId, linked);
            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'reset') {
            console.log('[steamlink] reset starting for guild=' + guildId);
            var msgStore = InstanceUtils.readCustomFile(guildId, LIST_MESSAGE_FILE + '.store') || {};
            console.log('[steamlink] reset msgStore:', msgStore);
            if (msgStore.messageId) {
                try {
                    var channel = client.channels.cache.get(LIST_CHANNEL_ID);
                    if (channel) {
                        var msg = await channel.messages.fetch(msgStore.messageId);
                        await msg.delete();
                    }
                } catch (err) {}
            }
            writeLinkedUsers(guildId, {});
            InstanceUtils.writeCustomFile(guildId, LIST_MESSAGE_FILE + '.store', {});
            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }

        if (sub === 'sync') {
            var rustplus = client.rustplusInstances[guildId];
            if (!rustplus || !rustplus.team) {
                await interaction.editReply({ content: 'Rust instance not available.', ephemeral: true });
                return;
            }

            var removedChanged = syncRemoveLeftPlayers(linked, rustplus);
            var autoMatched = autoMatchTeamMembers(linked, client, guildId, rustplus);
            var activeChanged = syncActiveStatus(linked, rustplus);
            var steamNameChanged = syncSteamNames(linked, rustplus);

            if (removedChanged || autoMatched || activeChanged || steamNameChanged) {
                writeLinkedUsers(guildId, linked);
            }
            await sendOrUpdateList(client, guildId, true, interaction);
            return;
        }
    },
};
