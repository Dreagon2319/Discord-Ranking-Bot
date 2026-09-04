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
const https = require("https");

/*
==================================================
CONFIGURATION
==================================================
*/

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = Number(process.env.PORT) || 10000;

const DATA_FILE = "./data.json";

console.log("========================================");
console.log("        RANKING BOT STARTING");
console.log("========================================");
console.log("Client ID:", CLIENT_ID || "MISSING");
console.log("Discord token:", TOKEN ? "FOUND" : "MISSING");
console.log("Token length:", TOKEN ? TOKEN.length : 0);
console.log("Render port:", PORT);
console.log("Node version:", process.version);
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
            console.error(
                "data.json contains invalid data. Starting fresh."
            );

            return {};
        }

        return parsed;

    } catch (error) {
        console.error(
            "Could not load data.json:"
        );

        console.error(error);

        return {};
    }
}

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error(
            "Could not save data.json:"
        );

        console.error(error);
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
DISCORD API CONNECTIVITY TEST
==================================================
*/

function testDiscordAPI() {

    return new Promise(resolve => {

        console.log(
            "Testing connection to Discord API..."
        );

        const request = https.get(
            "https://discord.com/api/v10/gateway",
            response => {

                console.log(
                    "Discord API HTTP status:",
                    response.statusCode
                );

                response.resume();

                response.on("end", () => {

                    console.log(
                        "Discord API connectivity test finished."
                    );

                    resolve(true);
                });
            }
        );

        request.setTimeout(
            10000,
            () => {

                console.error(
                    "Discord API connectivity test timed out after 10 seconds."
                );

                request.destroy();

                resolve(false);
            }
        );

        request.on(
            "error",
            error => {

                console.error(
                    "Discord API connectivity test failed:"
                );

                console.error(error);

                resolve(false);
            }
        );
    });
}

/*
==================================================
REGISTER SLASH COMMANDS
==================================================
*/

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
            "Slash commands registered successfully."
        );

        return true;

    } catch (error) {

        console.error(
            "Slash command registration failed:"
        );

        console.error(error);

        return false;
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
            `Could not fetch members for ${guild.name}:`
        );

        console.error(error);
    }

    const members = [
        ...guild.members.cache.values()
    ].filter(member => {

        return (
            !member.user.bot
        );
    });

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

    /*
    Maximum 10 players.
    */

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

    if (!Array.isArray(rankings)) {
        return "No ranking has been created yet.";
    }

    if (rankings.length === 0) {
        return "No ranking has been created yet.";
    }

    return rankings
        .map((player, index) => {

            const rank = index + 1;

            let medal = "";

            if (rank === 1) {
                medal = "🥇 ";
            }

            if (rank === 2) {
                medal = "🥈 ";
            }

            if (rank === 3) {
                medal = "🥉 ";
            }

            return (
                `${medal}**#${rank} — ${player.name}**`
            );
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
        await guild.channels.fetch(
            server.rankingChannelId
        ).catch(error => {

            console.error(
                "Could not fetch ranking channel:"
            );

            console.error(error);

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
            await channel.messages.fetch(
                server.rankingMessageId
            ).catch(() => null);
    }

    /*
    Existing message found.
    Edit it.
    */

    if (message) {

        try {

            await message.edit({
                embeds: [embed],
                components: []
            });

            console.log(
                `Ranking message updated in #${channel.name}.`
            );

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

        console.log(
            `Ranking message created in #${channel.name}.`
        );

        /*
        Pin message.
        */

        try {

            await message.pin();

            console.log(
                `Ranking message pinned in #${channel.name}.`
            );

        } catch (error) {

            console.error(
                "Could not pin ranking message:"
            );

            console.error(error);

            console.error(
                "Make sure the bot has Manage Messages permission."
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
MANAGER ROLE CHECK
==================================================
*/

function hasManagerRole(member, server) {

    if (!server.managerRoleId) {
        return false;
    }

    if (!member || !member.roles) {
        return false;
    }

    return member.roles.cache.has(
        server.managerRoleId
    );
}

/*
==================================================
DUPLICATE PLAYER CHECK
==================================================
*/

function findRankingPlayer(rankings, name) {

    if (!Array.isArray(rankings)) {
        return -1;
    }

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
DISCORD READY
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

    /*
    Register commands.
    */

    await registerCommands();

    /*
    Process every server.
    */

    for (
        const guild of client.guilds.cache.values()
    ) {

        try {

            console.log("");
            console.log(
                `Processing server: ${guild.name}`
            );

            const server =
                getServerData(guild.id);

            /*
            Create initial ranking
            if no ranking exists.
            */

            if (
                server.rankings.length === 0
            ) {

                server.rankings =
                    await createRandomRanking(
                        guild
                    );

                saveData();

                console.log(
                    `Initial ranking created for ${guild.name}.`
                );
            }

            /*
            Update ranking message
            if a channel was configured.
            */

            await updateRankingMessage(
                guild
            );

        } catch (error) {

            console.error(
                `Error processing server ${guild.name}:`
            );

            console.error(error);
        }
    }

    console.log("");
    console.log("========================================");
    console.log("       RANKING BOT IS READY");
    console.log("========================================");
});

/*
==================================================
DISCORD CLIENT EVENTS
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
        "Discord warning:"
    );

    console.warn(warning);
});

client.on(
    "shardError",
    error => {

        console.error(
            "Discord Gateway shard error:"
        );

        console.error(error);
    }
);

client.on(
    "shardDisconnect",
    (event, shardId) => {

        console.warn(
            `Discord shard ${shardId} disconnected.`
        );

        console.warn(
            "Close code:",
            event?.code
        );

        console.warn(
            "Reason:",
            event?.reason?.toString()
        );
    }
);

client.on(
    "shardReconnecting",
    shardId => {

        console.log(
            `Discord shard ${shardId} reconnecting...`
        );
    }
);

client.on(
    "shardReady",
    shardId => {

        console.log(
            `Discord shard ${shardId} is ready.`
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

                    saveData();

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
                        interaction.options.getChannel(
                            "channel"
                        );

                    server.rankingChannelId =
                        channel.id;

                    /*
                    Force the bot to create/find
                    the ranking message in this
                    channel.
                    */

                    server.rankingMessageId = null;

                    saveData();

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

                    /*
                    Validate name.
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
                    Maximum Discord embed field
                    safety.
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
                    Ranking channel required.
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
                    Check duplicate.
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
                    Find ranking channel.
                    */

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

                    console.log(
                        `Ranking request created: ${name} -> #${rank} (${type})`
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
                Only managers can press buttons.
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

                    const rejectedEmbed =
                        requestMessage.embeds.length
                            ? EmbedBuilder.from(
                                requestMessage.embeds[0]
                            )
                            : new EmbedBuilder();

                    rejectedEmbed
                        .setTitle(
                            "❌ Ranking Request Rejected"
                        )
                        .setFooter({
                            text:
                                `Rejected by ${interaction.user.tag}`
                        });

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
                    This protects against two requests
                    being accepted for the same player.
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

                        const duplicateEmbed =
                            requestMessage.embeds.length
                                ? EmbedBuilder.from(
                                    requestMessage.embeds[0]
                                )
                                : new EmbedBuilder();

                        duplicateEmbed
                            .setTitle(
                                "❌ Automatically Rejected — Player Already Ranked"
                            )
                            .setFooter({
                                text:
                                    `Already ranked at #${duplicateIndex + 1}`
                            });

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
                        name:
                            request.name,
                        userId:
                            null
                    };

                    /*
                    ==================================
                    BETWEEN
                    ==================================

                    Example:

                    Current:
                    #1 A
                    #2 B
                    #3 C

                    Request:
                    D -> #2 Between

                    Result:
                    #1 A
                    #2 D
                    #3 B
                    #4 C
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

                        /*
                        Maximum 10.
                        */

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

                        Example:

                        Current:
                        #1 A
                        #2 B
                        #3 C

                        Request:
                        D -> #2 Replace

                        Result:
                        #1 A
                        #2 D
                        #3 C
                        */

                        /*
                        If the requested position is
                        beyond the current list, expand
                        it temporarily.
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
                    Remove temporary Empty entries.
                    */

                    server.rankings =
                        server.rankings.filter(
                            player =>
                                player.name !==
                                "Empty"
                        );

                    /*
                    Maximum 10 players.
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
                    Update ranking message.
                    */

                    await updateRankingMessage(
                        interaction.guild
                    );

                    /*
                    Update request message.
                    */

                    const acceptedEmbed =
                        requestMessage.embeds.length
                            ? EmbedBuilder.from(
                                requestMessage.embeds[0]
                            )
                            : new EmbedBuilder();

                    acceptedEmbed
                        .setTitle(
                            "✅ Ranking Request Accepted"
                        )
                        .setFooter({
                            text:
                                `Accepted by ${interaction.user.tag}`
                        });

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

            } catch (_) {
                /*
                Interaction may already have expired.
                */
            }
        }
    }
);

/*
==================================================
DISCORD LOGIN
==================================================
*/

async function startDiscord() {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "Checking Discord API connectivity..."
    );

    const apiOK =
        await testDiscordAPI();

    if (!apiOK) {

        console.error("");
        console.error(
            "Discord API is not reachable from this server."
        );

        console.error(
            "The bot will NOT attempt Gateway login."
        );

        console.error(
            "Render/network connectivity must be fixed first."
        );

        return;
    }

    console.log(
        "Discord API is reachable."
    );

    console.log(
        "Attempting to connect to Discord Gateway..."
    );

    console.log(
        "========================================"
    );

    /*
    Safety timeout.
    */

    const loginTimeout =
        setTimeout(() => {

            console.error("");
            console.error(
                "========================================"
            );

            console.error(
                "DISCORD LOGIN TIMEOUT"
            );

            console.error(
                "Discord Gateway connection did not complete within 30 seconds."
            );

            console.error(
                "The process will restart so Render can try again."
            );

            console.error(
                "========================================"
            );

            process.exit(1);

        }, 30000);

    try {

        await client.login(TOKEN);

        clearTimeout(loginTimeout);

        console.log(
            "Discord login promise completed."
        );

    } catch (error) {

        clearTimeout(loginTimeout);

        console.error("");
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
    }
}

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
                "Error destroying Discord client:"
            );

            console.error(error);
        }

        httpServer.close(() => {

            process.exit(0);
        });
    }
);

process.on(
    "SIGINT",
    async () => {

        console.log(
            "SIGINT received. Shutting down..."
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
);

/*
==================================================
START
==================================================
*/

startDiscord();
