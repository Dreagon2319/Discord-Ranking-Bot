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

/*
==================================================
STARTUP
==================================================
*/

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
    console.log(
        `HTTP server listening on port ${PORT}`
    );
});

/*
==================================================
DATA
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

        const raw =
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            return {};
        }

        const parsed =
            JSON.parse(raw);

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
            "Could not load data.json:"
        );

        console.error(error);

        return {};
    }
}

const data = loadData();

function saveData() {
    try {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

    } catch (error) {

        console.error(
            "Could not save data.json:"
        );

        console.error(error);
    }
}

/*
==================================================
SERVER DATA
==================================================
*/

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

    const server =
        data[guildId];

    if (!server.requests) {
        server.requests = {};
    }

    if (!Array.isArray(server.rankings)) {
        server.rankings = [];
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

/*
==================================================
DEFAULT RANKING
==================================================
*/

function createDefaultRanking() {

    return Array.from(
        {
            length: 10
        },
        (_, index) => {

            return {
                name:
                    `Player${String(
                        index + 1
                    ).padStart(3, "0")}`,

                userId: null
            };
        }
    );
}

/*
==================================================
PERMISSIONS
==================================================
*/

/*
Owner OR Administrator.

These users can:

/setrole
/setchannel

They can also accept/reject requests.
*/

function isOwnerOrAdministrator(member) {

    if (!member) {
        return false;
    }

    return Boolean(
        member.id ===
            member.guild.ownerId ||

        member.permissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

/*
Configured manager role.
*/

function hasManagerRole(
    member,
    server
) {

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
Manager = configured role OR
server owner OR Administrator.
*/

function canManageRequests(
    member,
    server
) {

    return (
        hasManagerRole(
            member,
            server
        ) ||

        isOwnerOrAdministrator(
            member
        )
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
    ==============================================
    /SETROLE
    ==============================================
    */

    new SlashCommandBuilder()

        .setName("setrole")

        .setDescription(
            "Set the role that can manage ranking requests."
        )

        .addRoleOption(option =>

            option

                .setName("role")

                .setDescription(
                    "Manager role"
                )

                .setRequired(true)

        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),


    /*
    ==============================================
    /SETCHANNEL
    ==============================================
    */

    new SlashCommandBuilder()

        .setName("setchannel")

        .setDescription(
            "Set the channel where the ranking is displayed."
        )

        .addChannelOption(option =>

            option

                .setName("channel")

                .setDescription(
                    "Ranking channel"
                )

                .addChannelTypes(
                    ChannelType.GuildText
                )

                .setRequired(true)

        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),


    /*
    ==============================================
    /REQUESTRANK
    ==============================================
    */

    new SlashCommandBuilder()

        .setName("requestrank")

        .setDescription(
            "Request a new player ranking."
        )

        .addStringOption(option =>

            option

                .setName("name")

                .setDescription(
                    "Player name"
                )

                .setRequired(true)

        )

        .addIntegerOption(option =>

            option

                .setName("rank")

                .setDescription(
                    "Rank 1-10"
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

        ),


    /*
    ==============================================
    /REQUESTMOVE
    ==============================================
    */

    new SlashCommandBuilder()

        .setName("requestmove")

        .setDescription(
            "Request to move an existing player."
        )

        .addStringOption(option =>

            option

                .setName("name")

                .setDescription(
                    "Existing player name"
                )

                .setRequired(true)

        )

        .addIntegerOption(option =>

            option

                .setName("rank")

                .setDescription(
                    "Target rank 1-10"
                )

                .setMinValue(1)

                .setMaxValue(10)

                .setRequired(true)

        )

        .addStringOption(option =>

            option

                .setName("type")

                .setDescription(
                    "Move type"
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

        )

].map(
    command =>
        command.toJSON()
);

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

/*
==================================================
REGISTER COMMANDS
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
            "Slash commands registered."
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
RANKING DISPLAY
==================================================
*/

function rankingText(rankings) {

    if (!rankings.length) {

        return (
            "No ranking has been created yet."
        );
    }

    return rankings

        .map(
            (player, index) => {

                const rank =
                    index + 1;

                let medal = "";

                if (rank === 1) {

                    medal = "🥇 ";

                } else if (rank === 2) {

                    medal = "🥈 ";

                } else if (rank === 3) {

                    medal = "🥉 ";
                }

                return (
                    `${medal}**Rank ${rank} : ${player.name}**`
                );
            }
        )

        .join("\n");
}

/*
==================================================
RANKING EMBED
==================================================
*/

function createRankingEmbed(
    rankings
) {

    return new EmbedBuilder()

        .setTitle(
            "🏆 SERVER RANKING"
        )

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

async function updateRankingMessage(
    guild
) {

    const server =
        getServerData(
            guild.id
        );

    if (!server.rankingChannelId) {
        return;
    }

    const channel =
        await guild.channels.fetch(
            server.rankingChannelId
        ).catch(
            () => null
        );

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
    Try existing ranking message.
    */

    if (
        server.rankingMessageId
    ) {

        message =
            await channel.messages.fetch(
                server.rankingMessageId
            ).catch(
                () => null
            );
    }

    /*
    Edit existing ranking message.
    */

    if (message) {

        try {

            await message.edit({

                embeds: [
                    embed
                ]

            });

            /*
            Make sure ranking
            message remains pinned.
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

            server.rankingMessageId =
                null;

            saveData();
        }
    }

    /*
    Create ranking message.
    */

    try {

        message =
            await channel.send({

                embeds: [
                    embed
                ]

            });

        server.rankingMessageId =
            message.id;

        saveData();

        /*
        Pin ranking message.
        */

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
PLAYER SEARCH
==================================================
*/

function findRankingPlayer(
    rankings,
    name
) {

    const target =
        String(name)
            .trim()
            .toLowerCase();

    return rankings.findIndex(

        player =>

            String(player.name)
                .trim()
                .toLowerCase() ===
            target

    );
}

/*
==================================================
GET RANK
==================================================
*/

function getPlayerRank(
    rankings,
    name
) {

    const index =
        findRankingPlayer(
            rankings,
            name
        );

    if (index === -1) {
        return null;
    }

    return index + 1;
}

/*
==================================================
CREATE REQUEST EMBED
==================================================
*/

function createRequestEmbed(
    title,
    interaction,
    fields
) {

    const embed =
        new EmbedBuilder()

            .setTitle(title)

            .addFields(

                {
                    name:
                        "Requested By",

                    value:
                        `<@${interaction.user.id}>`
                },

                ...fields
            )

            .setFooter({

                text:
                    "Waiting for manager approval"
            })

            .setTimestamp();

    return embed;
}

/*
==================================================
REQUEST BUTTONS
==================================================
*/

function createRequestButtons() {

    const acceptButton =
        new ButtonBuilder()

            .setCustomId(
                "ranking_accept"
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
                "ranking_reject"
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

    return new ActionRowBuilder()
        .addComponents(
            acceptButton,
            rejectButton
        );
}

/*
==================================================
PIN REQUEST
==================================================
*/

async function pinRequest(
    message
) {

    try {

        await message.pin();

        console.log(
            `Pinned request ${message.id}`
        );

    } catch (error) {

        console.error(
            "Could not pin request message."
        );

        console.error(
            "Check Manage Messages permission."
        );
    }
}

/*
==================================================
READY
==================================================
*/

client.once(
    "ready",
    async () => {

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
        Do NOT create a ranking automatically.

        The first /setchannel creates:

        Player001
        Player002
        ...
        Player010
        */

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
    }
);

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

                    /*
                    Check whether a ranking
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
                    FIRST TIME ONLY:
                    Create default ranking.

                    Existing ranking is NEVER
                    reset when channel changes.
                    */

                    if (!hadRanking) {

                        server.rankings =
                            createDefaultRanking();

                        console.log(
                            `Created default ranking for ${interaction.guild.name}`
                        );
                    }

                    /*
                    New channel needs a new
                    ranking message.
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

                    /*
                    Empty name.
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
                    Name length.
                    */

                    if (
                        name.length > 100
                    ) {

                        await interaction.reply({

                            content:
                                "❌ Player name is too long. Maximum 100 characters.",

                            ephemeral: true

                        });

                        return;
                    }

                    /*
                    Ranking must exist.
                    */

                    if (
                        !server.rankingChannelId
                    ) {

                        await interaction.reply({

                            content:
                                "❌ Ranking channel has not been configured. An administrator must use /setchannel first.",

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
                                `❌ Request automatically rejected.\n\n**${name}** is already on the ranking list at **Rank ${existingIndex + 1}**.`,

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
                            .catch(
                                () => null
                            );

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
                    Create request.
                    */

                    const embed =
                        createRequestEmbed(

                            "🏆 Ranking Change Request",

                            interaction,

                            [

                                {
                                    name:
                                        "Player",

                                    value:
                                        name
                                },

                                {
                                    name:
                                        "Requested Rank",

                                    value:
                                        `Rank ${rank}`
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

                            ]

                        );

                    const row =
                        createRequestButtons();

                    const requestMessage =
                        await channel.send({

                            embeds: [
                                embed
                            ],

                            components: [
                                row
                            ]

                        });

                    /*
                    Save request.
                    */

                    server.requests[
                        requestMessage.id
                    ] = {

                        requestType:
                            "rank",

                        name:
                            name,

                        rank:
                            rank,

                        type:
                            type,

                        requesterId:
                            interaction.user.id,

                        createdAt:
                            Date.now()

                    };

                    saveData();

                    /*
                    Pin request.
                    */

                    await pinRequest(
                        requestMessage
                    );

                    await interaction.reply({

                        content:
                            "✅ Your ranking request has been submitted for manager approval.",

                        ephemeral: true

                    });

                    return;
                }

                /*
                ======================================
                REQUEST MOVE
                ======================================
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

                    const targetRank =
                        interaction.options
                            .getInteger(
                                "rank"
                            );

                    const type =
                        interaction.options
                            .getString(
                                "type"
                            );

                    /*
                    Ranking must exist.
                    */

                    if (
                        !server.rankingChannelId
                    ) {

                        await interaction.reply({

                            content:
                                "❌ Ranking channel has not been configured. An administrator must use /setchannel first.",

                            ephemeral: true

                        });

                        return;
                    }

                    /*
                    ==================================
                    NAME MUST ALREADY EXIST
                    ==================================
                    */

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

                    const currentRank =
                        currentIndex + 1;

                    /*
                    Moving to same rank.
                    */

                    if (
                        currentRank ===
                        targetRank
                    ) {

                        await interaction.reply({

                            content:
                                `❌ **${name}** is already at Rank ${targetRank}.`,

                            ephemeral: true

                        });

                        return;
                    }

                    /*
                    Get channel.
                    */

                    const channel =
                        await interaction.guild
                            .channels
                            .fetch(
                                server.rankingChannelId
                            )
                            .catch(
                                () => null
                            );

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
                    CREATE MOVE REQUEST
                    ==================================
                    */

                    const embed =
                        createRequestEmbed(

                            "🔄 Ranking Move Request",

                            interaction,

                            [

                                {
                                    name:
                                        "Player",

                                    value:
                                        name
                                },

                                {
                                    name:
                                        "Current Rank",

                                    value:
                                        `Rank ${currentRank}`
                                },

                                {
                                    name:
                                        "Requested Rank",

                                    value:
                                        `Rank ${targetRank}`
                                },

                                {
                                    name:
                                        "Type",

                                    value:
                                        type ===
                                        "move"
                                            ? "Move"
                                            : "Replace"
                                }

                            ]

                        );

                    const row =
                        createRequestButtons();

                    const requestMessage =
                        await channel.send({

                            embeds: [
                                embed
                            ],

                            components: [
                                row
                            ]

                        });

                    /*
                    Save request.
                    */

                    server.requests[
                        requestMessage.id
                    ] = {

                        requestType:
                            "move",

                        name:
                            name,

                        currentRank:
                            currentRank,

                        targetRank:
                            targetRank,

                        type:
                            type,

                        requesterId:
                            interaction.user.id,

                        createdAt:
                            Date.now()

                    };

                    saveData();

                    /*
                    Pin request.
                    */

                    await pinRequest(
                        requestMessage
                    );

                    await interaction.reply({

                        content:
                            "✅ Your move request has been submitted for manager approval.",

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
                ======================================
                MANAGER CHECK
                ======================================
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
                    "ranking_reject"
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

                        embeds: [
                            embed
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
                    interaction.customId ===
                    "ranking_accept"
                ) {

                    /*
                    ==================================
                    RANK REQUEST
                    ==================================
                    */

                    if (
                        request.requestType ===
                        "rank"
                    ) {

                        /*
                        Check duplicate AGAIN.

                        Another request may have
                        been accepted first.
                        */

                        const duplicateIndex =
                            findRankingPlayer(
                                server.rankings,
                                request.name
                            );

                        if (
                            duplicateIndex !==
                            -1
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
                                        `Already ranked at Rank ${duplicateIndex + 1}`

                                });

                            await interaction.update({

                                embeds: [
                                    embed
                                ],

                                components: []

                            });

                            return;
                        }

                        const newPlayer = {

                            name:
                                request.name,

                            userId:
                                null

                        };

                        const position =
                            request.rank - 1;

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

                            /*
                            Remove Rank 10.
                            */

                            server.rankings =
                                server.rankings.slice(
                                    0,
                                    10
                                );
                        }

                        /*
                        ==================================
                        REPLACE
                        ==================================
                        */

                        else {

                            server.rankings[
                                position
                            ] = newPlayer;
                        }

                        /*
                        Make absolutely sure
                        there are maximum 10.
                        */

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

                            embeds: [
                                embed
                            ],

                            components: []

                        });

                        return;
                    }

                    /*
                    ==================================
                    MOVE REQUEST
                    ==================================
                    */

                    if (
                        request.requestType ===
                        "move"
                    ) {

                        /*
                        Find player again.

                        This is important because
                        the ranking could have changed
                        while the request was waiting.
                        */

                        const currentIndex =
                            findRankingPlayer(
                                server.rankings,
                                request.name
                            );

                        if (
                            currentIndex ===
                            -1
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
                                    "❌ Automatically Rejected — Player No Longer Ranked"
                                )

                                .setFooter({

                                    text:
                                        "The requested player is no longer on the list."

                                });

                            await interaction.update({

                                embeds: [
                                    embed
                                ],

                                components: []

                            });

                            return;
                        }

                        const targetIndex =
                            request.targetRank - 1;

                        /*
                        ==================================
                        MOVE
                        ==================================

                        Example:

                        A
                        B
                        C
                        D

                        Move D to #2:

                        A
                        D
                        B
                        C
                        */

                        if (
                            request.type ===
                            "move"
                        ) {

                            const [
                                movingPlayer
                            ] =
                                server.rankings.splice(
                                    currentIndex,
                                    1
                                );

                            server.rankings.splice(
                                targetIndex,
                                0,
                                movingPlayer
                            );
                        }

                        /*
                        ==================================
                        REPLACE / SWAP
                        ==================================

                        Example:

                        A
                        B
                        C
                        D

                        Request:
                        B -> Rank 4

                        Result:

                        A
                        D
                        C
                        B
                        */

                        else {

                            const temp =
                                server.rankings[
                                    currentIndex
                                ];

                            server.rankings[
                                currentIndex
                            ] =
                                server.rankings[
                                    targetIndex
                                ];

                            server.rankings[
                                targetIndex
                            ] = temp;
                        }

                        /*
                        Keep exactly maximum
                        10 positions.
                        */

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
                                "✅ Ranking Move Accepted"
                            )

                            .setFooter({

                                text:
                                    `Accepted by ${interaction.user.tag}`

                            });

                        await interaction.update({

                            embeds: [
                                embed
                            ],

                            components: []

                        });

                        return;
                    }
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

        setTimeout(
            () => process.exit(1),
            5000
        );
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

    httpServer.close(
        () => process.exit(0)
    );
}

process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);
