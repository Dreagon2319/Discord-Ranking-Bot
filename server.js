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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
    process.exit(1);
}

const DATA_FILE = "./data.json";

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, "{}");
        }

        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (error) {
        console.error("Could not load data:", error);
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const data = loadData();

function getServerData(guildId) {
    if (!data[guildId]) {
        data[guildId] = {
            managerRoleId: null,
            rankingChannelId: null,
            rankingMessageId: null,
            rankings: []
        };

        saveData(data);
    }

    return data[guildId];
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const commands = [

    new SlashCommandBuilder()
        .setName("setrole")
        .setDescription("Set the role that can manage ranking requests.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("Manager role")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName("setchannel")
        .setDescription("Set the channel where the ranking list is displayed.")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Ranking channel")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName("requestrank")
        .setDescription("Request a ranking change.")
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

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
    try {
        console.log("Registering slash commands...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log("Slash commands registered.");
    } catch (error) {
        console.error("Command registration failed:", error);
    }
}

function createRandomRanking(guild) {
    const members = [...guild.members.cache.values()]
        .filter(member => !member.user.bot);

    // Shuffle members randomly
    for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

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

function rankingText(rankings) {
    if (!rankings.length) {
        return "No ranking has been created yet.";
    }

    return rankings
        .map((player, index) => {
            const rank = index + 1;

            let medal = "";

            if (rank === 1) medal = "🥇 ";
            else if (rank === 2) medal = "🥈 ";
            else if (rank === 3) medal = "🥉 ";

            return `${medal}**#${rank} — ${player.name}**`;
        })
        .join("\n");
}

function createRankingEmbed(rankings) {
    return new EmbedBuilder()
        .setTitle("🏆 SERVER RANKING")
        .setDescription(rankingText(rankings))
        .setFooter({
            text: "Ranking Bot"
        })
        .setTimestamp();
}

async function updateRankingMessage(guild) {
    const server = getServerData(guild.id);

    if (!server.rankingChannelId) {
        return;
    }

    const channel = await guild.channels
        .fetch(server.rankingChannelId)
        .catch(() => null);

    if (!channel || !channel.isTextBased()) {
        return;
    }

    const embed = createRankingEmbed(server.rankings);

    let message = null;

    if (server.rankingMessageId) {
        message = await channel.messages
            .fetch(server.rankingMessageId)
            .catch(() => null);
    }

    if (message) {
        await message.edit({
            embeds: [embed]
        });

        return;
    }

    message = await channel.send({
        embeds: [embed]
    });

    server.rankingMessageId = message.id;

    saveData(data);

    try {
        await message.pin();
    } catch (error) {
        console.error("Could not pin ranking message:", error);
    }
}

function hasManagerRole(member, server) {
    if (!server.managerRoleId) {
        return false;
    }

    return member.roles.cache.has(server.managerRoleId);
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    await registerCommands();

    for (const guild of client.guilds.cache.values()) {
        const server = getServerData(guild.id);

        if (server.rankings.length === 0) {
            server.rankings = createRandomRanking(guild);

            saveData(data);
        }

        await updateRankingMessage(guild);
    }

    console.log("Ranking Bot is ready.");
});

client.on("interactionCreate", async interaction => {

    try {

        // ==============================
        // SLASH COMMANDS
        // ==============================

        if (interaction.isChatInputCommand()) {

            const server = getServerData(interaction.guild.id);

            // /setrole
            if (interaction.commandName === "setrole") {

                const role = interaction.options.getRole("role");

                server.managerRoleId = role.id;

                saveData(data);

                await interaction.reply({
                    content:
                        `✅ Manager role set to **${role.name}**.`,
                    ephemeral: true
                });

                return;
            }

            // /setchannel
            if (interaction.commandName === "setchannel") {

                const channel =
                    interaction.options.getChannel("channel");

                server.rankingChannelId = channel.id;

                saveData(data);

                await updateRankingMessage(interaction.guild);

                await interaction.reply({
                    content:
                        `✅ Ranking channel set to ${channel}.`,
                    ephemeral: true
                });

                return;
            }

            // /requestrank
            if (interaction.commandName === "requestrank") {

                const name =
                    interaction.options.getString("name").trim();

                const rank =
                    interaction.options.getInteger("rank");

                const type =
                    interaction.options.getString("type");

                if (!server.rankingChannelId) {

                    await interaction.reply({
                        content:
                            "❌ Ranking channel has not been configured yet.",
                        ephemeral: true
                    });

                    return;
                }

                // Duplicate check
                const alreadyExists =
                    server.rankings.some(
                        player =>
                            player.name.toLowerCase() ===
                            name.toLowerCase()
                    );

                if (alreadyExists) {

                    const existingRank =
                        server.rankings.findIndex(
                            player =>
                                player.name.toLowerCase() ===
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

                const channel =
                    await interaction.guild.channels
                        .fetch(server.rankingChannelId)
                        .catch(() => null);

                if (!channel) {

                    await interaction.reply({
                        content:
                            "❌ Ranking channel could not be found.",
                        ephemeral: true
                    });

                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle("🏆 Ranking Change Request")
                    .addFields(
                        {
                            name: "Requested By",
                            value: `<@${interaction.user.id}>`
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
                    .setColor(0x5865F2)
                    .setTimestamp();

                const acceptButton =
                    new ButtonBuilder()
                        .setCustomId(
                            `rank_accept:${interaction.id}`
                        )
                        .setLabel("Accept")
                        .setEmoji("✅")
                        .setStyle(ButtonStyle.Success);

                const rejectButton =
                    new ButtonBuilder()
                        .setCustomId(
                            `rank_reject:${interaction.id}`
                        )
                        .setLabel("Reject")
                        .setEmoji("❌")
                        .setStyle(ButtonStyle.Danger);

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

                // Store request information in button custom IDs
                // by attaching it to message metadata in memory.
                requestMessage._rankingRequest = {
                    name,
                    rank,
                    type,
                    requesterId: interaction.user.id
                };

                // Save request information separately
                if (!server.requests) {
                    server.requests = {};
                }

                server.requests[requestMessage.id] = {
                    name,
                    rank,
                    type,
                    requesterId: interaction.user.id
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

        // ==============================
        // BUTTONS
        // ==============================

        if (interaction.isButton()) {

            const server =
                getServerData(interaction.guild.id);

            if (!hasManagerRole(
                interaction.member,
                server
            )) {

                await interaction.reply({
                    content:
                        "❌ You do not have permission to manage ranking requests.",
                    ephemeral: true
                });

                return;
            }

            const parts =
                interaction.customId.split(":");

            const action = parts[0];

            // Request message
            const requestMessage =
                interaction.message;

            const request =
                server.requests?.[requestMessage.id];

            if (!request) {

                await interaction.reply({
                    content:
                        "❌ This request is no longer available.",
                    ephemeral: true
                });

                return;
            }

            if (action === "rank_reject") {

                delete server.requests[requestMessage.id];

                saveData(data);

                await interaction.update({
                    embeds: [
                        EmbedBuilder.from(
                            requestMessage.embeds[0]
                        )
                            .setTitle(
                                "❌ Ranking Request Rejected"
                            )
                    ],
                    components: []
                });

                return;
            }

            if (action === "rank_accept") {

                // Re-check duplicate before accepting
                const duplicate =
                    server.rankings.some(
                        player =>
                            player.name.toLowerCase() ===
                            request.name.toLowerCase()
                    );

                if (duplicate) {

                    delete server.requests[
                        requestMessage.id
                    ];

                    saveData(data);

                    await interaction.update({
                        embeds: [
                            EmbedBuilder.from(
                                requestMessage.embeds[0]
                            )
                                .setTitle(
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

                if (request.type === "replace") {

                    server.rankings[position] =
                        newPlayer;

                } else {

                    server.rankings.splice(
                        position,
                        0,
                        newPlayer
                    );

                    // Maximum 10 players
                    server.rankings =
                        server.rankings.slice(0, 10);
                }

                delete server.requests[
                    requestMessage.id
                ];

                saveData(data);

                await updateRankingMessage(
                    interaction.guild
                );

                await interaction.update({
                    embeds: [
                        EmbedBuilder.from(
                            requestMessage.embeds[0]
                        )
                            .setTitle(
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

        if (!interaction.replied &&
            !interaction.deferred) {

            await interaction.reply({
                content:
                    "❌ An unexpected error occurred.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

client.login(TOKEN);
