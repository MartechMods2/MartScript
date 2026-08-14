'use strict';

/**
 * ============================================================
 * MARTSCRIPT AUTOMATION ENGINE
 * ============================================================
 *
 * WhatsApp automation service
 * Runtime: Node.js + whatsapp-web.js
 * Database: MongoDB Atlas
 * Auth: RemoteAuth + MongoStore
 * Hosting: Docker / Render
 *
 * IMPORTANT ENVIRONMENT VARIABLES:
 *
 * MONGO_URI=
 * BOT_PHONE_NUMBER=
 * ADMIN_NUMBERS=
 * BOT_NAME=MartScript
 * PORT=10000
 *
 * Example:
 *
 * ADMIN_NUMBERS=2348012345678,2348098765432
 *
 * ============================================================
 */

// ============================================================
// CORE MODULES
// ============================================================

const express = require('express');
const mongoose = require('mongoose');

const {
    Client,
    RemoteAuth
} = require('whatsapp-web.js');

const {
    MongoStore
} = require('wwebjs-mongo');


// ============================================================
// APPLICATION CONFIGURATION
// ============================================================

const app = express();

const PORT = Number(process.env.PORT) || 10000;

const BOT_NAME = process.env.BOT_NAME || 'MartScript';

const MONGO_URI = process.env.MONGO_URI;

const BOT_PHONE_NUMBER =
    process.env.BOT_PHONE_NUMBER || '';

const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map(number => number.trim().replace(/\D/g, ''))
    .filter(Boolean);


// ============================================================
// RUNTIME STATE
// ============================================================

const userStates = new Map();

const rateLimits = new Map();

let botMutedGlobally = false;

let whatsappClient = null;

let mongoConnected = false;

let botReady = false;

let shuttingDown = false;


// ============================================================
// RATE LIMIT CONFIGURATION
// ============================================================

const RATE_LIMIT_MS = 2000;

const MAX_STATE_ENTRIES = 5000;

const MAX_RATE_LIMIT_ENTRIES = 5000;


// ============================================================
// STARTUP INFORMATION
// ============================================================

console.log('');
console.log('============================================================');
console.log(`🚀 ${BOT_NAME} BOOT SEQUENCE`);
console.log('============================================================');
console.log(`Node.js: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`PID: ${process.pid}`);
console.log(`Port: ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
console.log('============================================================');
console.log('');


// ============================================================
// BASIC VALIDATION
// ============================================================

if (!MONGO_URI) {
    console.error('❌ CRITICAL: MONGO_URI is not configured.');
    console.error('Add MONGO_URI to your Render environment variables.');
    process.exit(1);
}

if (!BOT_PHONE_NUMBER) {
    console.warn(
        '⚠️ BOT_PHONE_NUMBER is not configured. ' +
        'Phone pairing-code functionality may be unavailable.'
    );
}

if (ADMIN_NUMBERS.length === 0) {
    console.warn(
        '⚠️ ADMIN_NUMBERS is empty. ' +
        'Administrative commands will be disabled.'
    );
}


// ============================================================
// EXPRESS CONFIGURATION
// ============================================================

app.disable('x-powered-by');

app.use(express.json());


// ============================================================
// HEALTH / STATUS ENDPOINT
// ============================================================

app.get('/', (req, res) => {
    res.status(200).json({
        service: BOT_NAME,
        status: 'online',
        whatsapp: botReady ? 'connected' : 'starting',
        database: mongoConnected ? 'connected' : 'disconnected',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});


// ============================================================
// SIMPLE HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {

    const healthy =
        mongoConnected &&
        botReady &&
        !shuttingDown;

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        service: BOT_NAME,
        whatsapp: botReady,
        database: mongoConnected,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});


// ============================================================
// API STATUS ENDPOINT
// ============================================================

app.get('/api/status', (req, res) => {

    const memory = process.memoryUsage();

    res.status(200).json({
        service: BOT_NAME,

        runtime: {
            node: process.version,
            platform: process.platform,
            pid: process.pid,
            uptimeSeconds: Math.floor(process.uptime())
        },

        whatsapp: {
            ready: botReady
        },

        database: {
            connected: mongoConnected,
            state: mongoose.connection.readyState
        },

        memory: {
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
        },

        users: {
            activeStates: userStates.size,
            rateLimitEntries: rateLimits.size
        },

        timestamp: new Date().toISOString()
    });
});


// ============================================================
// START HTTP SERVER IMMEDIATELY
// ============================================================

const server = app.listen(PORT, '0.0.0.0', () => {

    console.log('============================================================');
    console.log(`🌐 ${BOT_NAME} HTTP SERVER ONLINE`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔗 Health: /health`);
    console.log(`📊 Status: /api/status`);
    console.log('============================================================');
    console.log('');
});


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function formatUptime(seconds) {

    const days = Math.floor(seconds / 86400);

    seconds %= 86400;

    const hours = Math.floor(seconds / 3600);

    seconds %= 3600;

    const minutes = Math.floor(seconds / 60);

    const secs = Math.floor(seconds % 60);

    return [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : '',
        `${secs}s`
    ]
        .filter(Boolean)
        .join(' ');
}


function formatBytes(bytes) {

    if (!bytes) {
        return '0 MB';
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}


function normalizeMessage(message) {

    return (message || '')
        .trim()
        .toLowerCase();
}


function getUserId(message) {

    return message.from || '';
}


function getPhoneFromUserId(userId) {

    return userId
        .replace('@c.us', '')
        .replace('@g.us', '')
        .replace(/\D/g, '');
}


function isAdmin(userId) {

    const phone = getPhoneFromUserId(userId);

    return ADMIN_NUMBERS.includes(phone);
}


function setUserState(userId, state) {

    if (!userId) {
        return;
    }

    // Prevent unlimited memory growth.
    if (
        userStates.size >= MAX_STATE_ENTRIES &&
        !userStates.has(userId)
    ) {
        const firstKey = userStates.keys().next().value;

        if (firstKey) {
            userStates.delete(firstKey);
        }
    }

    userStates.set(userId, state);
}


function clearUserState(userId) {

    if (userId) {
        userStates.delete(userId);
    }
}


function isRateLimited(userId) {

    const now = Date.now();

    const previous = rateLimits.get(userId);

    if (
        previous &&
        now - previous < RATE_LIMIT_MS
    ) {
        return true;
    }

    if (
        rateLimits.size >= MAX_RATE_LIMIT_ENTRIES &&
        !rateLimits.has(userId)
    ) {
        const firstKey = rateLimits.keys().next().value;

        if (firstKey) {
            rateLimits.delete(firstKey);
        }
    }

    rateLimits.set(userId, now);

    return false;
}


function getMemoryStats() {

    const memory = process.memoryUsage();

    return {
        rss: formatBytes(memory.rss),
        heapUsed: formatBytes(memory.heapUsed),
        heapTotal: formatBytes(memory.heapTotal),
        external: formatBytes(memory.external)
    };
}


// ============================================================
// COMMAND HELPERS
// ============================================================

function getMainMenu(name = 'there') {

    return (
        `👋 Hello, *${name}*!\n\n` +
        `🤖 Welcome to *${BOT_NAME} Automation Hub*.\n\n` +

        `📋 *MAIN MENU*\n\n` +

        `1️⃣ *Menu Directory*\n` +
        `2️⃣ *Services*\n` +
        `3️⃣ *Payment Information*\n` +
        `4️⃣ *Currency Information*\n` +
        `5️⃣ *Support*\n` +
        `6️⃣ *Business Hours*\n\n` +

        `⚡ *Quick Commands*\n` +
        `• !menu\n` +
        `• !services\n` +
        `• !status\n` +
        `• !ping\n` +
        `• !help\n` +
        `• !about\n` +
        `• !support\n\n` +

        `_Powered by ${BOT_NAME} Core Engine._`
    );
}


function getHelpMessage() {

    return (
        `💡 *${BOT_NAME} COMMAND CENTER*\n\n` +

        `📂 *Navigation*\n` +
        `• !menu — Open main menu\n` +
        `• !services — View services\n` +
        `• !help — Show this guide\n\n` +

        `🖥️ *System*\n` +
        `• !ping — Check response latency\n` +
        `• !status — System telemetry\n` +
        `• !about — About ${BOT_NAME}\n\n` +

        `🧹 *Session*\n` +
        `• !clear — Reset your session\n\n` +

        `📞 *Support*\n` +
        `• !support — Contact support\n\n` +

        `_Some administrative commands are restricted._`
    );
}


function getServicesMessage() {

    return (
        `⚡ *${BOT_NAME} SERVICES*\n\n` +

        `🤖 *A — WhatsApp Automation*\n` +
        `Custom WhatsApp workflows, automated responses and business messaging systems.\n\n` +

        `☁️ *B — Cloud Deployment*\n` +
        `Docker, Render, VPS and server deployment architecture.\n\n` +

        `💻 *C — Web Automation*\n` +
        `Backend automation, APIs, data processing and workflow systems.\n\n` +

        `🔧 Reply with *A*, *B* or *C* for more information.`
    );
}


// ============================================================
// STATUS MESSAGE
// ============================================================

async function sendStatus(message) {

    const memory = getMemoryStats();

    const databaseState =
        mongoose.connection.readyState === 1
            ? 'Connected ✅'
            : 'Disconnected ❌';

    const whatsappState =
        botReady
            ? 'Online ✅'
            : 'Offline / Starting ⏳';

    const statusMessage =
        `🖥️ *${BOT_NAME} CLUSTER TELEMETRY*\n\n` +

        `⚙️ *Engine:* Online ✅\n` +
        `📡 *WhatsApp:* ${whatsappState}\n` +
        `🗄️ *MongoDB:* ${databaseState}\n` +
        `🐳 *Runtime:* Docker / Render\n` +
        `🟢 *Process:* ${process.pid}\n` +
        `⏱️ *Uptime:* ${formatUptime(process.uptime())}\n\n` +

        `💾 *Memory*\n` +
        `• RSS: ${memory.rss}\n` +
        `• Heap Used: ${memory.heapUsed}\n` +
        `• Heap Total: ${memory.heapTotal}\n\n` +

        `👥 *Active Sessions:* ${userStates.size}\n` +
        `🛡️ *Global Mute:* ${botMutedGlobally ? 'ON' : 'OFF'}\n\n` +

        `_Telemetry generated at ${new Date().toISOString()}_`;

    await message.reply(statusMessage);
}


// ============================================================
// ADMIN PANIC SWITCH
// ============================================================

async function handleAdminCommand(message, cleanMsg) {

    const userId = getUserId(message);

    if (!isAdmin(userId)) {

        await message.reply(
            '⛔ *Access Denied*\n\n' +
            'This command is restricted to authorized administrators.'
        );

        return true;
    }


    if (cleanMsg === '!panic') {

        botMutedGlobally = !botMutedGlobally;

        await message.reply(
            `⚠️ *SYSTEM RESPONSE MODE*\n\n` +
            `Bot responses are now *${botMutedGlobally ? 'DISABLED 🔴' : 'ENABLED 🟢'}*.`
        );

        return true;
    }


    if (cleanMsg === '!admin') {

        await message.reply(
            `🔐 *${BOT_NAME} ADMIN PANEL*\n\n` +

            `• !panic — Toggle global response mode\n` +
            `• !status — System telemetry\n` +
            `• !admin — Show admin commands\n`
        );

        return true;
    }

    return false;
}


// ============================================================
// MESSAGE PROCESSOR
// ============================================================

async function processMessage(message) {

    if (!message) {
        return;
    }


    // Ignore empty messages.

    if (!message.body && !message.hasMedia) {
        return;
    }


    const userId = getUserId(message);

    if (!userId) {
        return;
    }


    const cleanMsg = normalizeMessage(message.body);


    // --------------------------------------------------------
    // ADMIN COMMANDS
    // --------------------------------------------------------

    if (message.fromMe && cleanMsg.startsWith('!')) {

        if (
            cleanMsg === '!panic' ||
            cleanMsg === '!admin'
        ) {
            await handleAdminCommand(
                message,
                cleanMsg
            );

            return;
        }
    }


    // --------------------------------------------------------
    // GLOBAL MUTE
    // --------------------------------------------------------

    if (botMutedGlobally && !isAdmin(userId)) {
        return;
    }


    // --------------------------------------------------------
    // GROUP PROTECTION
    // --------------------------------------------------------

    const chat = await message.getChat();

    if (
        chat.isGroup &&
        !message.fromMe
    ) {
        return;
    }


    // --------------------------------------------------------
    // RATE LIMITING
    // --------------------------------------------------------

    if (
        !message.fromMe &&
        isRateLimited(userId)
    ) {
        return;
    }


    // --------------------------------------------------------
    // CONTACT INFORMATION
    // --------------------------------------------------------

    let contact = null;

    try {
        contact = await message.getContact();
    } catch {
        contact = null;
    }


    const displayName =
        contact?.pushname ||
        contact?.name ||
        'there';


    // --------------------------------------------------------
    // MEDIA HANDLER
    // --------------------------------------------------------

    if (
        message.hasMedia &&
        !message.fromMe
    ) {

        await message.reply(
            `📥 *${BOT_NAME} Media System*\n\n` +
            `Your media message has been received successfully.\n\n` +
            `A support agent can review it if necessary.`
        );

        return;
    }


    // --------------------------------------------------------
    // TYPING INDICATOR
    // --------------------------------------------------------

    if (!message.fromMe) {

        try {

            await chat.sendStateTyping();

            await new Promise(resolve =>
                setTimeout(resolve, 600)
            );

        } catch {
            // Typing indicator is optional.
        }
    }


    // ========================================================
    // GREETINGS
    // ========================================================

    const greetings = new Set([
        'hi',
        'hello',
        'hey',
        'yo',
        'good morning',
        'good afternoon',
        'good evening',
        'boss',
        'baddest'
    ]);


    if (greetings.has(cleanMsg)) {

        setUserState(userId, 'MAIN_MENU');

        await message.reply(
            getMainMenu(displayName)
        );

        return;
    }


    // ========================================================
    // MAIN MENU
    // ========================================================

    if (
        cleanMsg === '1' ||
        cleanMsg === '!menu' ||
        cleanMsg === 'menu'
    ) {

        setUserState(userId, 'MAIN_MENU');

        await message.reply(
            `🛠️ *${BOT_NAME} CORE DIRECTORY*\n\n` +

            `• !services — Services\n` +
            `• !pay — Payment information\n` +
            `• !rate — Currency information\n` +
            `• !support — Support\n` +
            `• !hours — Business hours\n` +
            `• !status — System status\n` +
            `• !help — Full command guide`
        );

        return;
    }


    // ========================================================
    // SERVICES
    // ========================================================

    if (
        cleanMsg === '2' ||
        cleanMsg === '!services' ||
        cleanMsg === 'services'
    ) {

        setUserState(userId, 'SERVICES_MENU');

        await message.reply(
            getServicesMessage()
        );

        return;
    }


    // ========================================================
    // SERVICES SUBMENU
    // ========================================================

    const currentState =
        userStates.get(userId);


    if (
        currentState === 'SERVICES_MENU'
    ) {

        if (cleanMsg === 'a') {

            await message.reply(
                `🤖 *WhatsApp Automation*\n\n` +
                `Custom automated WhatsApp workflows, ` +
                `business responses, command systems and ` +
                `cloud-hosted automation engines.`
            );

            return;
        }


        if (cleanMsg === 'b') {

            await message.reply(
                `☁️ *Cloud Deployment*\n\n` +
                `Dockerized applications, Render deployments, ` +
                `Linux server configuration and cloud application architecture.`
            );

            return;
        }


        if (cleanMsg === 'c') {

            await message.reply(
                `💻 *Web Automation*\n\n` +
                `Backend APIs, workflow automation, data processing ` +
                `and custom web service integrations.`
            );

            return;
        }
    }


    // ========================================================
    // PAYMENT
    // ========================================================

    if (
        cleanMsg === '3' ||
        cleanMsg === '!pay'
    ) {

        await message.reply(
            `💳 *PAYMENT INFORMATION*\n\n` +

            `Payment details are handled directly by the ` +
            `${BOT_NAME} administrator.\n\n` +

            `📞 Type *!support* to request the current ` +
            `approved payment information.\n\n` +

            `⚠️ Do not send money to an account number obtained ` +
            `from an unofficial source.`
        );

        return;
    }


    // ========================================================
    // CURRENCY
    // ========================================================

    if (
        cleanMsg === '4' ||
        cleanMsg === '!rate'
    ) {

        await message.reply(
            `📈 *CURRENCY INFORMATION*\n\n` +

            `Currency rates change frequently.\n\n` +

            `For current pricing or billing conversion, ` +
            `please contact *!support*.\n\n` +

            `_No static exchange rate is stored in this bot._`
        );

        return;
    }


    // ========================================================
    // SUPPORT
    // ========================================================

    if (
        cleanMsg === '5' ||
        cleanMsg === '!support' ||
        cleanMsg === 'support'
    ) {

        const profileId =
            getPhoneFromUserId(userId) ||
            'unknown';


        await message.reply(
            `🚀 *SUPPORT REQUEST RECEIVED*\n\n` +

            `Your support request has been recorded.\n\n` +

            `🆔 Reference: *${profileId}*\n` +
            `📡 System: *${BOT_NAME}*\n\n` +

            `An administrator can follow up with you directly.`
        );

        return;
    }


    // ========================================================
    // BUSINESS HOURS
    // ========================================================

    if (
        cleanMsg === '6' ||
        cleanMsg === '!hours' ||
        cleanMsg === 'hours'
    ) {

        await message.reply(
            `🕒 *${BOT_NAME} OPERATING HOURS*\n\n` +

            `Monday - Friday\n` +
            `08:00 AM - 10:00 PM WAT\n\n` +

            `Saturday\n` +
            `10:00 AM - 06:00 PM WAT\n\n` +

            `Sunday\n` +
            `Closed\n\n` +

            `_Automated systems may remain online outside these hours._`
        );

        return;
    }


    // ========================================================
    // PING
    // ========================================================

    if (
        cleanMsg === '!ping' ||
        cleanMsg === 'ping'
    ) {

        const start = Date.now();

        const sentMessage = await message.reply(
            '🏓 *Pong!* Checking system latency...'
        );

        const latency =
            Date.now() - start;

        if (sentMessage) {
            await message.reply(
                `📡 *${BOT_NAME} LATENCY*\n\n` +
                `⚡ Response: *${latency} ms*\n` +
                `🟢 Engine: Online`
            );
        }

        return;
    }


    // ========================================================
    // STATUS
    // ========================================================

    if (
        cleanMsg === '!status' ||
        cleanMsg === 'status'
    ) {

        await sendStatus(message);

        return;
    }


    // ========================================================
    // ABOUT
    // ========================================================

    if (
        cleanMsg === '!about' ||
        cleanMsg === 'about'
    ) {

        await message.reply(
            `🏢 *ABOUT ${BOT_NAME.toUpperCase()}*\n\n` +

            `${BOT_NAME} is a cloud-hosted WhatsApp automation ` +
            `engine designed for automated communication, ` +
            `business workflows and extensible backend services.\n\n` +

            `⚙️ Runtime: Node.js\n` +
            `🐳 Infrastructure: Docker\n` +
            `🗄️ Persistence: MongoDB Atlas\n` +
            `☁️ Deployment: Cloud`
        );

        return;
    }


    // ========================================================
    // CLEAR SESSION
    // ========================================================

    if (
        cleanMsg === '!clear' ||
        cleanMsg === 'reset'
    ) {

        clearUserState(userId);

        await message.reply(
            `🔄 *SESSION RESET*\n\n` +
            `Your temporary conversation state has been cleared.`
        );

        return;
    }


    // ========================================================
    // HELP
    // ========================================================

    if (
        cleanMsg === '!help' ||
        cleanMsg === 'help'
    ) {

        await message.reply(
            getHelpMessage()
        );

        return;
    }


    // ========================================================
    // ADMIN STATUS
    // ========================================================

    if (
        cleanMsg === '!admin'
    ) {

        if (!isAdmin(userId)) {

            await message.reply(
                '⛔ *Access Denied*'
            );

            return;
        }

        await message.reply(
            `🔐 *${BOT_NAME} ADMIN COMMANDS*\n\n` +
            `• !admin — Admin command list\n` +
            `• !panic — Toggle global response mode\n` +
            `• !status — Cluster telemetry`
        );

        return;
    }


    // ========================================================
    // UNKNOWN COMMAND HANDLER
    // ========================================================

    if (
        cleanMsg.startsWith('!')
    ) {

        await message.reply(
            `❓ *Unknown Command*\n\n` +

            `I don't recognize *${message.body}*.\n\n` +

            `Type *!help* to see the available commands.`
        );

        return;
    }


    // ========================================================
    // SMART FALLBACK
    // ========================================================

    if (
        !message.fromMe &&
        cleanMsg.length > 0
    ) {

        await message.reply(
            `🤖 *${BOT_NAME} Assistant*\n\n` +

            `I received your message:\n` +
            `_"${message.body}"_\n\n` +

            `I can help you navigate the automated system.\n\n` +

            `👉 Type *!menu* to begin.\n` +
            `👉 Type *!support* to contact support.\n` +
            `👉 Type *!help* to see available commands.`
        );

        return;
    }
}


// ============================================================
// MONGODB + WHATSAPP INITIALIZATION
// ============================================================

async function startApplication() {

    try {

        console.log('🗄️ Connecting to MongoDB Atlas...');


        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS: 15000
            }
        );


        mongoConnected = true;

        console.log(
            '✅ MongoDB Atlas connection established.'
        );


        const store = new MongoStore({
            mongoose
        });


        console.log(
            '🔐 Initializing WhatsApp RemoteAuth...'
        );


        whatsappClient = new Client({

            authStrategy: new RemoteAuth({

                store,

                clientId: 'mart-script-session',

                backupSyncIntervalMs: 30000

            }),


            puppeteer: {

                executablePath:
                    process.env.CHROME_BIN ||
                    '/usr/bin/google-chrome',

                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-extensions'
                ]

            }

        });


        // ====================================================
        // WHATSAPP AUTH EVENTS
        // ====================================================

        whatsappClient.on(
            'qr',
            () => {

                console.log('');
                console.log(
                    '============================================================'
                );
                console.log(
                    '📱 WHATSAPP AUTHENTICATION REQUIRED'
                );
                console.log(
                    '============================================================'
                );
                console.log(
                    'A WhatsApp authentication event was received.'
                );
                console.log(
                    'Use the authentication method configured for this deployment.'
                );
                console.log(
                    '============================================================'
                );
                console.log('');

            }
        );


        whatsappClient.on(
            'authenticated',
            () => {

                console.log(
                    '🔐 WhatsApp authentication successful.'
                );

            }
        );


        whatsappClient.on(
            'auth_failure',
            message => {

                console.error(
                    '❌ WhatsApp authentication failure:',
                    message
                );

            }
        );


        whatsappClient.on(
            'ready',
            async () => {

                botReady = true;

                console.log('');
                console.log(
                    '============================================================'
                );
                console.log(
                    `🚀 ${BOT_NAME.toUpperCase()} IS ONLINE`
                );
                console.log(
                    '============================================================'
                );
                console.log(
                    'WhatsApp: CONNECTED ✅'
                );
                console.log(
                    'MongoDB: CONNECTED ✅'
                );
                console.log(
                    `Uptime: ${formatUptime(process.uptime())}`
                );
                console.log(
                    '============================================================'
                );
                console.log('');

            }
        );


        whatsappClient.on(
            'remote_session_saved',
            () => {

                console.log(
                    '☁️ WhatsApp RemoteAuth session synchronized with MongoDB.'
                );

            }
        );


        whatsappClient.on(
            'disconnected',
            reason => {

                botReady = false;

                console.warn(
                    '⚠️ WhatsApp disconnected:',
                    reason
                );

            }
        );


        whatsappClient.on(
            'change_state',
            state => {

                console.log(
                    `📡 WhatsApp state changed: ${state}`
                );

            }
        );


        // ====================================================
        // MESSAGE EVENT
        // ====================================================

        whatsappClient.on(
            'message_create',
            async message => {

                try {

                    await processMessage(
                        message
                    );

                } catch (error) {

                    console.error(
                        '❌ Message processing error:',
                        error
                    );

                    try {

                        if (
                            message &&
                            !message.fromMe
                        ) {

                            await message.reply(
                                `⚠️ ${BOT_NAME} encountered a temporary processing error.\n\n` +
                                `Please try again or type *!support*.`
                            );

                        }

                    } catch (replyError) {

                        console.error(
                            'Failed to send error response:',
                            replyError.message
                        );

                    }
                }

            }
        );


        // ====================================================
        // INITIALIZE WHATSAPP
        // ====================================================

        console.log(
            '🚀 Starting WhatsApp client...'
        );

        await whatsappClient.initialize();

    } catch (error) {

        console.error('');
        console.error(
            '============================================================'
        );
        console.error(
            '❌ APPLICATION STARTUP FAILED'
        );
        console.error(
            '============================================================'
        );
        console.error(error);
        console.error(
            '============================================================'
        );
        console.error('');

        mongoConnected = false;

        // Keep the HTTP server alive so Render can still see
        // the allocated port while the process reports failure.
    }
}


// ============================================================
// PERIODIC MAINTENANCE
// ============================================================

setInterval(
    () => {

        const now = Date.now();

        // Remove old rate-limit entries.

        for (
            const [userId, timestamp]
            of rateLimits.entries()
        ) {

            if (
                now - timestamp >
                RATE_LIMIT_MS * 10
            ) {

                rateLimits.delete(
                    userId
                );

            }

        }

        // Remove sessions that somehow exceed our safety cap.

        while (
            userStates.size >
            MAX_STATE_ENTRIES
        ) {

            const firstKey =
                userStates.keys().next().value;

            if (!firstKey) {
                break;
            }

            userStates.delete(
                firstKey
            );
        }

    },
    60 * 1000
);


// ============================================================
// PROCESS ERROR HANDLING
// ============================================================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '⚠️ UNHANDLED PROMISE REJECTION:',
            error
        );

    }
);


process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ UNCAUGHT EXCEPTION:',
            error
        );

        // Do not immediately kill the process.
        // Render needs the HTTP endpoint to remain available.
    }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {

    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log('');
    console.log(
        `🛑 Received ${signal}. Starting graceful shutdown...`
    );


    try {

        if (whatsappClient) {

            console.log(
                '📱 Closing WhatsApp client...'
            );

            await whatsappClient.destroy();

        }

    } catch (error) {

        console.error(
            'WhatsApp shutdown error:',
            error.message
        );

    }


    try {

        if (
            mongoose.connection.readyState !== 0
        ) {

            console.log(
                '🗄️ Closing MongoDB connection...'
            );

            await mongoose.connection.close();

        }

    } catch (error) {

        console.error(
            'MongoDB shutdown error:',
            error.message
        );

    }


    try {

        await new Promise(resolve => {

            server.close(
                resolve
            );

        });

    } catch (error) {

        console.error(
            'HTTP server shutdown error:',
            error.message
        );

    }


    console.log(
        `✅ ${BOT_NAME} shutdown complete.`
    );

    process.exit(0);
}


process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);


// ============================================================
// START APPLICATION
// ============================================================

startApplication();
