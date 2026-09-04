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

if (!TOKEN || !CLIENT_ID) {
    console.error(
        "Missing DISCORD_TOKEN or CLIENT_ID environment variable."
    );
    process.exit(1);
}

/*
==================================================
RENDER WEB SERVICE HTTP SERVER
==================================================
Discord bots normally do not need an HTTP port.

Render Web Services do, so we create a tiny
HTTP server while the Discord bot runs normally.
*/

const PORT = process.env.PORT || 10000;

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Ranking Bot is running!");
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

        return JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
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

    // Make sure older data files get the requests object.
    if (!data[guildId].requests) {
        data[guildId].requests = {};
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
                .addChannelTypes(ChannelType.GuildText)
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
                .setDescription("Requested rank (1-10)")
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

const rest = new REST({ version: "10" })
    .setToken(TOKEN);

/*
==================================================
REGISTER COMMANDS
==================================================
*/

async function registerCommands() {
    try {
        console.log("Registering slash commands...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("Slash commands registered.");
    } catch (error) {
        console.error(
            "Command registration failed:",
            error
        );
    }
}

/*
==================================================
RANDOM INITIAL RANKING
==================================================
*/

async function createRandomRanking(guild) {
    try {
        // Fetch all members so the random list is not
        // limited to whatever Discord happened to cache.
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

    // Shuffle members randomly.
    for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [members[i], members[j]] =
            [members[j], members[i]];
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

    const channel = await guild.channels
        .fetch(server.rankingChannelId)
        .catch(() => null);

    if (!channel || !channel.isTextBased()) {
        console.error(
            `Ranking channel not found in ${guild.name}.`
        );
        return;
    }

    const embed = createRankingEmbed(
        server.rankings
    );

    let message = null;

    /*
    Try to find the existing ranking message.
    */

    if (server.rankingMessageId) {
        message = await channel.messages
            .fetch(server.rankingMessageId)
            .catch(() => null);
    }

    /*
    Existing message found:
    edit it instead of creating another one.
    */

    if (message) {
        await message.edit({
            embeds: [embed]
        });

        return;
    }

    /*
    Message doesn't exist:
    create a new ranking message.
    */

    message = await channel.send({
        embeds: [embed]
    });

    server.rankingMessageId = message.id;

    saveData(data);

    /*
    Pin the ranking message.
    */

    try {
        await message.pin();

        console.log(
            `Ranking message pinned in #${channel.name}`
        );
    } catch (error) {
        console.error(
            "Could not pin ranking message:",
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
BOT READY
==================================================
*/

client.once("ready", async () => {
    console.log(
        `Logged in as ${client.user.tag}`
    );

    await registerCommands();

    for (const guild of client.guilds.cache.values()) {

        console.log(
            `Checking server: ${guild.name}`
        );

        const server =
            getServerData(guild.id);

        /*
        Create random ranking only if
        no ranking exists yet.
        */

        if (server.rankings.length === 0) {

            server.rankings =
                await createRandomRanking(guild);

            saveData(data);

            console.log(
                `Created initial ranking for ${guild.name}:`,
                server.rankings
            );
        }

        await updateRankingMessage(guild);
    }

    console.log("Ranking Bot is ready.");
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

            if (interaction.isChatInputCommand()) {

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
                        interaction.options.getRole(
                            "role"
                        );

                    server.managerRoleId =
                        role.id;

                    saveData(data);

                    await interaction.reply({
                        content:
                            `✅ Manager role set to **${role.name}**.`,
                        ephemeral: true
                    });

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
                        interaction.options.getChannel(
                            "channel"
                        );

                    server.rankingChannelId =
                        channel.id;

                    /*
                    Reset the saved message ID if
                    the channel was changed.
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

                    /*
                    Ranking channel must exist.
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
                    ==================================
                    DUPLICATE CHECK
                    ==================================
                    */

                    const existingPlayer =
                        server.rankings.find(
                            player =>
                                player.name
                                    .toLowerCase() ===
                                name.toLowerCase()
                        );

                    if (existingPlayer) {

                        const existingRank =
                            server.rankings
                                .findIndex(
                                    player =>
                                        player.name
                                            .toLowerCase() ===
                                        name.toLowerCase()
                                ) + 1;

                        await interaction.reply({
                            content:
                                `❌ Request automatically rejected.\n\n` +
                                `**${name}** is already ranked at **#${existingRank}**.`,
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
                                        type ===
                                        "between"
                                            ? "Between"
                                            : "Replace"
                                }
                            )
                            .setColor(0x5865F2)
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
                    Send request message.
                    */

                    const requestMessage =
                        await channel.send({
                            embeds: [embed],
                            components: [row]
                        });

                    /*
                    Save request permanently.
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

                    return;
                }
            }

            /*
            ==========================================
            BUTTONS
            ==========================================
            */

            if (interaction.isButton()) {

                if (!interaction.guild) {
                    return;
                }

                const server =
                    getServerData(
                        interaction.guild.id
                    );

                /*
                Check manager role.
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

                const parts =
                    interaction.customId
                        .split(":");

                const action = parts[0];

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

                    await interaction.update({
                        embeds: [
                            EmbedBuilder.from(
                                requestMessage.embeds[0]
                            ).setTitle(
                                "❌ Ranking Request Rejected"
                            )
                        ],
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
                    Re-check duplicate before
                    making the ranking change.
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

                        await interaction.update({
                            embeds: [
                                EmbedBuilder.from(
                                    requestMessage
                                        .embeds[0]
                                ).setTitle(
                                    "❌ Automatically Rejected — Player Already Ranked"
                                )
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
                    REPLACE
                    ==================================
                    */

                    if (
                        request.type ===
                        "replace"
                    ) {

                        /*
                        Make sure the requested
                        position exists.
                        */

                        if (
                            position >=
                            server.rankings.length
                        ) {

                            /*
                            Fill the requested
                            position if necessary.
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
                        }

                        server.rankings[
                            position
                        ] = newPlayer;

                    } else {

                        /*
                        ==================================
                        BETWEEN
                        ==================================
                        */

                        server.rankings.splice(
                            position,
                            0,
                            newPlayer
                        );

                        /*
                        Maximum 10 players.
                        The old #10 is removed.
                        */

                        server.rankings =
                            server.rankings
                                .slice(0, 10);
                    }

                    /*
                    Delete processed request.
                    */

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData(data);

                    /*
                    Update the main ranking message.
                    */

                    await updateRankingMessage(
                        interaction.guild
                    );

                    /*
                    Update request message.
                    */

                    await interaction.update({
                        embeds: [
                            EmbedBuilder.from(
                                requestMessage.embeds[0]
                            ).setTitle(
                                "✅ Ranking Request Accepted"
                            )
                        ],
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

client.login(TOKEN).catch(error => {
    console.error(
        "Discord login failed:",
        error
    );

    process.exit(1);
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
            "Unhandled promise rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught exception:",
            error
        );
    }
);
