const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const http = require("http");
const https = require("https");
const dns = require("dns");
const WebSocket = require("ws");

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = Number(process.env.PORT) || 10000;

const TEST_TIMEOUT = 30000;

console.log("");
console.log("==================================================");
console.log("       DISCORD COMPLETE CONNECTION DIAGNOSTIC");
console.log("==================================================");
console.log("Node:", process.version);
console.log("Platform:", process.platform);
console.log("Architecture:", process.arch);
console.log("Token:", TOKEN ? "FOUND" : "MISSING");
console.log("Token length:", TOKEN ? TOKEN.length : 0);
console.log("Port:", PORT);
console.log("==================================================");

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN IS MISSING");
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

    res.end("Discord diagnostic is running.");
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("✅ TEST 1: Render HTTP server: PASS");
});

/*
==================================================
TEST 2 — DNS
==================================================
*/

function testDNS() {

    return new Promise(resolve => {

        console.log("");
        console.log("TEST 2: Resolving discord.com...");

        dns.lookup(
            "discord.com",
            (error, address, family) => {

                if (error) {

                    console.error(
                        "❌ DNS FAILED:",
                        error.message
                    );

                    resolve(false);
                    return;
                }

                console.log(
                    `✅ DNS PASS: ${address} (IPv${family})`
                );

                resolve(true);
            }
        );
    });
}

/*
==================================================
TEST 3 — HTTPS
==================================================
*/

function testHTTPS() {

    return new Promise(resolve => {

        console.log("");
        console.log("TEST 3: HTTPS connection to Discord...");

        const request = https.get(
            "https://discord.com/api/v10/gateway",
            response => {

                console.log(
                    `✅ HTTPS PASS: HTTP ${response.statusCode}`
                );

                let body = "";

                response.on(
                    "data",
                    chunk => {
                        body += chunk;
                    }
                );

                response.on(
                    "end",
                    () => {

                        console.log(
                            "Gateway response:",
                            body.substring(0, 300)
                        );

                        resolve(true);
                    }
                );
            }
        );

        request.setTimeout(
            TEST_TIMEOUT,
            () => {

                console.error(
                    "❌ HTTPS TIMEOUT"
                );

                request.destroy();
                resolve(false);
            }
        );

        request.on(
            "error",
            error => {

                console.error(
                    "❌ HTTPS FAILED:",
                    error.message
                );

                resolve(false);
            }
        );
    });
}

/*
==================================================
TEST 4 — RAW WEBSOCKET
==================================================
*/

function testRawWebSocket() {

    return new Promise(resolve => {

        console.log("");
        console.log(
            "TEST 4: Raw WebSocket connection to Discord..."
        );

        let finished = false;

        const finish = result => {

            if (finished) {
                return;
            }

            finished = true;

            try {
                socket.close();
            } catch (_) {}

            resolve(result);
        };

        const socket =
            new WebSocket(
                "wss://gateway.discord.gg/?v=10&encoding=json"
            );

        const timer = setTimeout(() => {

            console.error(
                "❌ RAW WEBSOCKET TIMEOUT"
            );

            finish(false);

        }, TEST_TIMEOUT);

        socket.on(
            "open",
            () => {

                console.log(
                    "✅ RAW WEBSOCKET OPEN"
                );

                clearTimeout(timer);
            }
        );

        socket.on(
            "message",
            data => {

                console.log(
                    "✅ RAW WEBSOCKET RECEIVED DATA"
                );

                const text =
                    data.toString();

                console.log(
                    "Gateway packet:",
                    text.substring(0, 500)
                );

                try {

                    const packet =
                        JSON.parse(text);

                    if (packet.op === 10) {

                        console.log(
                            "✅ DISCORD GATEWAY HELLO RECEIVED"
                        );

                        finish(true);

                    } else {

                        console.log(
                            "Gateway opcode:",
                            packet.op
                        );
                    }

                } catch (error) {

                    console.error(
                        "Could not parse Gateway packet:",
                        error.message
                    );
                }
            }
        );

        socket.on(
            "error",
            error => {

                clearTimeout(timer);

                console.error(
                    "❌ RAW WEBSOCKET ERROR:",
                    error.message
                );

                finish(false);
            }
        );

        socket.on(
            "close",
            (code, reason) => {

                clearTimeout(timer);

                console.log(
                    "Raw WebSocket closed."
                );

                console.log(
                    "Close code:",
                    code
                );

                console.log(
                    "Reason:",
                    reason?.toString() || "None"
                );

                if (!finished) {
                    finish(false);
                }
            }
        );
    });
}

/*
==================================================
TEST 5 — DISCORD.JS
==================================================
*/

function testDiscordJS() {

    return new Promise(resolve => {

        console.log("");
        console.log(
            "TEST 5: Discord.js Gateway connection..."
        );

        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds
            ]
        });

        let finished = false;

        const finish = result => {

            if (finished) {
                return;
            }

            finished = true;

            clearTimeout(timer);

            try {
                client.destroy();
            } catch (_) {}

            resolve(result);
        };

        const timer = setTimeout(() => {

            console.error(
                "❌ DISCORD.JS TIMEOUT"
            );

            console.error(
                "Discord.js could not complete Gateway login within 30 seconds."
            );

            finish(false);

        }, TEST_TIMEOUT);

        client.on(
            "debug",
            message => {

                console.log(
                    "[discord.js]",
                    message
                );
            }
        );

        client.on(
            "warn",
            message => {

                console.warn(
                    "[discord.js WARN]",
                    message
                );
            }
        );

        client.on(
            "error",
            error => {

                console.error(
                    "[discord.js ERROR]",
                    error
                );
            }
        );

        client.on(
            "shardError",
            error => {

                console.error(
                    "[discord.js SHARD ERROR]",
                    error
                );
            }
        );

        client.on(
            "shardDisconnect",
            (event, shardId) => {

                console.error(
                    "Gateway disconnected."
                );

                console.error(
                    "Shard:",
                    shardId
                );

                console.error(
                    "Code:",
                    event?.code
                );

                console.error(
                    "Reason:",
                    event?.reason?.toString()
                );
            }
        );

        client.on(
            "shardReconnecting",
            shardId => {

                console.log(
                    "Gateway reconnecting. Shard:",
                    shardId
                );
            }
        );

        client.once(
            "ready",
            () => {

                console.log("");
                console.log(
                    "✅ DISCORD.JS LOGIN SUCCESSFUL"
                );

                console.log(
                    "Bot:",
                    client.user.tag
                );

                console.log(
                    "Bot ID:",
                    client.user.id
                );

                console.log(
                    "Guilds:",
                    client.guilds.cache.size
                );

                finish(true);
            }
        );

        console.log(
            "Calling client.login()..."
        );

        client.login(TOKEN)
            .catch(error => {

                console.error("");
                console.error(
                    "❌ DISCORD.JS LOGIN FAILED"
                );

                console.error(
                    error
                );

                finish(false);
            });
    });
}

/*
==================================================
FINAL DIAGNOSIS
==================================================
*/

async function runDiagnostic() {

    const results = {
        dns: false,
        https: false,
        rawWebSocket: false,
        discordJS: false
    };

    results.dns =
        await testDNS();

    results.https =
        await testHTTPS();

    results.rawWebSocket =
        await testRawWebSocket();

    results.discordJS =
        await testDiscordJS();

    console.log("");
    console.log("");
    console.log("==================================================");
    console.log("              FINAL DIAGNOSTIC");
    console.log("==================================================");

    console.log(
        "Render HTTP:       PASS"
    );

    console.log(
        "DNS:               ",
        results.dns ? "PASS ✅" : "FAIL ❌"
    );

    console.log(
        "Discord HTTPS:     ",
        results.https ? "PASS ✅" : "FAIL ❌"
    );

    console.log(
        "Raw WebSocket:     ",
        results.rawWebSocket
            ? "PASS ✅"
            : "FAIL ❌"
    );

    console.log(
        "Discord.js Login:  ",
        results.discordJS
            ? "PASS ✅"
            : "FAIL ❌"
    );

    console.log("==================================================");

    if (
        results.rawWebSocket &&
        results.discordJS
    ) {

        console.log(
            "🎉 RESULT: Discord Gateway works correctly."
        );

        console.log(
            "The problem is likely in the full bot code/configuration."
        );

    } else if (
        results.rawWebSocket &&
        !results.discordJS
    ) {

        console.log(
            "⚠️ RESULT: Render can reach Discord Gateway."
        );

        console.log(
            "Raw WebSocket works, but Discord.js login fails."
        );

        console.log(
            "Most likely: token/authentication or Discord.js configuration."
        );

    } else if (
        results.https &&
        !results.rawWebSocket
    ) {

        console.log(
            "⚠️ RESULT: HTTPS works, but WebSocket does not."
        );

        console.log(
            "This strongly points to a WebSocket/network connectivity problem."
        );

    } else if (
        !results.https
    ) {

        console.log(
            "❌ RESULT: Render cannot properly reach Discord."
        );

        console.log(
            "This points to outbound network/DNS/connectivity."
        );

    } else {

        console.log(
            "❌ RESULT: Discord Gateway connection failed."
        );
    }

    console.log("==================================================");

    process.exit(0);
}

/*
==================================================
START
==================================================
*/

setTimeout(
    runDiagnostic,
    1000
);

/*
==================================================
PROCESS ERRORS
==================================================
*/

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "Unhandled rejection:",
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

/*
==================================================
SHUTDOWN
==================================================
*/

process.on(
    "SIGTERM",
    () => {

        httpServer.close(
            () => process.exit(0)
        );
    }
);

process.on(
    "SIGINT",
    () => {

        httpServer.close(
            () => process.exit(0)
        );
    }
);
