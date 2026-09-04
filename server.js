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
RENDER SERVER
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
        console.error("Could not load data.json:", error);
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
        console.error("Could not save data.json:", error);
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
COMMANDS
==================================================
*/

const commands = [

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
        console.error("Slash command registration failed:");
        console.error(error);
    }
}

/*
==================================================
RANDOM INITIAL RANKING
==================================================
*/

async function createRandomRanking(guild) {
    console.log(
        `Creating initial ranking for ${guild.name}...`
    );

    try {
        await guild.members.fetch();
    } catch (error) {
        console.error(
            `Could not fetch members for ${guild.name}:`
        );
        console.error(error);
    }

    const members = [
        ...guild.members.cache.values()
    ].filter(member => !member.user.bot);

    for (
        let i = members.length - 1;
        i > 0;
        i--
    ) {
        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [
            members[i],
            members[j]
        ] = [
            members[j],
            members[i]
        ];
    }

    return members
        .slice(0, 10)
        .map(member => ({
            name: member.displayName,
            userId: member.id
        }));
}

/*
==================================================
RANKING DISPLAY
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

    if (server.rankingMessageId) {
        message =
            await channel.messages.fetch(
                server.rankingMessageId
            ).catch(() => null);
    }

    if (message) {
        try {
            await message.edit({
                embeds: [embed]
            });

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

    try {
        message = await channel.send({
            embeds: [embed]
        });

        server.rankingMessageId = message.id;

        saveData();

        try {
            await message.pin();
            console.log("Ranking message pinned.");
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
MANAGER PERMISSION
==================================================
*/

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

/*
==================================================
DUPLICATE CHECK
==================================================
*/

function findRankingPlayer(rankings, name) {
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
    console.log("========================================");
    console.log(
        `DISCORD LOGIN SUCCESSFUL: ${client.user.tag}`
    );
    console.log(
        `Bot ID: ${client.user.id}`
    );
    console.log(
        `Servers: ${client.guilds.cache.size}`
    );
    console.log("========================================");

    await registerCommands();

    for (
        const guild of client.guilds.cache.values()
    ) {
        try {
            const server =
                getServerData(guild.id);

            if (!server.rankings.length) {
                server.rankings =
                    await createRandomRanking(
                        guild
                    );

                saveData();
            }

            await updateRankingMessage(
                guild
            );
        } catch (error) {
            console.error(
                `Error processing ${guild.name}:`
            );

            console.error(error);
        }
    }

    console.log("");
    console.log("========================================");
    console.log("RANKING BOT IS READY");
    console.log("========================================");
});

/*
==================================================
GATEWAY EVENTS
==================================================
*/

client.on("error", error => {
    console.error("Discord client error:");
    console.error(error);
});

client.on("warn", warning => {
    console.warn("Discord warning:", warning);
});

client.on("shardError", error => {
    console.error("Discord Gateway error:");
    console.error(error);
});

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
            event?.reason?.toString() || "None"
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

                    const channel =
                        interaction.options.getChannel(
                            "channel"
                        );

                    server.rankingChannelId =
                        channel.id;

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
                                "❌ Player name is too long. Maximum 100 characters.",
                            ephemeral: true
                        });

                        return;
                    }

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
                    Prevent duplicates
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

                    const channel =
                        await interaction.guild.channels
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

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                "🏆 Ranking Change Request"
                            )
                            .addFields(
                                {
                                    name: "Requested By",
                                    value:
                                        `<@${interaction.user.id}>`
                                },
                                {
                                    name: "Player",
                                    value: name
                                },
                                {
                                    name: "Rank",
                                    value: `#${rank}`
                                },
                                {
                                    name: "Type",
                                    value:
                                        type === "between"
                                            ? "Between"
                                            : "Replace"
                                }
                            )
                            .setFooter({
                                text:
                                    "Waiting for manager approval"
                            })
                            .setTimestamp();

                    const acceptButton =
                        new ButtonBuilder()
                            .setCustomId(
                                "rank_accept"
                            )
                            .setLabel("Accept")
                            .setEmoji("✅")
                            .setStyle(
                                ButtonStyle.Success
                            );

                    const rejectButton =
                        new ButtonBuilder()
                            .setCustomId(
                                "rank_reject"
                            )
                            .setLabel("Reject")
                            .setEmoji("❌")
                            .setStyle(
                                ButtonStyle.Danger
                            );

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                acceptButton,
                                rejectButton
                            );

                    const requestMessage =
                        await channel.send({
                            embeds: [embed],
                            components: [row]
                        });

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

                if (
                    !hasManagerRole(
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
                    Check duplicate again because
                    another request could have been
                    accepted first.
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

                    const position =
                        request.rank - 1;

                    const newPlayer = {
                        name: request.name,
                        userId: null
                    };

                    /*
                    BETWEEN
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
                    REPLACE
                    */

                    else {

                        if (
                            position >=
                            server.rankings.length
                        ) {

                            while (
                                server.rankings.length <
                                position
                            ) {
                                server.rankings.push({
                                    name: "Empty",
                                    userId: null
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
                    Remove placeholders
                    */

                    server.rankings =
                        server.rankings.filter(
                            player =>
                                player.name !==
                                "Empty"
                        );

                    server.rankings =
                        server.rankings.slice(
                            0,
                            10
                        );

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData();

                    await updateRankingMessage(
                        interaction.guild
                    );

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

    console.log("Shutting down...");

    try {
        await client.destroy();
    } catch (error) {
        console.error(error);
    }

    httpServer.close(() => {
        process.exit(0);
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
