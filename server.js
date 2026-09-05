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

console.log("========================================");
console.log("RANKING BOT STARTING");
console.log("========================================");
console.log("Client ID:", CLIENT_ID || "MISSING");
console.log("Discord token:", TOKEN ? "FOUND" : "MISSING");
console.log("Node:", process.version);
console.log("Port:", PORT);
console.log("========================================");

if (!TOKEN) {
    console.error("DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("CLIENT_ID is missing.");
    process.exit(1);
}

/*
==================================================
HTTP SERVER
==================================================
*/

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Ranking Bot is running!");
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

/*
==================================================
DATA
==================================================
*/

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, "{}", "utf8");
        }

        const raw = fs.readFileSync(DATA_FILE, "utf8");

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
        console.error("Could not load data.json:");
        console.error(error);
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
        console.error("Could not save data.json:");
        console.error(error);
    }
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

    if (!server.requests) {
        server.requests = {};
    }

    if (!Array.isArray(server.rankings)) {
        server.rankings = [];
    }

    if (!Object.prototype.hasOwnProperty.call(
        server,
        "managerRoleId"
    )) {
        server.managerRoleId = null;
    }

    if (!Object.prototype.hasOwnProperty.call(
        server,
        "rankingChannelId"
    )) {
        server.rankingChannelId = null;
    }

    if (!Object.prototype.hasOwnProperty.call(
        server,
        "rankingMessageId"
    )) {
        server.rankingMessageId = null;
    }

    return server;
}

/*
==================================================
DEFAULT RANKING
==================================================
*/

function createDefaultRanking() {
    return Array.from(
        { length: 10 },
        (_, index) => ({
            name: `Player${String(index + 1).padStart(3, "0")}`,
            userId: null
        })
    );
}

/*
==================================================
PERMISSION CHECKS
==================================================
*/

function isOwnerOrAdministrator(member) {
    if (!member) {
        return false;
    }

    return Boolean(
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

/*
==================================================
DISCORD CLIENT
==================================================
*/

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

/*
==================================================
SLASH COMMANDS
==================================================
*/

const commands = [

    /*
    /setrole
    */

    new SlashCommandBuilder()
        .setName("setrole")
        .setDescription(
            "Set the role that can manage ranking requests."
        )
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("Manager role")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    /*
    /setchannel
    */

    new SlashCommandBuilder()
        .setName("setchannel")
        .setDescription(
            "Set the channel where the ranking list is displayed."
        )
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Ranking channel")
                .addChannelTypes(
                    ChannelType.GuildText
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    /*
    /requestrank
    */

    new SlashCommandBuilder()
        .setName("requestrank")
        .setDescription(
            "Request a ranking change."
        )
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription("Player name")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("rank")
                .setDescription("Requested rank 1-10")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription("Ranking change type")
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
        )

].map(command => command.toJSON());

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

/*
==================================================
REGISTER COMMANDS
==================================================
*/

async function registerCommands() {
    console.log("Registering slash commands...");

    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("Slash commands registered.");
    } catch (error) {
        console.error(
            "Slash command registration failed:"
        );

        console.error(error);
    }
}

/*
==================================================
RANKING TEXT
==================================================
*/

function rankingText(rankings) {
    if (!rankings.length) {
        return "No ranking has been created yet.";
    }

    return rankings
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

            return `${medal}**#${rank} — ${player.name}**`;
        })
        .join("\n");
}

/*
==================================================
RANKING EMBED
==================================================
*/

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

/*
==================================================
UPDATE RANKING MESSAGE
==================================================
*/

async function updateRankingMessage(guild) {

    const server = getServerData(guild.id);

    if (!server.rankingChannelId) {
        return;
    }

    const channel =
        await guild.channels.fetch(
            server.rankingChannelId
        ).catch(() => null);

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        console.error(
            `Ranking channel unavailable in ${guild.name}.`
        );

        return;
    }

    const embed = createRankingEmbed(
        server.rankings
    );

    let message = null;

    /*
    Try to find existing ranking message.
    */

    if (server.rankingMessageId) {

        message =
            await channel.messages.fetch(
                server.rankingMessageId
            ).catch(() => null);
    }

    /*
    Edit existing message.
    */

    if (message) {

        try {

            await message.edit({
                embeds: [embed]
            });

            /*
            Make sure it stays pinned.
            */

            try {
                if (!message.pinned) {
                    await message.pin();
                }
            } catch (error) {
                console.error(
                    "Could not pin ranking message."
                );
            }

            return;

        } catch (error) {

            console.error(
                "Could not edit ranking message:"
            );

            console.error(error);

            server.rankingMessageId = null;

            saveData();
        }
    }

    /*
    Create new ranking message.
    */

    try {

        message = await channel.send({
            embeds: [embed]
        });

        server.rankingMessageId =
            message.id;

        saveData();

        try {

            await message.pin();

            console.log(
                "Ranking message pinned."
            );

        } catch (error) {

            console.error(
                "Could not pin ranking message."
            );

            console.error(
                "Check Manage Messages permission."
            );
        }

    } catch (error) {

        console.error(
            "Could not send ranking message:"
        );

        console.error(error);
    }
}

/*
==================================================
DUPLICATE CHECK
==================================================
*/

function findRankingPlayer(
    rankings,
    name
) {

    const target =
        name.trim().toLowerCase();

    return rankings.findIndex(
        player =>
            String(player.name)
                .trim()
                .toLowerCase() === target
    );
}

/*
==================================================
READY
==================================================
*/

client.once("ready", async () => {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        `DISCORD LOGIN SUCCESSFUL: ${client.user.tag}`
    );

    console.log(
        `Bot ID: ${client.user.id}`
    );

    console.log(
        `Servers: ${client.guilds.cache.size}`
    );

    console.log(
        "========================================"
    );

    await registerCommands();

    /*
    IMPORTANT:
    Do NOT create random players automatically.

    Ranking is created only when /setchannel
    is used for the first time.
    */

    for (
        const guild of client.guilds.cache.values()
    ) {

        try {

            const server =
                getServerData(guild.id);

            /*
            Only update an existing ranking.
            */

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
                `Error processing ${guild.name}:`
            );

            console.error(error);
        }
    }

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "RANKING BOT IS READY"
    );

    console.log(
        "========================================"
    );
});

/*
==================================================
GATEWAY EVENTS
==================================================
*/

client.on(
    "error",
    error => {

        console.error(
            "Discord client error:"
        );

        console.error(error);
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
            "Discord Gateway error:"
        );

        console.error(error);
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

/*
==================================================
INTERACTIONS
==================================================
*/

client.on(
    "interactionCreate",
    async interaction => {

        try {

            /*
            ==========================================
            SLASH COMMANDS
            ==========================================
            */

            if (
                interaction.isChatInputCommand()
            ) {

                /*
                Commands only work inside servers.
                */

                if (!interaction.guild) {

                    await interaction.reply({
                        content:
                            "❌ This command can only be used inside a server.",
                        ephemeral: true
                    });

                    return;
                }

                const server =
                    getServerData(
                        interaction.guild.id
                    );

                /*
                ======================================
                SET ROLE
                ======================================
                */

                if (
                    interaction.commandName ===
                    "setrole"
                ) {

                    /*
                    ONLY SERVER OWNER OR
                    ADMINISTRATOR
                    */

                    if (
                        !isOwnerOrAdministrator(
                            interaction.member
                        )
                    ) {

                        await interaction.reply({
                            content:
                                "❌ Only the server owner or a member with Administrator permission can use this command.",
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
                            `✅ Manager role set to **${role.name}**.`,
                        ephemeral: true
                    });

                    return;
                }

                /*
                ======================================
                SET CHANNEL
                ======================================
                */

                if (
                    interaction.commandName ===
                    "setchannel"
                ) {

                    /*
                    ONLY SERVER OWNER OR
                    ADMINISTRATOR
                    */

                    if (
                        !isOwnerOrAdministrator(
                            interaction.member
                        )
                    ) {

                        await interaction.reply({
                            content:
                                "❌ Only the server owner or a member with Administrator permission can use this command.",
                            ephemeral: true
                        });

                        return;
                    }

                    const channel =
                        interaction.options.getChannel(
                            "channel"
                        );

                    /*
                    Check whether ranking
                    already exists.
                    */

                    const hadRanking =
                        Array.isArray(
                            server.rankings
                        ) &&
                        server.rankings.length > 0;

                    /*
                    Change channel.
                    */

                    server.rankingChannelId =
                        channel.id;

                    /*
                    IMPORTANT:

                    If this is the FIRST time
                    /setchannel is used,
                    create the default ranking.

                    If ranking already exists,
                    DO NOT reset it.
                    */

                    if (!hadRanking) {

                        server.rankings =
                            createDefaultRanking();

                        console.log(
                            `Created default ranking for ${interaction.guild.name}.`
                        );
                    }

                    /*
                    New channel means we need
                    a new ranking message there.
                    */

                    server.rankingMessageId =
                        null;

                    saveData();

                    await updateRankingMessage(
                        interaction.guild
                    );

                    await interaction.reply({
                        content:
                            `✅ Ranking channel set to ${channel}.`,
                        ephemeral: true
                    });

                    return;
                }

                /*
                ======================================
                REQUEST RANK
                ======================================
                */

                if (
                    interaction.commandName ===
                    "requestrank"
                ) {

                    const name =
                        interaction.options
                            .getString("name")
                            .trim();

                    const rank =
                        interaction.options
                            .getInteger("rank");

                    const type =
                        interaction.options
                            .getString("type");

                    /*
                    Check name.
                    */

                    if (!name) {

                        await interaction.reply({
                            content:
                                "❌ Player name cannot be empty.",
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    Maximum name length.
                    */

                    if (name.length > 100) {

                        await interaction.reply({
                            content:
                                "❌ Player name is too long. Maximum 100 characters.",
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    Check ranking channel.
                    */

                    if (
                        !server.rankingChannelId
                    ) {

                        await interaction.reply({
                            content:
                                "❌ Ranking channel has not been configured yet.",
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    Make sure ranking exists.
                    */

                    if (
                        !Array.isArray(
                            server.rankings
                        ) ||
                        !server.rankings.length
                    ) {

                        await interaction.reply({
                            content:
                                "❌ Ranking has not been created yet. An administrator must use /setchannel first.",
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    ==================================
                    DUPLICATE CHECK
                    ==================================
                    */

                    const existingIndex =
                        findRankingPlayer(
                            server.rankings,
                            name
                        );

                    if (
                        existingIndex !== -1
                    ) {

                        await interaction.reply({
                            content:
                                `❌ Request automatically rejected.\n\n` +
                                `**${name}** is already ranked at **#${existingIndex + 1}**.`,
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    Get ranking channel.
                    */

                    const channel =
                        await interaction.guild
                            .channels
                            .fetch(
                                server.rankingChannelId
                            )
                            .catch(() => null);

                    if (
                        !channel ||
                        !channel.isTextBased()
                    ) {

                        await interaction.reply({
                            content:
                                "❌ Ranking channel could not be found.",
                            ephemeral: true
                        });

                        return;
                    }

                    /*
                    ==================================
                    REQUEST EMBED
                    ==================================
                    */

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                "🏆 Ranking Change Request"
                            )
                            .addFields(
                                {
                                    name:
                                        "Requested By",
                                    value:
                                        `<@${interaction.user.id}>`
                                },
                                {
                                    name:
                                        "Player",
                                    value:
                                        name
                                },
                                {
                                    name:
                                        "Rank",
                                    value:
                                        `#${rank}`
                                },
                                {
                                    name:
                                        "Type",
                                    value:
                                        type ===
                                        "between"
                                            ? "Between"
                                            : "Replace"
                                }
                            )
                            .setFooter({
                                text:
                                    "Waiting for manager approval"
                            })
                            .setTimestamp();

                    /*
                    ==================================
                    BUTTONS
                    ==================================
                    */

                    const acceptButton =
                        new ButtonBuilder()
                            .setCustomId(
                                "rank_accept"
                            )
                            .setLabel(
                                "Accept"
                            )
                            .setEmoji(
                                "✅"
                            )
                            .setStyle(
                                ButtonStyle.Success
                            );

                    const rejectButton =
                        new ButtonBuilder()
                            .setCustomId(
                                "rank_reject"
                            )
                            .setLabel(
                                "Reject"
                            )
                            .setEmoji(
                                "❌"
                            )
                            .setStyle(
                                ButtonStyle.Danger
                            );

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                acceptButton,
                                rejectButton
                            );

                    /*
                    ==================================
                    SEND REQUEST
                    ==================================
                    */

                    const requestMessage =
                        await channel.send({
                            embeds: [embed],
                            components: [row]
                        });

                    /*
                    Save request.
                    */

                    server.requests[
                        requestMessage.id
                    ] = {
                        name,
                        rank,
                        type,
                        requesterId:
                            interaction.user.id,
                        createdAt:
                            Date.now()
                    };

                    saveData();

                    /*
                    PIN REQUEST
                    */

                    try {

                        await requestMessage.pin();

                        console.log(
                            "Ranking request pinned."
                        );

                    } catch (error) {

                        console.error(
                            "Could not pin ranking request."
                        );

                        console.error(
                            "Check Manage Messages permission."
                        );
                    }

                    /*
                    Confirm to requester.
                    */

                    await interaction.reply({
                        content:
                            "✅ Your ranking request has been submitted for manager approval.",
                        ephemeral: true
                    });

                    return;
                }
            }

            /*
            ==========================================
            BUTTONS
            ==========================================
            */

            if (
                interaction.isButton()
            ) {

                if (!interaction.guild) {
                    return;
                }

                const server =
                    getServerData(
                        interaction.guild.id
                    );

                /*
                Manager role OR
                server owner OR
                Administrator can accept/reject.
                */

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

                const requestMessage =
                    interaction.message;

                const request =
                    server.requests[
                        requestMessage.id
                    ];

                /*
                Request no longer exists.
                */

                if (!request) {

                    await interaction.reply({
                        content:
                            "❌ This request is no longer available.",
                        ephemeral: true
                    });

                    return;
                }

                /*
                ======================================
                REJECT
                ======================================
                */

                if (
                    interaction.customId ===
                    "rank_reject"
                ) {

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData();

                    const embed =
                        requestMessage.embeds.length
                            ? EmbedBuilder.from(
                                requestMessage.embeds[0]
                            )
                            : new EmbedBuilder();

                    embed
                        .setTitle(
                            "❌ Ranking Request Rejected"
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
                ======================================
                ACCEPT
                ======================================
                */

                if (
                    interaction.customId ===
                    "rank_accept"
                ) {

                    /*
                    Check duplicate AGAIN.

                    This prevents two requests
                    for the same player from
                    both being accepted.
                    */

                    const duplicateIndex =
                        findRankingPlayer(
                            server.rankings,
                            request.name
                        );

                    if (
                        duplicateIndex !== -1
                    ) {

                        delete server.requests[
                            requestMessage.id
                        ];

                        saveData();

                        const embed =
                            requestMessage.embeds.length
                                ? EmbedBuilder.from(
                                    requestMessage.embeds[0]
                                )
                                : new EmbedBuilder();

                        embed
                            .setTitle(
                                "❌ Automatically Rejected — Player Already Ranked"
                            )
                            .setFooter({
                                text:
                                    `Already ranked at #${duplicateIndex + 1}`
                            });

                        await interaction.update({
                            embeds: [embed],
                            components: []
                        });

                        return;
                    }

                    /*
                    Make sure ranking exists.
                    */

                    if (
                        !Array.isArray(
                            server.rankings
                        )
                    ) {
                        server.rankings =
                            createDefaultRanking();
                    }

                    /*
                    Rank position.

                    Rank 1 = index 0
                    Rank 10 = index 9
                    */

                    const position =
                        request.rank - 1;

                    const newPlayer = {
                        name:
                            request.name,
                        userId:
                            null
                    };

                    /*
                    ======================================
                    BETWEEN
                    ======================================

                    Example:

                    Old:

                    #1 A
                    #2 B
                    #3 C
                    #4 D

                    Request:

                    X -> Rank 2 -> Between

                    Result:

                    #1 A
                    #2 X
                    #3 B
                    #4 C

                    Everyone below moves down.
                    Old #10 is removed.
                    */

                    if (
                        request.type ===
                        "between"
                    ) {

                        server.rankings.splice(
                            position,
                            0,
                            newPlayer
                        );

                        server.rankings =
                            server.rankings.slice(
                                0,
                                10
                            );
                    }

                    /*
                    ======================================
                    REPLACE
                    ======================================

                    Only the selected rank
                    changes.
                    */

                    else {

                        /*
                        Normally ranking always has
                        10 positions.

                        This fallback protects
                        against malformed data.
                        */

                        if (
                            position >=
                            server.rankings.length
                        ) {

                            while (
                                server.rankings.length <
                                position
                            ) {

                                server.rankings.push({
                                    name:
                                        "Empty",
                                    userId:
                                        null
                                });
                            }

                            server.rankings.push(
                                newPlayer
                            );

                        } else {

                            server.rankings[
                                position
                            ] = newPlayer;
                        }
                    }

                    /*
                    ======================================
                    REMOVE EMPTY PLACEHOLDERS
                    ======================================
                    */

                    server.rankings =
                        server.rankings.filter(
                            player =>
                                player.name !==
                                "Empty"
                        );

                    /*
                    Keep maximum 10 players.
                    */

                    server.rankings =
                        server.rankings.slice(
                            0,
                            10
                        );

                    /*
                    Remove processed request.
                    */

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData();

                    /*
                    Update ranking message.
                    */

                    await updateRankingMessage(
                        interaction.guild
                    );

                    /*
                    Change request message
                    to accepted.
                    */

                    const embed =
                        requestMessage.embeds.length
                            ? EmbedBuilder.from(
                                requestMessage.embeds[0]
                            )
                            : new EmbedBuilder();

                    embed
                        .setTitle(
                            "✅ Ranking Request Accepted"
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
                "Interaction error:"
            );

            console.error(error);

            try {

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({
                        content:
                            "❌ An unexpected error occurred.",
                        ephemeral: true
                    });

                } else {

                    await interaction.followUp({
                        content:
                            "❌ An unexpected error occurred.",
                        ephemeral: true
                    });
                }

            } catch (_) {}
        }
    }
);

/*
==================================================
LOGIN
==================================================
*/

console.log(
    "Connecting to Discord Gateway..."
);

client.login(TOKEN)
    .then(() => {

        console.log(
            "Discord login completed."
        );

    })
    .catch(error => {

        console.error(
            "========================================"
        );

        console.error(
            "DISCORD LOGIN FAILED"
        );

        console.error(error);

        console.error(
            "========================================"
        );

        setTimeout(() => {
            process.exit(1);
        }, 5000);
    });

/*
==================================================
PROCESS ERRORS
==================================================
*/

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "Unhandled promise rejection:"
        );

        console.error(error);
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "Uncaught exception:"
        );

        console.error(error);
    }
);

/*
==================================================
SHUTDOWN
==================================================
*/

async function shutdown() {

    console.log(
        "Shutting down..."
    );

    try {

        await client.destroy();

    } catch (error) {

        console.error(error);
    }

    httpServer.close(() => {
        process.exit(0);
    });
}

process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);
