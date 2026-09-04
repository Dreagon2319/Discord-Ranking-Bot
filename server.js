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

/*
==================================================
CONFIG
==================================================
*/

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = Number(process.env.PORT) || 10000;
const DATA_FILE = "./data.json";

console.log("========================================");
console.log("RANKING BOT STARTING");
console.log("========================================");
console.log("Client ID:", CLIENT_ID || "MISSING");
console.log("Discord token:", TOKEN ? "FOUND" : "MISSING");
console.log("Token length:", TOKEN ? TOKEN.length : 0);
console.log("Node version:", process.version);
console.log("Render port:", PORT);
console.log("========================================");

if (!TOKEN) {
    console.error("ERROR: DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("ERROR: CLIENT_ID is missing.");
    process.exit(1);
}

/*
==================================================
RENDER HTTP SERVER
==================================================
*/

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Ranking Bot is running!");
});

httpServer.on("error", error => {
    console.error("HTTP server error:", error);
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
SLASH COMMANDS
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
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "Slash commands registered successfully."
        );

    } catch (error) {

        console.error(
            "Slash command registration failed:"
        );

        console.error(error);
    }
}

/*
==================================================
INITIAL RANDOM RANKING
==================================================
*/

async function createRandomRanking(guild) {

    console.log(
        `Fetching members for ${guild.name}...`
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

    const server =
        getServerData(guild.id);

    if (!server.rankingChannelId) {
        return;
    }

    const channel =
        await guild.channels.fetch(
            server.rankingChannelId
        ).catch(error => {

            console.error(
                "Could not fetch ranking channel:",
                error
            );

            return null;
        });

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        console.error(
            `Ranking channel unavailable in ${guild.name}.`
        );
        return;
    }

    const embed =
        createRankingEmbed(
            server.rankings
        );

    let message = null;

    /*
    Find existing ranking message.
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

            return;

        } catch (error) {

            console.error(
                "Could not edit ranking message:",
                error
            );

            server.rankingMessageId = null;
            saveData();
        }
    }

    /*
    Create ranking message.
    */

    try {

        message = await channel.send({
            embeds: [embed]
        });

        server.rankingMessageId =
            message.id;

        saveData();

        /*
        Pin ranking message.
        */

        try {

            await message.pin();

        } catch (error) {

            console.error(
                "Could not pin ranking message:",
                error
            );

            console.error(
                "Make sure the bot has Manage Messages permission."
            );
        }

    } catch (error) {

        console.error(
            "Could not send ranking message:",
            error
        );
    }
}

/*
==================================================
MANAGER ROLE
==================================================
*/

function hasManagerRole(member, server) {

    if (!server.managerRoleId) {
        return false;
    }

    if (!member?.roles) {
        return false;
    }

    return member.roles.cache.has(
        server.managerRoleId
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
        `Discord login successful: ${client.user.tag}`
    );
    console.log(
        `Bot user ID: ${client.user.id}`
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

            console.log(
                `Processing server: ${guild.name}`
            );

            if (
                server.rankings.length === 0
            ) {

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
                `Error processing ${guild.name}:`,
                error
            );
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

    console.error(
        "Discord client error:"
    );

    console.error(error);
});

client.on("warn", warning => {

    console.warn(
        "Discord warning:",
        warning
    );
});

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
            `Discord Gateway disconnected. Shard: ${shardId}`
        );

        console.error(
            "Close code:",
            event?.code
        );

        console.error(
            "Reason:",
            event?.reason?.toString() || "No reason"
        );
    }
);

client.on(
    "shardReconnecting",
    shardId => {

        console.log(
            `Discord Gateway reconnecting. Shard: ${shardId}`
        );
    }
);

client.on(
    "shardReady",
    shardId => {

        console.log(
            `Discord Gateway ready. Shard: ${shardId}`
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
                /setrole
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
                /setchannel
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
                /requestrank
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
                    Duplicate check.
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

                    /*
                    Request embed.
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

                    /*
                    Buttons.
                    */

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

                    /*
                    Send request.
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
                Manager permission.
                */

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

                const action =
                    interaction.customId;

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
                    action ===
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
                    action ===
                    "rank_accept"
                ) {

                    /*
                    Check duplicate again.
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
                        name:
                            request.name,
                        userId:
                            null
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

                    } else {

                        /*
                        REPLACE
                        */

                        while (
                            server.rankings.length <=
                            position
                        ) {

                            server.rankings.push({
                                name:
                                    "Empty",
                                userId:
                                    null
                            });
                        }

                        server.rankings[
                            position
                        ] = newPlayer;
                    }

                    /*
                    Remove empty entries.
                    */

                    server.rankings =
                        server.rankings.filter(
                            player =>
                                player.name !==
                                "Empty"
                        );

                    /*
                    Maximum 10.
                    */

                    server.rankings =
                        server.rankings.slice(
                            0,
                            10
                        );

                    /*
                    Remove request.
                    */

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData();

                    /*
                    Update ranking.
                    */

                    await updateRankingMessage(
                        interaction.guild
                    );

                    /*
                    Update request.
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
    "Attempting to connect to Discord Gateway..."
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

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
