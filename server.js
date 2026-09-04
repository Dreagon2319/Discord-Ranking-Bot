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
ENVIRONMENT VARIABLES
==================================================
*/

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 10000;

console.log("========================================");
console.log("RANKING BOT STARTING");
console.log("========================================");
console.log("Client ID:", CLIENT_ID || "MISSING");
console.log("Discord token:", TOKEN ? "FOUND" : "MISSING");
console.log("Token length:", TOKEN ? TOKEN.length : 0);
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
DATA STORAGE
==================================================
*/

const DATA_FILE = "./data.json";

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, "{}");
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        if (!raw.trim()) {
            return {};
        }

        return JSON.parse(raw);

    } catch (error) {
        console.error("Could not load data:", error);
        return {};
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2)
        );
    } catch (error) {
        console.error("Could not save data:", error);
    }
}

const data = loadData();

function getServerData(guildId) {

    if (!data[guildId]) {

        data[guildId] = {
            managerRoleId: null,
            rankingChannelId: null,
            rankingMessageId: null,
            rankings: [],
            requests: {}
        };

        saveData(data);
    }

    if (!data[guildId].requests) {
        data[guildId].requests = {};
        saveData(data);
    }

    if (!Array.isArray(data[guildId].rankings)) {
        data[guildId].rankings = [];
        saveData(data);
    }

    return data[guildId];
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
                .setDescription(
                    "Requested rank (1-10)"
                )
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription(
                    "Ranking change type"
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
        )

].map(command => command.toJSON());

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

/*
==================================================
REGISTER SLASH COMMANDS
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
CREATE RANDOM INITIAL RANKING
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
            `Could not fetch members for ${guild.name}:`,
            error
        );
    }

    const members = [
        ...guild.members.cache.values()
    ].filter(member => !member.user.bot);

    /*
    Shuffle members.
    */

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

    const ranking = members
        .slice(0, 10)
        .map(member => ({
            name: member.displayName,
            userId: member.id
        }));

    console.log(
        `Initial ranking contains ${ranking.length} players.`
    );

    return ranking;
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

    const server =
        getServerData(guild.id);

    if (!server.rankingChannelId) {
        console.log(
            `No ranking channel configured for ${guild.name}.`
        );
        return;
    }

    const channel =
        await guild.channels
            .fetch(
                server.rankingChannelId
            )
            .catch(error => {

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
            `Ranking channel is unavailable in ${guild.name}.`
        );

        return;
    }

    const embed =
        createRankingEmbed(
            server.rankings
        );

    let message = null;

    /*
    Try existing ranking message.
    */

    if (server.rankingMessageId) {

        message =
            await channel.messages
                .fetch(
                    server.rankingMessageId
                )
                .catch(() => null);
    }

    /*
    Edit existing message.
    */

    if (message) {

        await message.edit({
            embeds: [embed]
        });

        console.log(
            `Ranking message updated in #${channel.name}.`
        );

        return;
    }

    /*
    Create new ranking message.
    */

    try {

        message =
            await channel.send({
                embeds: [embed]
            });

        server.rankingMessageId =
            message.id;

        saveData(data);

        console.log(
            `Ranking message created in #${channel.name}.`
        );

        /*
        Pin ranking message.
        */

        try {

            await message.pin();

            console.log(
                `Ranking message pinned in #${channel.name}.`
            );

        } catch (error) {

            console.error(
                "Could not pin ranking message:",
                error
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
MANAGER ROLE CHECK
==================================================
*/

function hasManagerRole(member, server) {

    if (!server.managerRoleId) {
        return false;
    }

    return member.roles.cache.has(
        server.managerRoleId
    );
}

/*
==================================================
DISCORD READY
==================================================
*/

client.once("ready", async () => {

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

        console.log(
            `Processing server: ${guild.name}`
        );

        const server =
            getServerData(guild.id);

        /*
        Create initial ranking if needed.
        */

        if (
            server.rankings.length === 0
        ) {

            server.rankings =
                await createRandomRanking(
                    guild
                );

            saveData(data);

            console.log(
                `Initial ranking created for ${guild.name}.`
            );
        }

        await updateRankingMessage(
            guild
        );
    }

    console.log("========================================");
    console.log("RANKING BOT IS READY");
    console.log("========================================");
});

/*
==================================================
DISCORD CLIENT ERRORS
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
                /setrole
                ======================================
                */

                if (
                    interaction.commandName ===
                    "setrole"
                ) {

                    const role =
                        interaction.options
                            .getRole("role");

                    server.managerRoleId =
                        role.id;

                    saveData(data);

                    await interaction.reply({
                        content:
                            `✅ Manager role set to **${role.name}**.`,
                        ephemeral: true
                    });

                    console.log(
                        `Manager role set to ${role.name} in ${interaction.guild.name}.`
                    );

                    return;
                }

                /*
                ======================================
                /setchannel
                ======================================
                */

                if (
                    interaction.commandName ===
                    "setchannel"
                ) {

                    const channel =
                        interaction.options
                            .getChannel("channel");

                    server.rankingChannelId =
                        channel.id;

                    /*
                    Force creation of a ranking
                    message in the new channel.
                    */

                    server.rankingMessageId =
                        null;

                    saveData(data);

                    await updateRankingMessage(
                        interaction.guild
                    );

                    await interaction.reply({
                        content:
                            `✅ Ranking channel set to ${channel}.`,
                        ephemeral: true
                    });

                    console.log(
                        `Ranking channel set to #${channel.name} in ${interaction.guild.name}.`
                    );

                    return;
                }

                /*
                ======================================
                /requestrank
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
                    ==================================
                    DUPLICATE CHECK
                    ==================================
                    */

                    const existingIndex =
                        server.rankings.findIndex(
                            player =>
                                player.name
                                    .toLowerCase() ===
                                name.toLowerCase()
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
                    Find ranking channel.
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
                                        type === "between"
                                            ? "Between"
                                            : "Replace"
                                }
                            )
                            .setTimestamp();

                    /*
                    ==================================
                    BUTTONS
                    ==================================
                    */

                    const acceptButton =
                        new ButtonBuilder()
                            .setCustomId(
                                `rank_accept:${interaction.id}`
                            )
                            .setLabel("Accept")
                            .setEmoji("✅")
                            .setStyle(
                                ButtonStyle.Success
                            );

                    const rejectButton =
                        new ButtonBuilder()
                            .setCustomId(
                                `rank_reject:${interaction.id}`
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

                    if (!server.requests) {
                        server.requests = {};
                    }

                    server.requests[
                        requestMessage.id
                    ] = {
                        name,
                        rank,
                        type,
                        requesterId:
                            interaction.user.id
                    };

                    saveData(data);

                    await interaction.reply({
                        content:
                            "✅ Your ranking request has been submitted for manager approval.",
                        ephemeral: true
                    });

                    console.log(
                        `Ranking request created by ${interaction.user.tag}: ${name} -> #${rank} (${type})`
                    );

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
                Manager role check.
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
                    interaction.customId
                        .split(":")[0];

                const requestMessage =
                    interaction.message;

                const request =
                    server.requests?.[
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

                    saveData(data);

                    const rejectedEmbed =
                        EmbedBuilder.from(
                            requestMessage.embeds[0]
                        ).setTitle(
                            "❌ Ranking Request Rejected"
                        );

                    await interaction.update({
                        embeds: [
                            rejectedEmbed
                        ],
                        components: []
                    });

                    console.log(
                        `Ranking request rejected: ${request.name}`
                    );

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

                    const duplicate =
                        server.rankings.some(
                            player =>
                                player.name
                                    .toLowerCase() ===
                                request.name
                                    .toLowerCase()
                        );

                    if (duplicate) {

                        delete server.requests[
                            requestMessage.id
                        ];

                        saveData(data);

                        const duplicateEmbed =
                            EmbedBuilder.from(
                                requestMessage
                                    .embeds[0]
                            ).setTitle(
                                "❌ Automatically Rejected — Player Already Ranked"
                            );

                        await interaction.update({
                            embeds: [
                                duplicateEmbed
                            ],
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
                    ==================================
                    BETWEEN
                    ==================================
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
                        ==================================
                        REPLACE
                        ==================================
                        */

                        while (
                            server.rankings.length <=
                            position
                        ) {

                            server.rankings.push({
                                name: "Empty",
                                userId: null
                            });
                        }

                        server.rankings[
                            position
                        ] = newPlayer;
                    }

                    /*
                    Remove empty entries if
                    any exist.
                    */

                    server.rankings =
                        server.rankings.filter(
                            player =>
                                player.name !==
                                "Empty"
                        );

                    /*
                    Keep maximum 10.
                    */

                    server.rankings =
                        server.rankings.slice(
                            0,
                            10
                        );

                    /*
                    Delete request.
                    */

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData(data);

                    /*
                    Update ranking.
                    */

                    await updateRankingMessage(
                        interaction.guild
                    );

                    /*
                    Update request message.
                    */

                    const acceptedEmbed =
                        EmbedBuilder.from(
                            requestMessage.embeds[0]
                        ).setTitle(
                            "✅ Ranking Request Accepted"
                        );

                    await interaction.update({
                        embeds: [
                            acceptedEmbed
                        ],
                        components: []
                    });

                    console.log(
                        `Ranking request accepted: ${request.name} -> #${request.rank}`
                    );

                    return;
                }
            }

        } catch (error) {

            console.error(
                "Interaction error:",
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {

                await interaction.reply({
                    content:
                        "❌ An unexpected error occurred.",
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

/*
==================================================
DISCORD LOGIN
==================================================
*/

console.log(
    "Attempting to connect to Discord..."
);

client.login(TOKEN)
    .then(() => {

        console.log(
            "Discord login promise completed."
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

        /*
        Keep the process alive long enough
        for Render to display the error.
        */

        setTimeout(() => {
            process.exit(1);
        }, 5000);
    });

/*
==================================================
PROCESS ERROR HANDLING
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
GRACEFUL SHUTDOWN
==================================================
*/

process.on(
    "SIGTERM",
    async () => {

        console.log(
            "SIGTERM received. Shutting down..."
        );

        try {
            await client.destroy();
        } catch (error) {
            console.error(
                "Error destroying Discord client:",
                error
            );
        }

        httpServer.close(() => {
            process.exit(0);
        });
    }
);
