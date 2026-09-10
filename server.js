const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ChannelType
} = require("discord.js");

const fs = require("fs");
const http = require("http");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = Number(process.env.PORT) || 10000;
const DATA_FILE = "./data.json";

if (!TOKEN) {
    console.error("DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("CLIENT_ID is missing.");
    process.exit(1);
}

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Ranking Bot is running!");
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                "{}",
                "utf8"
            );
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        if (!raw.trim()) {
            return {};
        }

        const parsed = JSON.parse(raw);

        if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            return {};
        }

        return parsed;
    } catch (error) {
        console.error(
            "Could not load data.json:",
            error
        );

        return {};
    }
}

const data = loadData();

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error(
            "Could not save data.json:",
            error
        );
    }
}

function createDefaultRanking() {
    return Array.from(
        { length: 10 },
        (_, index) => ({
            name: `Player${String(index + 1).padStart(3, "0")}`,
            userId: null
        })
    );
}

function getServerData(guildId) {
    if (!data[guildId]) {
        data[guildId] = {
            managerRoleId: null,
            rankingChannelId: null,
            rankingMessageId: null,
            rankings: [],
            requests: {}
        };

        saveData();
    }

    const server = data[guildId];

    if (!Array.isArray(server.rankings)) {
        server.rankings = [];
    }

    if (!server.requests) {
        server.requests = {};
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            server,
            "managerRoleId"
        )
    ) {
        server.managerRoleId = null;
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            server,
            "rankingChannelId"
        )
    ) {
        server.rankingChannelId = null;
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            server,
            "rankingMessageId"
        )
    ) {
        server.rankingMessageId = null;
    }

    return server;
}

function isOwnerOrAdministrator(member) {
    if (!member) {
        return false;
    }

    return (
        member.id === member.guild.ownerId ||
        member.permissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

function hasManagerRole(member, server) {
    if (!server.managerRoleId) {
        return false;
    }

    return Boolean(
        member?.roles?.cache?.has(
            server.managerRoleId
        )
    );
}

function canManageRequests(member, server) {
    return (
        hasManagerRole(member, server) ||
        isOwnerOrAdministrator(member)
    );
}

function rankingNameExists(rankings, name) {
    return rankings.some(
        player =>
            String(player.name)
                .trim()
                .toLowerCase() ===
            String(name)
                .trim()
                .toLowerCase()
    );
}

function findRankingPlayer(rankings, name) {
    const target = String(name)
        .trim()
        .toLowerCase();

    return rankings.findIndex(
        player =>
            String(player.name)
                .trim()
                .toLowerCase() === target
    );
}

function normalizeRanking(rankings) {
    const result = Array.isArray(rankings)
        ? rankings.slice(0, 10)
        : [];

    while (result.length < 10) {
        const index = result.length;

        result.push({
            name: `Player${String(index + 1).padStart(3, "0")}`,
            userId: null
        });
    }

    return result.map(player => ({
        name: String(
            player.name || ""
        ).trim(),

        userId: player.userId || null
    }));
}

function rankingText(rankings) {
    return rankings
        .slice(0, 10)
        .map((player, index) => {
            const rank = index + 1;

            let medal = "";

            if (rank === 1) {
                medal = "🥇 ";
            } else if (rank === 2) {
                medal = "🥈 ";
            } else if (rank === 3) {
                medal = "🥉 ";
            }

            return `${medal}**Rank ${rank} : ${player.name}**`;
        })
        .join("\n");
}

function createRankingEmbed(rankings) {
    return new EmbedBuilder()
        .setTitle("🏆 SERVER RANKING")
        .setDescription(
            rankingText(rankings)
        )
        .setFooter({
            text: "Ranking Bot"
        })
        .setTimestamp();
}

function createRequestEmbed(
    title,
    interaction,
    fields
) {
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(
            {
                name: "Requested By",
                value: `<@${interaction.user.id}>`
            },
            ...fields
        )
        .setFooter({
            text: "Waiting for manager approval"
        })
        .setTimestamp();
}

function createRequestButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ranking_accept")
            .setLabel("Accept")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("ranking_reject")
            .setLabel("Reject")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

async function getRankingChannel(
    guild,
    server
) {
    if (!server.rankingChannelId) {
        return null;
    }

    const channel =
        await guild.channels
            .fetch(server.rankingChannelId)
            .catch(() => null);

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        return null;
    }

    return channel;
}

async function unpinOldRankingMessage(
    guild,
    channelId,
    messageId
) {
    if (!channelId || !messageId) {
        return;
    }

    const channel =
        await guild.channels
            .fetch(channelId)
            .catch(() => null);

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        return;
    }

    const message =
        await channel.messages
            .fetch(messageId)
            .catch(() => null);

    if (!message) {
        return;
    }

    if (message.pinned) {
        await message
            .unpin()
            .catch(() => {});
    }
}

async function updateRankingMessage(guild) {
    const server =
        getServerData(guild.id);

    if (!server.rankingChannelId) {
        return null;
    }

    server.rankings =
        normalizeRanking(
            server.rankings
        );

    const channel =
        await getRankingChannel(
            guild,
            server
        );

    if (!channel) {
        return null;
    }

    const embed =
        createRankingEmbed(
            server.rankings
        );

    let message = null;

    if (server.rankingMessageId) {
        message =
            await channel.messages
                .fetch(
                    server.rankingMessageId
                )
                .catch(() => null);
    }

    if (message) {
        await message.edit({
            embeds: [embed],
            components: []
        });

        if (!message.pinned) {
            await message
                .pin()
                .catch(() => {});
        }

        saveData();

        return message;
    }

    message =
        await channel.send({
            embeds: [embed]
        });

    server.rankingMessageId =
        message.id;

    saveData();

    await message
        .pin()
        .catch(error => {
            console.error(
                "Could not pin ranking message:",
                error
            );
        });

    return message;
}

function applyRankChange(
    rankings,
    name,
    rank,
    type
) {
    const newPlayer = {
        name: name.trim(),
        userId: null
    };

    if (type === "between") {
        rankings.splice(
            rank - 1,
            0,
            newPlayer
        );

        rankings.splice(10);
    } else if (type === "replace") {
        rankings[rank - 1] =
            newPlayer;
    }

    return normalizeRanking(
        rankings
    );
}

function applyMoveChange(
    rankings,
    name,
    rank,
    type
) {
    const currentIndex =
        findRankingPlayer(
            rankings,
            name
        );

    if (currentIndex === -1) {
        return null;
    }

    const targetIndex =
        rank - 1;

    if (type === "move") {
        const player =
            rankings.splice(
                currentIndex,
                1
            )[0];

        rankings.splice(
            targetIndex,
            0,
            player
        );
    } else if (type === "replace") {
        const temporary =
            rankings[currentIndex];

        rankings[currentIndex] =
            rankings[targetIndex];

        rankings[targetIndex] =
            temporary;
    }

    return normalizeRanking(
        rankings
    );
}

function parseRankingMessage(message) {
    if (!message) {
        return null;
    }

    let text = "";

    // Normal message content
    if (typeof message.content === "string") {
        text += message.content + "\n";
    }

    // Embed content
    if (Array.isArray(message.embeds)) {
        for (const embed of message.embeds) {

            if (embed.title) {
                text += embed.title + "\n";
            }

            if (embed.description) {
                text += embed.description + "\n";
            }

            if (Array.isArray(embed.fields)) {
                for (const field of embed.fields) {

                    if (field.name) {
                        text += field.name + "\n";
                    }

                    if (field.value) {
                        text += field.value + "\n";
                    }
                }
            }
        }
    }

    if (!text.trim()) {
        return null;
    }

    /*
    Remove Discord markdown links.

    [🥇](https://discord.com/assets/...)
    becomes
    🥇
    */

    text = text.replace(
        /\[([^\]]+)\]\([^)]+\)/g,
        "$1"
    );

    /*
    Remove markdown formatting.
    */

    text = text
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .replace(/```/g, "")
        .replace(/`/g, "")
        .replace(/\r/g, "");

    /*
    Remove ranking emojis.
    */

    text = text.replace(
        /[🥇🥈🥉🏅🏆]/g,
        " "
    );

    /*
    =========================================
    FIND EACH RANK
    =========================================

    This works whether ranks are:

    Rank 1 : aa
    Rank 2 : Player002

    OR:

    Rank 1 : aa Rank 2 : Player002
    =========================================
    */

    const rankRegex =
        /Rank\s*(\d{1,2})\s*[:\-–—]\s*(.*?)(?=\s+Rank\s*\d{1,2}\s*[:\-–—]|$)/gi;

    const rankings = [];

    let match;

    while (
        (match = rankRegex.exec(text)) !== null
    ) {

        const rank =
            Number(match[1]);

        let name =
            match[2].trim();

        /*
        If this is Rank 10, remove any
        footer text that may have been
        copied after the player name.
        */

        name = name
            .replace(
                /\s*Ranking Bot.*$/i,
                ""
            )
            .trim();

        /*
        Ignore invalid ranks.
        */

        if (
            rank < 1 ||
            rank > 10 ||
            !name
        ) {
            continue;
        }

        /*
        Reject duplicate ranks.
        */

        if (
            rankings.some(
                player =>
                    player.rank === rank
            )
        ) {
            continue;
        }

        rankings.push({
            rank: rank,
            name: name,
            userId: null
        });
    }

    /*
    Must have exactly 10 ranks.
    */

    if (rankings.length !== 10) {
        return null;
    }

    /*
    Sort by rank.
    */

    rankings.sort(
        (a, b) =>
            a.rank - b.rank
    );

    /*
    Must contain exactly Rank 1-10.
    */

    for (
        let i = 0;
        i < 10;
        i++
    ) {
        if (
            rankings[i].rank !==
            i + 1
        ) {
            return null;
        }
    }

    /*
    Player names must be unique.
    */

    const names =
        rankings.map(
            player =>
                player.name
                    .trim()
                    .toLowerCase()
        );

    if (
        new Set(names).size !== 10
    ) {
        return null;
    }

    return rankings;
}
const commands = [

    new SlashCommandBuilder()
        .setName("setrank")
        .setDescription(
            "Immediately set a new player rank."
        )
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription(
                    "New player name. It must not already be on the list."
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("rank")
                .setDescription(
                    "Rank from 1 to 10."
                )
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription(
                    "Ranking change type."
                )
                .addChoices(
                    {
                        name: "Between",
                        value: "between"
                    },
                    {
                        name: "Replace",
                        value: "replace"
                    }
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("setmove")
        .setDescription(
            "Immediately move an existing player."
        )
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription(
                    "Player name already on the list."
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("rank")
                .setDescription(
                    "Target rank from 1 to 10."
                )
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription(
                    "Move type."
                )
                .addChoices(
                    {
                        name: "Move",
                        value: "move"
                    },
                    {
                        name: "Replace",
                        value: "replace"
                    }
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("recoverdata")
        .setDescription(
            "Recover the ranking from an old ranking-list message."
        )
        .addStringOption(option =>
            option
                .setName("data")
                .setDescription(
                    "Copy the old ranking-list message link and paste it here."
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("showlist")
        .setDescription(
            "Show the existing ranking list again in the selected channel."
        )
].map(command =>
    command.toJSON()
);

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

async function registerCommands() {
    console.log(
        "Registering slash commands..."
    );

    try {
        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "Slash commands registered."
        );
    } catch (error) {
        console.error(
            "Slash command registration failed:",
            error
        );
    }
}
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});
client.once(
    "ready",
    async () => {
        console.log(
            `DISCORD LOGIN SUCCESSFUL: ${client.user.tag}`
        );

        console.log(
            `Bot ID: ${client.user.id}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        await registerCommands();

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            try {
                const server =
                    getServerData(
                        guild.id
                    );

                if (
                    server.rankingChannelId &&
                    server.rankings.length
                ) {
                    await updateRankingMessage(
                        guild
                    );
                }
            } catch (error) {
                console.error(
                    `Error updating ${guild.name}:`,
                    error
                );
            }
        }

        console.log(
            "RANKING BOT IS READY"
        );
    }
);

client.on(
    "error",
    error => {
        console.error(
            "Discord client error:",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "Discord warning:",
            warning
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "Discord Gateway error:",
            error
        );
    }
);

client.on(
    "shardDisconnect",
    (event, shardId) => {
        console.error(
            `Gateway disconnected. Shard: ${shardId}`
        );

        console.error(
            "Close code:",
            event?.code
        );

        console.error(
            "Reason:",
            event?.reason?.toString() ||
            "None"
        );
    }
);

client.on(
    "shardReconnecting",
    shardId => {
        console.log(
            `Gateway reconnecting. Shard: ${shardId}`
        );
    }
);

client.on(
    "shardReady",
    shardId => {
        console.log(
            `Gateway ready. Shard: ${shardId}`
        );
    }
);

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                interaction.isChatInputCommand()
            ) {
                if (!interaction.guild) {
                    await interaction.reply({
                        content:
                            "❌ This command can only be used inside a server.",
                        ephemeral: true
                    });

                    return;
                }

                const guild =
                    interaction.guild;

                const server =
                    getServerData(
                        guild.id
                    );

                /*
                =========================================
                /setrole
                =========================================
                */

                if (
                    interaction.commandName ===
                    "setrole"
                ) {
                    if (
                        !isOwnerOrAdministrator(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                "❌ Only the server owner or an Administrator can use this command.",
                            ephemeral: true
                        });

                        return;
                    }

                    const role =
                        interaction.options.getRole(
                            "role"
                        );

                    server.managerRoleId =
                        role.id;

                    saveData();

                    await interaction.reply({
                        content:
                            `✅ The ranking manager role is now ${role}.`,
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                /setchannel
                =========================================
                */

                if (
                    interaction.commandName ===
                    "setchannel"
                ) {
                    if (
                        !isOwnerOrAdministrator(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                "❌ Only the server owner or an Administrator can use this command.",
                            ephemeral: true
                        });

                        return;
                    }

                    const channel =
                        interaction.options.getChannel(
                            "channel"
                        );

                    const oldChannelId =
                        server.rankingChannelId;

                    const oldMessageId =
                        server.rankingMessageId;

                    const hadRanking =
                        Array.isArray(
                            server.rankings
                        ) &&
                        server.rankings.length > 0;

                    if (
                        oldChannelId &&
                        oldMessageId &&
                        oldChannelId !==
                            channel.id
                    ) {
                        await unpinOldRankingMessage(
                            guild,
                            oldChannelId,
                            oldMessageId
                        );
                    }

                    server.rankingChannelId =
                        channel.id;

                    if (!hadRanking) {
                        server.rankings =
                            createDefaultRanking();
                    } else {
                        server.rankings =
                            normalizeRanking(
                                server.rankings
                            );
                    }

                    server.rankingMessageId =
                        null;

                    saveData();

                    await updateRankingMessage(
                        guild
                    );

                    await interaction.reply({
                        content:
                            `✅ Ranking channel set to ${channel}.\nThe existing ranking was preserved.`,
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                /showlist

                ALWAYS CREATES A NEW MESSAGE.
                =========================================
                */

                if (
    interaction.commandName ===
    "showlist"
) {
    if (
        !server.rankingChannelId
    ) {
        await interaction.reply({
            content:
                "❌ No ranking channel has been set. An owner or Administrator must use /setchannel first.",
            ephemeral: true
        });

        return;
    }

    if (
        !Array.isArray(
            server.rankings
        ) ||
        server.rankings.length === 0
    ) {
        server.rankings =
            createDefaultRanking();
    }

    server.rankings =
        normalizeRanking(
            server.rankings
        );

    saveData();

    const channel =
        await getRankingChannel(
            guild,
            server
        );

    if (!channel) {
        await interaction.reply({
            content:
                "❌ The selected ranking channel could not be found.",
            ephemeral: true
        });

        return;
    }

    /*
        CREATE A COMPLETELY NEW RANKING MESSAGE
        EVERY TIME /showlist IS USED.
    */

    const embed =
        createRankingEmbed(
            server.rankings
        );

    const newMessage =
        await channel.send({
            embeds: [embed]
        });

    /*
        Pin the new ranking message.
    */

    await newMessage
        .pin()
        .catch(error => {
            console.error(
                "Could not pin /showlist message:",
                error
            );
        });

    /*
        Make this newest message the
        active ranking message.
    */

    server.rankingMessageId =
        newMessage.id;

    saveData();

    /*
        Also show the actual ranking list
        in the command response instead of
        showing only a success message.
    */

    await interaction.reply({
        content:
            "✅ Ranking list shown again:",
        embeds: [embed],
        ephemeral: true
    });

    return;
}

                /*
                =========================================
                /requestrank
                =========================================
                */

                if (
                    interaction.commandName ===
                    "requestrank"
                ) {
                    const name =
                        interaction.options
                            .getString(
                                "name"
                            )
                            .trim();

                    const rank =
                        interaction.options
                            .getInteger(
                                "rank"
                            );

                    const type =
                        interaction.options
                            .getString(
                                "type"
                            );

                    if (
                        !server.rankingChannelId
                    ) {
                        await interaction.reply({
                            content:
                                "❌ A ranking channel has not been set.",
                            ephemeral: true
                        });

                        return;
                    }

                    if (!name) {
                        await interaction.reply({
                            content:
                                "❌ Player name cannot be empty.",
                            ephemeral: true
                        });

                        return;
                    }

                    if (name.length > 100) {
                        await interaction.reply({
                            content:
                                "❌ Player name is too long.",
                            ephemeral: true
                        });

                        return;
                    }

                    if (
                        rankingNameExists(
                            server.rankings,
                            name
                        )
                    ) {
                        await interaction.reply({
                            content:
                                `❌ Request automatically rejected because **${name}** is already on the ranking list.`,
                            ephemeral: true
                        });

                        return;
                    }

                    const channel =
                        await getRankingChannel(
                            guild,
                            server
                        );

                    if (!channel) {
                        await interaction.reply({
                            content:
                                "❌ The selected ranking channel could not be found.",
                            ephemeral: true
                        });

                        return;
                    }

                    const requestEmbed =
                        createRequestEmbed(
                            "📝 Ranking Request",
                            interaction,
                            [
                                {
                                    name: "Player",
                                    value: name
                                },
                                {
                                    name: "Requested Rank",
                                    value:
                                        `#${rank}`
                                },
                                {
                                    name: "Type",
                                    value:
                                        type ===
                                        "between"
                                            ? "Between"
                                            : "Replace"
                                }
                            ]
                        );

                    const requestMessage =
                        await channel.send({
                            embeds: [
                                requestEmbed
                            ],
                            components: [
                                createRequestButtons()
                            ]
                        });

                    server.requests[
                        requestMessage.id
                    ] = {
                        requestType: "rank",
                        name,
                        rank,
                        type,
                        requesterId:
                            interaction.user.id,
                        createdAt:
                            Date.now()
                    };

                    saveData();

                    await interaction.reply({
                        content:
                            "✅ Your ranking request has been submitted for manager approval.",
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                /requestmove
                =========================================
                */

                if (
                    interaction.commandName ===
                    "requestmove"
                ) {
                    const name =
                        interaction.options
                            .getString(
                                "name"
                            )
                            .trim();

                    const rank =
                        interaction.options
                            .getInteger(
                                "rank"
                            );

                    const type =
                        interaction.options
                            .getString(
                                "type"
                            );

                    if (
                        !server.rankingChannelId
                    ) {
                        await interaction.reply({
                            content:
                                "❌ A ranking channel has not been set.",
                            ephemeral: true
                        });

                        return;
                    }

                    const currentIndex =
                        findRankingPlayer(
                            server.rankings,
                            name
                        );

                    if (
                        currentIndex === -1
                    ) {
                        await interaction.reply({
                            content:
                                `❌ **${name}** is not currently on the ranking list.`,
                            ephemeral: true
                        });

                        return;
                    }

                    if (
                        currentIndex ===
                        rank - 1
                    ) {
                        await interaction.reply({
                            content:
                                `❌ **${name}** is already at rank **#${rank}**.`,
                            ephemeral: true
                        });

                        return;
                    }

                    const channel =
                        await getRankingChannel(
                            guild,
                            server
                        );

                    if (!channel) {
                        await interaction.reply({
                            content:
                                "❌ The selected ranking channel could not be found.",
                            ephemeral: true
                        });

                        return;
                    }

                    const requestEmbed =
                        createRequestEmbed(
                            "🔄 Ranking Move Request",
                            interaction,
                            [
                                {
                                    name: "Player",
                                    value: name
                                },
                                {
                                    name: "Current Rank",
                                    value:
                                        `#${currentIndex + 1}`
                                },
                                {
                                    name: "Requested Rank",
                                    value:
                                        `#${rank}`
                                },
                                {
                                    name: "Type",
                                    value:
                                        type ===
                                        "move"
                                            ? "Move"
                                            : "Replace"
                                }
                            ]
                        );

                    const requestMessage =
                        await channel.send({
                            embeds: [
                                requestEmbed
                            ],
                            components: [
                                createRequestButtons()
                            ]
                        });

                    server.requests[
                        requestMessage.id
                    ] = {
                        requestType: "move",
                        name,
                        rank,
                        type,
                        requesterId:
                            interaction.user.id,
                        createdAt:
                            Date.now()
                    };

                    saveData();

                    await interaction.reply({
                        content:
                            "✅ Your move request has been submitted for manager approval.",
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                /setrank
                =========================================
                */

                if (
                    interaction.commandName ===
                    "setrank"
                ) {
                    if (
                        !hasManagerRole(
                            interaction.member,
                            server
                        )
                    ) {
                        await interaction.reply({
                            content:
                                "❌ Only members with the configured ranking manager role can use this command.",
                            ephemeral: true
                        });

                        return;
                    }

                    const name =
                        interaction.options
                            .getString(
                                "name"
                            )
                            .trim();

                    const rank =
                        interaction.options
                            .getInteger(
                                "rank"
                            );

                    const type =
                        interaction.options
                            .getString(
                                "type"
                            );

                    if (
                        rankingNameExists(
                            server.rankings,
                            name
                        )
                    ) {
                        await interaction.reply({
                            content:
                                `❌ **${name}** is already on the ranking list.`,
                            ephemeral: true
                        });

                        return;
                    }

                    server.rankings =
                        applyRankChange(
                            server.rankings,
                            name,
                            rank,
                            type
                        );

                    saveData();

                    await updateRankingMessage(
                        guild
                    );

                    await interaction.reply({
                        content:
                            `✅ **${name}** has been set at rank **#${rank}**.`,
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                /setmove
                =========================================
                */

                if (
                    interaction.commandName ===
                    "setmove"
                ) {
                    if (
                        !hasManagerRole(
                            interaction.member,
                            server
                        )
                    ) {
                        await interaction.reply({
                            content:
                                "❌ Only members with the configured ranking manager role can use this command.",
                            ephemeral: true
                        });

                        return;
                    }

                    const name =
                        interaction.options
                            .getString(
                                "name"
                            )
                            .trim();

                    const rank =
                        interaction.options
                            .getInteger(
                                "rank"
                            );

                    const type =
                        interaction.options
                            .getString(
                                "type"
                            );

                    const currentIndex =
                        findRankingPlayer(
                            server.rankings,
                            name
                        );

                    if (
                        currentIndex === -1
                    ) {
                        await interaction.reply({
                            content:
                                `❌ **${name}** is not currently on the ranking list.`,
                            ephemeral: true
                        });

                        return;
                    }

                    if (
                        currentIndex ===
                        rank - 1
                    ) {
                        await interaction.reply({
                            content:
                                `❌ **${name}** is already at rank **#${rank}**.`,
                            ephemeral: true
                        });

                        return;
                    }

                    const updated =
                        applyMoveChange(
                            server.rankings,
                            name,
                            rank,
                            type
                        );

                    if (!updated) {
                        await interaction.reply({
                            content:
                                "❌ Could not change the ranking.",
                            ephemeral: true
                        });

                        return;
                    }

                    server.rankings =
                        updated;

                    saveData();

                    await updateRankingMessage(
                        guild
                    );

                    await interaction.reply({
                        content:
                            `✅ **${name}** has been moved to rank **#${rank}**.`,
                        ephemeral: true
                    });

                    return;
                }
/*
=========================================
/recoverdata
=========================================
*/

if (
    interaction.commandName ===
    "recoverdata"
) {
    if (
        !hasManagerRole(
            interaction.member,
            server
        )
    ) {
        await interaction.reply({
            content:
                "❌ Only members with the configured ranking manager role can use this command.",
            ephemeral: true
        });

        return;
    }

    const link =
        interaction.options
            .getString("data")
            .trim();

    // Accept normal, canary, PTB and discordapp links
    const match =
        link.match(
            /^https?:\/\/(?:canary\.)?(?:ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/
        );

    if (!match) {
        await interaction.reply({
            content:
                "❌ Invalid message link. Just copy the Discord message link and paste it into `data`.",
            ephemeral: true
        });

        return;
    }

    const linkedGuildId =
        match[1];

    const linkedChannelId =
        match[2];

    const linkedMessageId =
        match[3];

    // Make sure the message belongs to this server
    if (
        linkedGuildId !==
        guild.id
    ) {
        await interaction.reply({
            content:
                "❌ The message link must belong to this server.",
            ephemeral: true
        });

        return;
    }

    // Fetch the channel
    const linkedChannel =
        await guild.channels
            .fetch(
                linkedChannelId
            )
            .catch(
                () => null
            );

    if (
        !linkedChannel ||
        !linkedChannel.isTextBased()
    ) {
        await interaction.reply({
            content:
                "❌ The linked channel could not be found. Make sure the bot can view that channel.",
            ephemeral: true
        });

        return;
    }

    // Fetch the message
    const linkedMessage =
        await linkedChannel.messages
            .fetch(
                linkedMessageId
            )
            .catch(
                () => null
            );

    if (!linkedMessage) {
        await interaction.reply({
            content:
                "❌ The linked message could not be found. Make sure the bot has Read Message History permission.",
            ephemeral: true
        });

        return;
    }

    // Parse the ranking
    const recovered =
        parseRankingMessage(
            linkedMessage
        );

    if (!recovered) {
        await interaction.reply({
            content:
                "❌ Recovery failed. The linked message must contain exactly 10 valid ranking entries from Rank 1 through Rank 10.",
            ephemeral: true
        });

        return;
    }

    // Save recovered ranking
    server.rankings =
        normalizeRanking(
            recovered
        );

    // Make sure requests exists
    if (
        !server.requests ||
        typeof server.requests !==
        "object"
    ) {
        server.requests = {};
    }

    saveData();

    // Update the active ranking message
    const rankingMessage =
        await updateRankingMessage(
            guild
        );

    if (!rankingMessage) {
        await interaction.reply({
            content:
                "❌ The ranking data was recovered, but the selected ranking channel could not be updated.",
            ephemeral: true
        });

        return;
    }

    await interaction.reply({
        content:
            "✅ Ranking data successfully recovered from the linked message.",
        ephemeral: true
    });

    return;
}
            }
            /*
            =========================================
            BUTTON INTERACTIONS
            =========================================
            */

            if (
                interaction.isButton()
            ) {
                if (
                    interaction.customId !==
                        "ranking_accept" &&
                    interaction.customId !==
                        "ranking_reject"
                ) {
                    return;
                }

                if (!interaction.guild) {
                    return;
                }

                const guild =
                    interaction.guild;

                const server =
                    getServerData(
                        guild.id
                    );

                if (
                    !canManageRequests(
                        interaction.member,
                        server
                    )
                ) {
                    await interaction.reply({
                        content:
                            "❌ You do not have permission to manage ranking requests.",
                        ephemeral: true
                    });

                    return;
                }

                const request =
                    server.requests[
                        interaction.message.id
                    ];

                if (!request) {
                    await interaction.reply({
                        content:
                            "❌ This request no longer exists or has already been processed.",
                        ephemeral: true
                    });

                    return;
                }

                /*
                =========================================
                REJECT
                =========================================
                */

                if (
                    interaction.customId ===
                    "ranking_reject"
                ) {
                    delete server.requests[
                        interaction.message.id
                    ];

                    saveData();

                    const embed =
                        interaction.message
                            .embeds?.[0]
                            ? EmbedBuilder.from(
                                interaction.message
                                    .embeds[0]
                            )
                            : new EmbedBuilder()
                                .setTitle(
                                    "Ranking Request"
                                );

                    embed
                        .setTitle(
                            request.requestType ===
                                "move"
                                ? "❌ Ranking Move Request Rejected"
                                : "❌ Ranking Request Rejected"
                        )
                        .setFooter({
                            text:
                                `Rejected by ${interaction.user.tag}`
                        });

                    await interaction.update({
                        embeds: [embed],
                        components: []
                    });

                    return;
                }

                /*
                =========================================
                ACCEPT
                =========================================
                */

                if (
                    interaction.customId ===
                    "ranking_accept"
                ) {
                    /*
                    =====================================
                    ACCEPT RANK REQUEST
                    =====================================
                    */

                    if (
                        request.requestType ===
                        "rank"
                    ) {
                        if (
                            rankingNameExists(
                                server.rankings,
                                request.name
                            )
                        ) {
                            delete server.requests[
                                interaction.message.id
                            ];

                            saveData();

                            const embed =
                                interaction.message
                                    .embeds?.[0]
                                    ? EmbedBuilder.from(
                                        interaction.message
                                            .embeds[0]
                                    )
                                    : new EmbedBuilder()
                                        .setTitle(
                                            "Ranking Request"
                                        );

                            embed
                                .setTitle(
                                    "❌ Ranking Request Automatically Rejected"
                                )
                                .setFooter({
                                    text:
                                        "Player is already on the ranking list."
                                });

                            await interaction.update({
                                embeds: [embed],
                                components: []
                            });

                            return;
                        }

                        server.rankings =
                            applyRankChange(
                                server.rankings,
                                request.name,
                                request.rank,
                                request.type
                            );
                    }

                    /*
                    =====================================
                    ACCEPT MOVE REQUEST
                    =====================================
                    */

                    if (
                        request.requestType ===
                        "move"
                    ) {
                        const currentIndex =
                            findRankingPlayer(
                                server.rankings,
                                request.name
                            );

                        if (
                            currentIndex === -1
                        ) {
                            delete server.requests[
                                interaction.message.id
                            ];

                            saveData();

                            const embed =
                                interaction.message
                                    .embeds?.[0]
                                    ? EmbedBuilder.from(
                                        interaction.message
                                            .embeds[0]
                                    )
                                    : new EmbedBuilder()
                                        .setTitle(
                                            "Ranking Move Request"
                                        );

                            embed
                                .setTitle(
                                    "❌ Move Request Automatically Rejected"
                                )
                                .setFooter({
                                    text:
                                        "Player is no longer on the ranking list."
                                });

                            await interaction.update({
                                embeds: [embed],
                                components: []
                            });

                            return;
                        }

                        if (
                            currentIndex ===
                            request.rank - 1
                        ) {
                            delete server.requests[
                                interaction.message.id
                            ];

                            saveData();

                            const embed =
                                interaction.message
                                    .embeds?.[0]
                                    ? EmbedBuilder.from(
                                        interaction.message
                                            .embeds[0]
                                    )
                                    : new EmbedBuilder()
                                        .setTitle(
                                            "Ranking Move Request"
                                        );

                            embed
                                .setTitle(
                                    "❌ Move Request Automatically Rejected"
                                )
                                .setFooter({
                                    text:
                                        "Player is already at the requested rank."
                                });

                            await interaction.update({
                                embeds: [embed],
                                components: []
                            });

                            return;
                        }

                        const updated =
                            applyMoveChange(
                                server.rankings,
                                request.name,
                                request.rank,
                                request.type
                            );

                        if (!updated) {
                            await interaction.reply({
                                content:
                                    "❌ The ranking could not be updated.",
                                ephemeral: true
                            });

                            return;
                        }

                        server.rankings =
                            updated;
                    }

                    server.rankings =
                        normalizeRanking(
                            server.rankings
                        );

                    delete server.requests[
                        interaction.message.id
                    ];

                    saveData();

                    await updateRankingMessage(
                        guild
                    );

                    const embed =
                        interaction.message
                            .embeds?.[0]
                            ? EmbedBuilder.from(
                                interaction.message
                                    .embeds[0]
                            )
                            : new EmbedBuilder()
                                .setTitle(
                                    "Ranking Request"
                                );

                    embed
                        .setTitle(
                            request.requestType ===
                                "move"
                                ? "✅ Ranking Move Request Accepted"
                                : "✅ Ranking Request Accepted"
                        )
                        .setFooter({
                            text:
                                `Accepted by ${interaction.user.tag}`
                        });

                    await interaction.update({
                        embeds: [embed],
                        components: []
                    });

                    return;
                }
            }
        } catch (error) {
            console.error(
                "Interaction error:",
                error
            );

            try {
                if (interaction.replied) {
                    await interaction.followUp({
                        content:
                            "❌ An unexpected error occurred.",
                        ephemeral: true
                    });
                } else if (
                    interaction.deferred
                ) {
                    await interaction.editReply({
                        content:
                            "❌ An unexpected error occurred."
                    });
                } else {
                    await interaction.reply({
                        content:
                            "❌ An unexpected error occurred.",
                        ephemeral: true
                    });
                }
            } catch {}
        }
    }
);

client.login(TOKEN);
