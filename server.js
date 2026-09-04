const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = Number(process.env.PORT) || 10000;

console.log("========================================");
console.log("DISCORD GATEWAY DIAGNOSTIC");
console.log("========================================");
console.log("Discord token:", TOKEN ? "FOUND" : "MISSING");
console.log("Token length:", TOKEN ? TOKEN.length : 0);
console.log("Node version:", process.version);
console.log("Render port:", PORT);
console.log("========================================");

if (!TOKEN) {
    console.error("ERROR: DISCORD_TOKEN is missing.");
    process.exit(1);
}

/*
==================================================
RENDER HTTP SERVER
==================================================
*/

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Gateway diagnostic is running.");
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

/*
==================================================
DISCORD CLIENT
==================================================
*/

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

/*
==================================================
DISCORD DEBUG EVENTS
==================================================
*/

client.on("debug", message => {
    console.log("[DISCORD DEBUG]", message);
});

client.on("warn", message => {
    console.warn("[DISCORD WARN]", message);
});

client.on("error", error => {
    console.error("[DISCORD ERROR]");
    console.error(error);
});

client.on("shardError", error => {
    console.error("[GATEWAY ERROR]");
    console.error(error);
});

client.on("shardReconnecting", shardId => {
    console.log(
        `[GATEWAY] Reconnecting shard ${shardId}...`
    );
});

client.on("shardDisconnect", (event, shardId) => {
    console.error(
        `[GATEWAY] Shard ${shardId} disconnected`
    );

    console.error("Close code:", event?.code);
    console.error(
        "Reason:",
        event?.reason?.toString() || "None"
    );
});

client.on("shardReady", shardId => {
    console.log(
        `[GATEWAY] Shard ${shardId} is ready`
    );
});

client.once("ready", () => {
    console.log("");
    console.log("========================================");
    console.log("SUCCESS!");
    console.log("Discord Gateway connection works.");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log("========================================");
});

/*
==================================================
LOGIN TIMEOUT
==================================================
*/

const timeout = setTimeout(() => {

    console.error("");
    console.error("========================================");
    console.error("GATEWAY CONNECTION TIMEOUT");
    console.error("No successful Discord connection after 60 seconds.");
    console.error("========================================");

    process.exit(1);

}, 60000);

/*
==================================================
LOGIN
==================================================
*/

console.log("Attempting Discord Gateway connection...");

client.login(TOKEN)
    .then(() => {
        clearTimeout(timeout);
        console.log("client.login() completed.");
    })
    .catch(error => {

        clearTimeout(timeout);

        console.error("");
        console.error("========================================");
        console.error("LOGIN FAILED");
        console.error("========================================");

        console.error(error);

        process.exit(1);
    });

/*
==================================================
PROCESS ERRORS
==================================================
*/

process.on("unhandledRejection", error => {
    console.error("Unhandled rejection:");
    console.error(error);
});

process.on("uncaughtException", error => {
    console.error("Uncaught exception:");
    console.error(error);
});

/*
==================================================
SHUTDOWN
==================================================
*/

function shutdown() {

    console.log("Shutting down...");

    try {
        client.destroy();
    } catch (error) {
        console.error(error);
    }

    httpServer.close(() => {
        process.exit(0);
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
