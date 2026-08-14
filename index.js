'use strict';

/*
============================================================
                    MARTSCRIPT
              GROUP AUTOMATION BOT
============================================================

Features
------------------------------------------------------------
🛡️ Moderation
   !warn
   !warnings
   !clearwarn
   !kick
   !admins
   !antilink

🗳️ Voting
   !vote
   vote 1
   !results
   !endvote

📅 Events
   !event
   !events
   !clearevents

🎮 Games
   !trivia
   !guess
   !math
   !scramble
   !dice
   !coin
   !8ball

🏆 Gamification
   !profile
   !rank
   !leaderboard

😂 Fun
   !joke
   !ship
   !rate

🤖 Bot
   !help
   !menu
   !ping
   !status
   !about

👑 Creator
   Automatic creator reaction

============================================================
ENVIRONMENT VARIABLES
============================================================

MONGO_URI=
BOT_NAME=MartScript
CREATOR_NAME=Martech
CREATOR_NUMBER=234XXXXXXXXXX
ADMIN_NUMBERS=234XXXXXXXXXX
BOT_PREFIX=!
PORT=10000

============================================================
*/

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
// CONFIG
// ============================================================

const app = express();

const PORT =
    Number(process.env.PORT) || 10000;

const BOT_NAME =
    process.env.BOT_NAME || 'MartScript';

const BOT_PREFIX =
    process.env.BOT_PREFIX || '!';

const MONGO_URI =
    process.env.MONGO_URI;

const CREATOR_NAME =
    process.env.CREATOR_NAME || 'Martech';

const CREATOR_NUMBER =
    (process.env.CREATOR_NUMBER || '')
        .replace(/\D/g, '');

const ADMIN_NUMBERS =
    (process.env.ADMIN_NUMBERS || '')
        .split(',')
        .map(x => x.trim().replace(/\D/g, ''))
        .filter(Boolean);


// ============================================================
// RUNTIME STATE
// ============================================================

let whatsappClient = null;

let mongoConnected = false;

let botReady = false;

let shuttingDown = false;

let globalMute = false;

const rateLimits = new Map();

const groupGames = new Map();


// ============================================================
// CONSTANTS
// ============================================================

const MAX_WARNINGS = 3;

const RATE_LIMIT_MS = 1500;

const LINK_WARNING_ENABLED = true;

const XP_PER_MESSAGE = 1;

const XP_COOLDOWN = 30 * 1000;


// ============================================================
// EXPRESS
// ============================================================

app.disable('x-powered-by');

app.use(express.json());


// ============================================================
// HEALTH ENDPOINTS
// ============================================================

app.get('/', (req, res) => {

    res.status(200).json({
        bot: BOT_NAME,
        status: 'online',
        whatsapp: botReady,
        mongodb: mongoConnected,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });

});


app.get('/health', (req, res) => {

    const healthy =
        mongoConnected &&
        !shuttingDown;

    res.status(
        healthy ? 200 : 503
    ).json({

        status:
            healthy
                ? 'healthy'
                : 'degraded',

        bot: BOT_NAME,

        whatsapp:
            botReady,

        mongodb:
            mongoConnected,

        uptime:
            Math.floor(process.uptime()),

        timestamp:
            new Date().toISOString()
    });

});


app.get('/api/status', (req, res) => {

    const memory =
        process.memoryUsage();

    res.json({

        bot: BOT_NAME,

        runtime: {
            node: process.version,
            platform: process.platform,
            pid: process.pid,
            uptime: process.uptime()
        },

        whatsapp: {
            ready: botReady
        },

        database: {
            connected: mongoConnected,
            state: mongoose.connection.readyState
        },

        memory: {
            rss:
                `${(
                    memory.rss /
                    1024 /
                    1024
                ).toFixed(1)} MB`,

            heapUsed:
                `${(
                    memory.heapUsed /
                    1024 /
                    1024
                ).toFixed(1)} MB`
        },

        runtimeState: {
            activeGames:
                groupGames.size,

            rateLimitEntries:
                rateLimits.size,

            globalMute
        },

        timestamp:
            new Date().toISOString()
    });

});


// ============================================================
// HTTP SERVER
// ============================================================

const server =
    app.listen(
        PORT,
        '0.0.0.0',
        () => {

            console.log(
                `🌐 ${BOT_NAME} listening on port ${PORT}`
            );

        }
    );


// ============================================================
// DATABASE SCHEMAS
// ============================================================

const memberSchema =
    new mongoose.Schema({

        groupId: {
            type: String,
            required: true,
            index: true
        },

        userId: {
            type: String,
            required: true,
            index: true
        },

        name: {
            type: String,
            default: 'Unknown'
        },

        xp: {
            type: Number,
            default: 0
        },

        level: {
            type: Number,
            default: 1
        },

        warnings: {
            type: Number,
            default: 0
        },

        messages: {
            type: Number,
            default: 0
        },

        gamesWon: {
            type: Number,
            default: 0
        },

        createdAt: {
            type: Date,
            default: Date.now
        }

    });


memberSchema.index(
    {
        groupId: 1,
        userId: 1
    },
    {
        unique: true
    }
);


const Member =
    mongoose.model(
        'MartScriptMember',
        memberSchema
    );


// ============================================================
// VOTE SCHEMA
// ============================================================

const voteSchema =
    new mongoose.Schema({

        groupId: {
            type: String,
            required: true,
            index: true
        },

        question: {
            type: String,
            required: true
        },

        options: [{
            type: String
        }],

        votes: {
            type: Map,
            of: Number,
            default: {}
        },

        voters: [{
            type: String
        }],

        active: {
            type: Boolean,
            default: true
        },

        createdAt: {
            type: Date,
            default: Date.now
        }

    });


const Vote =
    mongoose.model(
        'MartScriptVote',
        voteSchema
    );


// ============================================================
// EVENT SCHEMA
// ============================================================

const eventSchema =
    new mongoose.Schema({

        groupId: {
            type: String,
            required: true,
            index: true
        },

        title: {
            type: String,
            required: true
        },

        date: {
            type: String,
            required: true
        },

        time: {
            type: String,
            required: true
        },

        creator: {
            type: String
        },

        createdAt: {
            type: Date,
            default: Date.now
        }

    });


const GroupEvent =
    mongoose.model(
        'MartScriptEvent',
        eventSchema
    );


// ============================================================
// GROUP SETTINGS
// ============================================================

const groupSettingsSchema =
    new mongoose.Schema({

        groupId: {
            type: String,
            unique: true,
            index: true
        },

        antiLink: {
            type: Boolean,
            default: true
        },

        welcome: {
            type: Boolean,
            default: true
        },

        warningsEnabled: {
            type: Boolean,
            default: true
        },

        creatorRespect: {
            type: Boolean,
            default: true
        },

        whitelist: {
            type: [String],
            default: []
        }

    });


const GroupSettings =
    mongoose.model(
        'MartScriptGroupSettings',
        groupSettingsSchema
    );


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function normalize(text) {

    return String(text || '')
        .trim()
        .toLowerCase();

}


function getPhone(userId) {

    return String(userId || '')
        .replace('@c.us', '')
        .replace('@g.us', '')
        .replace(/\D/g, '');

}


function isAdminNumber(userId) {

    return ADMIN_NUMBERS.includes(
        getPhone(userId)
    );

}


async function isGroupAdmin(
    chat,
    userId
) {

    try {

        if (!chat.isGroup) {
            return false;
        }

        const participant =
            chat.participants.find(
                p => p.id._serialized === userId
            );

        return Boolean(
            participant?.isAdmin ||
            participant?.isSuperAdmin
        );

    } catch {

        return false;

    }

}


async function isBotAdmin(chat) {

    try {

        const botId =
            whatsappClient.info.wid._serialized;

        return isGroupAdmin(
            chat,
            botId
        );

    } catch {

        return false;

    }

}


function formatUptime(seconds) {

    seconds =
        Math.floor(seconds);

    const days =
        Math.floor(
            seconds / 86400
        );

    seconds %= 86400;

    const hours =
        Math.floor(
            seconds / 3600
        );

    seconds %= 3600;

    const minutes =
        Math.floor(
            seconds / 60
        );

    const secs =
        seconds % 60;

    return [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : '',
        `${secs}s`
    ]
        .filter(Boolean)
        .join(' ');

}


function randomNumber(
    min,
    max
) {

    return Math.floor(
        Math.random() *
        (max - min + 1)
    ) + min;

}


function escapeRegex(text) {

    return text.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );

}


// ============================================================
// GROUP SETTINGS
// ============================================================

async function getSettings(groupId) {

    let settings =
        await GroupSettings.findOne({
            groupId
        });

    if (!settings) {

        settings =
            await GroupSettings.create({
                groupId
            });

    }

    return settings;

}


// ============================================================
// MEMBER DATABASE
// ============================================================

async function getMember(
    groupId,
    userId,
    name
) {

    let member =
        await Member.findOne({
            groupId,
            userId
        });

    if (!member) {

        member =
            await Member.create({
                groupId,
                userId,
                name:
                    name ||
                    'Unknown'
            });

    } else if (
        name &&
        member.name !== name
    ) {

        member.name = name;

        await member.save();

    }

    return member;

}


// ============================================================
// LEVEL SYSTEM
// ============================================================

function calculateLevel(xp) {

    return Math.max(
        1,
        Math.floor(
            Math.sqrt(xp / 10)
        ) + 1
    );

}


async function addXP(
    groupId,
    userId,
    name,
    amount = XP_PER_MESSAGE
) {

    const member =
        await getMember(
            groupId,
            userId,
            name
        );

    member.xp += amount;

    member.messages += 1;

    const oldLevel =
        member.level;

    member.level =
        calculateLevel(
            member.xp
        );

    await member.save();

    return {
        member,
        leveledUp:
            member.level >
            oldLevel
    };

}


// ============================================================
// RATE LIMIT
// ============================================================

function rateLimited(userId) {

    const now =
        Date.now();

    const previous =
        rateLimits.get(userId);

    if (
        previous &&
        now - previous <
        RATE_LIMIT_MS
    ) {

        return true;

    }

    rateLimits.set(
        userId,
        now
    );

    return false;

}


// ============================================================
// MENTION PARSER
// ============================================================

function getMentionedIds(message) {

    if (
        !message.mentionedIds
    ) {

        return [];

    }

    return [
        ...message.mentionedIds
    ];

}


// ============================================================
// MENTION USER
// ============================================================

async function mentionUser(
    chat,
    userId,
    text
) {

    try {

        const contact =
            await whatsappClient.getContactById(
                userId
            );

        await chat.sendMessage(
            text,
            {
                mentions: [
                    contact
                ]
            }
        );

        return true;

    } catch (error) {

        console.error(
            'Mention error:',
            error.message
        );

        return false;

    }

}


// ============================================================
// WARN USER
// ============================================================

async function warnUser(
    chat,
    targetId,
    reason = 'No reason specified'
) {

    const contact =
        await whatsappClient.getContactById(
            targetId
        );

    const name =
        contact.pushname ||
        contact.name ||
        getPhone(targetId);

    const member =
        await getMember(
            chat.id._serialized,
            targetId,
            name
        );

    member.warnings += 1;

    await member.save();

    const count =
        member.warnings;

    if (count >= MAX_WARNINGS) {

        const botAdmin =
            await isBotAdmin(chat);

        if (!botAdmin) {

            await chat.sendMessage(
                `🚨 *FINAL WARNING*\n\n` +
                `@${getPhone(targetId)} has reached ` +
                `*${MAX_WARNINGS}/${MAX_WARNINGS} warnings*.\n\n` +
                `⚠️ I cannot remove the member because ` +
                `I am not a group administrator.`,
                {
                    mentions: [
                        contact
                    ]
                }
            );

            return;

        }

        try {

            await chat.sendMessage(
                `🚨 *${MAX_WARNINGS} WARNINGS REACHED*\n\n` +
                `@${getPhone(targetId)} has reached the maximum ` +
                `warning limit.\n\n` +
                `📌 Reason: ${reason}\n` +
                `👢 Removing member...`,
                {
                    mentions: [
                        contact
                    ]
                }
            );

            await chat.removeParticipants([
                targetId
            ]);

            member.warnings = 0;

            await member.save();

            return;

        } catch (error) {

            console.error(
                'Kick error:',
                error.message
            );

            await chat.sendMessage(
                `❌ I could not remove @${getPhone(targetId)}.\n\n` +
                `Make sure MartScript has administrator privileges.`,
                {
                    mentions: [
                        contact
                    ]
                }
            );

            return;

        }

    }


    await chat.sendMessage(
        `⚠️ *GROUP WARNING*\n\n` +
        `@${getPhone(targetId)} has received warning ` +
        `*${count}/${MAX_WARNINGS}*.\n\n` +
        `📌 Reason: ${reason}\n\n` +
        `Please follow the group rules.`,
        {
            mentions: [
                contact
            ]
        }
    );

}


// ============================================================
// REMOVE MEMBER
// ============================================================

async function removeMember(
    chat,
    targetId
) {

    if (!chat.isGroup) {

        return {
            ok: false,
            reason: 'This command only works in groups.'
        };

    }


    const botAdmin =
        await isBotAdmin(chat);

    if (!botAdmin) {

        return {
            ok: false,
            reason:
                'I need administrator privileges first.'
        };

    }


    const targetAdmin =
        await isGroupAdmin(
            chat,
            targetId
        );

    if (targetAdmin) {

        return {
            ok: false,
            reason:
                'I will not remove another group administrator.'
        };

    }


    try {

        await chat.removeParticipants([
            targetId
        ]);

        return {
            ok: true
        };

    } catch (error) {

        return {
            ok: false,
            reason: error.message
        };

    }

}


// ============================================================
// ANTI-LINK
// ============================================================

const URL_REGEX =
    /(https?:\/\/|www\.|t\.me\/|chat\.whatsapp\.com\/|wa\.me\/|discord\.gg\/|discord\.com\/invite\/)[^\s]+/i;


function containsExternalLink(
    text
) {

    return URL_REGEX.test(
        text || ''
    );

}


function isWhitelistedLink(
    text,
    whitelist
) {

    const lower =
        String(text || '')
            .toLowerCase();

    return whitelist.some(
        domain =>
            lower.includes(
                domain.toLowerCase()
            )
    );

}


// ============================================================
// ANTI-LINK HANDLER
// ============================================================

async function handleAntiLink(
    message,
    chat,
    settings
) {

    if (!settings.antiLink) {
        return false;
    }

    if (!containsExternalLink(
        message.body
    )) {

        return false;

    }

    if (
        isWhitelistedLink(
            message.body,
            settings.whitelist
        )
    ) {

        return false;

    }


    const sender =
        message.author ||
        message.from;


    if (
        await isGroupAdmin(
            chat,
            sender
        )
    ) {

        return false;

    }


    try {

        await message.delete(
            true
        );

    } catch (error) {

        console.warn(
            'Could not delete link:',
            error.message
        );

    }


    await warnUser(
        chat,
        sender,
        'Posting external links is not allowed.'
    );

    return true;

}


// ============================================================
// CREATOR RESPECT
// ============================================================

async function handleCreatorMention(
    message,
    chat,
    settings
) {

    if (
        !settings.creatorRespect
    ) {

        return;

    }


    const body =
        String(message.body || '')
            .toLowerCase();


    const creatorMentioned =
        body.includes(
            CREATOR_NAME.toLowerCase()
        );


    const creatorNumberMentioned =
        message.mentionedIds?.some(
            id =>
                getPhone(id) ===
                CREATOR_NUMBER
        );


    if (
        !creatorMentioned &&
        !creatorNumberMentioned
    ) {

        return;

    }


    try {

        await message.react('🫡');

    } catch (error) {

        console.warn(
            'Reaction failed:',
            error.message
        );

    }

}


// ============================================================
// WELCOME NEW MEMBERS
// ============================================================

async function handleGroupJoin(
    notification
) {

    try {

        const chat =
            await notification.getChat();

        if (!chat.isGroup) {
            return;
        }

        const settings =
            await getSettings(
                chat.id._serialized
            );

        if (!settings.welcome) {
            return;
        }

        const recipients =
            notification.recipientIds ||
            [];

        for (
            const id of recipients
        ) {

            try {

                const contact =
                    await whatsappClient.getContactById(
                        id
                    );

                await chat.sendMessage(
                    `🎉 Welcome @${getPhone(id)} to *${chat.name}*!\n\n` +
                    `🤖 I'm *${BOT_NAME}*, the group's automation bot.\n\n` +
                    `Type *!help* to see what I can do.`,
                    {
                        mentions: [
                            contact
                        ]
                    }
                );

            } catch {
                // Ignore individual welcome failures.
            }

        }

    } catch (error) {

        console.error(
            'Welcome error:',
            error.message
        );

    }

}


// ============================================================
// VOTING
// ============================================================

async function createVote(
    chat,
    question,
    options
) {

    if (
        !question ||
        options.length < 2
    ) {

        return null;

    }


    const existing =
        await Vote.findOne({
            groupId:
                chat.id._serialized,

            active: true
        });

    if (existing) {

        return {
            error:
                'There is already an active vote.'
        };

    }


    const vote =
        await Vote.create({

            groupId:
                chat.id._serialized,

            question,

            options,

            votes: new Map(
                options.map(
                    (_, index) => [
                        String(index + 1),
                        0
                    ]
                )
            )

        });


    let output =
        `🗳️ *NEW GROUP VOTE*\n\n` +
        `❓ *${question}*\n\n`;

    options.forEach(
        (option, index) => {

            output +=
                `${index + 1}️⃣ ${option}\n`;

        }
    );

    output +=
        `\n👉 Vote using *vote 1*, *vote 2*, etc.`;

    await chat.sendMessage(
        output
    );

    return vote;

}


// ============================================================
// CAST VOTE
// ============================================================

async function castVote(
    message,
    choice
) {

    const chat =
        await message.getChat();

    if (!chat.isGroup) {
        return;
    }


    const vote =
        await Vote.findOne({
            groupId:
                chat.id._serialized,

            active: true
        });

    if (!vote) {

        await message.reply(
            '❌ There is currently no active vote.'
        );

        return;

    }


    const number =
        String(choice);


    if (
        !vote.options[
            Number(number) - 1
        ]
    ) {

        await message.reply(
            '❌ Invalid vote option.'
        );

        return;

    }


    if (
        vote.voters.includes(
            message.author ||
            message.from
        )
    ) {

        await message.reply(
            '⚠️ You have already voted.'
        );

        return;

    }


    const voter =
        message.author ||
        message.from;


    const current =
        Number(
            vote.votes.get(
                number
            ) || 0
        );


    vote.votes.set(
        number,
        current + 1
    );

    vote.voters.push(
        voter
    );

    await vote.save();

    await message.reply(
        `✅ Your vote for *${vote.options[Number(number) - 1]}* has been recorded.`
    );

}


// ============================================================
// VOTE RESULTS
// ============================================================

async function voteResults(
    message
) {

    const chat =
        await message.getChat();

    const vote =
        await Vote.findOne({
            groupId:
                chat.id._serialized,

            active: true
        });

    if (!vote) {

        await message.reply(
            '❌ No active vote.'
        );

        return;

    }


    let output =
        `📊 *VOTE RESULTS*\n\n` +
        `❓ ${vote.question}\n\n`;

    vote.options.forEach(
        (option, index) => {

            const count =
                Number(
                    vote.votes.get(
                        String(index + 1)
                    ) || 0
                );

            output +=
                `${index + 1}️⃣ ${option} — *${count}*\n`;

        }
    );

    output +=
        `\n👥 Total votes: *${vote.voters.length}*`;

    await message.reply(
        output
    );

}


// ============================================================
// END VOTE
// ============================================================

async function endVote(
    message
) {

    const chat =
        await message.getChat();

    const admin =
        await isGroupAdmin(
            chat,
            message.author ||
            message.from
        );

    if (!admin) {

        await message.reply(
            '⛔ Only group administrators can end a vote.'
        );

        return;

    }


    const vote =
        await Vote.findOne({
            groupId:
                chat.id._serialized,

            active: true
        });

    if (!vote) {

        await message.reply(
            '❌ No active vote.'
        );

        return;

    }


    vote.active = false;

    await vote.save();

    await message.reply(
        '🗳️ Voting has officially ended.'
    );

}


// ============================================================
// EVENTS
// ============================================================

async function createEvent(
    message,
    args
) {

    const chat =
        await message.getChat();

    const admin =
        await isGroupAdmin(
            chat,
            message.author ||
            message.from
        );

    if (!admin) {

        await message.reply(
            '⛔ Only group administrators can create events.'
        );

        return;

    }


    /*
      Format:

      !event Game Night | 2026-08-15 | 20:00
    */

    const parts =
        args.join(' ')
            .split('|')
            .map(x => x.trim());


    if (
        parts.length < 3
    ) {

        await message.reply(
            `📅 *EVENT FORMAT*\n\n` +
            `!event Event Name | YYYY-MM-DD | HH:MM\n\n` +
            `Example:\n` +
            `!event Game Night | 2026-08-15 | 20:00`
        );

        return;

    }


    const event =
        await GroupEvent.create({

            groupId:
                chat.id._serialized,

            title:
                parts[0],

            date:
                parts[1],

            time:
                parts[2],

            creator:
                message.author ||
                message.from

        });


    await message.reply(
        `📅 *EVENT CREATED*\n\n` +
        `🎯 *${event.title}*\n` +
        `📆 ${event.date}\n` +
        `⏰ ${event.time}`
    );

}


// ============================================================
// LIST EVENTS
// ============================================================

async function listEvents(
    message
) {

    const chat =
        await message.getChat();

    const events =
        await GroupEvent.find({

            groupId:
                chat.id._serialized

        })
        .sort({
            date: 1,
            time: 1
        })
        .limit(20);


    if (!events.length) {

        await message.reply(
            '📅 There are no upcoming events.'
        );

        return;

    }


    let output =
        `📅 *GROUP EVENTS*\n\n`;

    events.forEach(
        (event, index) => {

            output +=
                `${index + 1}. 🎯 *${event.title}*\n` +
                `   📆 ${event.date}\n` +
                `   ⏰ ${event.time}\n\n`;

        }
    );


    await message.reply(
        output
    );

}


// ============================================================
// CLEAR EVENTS
// ============================================================

async function clearEvents(
    message
) {

    const chat =
        await message.getChat();

    const admin =
        await isGroupAdmin(
            chat,
            message.author ||
            message.from
        );

    if (!admin) {

        await message.reply(
            '⛔ Only group administrators can clear events.'
        );

        return;

    }


    await GroupEvent.deleteMany({
        groupId:
            chat.id._serialized
    });


    await message.reply(
        '🧹 All group events have been cleared.'
    );

}


// ============================================================
// GAME: DICE
// ============================================================

async function diceGame(
    message
) {

    const roll =
        randomNumber(
            1,
            6
        );

    await message.reply(
        `🎲 *DICE ROLL*\n\n` +
        `You rolled: *${roll}*`
    );

}


// ============================================================
// GAME: COIN
// ============================================================

async function coinGame(
    message
) {

    const result =
        Math.random() < 0.5
            ? 'HEADS 🪙'
            : 'TAILS 🪙';

    await message.reply(
        `🪙 *COIN FLIP*\n\n` +
        `Result: *${result}*`
    );

}


// ============================================================
// GAME: 8 BALL
// ============================================================

async function eightBall(
    message
) {

    const answers = [

        '🎱 Absolutely.',

        '🎱 Definitely not.',

        '🎱 Probably.',

        '🎱 Ask again later.',

        '🎱 The group says yes.',

        '🎱 The group says no.',

        '🎱 Very likely.',

        '🎱 I would not count on it.'

    ];


    await message.reply(
        answers[
            randomNumber(
                0,
                answers.length - 1
            )
        ]
    );

}


// ============================================================
// GAME: GUESS
// ============================================================

async function startGuessGame(
    message
) {

    const chat =
        await message.getChat();

    if (!chat.isGroup) {

        await message.reply(
            '🎯 Guessing games are for groups.'
        );

        return;

    }


    const groupId =
        chat.id._serialized;


    groupGames.set(
        groupId,
        {
            type: 'guess',

            answer:
                randomNumber(
                    1,
                    50
                ),

            startedBy:
                message.author ||
                message.from,

            startedAt:
                Date.now()
        }
    );


    await message.reply(
        `🎯 *GUESSING GAME*\n\n` +
        `I'm thinking of a number between *1 and 50*.\n\n` +
        `Send your guess! 👀`
    );

}


// ============================================================
// GAME: MATH
// ============================================================

async function startMathGame(
    message
) {

    const a =
        randomNumber(
            5,
            30
        );

    const b =
        randomNumber(
            5,
            20
        );

    const operators = [
        '+',
        '-',
        '*'
    ];

    const operator =
        operators[
            randomNumber(
                0,
                operators.length - 1
            )
        ];


    let answer;

    if (operator === '+') {
        answer = a + b;
    }

    if (operator === '-') {
        answer = a - b;
    }

    if (operator === '*') {
        answer = a * b;
    }


    const chat =
        await message.getChat();


    groupGames.set(
        chat.id._serialized,
        {
            type: 'math',
            question:
                `${a} ${operator} ${b}`,
            answer
        }
    );


    await message.reply(
        `🧠 *MATH CHALLENGE*\n\n` +
        `What is:\n\n` +
        `*${a} ${operator} ${b}* ?\n\n` +
        `First correct answer wins! 🏆`
    );

}


// ============================================================
// GAME: SCRAMBLE
// ============================================================

async function startScramble(
    message
) {

    const words = [

        'javascript',
        'linux',
        'computer',
        'programming',
        'security',
        'network',
        'docker',
        'database',
        'developer',
        'terminal'

    ];


    const word =
        words[
            randomNumber(
                0,
                words.length - 1
            )
        ];


    const scrambled =
        word
            .split('')
            .sort(
                () => Math.random() - 0.5
            )
            .join('');


    const chat =
        await message.getChat();


    groupGames.set(
        chat.id._serialized,
        {
            type: 'scramble',
            answer: word
        }
    );


    await message.reply(
        `🔀 *WORD SCRAMBLE*\n\n` +
        `Unscramble this:\n\n` +
        `*${scrambled.toUpperCase()}*\n\n` +
        `First correct answer wins! 🏆`
    );

}


// ============================================================
// PROCESS ACTIVE GAME
// ============================================================

async function processGame(
    message,
    chat
) {

    const game =
        groupGames.get(
            chat.id._serialized
        );

    if (!game) {
        return false;
    }


    const answer =
        normalize(
            message.body
        );


    let correct = false;


    if (
        game.type === 'guess'
    ) {

        const number =
            Number(answer);

        if (
            Number.isInteger(number)
        ) {

            if (
                number === game.answer
            ) {

                correct = true;

            } else if (
                number < game.answer
            ) {

                await message.reply(
                    '⬆️ Higher!'
                );

                return true;

            } else {

                await message.reply(
                    '⬇️ Lower!'
                );

                return true;

            }

        }

    }


    if (
        game.type === 'math'
    ) {

        if (
            Number(answer) ===
            game.answer
        ) {

            correct = true;

        }

    }


    if (
        game.type === 'scramble'
    ) {

        if (
            answer ===
            game.answer
        ) {

            correct = true;

        }

    }


    if (correct) {

        const winner =
            message.author ||
            message.from;

        const contact =
            await message.getContact();

        const name =
            contact.pushname ||
            contact.name ||
            'Player';


        const member =
            await getMember(
                chat.id._serialized,
                winner,
                name
            );


        member.xp += 10;

        member.gamesWon += 1;

        member.level =
            calculateLevel(
                member.xp
            );

        await member.save();


        groupGames.delete(
            chat.id._serialized
        );


        await chat.sendMessage(
            `🏆 *WE HAVE A WINNER!*\n\n` +
            `🎉 Congratulations @${getPhone(winner)}!\n\n` +
            `⭐ +10 XP\n` +
            `🏅 Games won: ${member.gamesWon}`,
            {
                mentions: [
                    contact
                ]
            }
        );

    }

    return true;

}


// ============================================================
// PROFILE
// ============================================================

async function showProfile(
    message
) {

    const chat =
        await message.getChat();

    const target =
        message.mentionedIds?.[0] ||
        message.author ||
        message.from;


    const contact =
        await whatsappClient.getContactById(
            target
        );


    const member =
        await getMember(
            chat.id._serialized,
            target,
            contact.pushname ||
            contact.name ||
            'Member'
        );


    await message.reply(
        `👤 *MEMBER PROFILE*\n\n` +
        `🏷️ Name: *${member.name}*\n` +
        `⭐ Level: *${member.level}*\n` +
        `✨ XP: *${member.xp}*\n` +
        `💬 Messages: *${member.messages}*\n` +
        `🏆 Game Wins: *${member.gamesWon}*\n` +
        `⚠️ Warnings: *${member.warnings}/${MAX_WARNINGS}*`
    );

}


// ============================================================
// LEADERBOARD
// ============================================================

async function leaderboard(
    message
) {

    const chat =
        await message.getChat();

    const members =
        await Member.find({
            groupId:
                chat.id._serialized
        })
        .sort({
            xp: -1
        })
        .limit(10);


    if (!members.length) {

        await message.reply(
            '🏆 No leaderboard data yet.'
        );

        return;

    }


    let output =
        `🏆 *GROUP LEADERBOARD*\n\n`;


    members.forEach(
        (member, index) => {

            const medals = [
                '🥇',
                '🥈',
                '🥉'
            ];

            const medal =
                medals[index] ||
                `${index + 1}.`;

            output +=
                `${medal} *${member.name}*\n` +
                `   ⭐ Level ${member.level} — ${member.xp} XP\n\n`;

        }
    );


    await message.reply(
        output
    );

}


// ============================================================
// GROUP STATS
// ============================================================

async function groupStats(
    message
) {

    const chat =
        await message.getChat();

    if (!chat.isGroup) {
        return;
    }


    const members =
        await Member.find({
            groupId:
                chat.id._serialized
        });


    const totalXP =
        members.reduce(
            (sum, m) =>
                sum + m.xp,
            0
        );


    const totalWarnings =
        members.reduce(
            (sum, m) =>
                sum + m.warnings,
            0
        );


    await message.reply(
        `📊 *GROUP STATISTICS*\n\n` +
        `👥 Members: *${chat.participants.length}*\n` +
        `🧠 Tracked Users: *${members.length}*\n` +
        `⭐ Total XP: *${totalXP}*\n` +
        `⚠️ Active Warnings: *${totalWarnings}*\n` +
        `🎮 Active Games: *${groupGames.has(chat.id._serialized) ? 'Yes' : 'No'}*`
    );

}


// ============================================================
// ADMIN HELP
// ============================================================

async function adminHelp(
    message
) {

    const chat =
        await message.getChat();

    const sender =
        message.author ||
        message.from;


    const admin =
        isAdminNumber(sender) ||
        await isGroupAdmin(
            chat,
            sender
        );


    if (!admin) {

        await message.reply(
            '⛔ Admin access required.'
        );

        return;

    }


    await message.reply(
        `🔐 *ADMIN COMMANDS*\n\n` +

        `🛡️ !warn @user reason\n` +
        `🧹 !clearwarn @user\n` +
        `👢 !kick @user\n` +
        `🔗 !antilink on/off\n` +
        `👋 !welcome on/off\n` +
        `🗳️ !endvote\n` +
        `📅 !clearevents\n` +
        `🔇 !mute\n` +
        `🔊 !unmute\n` +
        `📊 !stats`
    );

}


// ============================================================
// TOGGLE SETTINGS
// ============================================================

async function toggleSetting(
    message,
    type,
    value
) {

    const chat =
        await message.getChat();

    const sender =
        message.author ||
        message.from;


    const admin =
        isAdminNumber(sender) ||
        await isGroupAdmin(
            chat,
            sender
        );


    if (!admin) {

        await message.reply(
            '⛔ Only administrators can change group settings.'
        );

        return;

    }


    const settings =
        await getSettings(
            chat.id._serialized
        );


    const enabled =
        value === 'on';


    if (type === 'antilink') {

        settings.antiLink =
            enabled;

    }


    if (type === 'welcome') {

        settings.welcome =
            enabled;

    }


    await settings.save();


    await message.reply(
        `⚙️ *SETTING UPDATED*\n\n` +
        `${type}: *${enabled ? 'ON 🟢' : 'OFF 🔴'}*`
    );

}


// ============================================================
// CLEAR WARNING
// ============================================================

async function clearWarning(
    message
) {

    const chat =
        await message.getChat();

    const sender =
        message.author ||
        message.from;


    const admin =
        isAdminNumber(sender) ||
        await isGroupAdmin(
            chat,
            sender
        );


    if (!admin) {

        await message.reply(
            '⛔ Admin access required.'
        );

        return;

    }


    const target =
        message.mentionedIds?.[0];


    if (!target) {

        await message.reply(
            '⚠️ Mention the member whose warnings you want to clear.'
        );

        return;

    }


    await Member.updateOne(
        {
            groupId:
                chat.id._serialized,

            userId:
                target
        },
        {
            $set: {
                warnings: 0
            }
        }
    );


    await message.reply(
        `✅ Warnings cleared for @${getPhone(target)}.`
    );

}


// ============================================================
// SHOW WARNINGS
// ============================================================

async function showWarnings(
    message
) {

    const chat =
        await message.getChat();

    const target =
        message.mentionedIds?.[0] ||
        message.author ||
        message.from;


    const member =
        await Member.findOne({

            groupId:
                chat.id._serialized,

            userId:
                target

        });


    const warnings =
        member?.warnings || 0;


    await message.reply(
        `⚠️ *WARNING STATUS*\n\n` +
        `Member: @${getPhone(target)}\n` +
        `Warnings: *${warnings}/${MAX_WARNINGS}*`
    );

}


// ============================================================
// MENU
// ============================================================

function helpMenu() {

    return (
        `🤖 *${BOT_NAME} GROUP COMMAND CENTER*\n\n` +

        `🛡️ *MODERATION*\n` +
        `• !warn @user reason\n` +
        `• !warnings @user\n` +
        `• !clearwarn @user\n` +
        `• !kick @user\n` +
        `• !antilink on/off\n\n` +

        `🗳️ *VOTING*\n` +
        `• !vote question | option | option\n` +
        `• vote 1\n` +
        `• !results\n` +
        `• !endvote\n\n` +

        `📅 *EVENTS*\n` +
        `• !event name | date | time\n` +
        `• !events\n` +
        `• !clearevents\n\n` +

        `🎮 *GAMES*\n` +
        `• !guess\n` +
        `• !math\n` +
        `• !scramble\n` +
        `• !dice\n` +
        `• !coin\n` +
        `• !8ball\n\n` +

        `🏆 *XP SYSTEM*\n` +
        `• !profile\n` +
        `• !leaderboard\n` +
        `• !rank\n` +
        `• !stats\n\n` +

        `😂 *FUN*\n` +
        `• !joke\n` +
        `• !ship @user @user\n` +
        `• !rate @user\n\n` +

        `⚙️ *SYSTEM*\n` +
        `• !ping\n` +
        `• !status\n` +
        `• !about\n` +
        `• !help`
    );

}


// ============================================================
// FUN: JOKE
// ============================================================

async function joke(
    message
) {

    const jokes = [

        '😂 Why do programmers prefer dark mode? Because light attracts bugs.',

        '🐛 A programmer walks into a bar and orders 1 beer, 0 beers, -1 beers, a lizard and 999999999 beers.',

        '💻 There are only 10 kinds of people: those who understand binary and those who do not.',

        '🤣 Debugging: being the detective in a crime movie where you are also the murderer.'

    ];


    await message.reply(
        jokes[
            randomNumber(
                0,
                jokes.length - 1
            )
        ]
    );

}


// ============================================================
// FUN: RATE
// ============================================================

async function rate(
    message
) {

    const target =
        message.mentionedIds?.[0];


    if (!target) {

        await message.reply(
            '😂 Mention someone to rate.'
        );

        return;

    }


    const score =
        randomNumber(
            1,
            100
        );


    await message.reply(
        `📊 *MARTSCRIPT RATING SYSTEM*\n\n` +
        `@${getPhone(target)} gets:\n\n` +
        `🔥 *${score}/100*`,
        {
            mentions: [
                await whatsappClient.getContactById(
                    target
                )
            ]
        }
    );

}


// ============================================================
// FUN: SHIP
// ============================================================

async function ship(
    message
) {

    const mentions =
        message.mentionedIds || [];


    if (
        mentions.length < 2
    ) {

        await message.reply(
            '💘 Mention two people.'
        );

        return;

    }


    const score =
        randomNumber(
            0,
            100
        );


    await message.reply(
        `💘 *SHIP METER*\n\n` +
        `@${getPhone(mentions[0])} ❤️ ` +
        `@${getPhone(mentions[1])}\n\n` +
        `Compatibility: *${score}%*`,
        {
            mentions: [
                await whatsappClient.getContactById(
                    mentions[0]
                ),
                await whatsappClient.getContactById(
                    mentions[1]
                )
            ]
        }
    );

}


// ============================================================
// MAIN MESSAGE HANDLER
// ============================================================

async function processMessage(
    message
) {

    if (!message) {
        return;
    }


    const chat =
        await message.getChat();


    /*
    ------------------------------------------------------------
    Only process group messages.
    ------------------------------------------------------------
    */

    if (!chat.isGroup) {
        return;
    }


    const sender =
        message.author ||
        message.from;


    const body =
        String(
            message.body || ''
        ).trim();


    if (!body) {
        return;
    }


    /*
    ------------------------------------------------------------
    Creator respect
    ------------------------------------------------------------
    */

    const settings =
        await getSettings(
            chat.id._serialized
        );


    if (!message.fromMe) {

        await handleCreatorMention(
            message,
            chat,
            settings
        );

    }


    /*
    ------------------------------------------------------------
    Anti-link
    ------------------------------------------------------------
    */

    if (
        !message.fromMe &&
        LINK_WARNING_ENABLED
    ) {

        const handled =
            await handleAntiLink(
                message,
                chat,
                settings
            );

        if (handled) {
            return;
        }

    }


    /*
    ------------------------------------------------------------
    Game engine
    ------------------------------------------------------------
    */

    if (!message.fromMe) {

        const handled =
            await processGame(
                message,
                chat
            );

        if (handled) {
            return;
        }

    }


    /*
    ------------------------------------------------------------
    Rate limiting
    ------------------------------------------------------------
    */

    if (
        !message.fromMe &&
        rateLimited(sender)
    ) {

        return;

    }


    /*
    ------------------------------------------------------------
    XP
    ------------------------------------------------------------
    */

    if (!message.fromMe) {

        try {

            const contact =
                await message.getContact();

            const name =
                contact.pushname ||
                contact.name ||
                'Member';


            await addXP(
                chat.id._serialized,
                sender,
                name,
                XP_PER_MESSAGE
            );

        } catch {
            // XP failure should never break the bot.
        }

    }


    /*
    ------------------------------------------------------------
    Commands
    ------------------------------------------------------------
    */

    if (
        !body.startsWith(
            BOT_PREFIX
        )
    ) {

        /*
        Creator name detection even without command.
        */

        return;

    }


    const withoutPrefix =
        body.slice(
            BOT_PREFIX.length
        ).trim();


    const parts =
        withoutPrefix.split(
            /\s+/
        );


    const command =
        normalize(
            parts.shift()
        );


    const args =
        parts;


    // ========================================================
    // HELP
    // ========================================================

    if (
        command === 'help' ||
        command === 'menu'
    ) {

        await message.reply(
            helpMenu()
        );

        return;

    }


    // ========================================================
    // PING
    // ========================================================

    if (
        command === 'ping'
    ) {

        const start =
            Date.now();

        await message.reply(
            `🏓 *PONG!*\n\n` +
            `⚡ ${Date.now() - start} ms\n` +
            `🟢 ${BOT_NAME} is alive.`
        );

        return;

    }


    // ========================================================
    // STATUS
    // ========================================================

    if (
        command === 'status'
    ) {

        const memory =
            process.memoryUsage();


        await message.reply(
            `🖥️ *${BOT_NAME.toUpperCase()} STATUS*\n\n` +
            `🟢 Bot: *Online*\n` +
            `📱 WhatsApp: *${botReady ? 'Connected' : 'Starting'}*\n` +
            `🗄️ MongoDB: *${mongoConnected ? 'Connected' : 'Disconnected'}*\n` +
            `🐳 Runtime: *Docker / Render*\n` +
            `⏱️ Uptime: *${formatUptime(process.uptime())}*\n` +
            `💾 RAM: *${(memory.rss / 1024 / 1024).toFixed(1)} MB*\n` +
            `🎮 Active games: *${groupGames.size}*`
        );

        return;

    }


    // ========================================================
    // ABOUT
    // ========================================================

    if (
        command === 'about'
    ) {

        await message.reply(
            `🤖 *${BOT_NAME}*\n\n` +
            `A group automation and entertainment engine created by *${CREATOR_NAME}*.\n\n` +
            `🛡️ Moderation\n` +
            `🗳️ Voting\n` +
            `📅 Events\n` +
            `🎮 Games\n` +
            `🏆 XP & Leaderboards\n` +
            `😂 Group Entertainment\n\n` +
            `👑 Creator: *${CREATOR_NAME}*`
        );

        return;

    }


    // ========================================================
    // WARN
    // ========================================================

    if (
        command === 'warn'
    ) {

        const admin =
            isAdminNumber(sender) ||
            await isGroupAdmin(
                chat,
                sender
            );


        if (!admin) {

            await message.reply(
                '⛔ Only group administrators can warn members.'
            );

            return;

        }


        const target =
            message.mentionedIds?.[0];


        if (!target) {

            await message.reply(
                '⚠️ Usage:\n' +
                '!warn @user reason'
            );

            return;

        }


        const reason =
            args
                .filter(
                    x =>
                        !x.includes('@')
                )
                .join(' ') ||
            'No reason specified';


        await warnUser(
            chat,
            target,
            reason
        );

        return;

    }


    // ========================================================
    // WARNINGS
    // ========================================================

    if (
        command === 'warnings'
    ) {

        await showWarnings(
            message
        );

        return;

    }


    // ========================================================
    // CLEAR WARN
    // ========================================================

    if (
        command === 'clearwarn'
    ) {

        await clearWarning(
            message
        );

        return;

    }


    // ========================================================
    // KICK
    // ========================================================

    if (
        command === 'kick' ||
        command === 'remove'
    ) {

        const admin =
            isAdminNumber(sender) ||
            await isGroupAdmin(
                chat,
                sender
            );


        if (!admin) {

            await message.reply(
                '⛔ Only group administrators can remove members.'
            );

            return;

        }


        const target =
            message.mentionedIds?.[0];


        if (!target) {

            await message.reply(
                '⚠️ Mention the member to remove.'
            );

            return;

        }


        const result =
            await removeMember(
                chat,
                target
            );


        if (!result.ok) {

            await message.reply(
                `❌ ${result.reason}`
            );

            return;

        }


        await message.reply(
            `👢 Member removed successfully.`
        );

        return;

    }


    // ========================================================
    // ANTI LINK
    // ========================================================

    if (
        command === 'antilink'
    ) {

        await toggleSetting(
            message,
            'antilink',
            normalize(args[0]) || 'off'
        );

        return;

    }


    // ========================================================
    // WELCOME
    // ========================================================

    if (
        command === 'welcome'
    ) {

        await toggleSetting(
            message,
            'welcome',
            normalize(args[0]) || 'off'
        );

        return;

    }


    // ========================================================
    // ADMIN
    // ========================================================

    if (
        command === 'admin'
    ) {

        await adminHelp(
            message
        );

        return;

    }


    // ========================================================
    // MUTE
    // ========================================================

    if (
        command === 'mute'
    ) {

        const admin =
            isAdminNumber(sender) ||
            await isGroupAdmin(
                chat,
                sender
            );


        if (!admin) {

            await message.reply(
                '⛔ Admin access required.'
            );

            return;

        }


        globalMute = true;

        await message.reply(
            '🔇 *MartScript muted.*'
        );

        return;

    }


    // ========================================================
    // UNMUTE
    // ========================================================

    if (
        command === 'unmute'
    ) {

        const admin =
            isAdminNumber(sender) ||
            await isGroupAdmin(
                chat,
                sender
            );


        if (!admin) {

            await message.reply(
                '⛔ Admin access required.'
            );

            return;

        }


        globalMute = false;

        await message.reply(
            '🔊 *MartScript is active again.*'
        );

        return;

    }


    // ========================================================
    // VOTE
    // ========================================================

    if (
        command === 'vote'
    ) {

        const raw =
            args.join(' ');

        const parts =
            raw.split('|')
                .map(
                    x => x.trim()
                )
                .filter(Boolean);


        const question =
            parts.shift();


        await createVote(
            chat,
            question,
            parts
        );

        return;

    }


    // ========================================================
    // RESULTS
    // ========================================================

    if (
        command === 'results'
    ) {

        await voteResults(
            message
        );

        return;

    }


    // ========================================================
    // END VOTE
    // ========================================================

    if (
        command === 'endvote'
    ) {

        await endVote(
            message
        );

        return;

    }


    // ========================================================
    // VOTE RESPONSE
    // ========================================================

    if (
        command === 'vote1' ||
        command === 'vote2' ||
        command === 'vote3' ||
        command === 'vote4' ||
        command === 'vote5'
    ) {

        const choice =
            command.replace(
                'vote',
                ''
            );

        await castVote(
            message,
            choice
        );

        return;

    }


    // ========================================================
    // EVENTS
    // ========================================================

    if (
        command === 'event'
    ) {

        await createEvent(
            message,
            args
        );

        return;

    }


    if (
        command === 'events'
    ) {

        await listEvents(
            message
        );

        return;

    }


    if (
        command === 'clearevents'
    ) {

        await clearEvents(
            message
        );

        return;

    }


    // ========================================================
    // GAMES
    // ========================================================

    if (
        command === 'guess'
    ) {

        await startGuessGame(
            message
        );

        return;

    }


    if (
        command === 'math'
    ) {

        await startMathGame(
            message
        );

        return;

    }


    if (
        command === 'scramble'
    ) {

        await startScramble(
            message
        );

        return;

    }


    if (
        command === 'dice' ||
        command === 'roll'
    ) {

        await diceGame(
            message
        );

        return;

    }


    if (
        command === 'coin'
    ) {

        await coinGame(
            message
        );

        return;

    }


    if (
        command === '8ball' ||
        command === '8-ball'
    ) {

        await eightBall(
            message
        );

        return;

    }


    // ========================================================
    // PROFILE
    // ========================================================

    if (
        command === 'profile'
    ) {

        await showProfile(
            message
        );

        return;

    }


    // ========================================================
    // RANK / LEADERBOARD
    // ========================================================

    if (
        command === 'rank' ||
        command === 'leaderboard'
    ) {

        await leaderboard(
            message
        );

        return;

    }


    // ========================================================
    // STATS
    // ========================================================

    if (
        command === 'stats'
    ) {

        await groupStats(
            message
        );

        return;

    }


    // ========================================================
    // FUN
    // ========================================================

    if (
        command === 'joke'
    ) {

        await joke(
            message
        );

        return;

    }


    if (
        command === 'rate'
    ) {

        await rate(
            message
        );

        return;

    }


    if (
        command === 'ship'
    ) {

        await ship(
            message
        );

        return;

    }


    // ========================================================
    // UNKNOWN COMMAND
    // ========================================================

    await message.reply(
        `❓ Unknown command: *${BOT_PREFIX}${command}*\n\n` +
        `Type *${BOT_PREFIX}help* to see what I can do.`
    );

}


// ============================================================
// WHATSAPP INITIALIZATION
// ============================================================

async function startBot() {

    if (!MONGO_URI) {

        console.error(
            '❌ MONGO_URI is missing.'
        );

        process.exit(1);

    }


    try {

        console.log(
            '🗄️ Connecting to MongoDB...'
        );


        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS:
                    15000
            }
        );


        mongoConnected =
            true;


        console.log(
            '✅ MongoDB connected.'
        );


        const store =
            new MongoStore({
                mongoose
            });


        whatsappClient =
            new Client({

                authStrategy:
                    new RemoteAuth({

                        store,

                        clientId:
                            'martscript-group-bot',

                        backupSyncIntervalMs:
                            30000

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
        // QR
        // ====================================================

        whatsappClient.on(
            'qr',
            () => {

                console.log(
                    '📱 WhatsApp authentication QR generated.'
                );

                console.log(
                    'Use the authentication method configured for your deployment.'
                );

            }
        );


        // ====================================================
        // AUTH
        // ====================================================

        whatsappClient.on(
            'authenticated',
            () => {

                console.log(
                    '🔐 WhatsApp authenticated.'
                );

            }
        );


        whatsappClient.on(
            'auth_failure',
            reason => {

                console.error(
                    '❌ WhatsApp auth failure:',
                    reason
                );

            }
        );


        // ====================================================
        // READY
        // ====================================================

        whatsappClient.on(
            'ready',
            () => {

                botReady =
                    true;

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
                    '📱 WhatsApp: CONNECTED'
                );
                console.log(
                    '🗄️ MongoDB: CONNECTED'
                );
                console.log(
                    '🛡️ Group moderation: ENABLED'
                );
                console.log(
                    '🗳️ Voting: ENABLED'
                );
                console.log(
                    '🎮 Games: ENABLED'
                );
                console.log(
                    '🏆 XP system: ENABLED'
                );
                console.log(
                    '============================================================'
                );
                console.log('');

            }
        );


        // ====================================================
        // REMOTE SESSION
        // ====================================================

        whatsappClient.on(
            'remote_session_saved',
            () => {

                console.log(
                    '☁️ RemoteAuth session saved.'
                );

            }
        );


        // ====================================================
        // DISCONNECT
        // ====================================================

        whatsappClient.on(
            'disconnected',
            reason => {

                botReady =
                    false;

                console.warn(
                    '⚠️ WhatsApp disconnected:',
                    reason
                );

            }
        );


        // ====================================================
        // GROUP JOIN
        // ====================================================

        whatsappClient.on(
            'group_join',
            async notification => {

                await handleGroupJoin(
                    notification
                );

            }
        );


        // ====================================================
        // MESSAGE
        // ====================================================

        whatsappClient.on(
            'message_create',
            async message => {

                try {

                    /*
                    Commands sent by the bot itself
                    are ignored except where explicitly
                    needed.
                    */

                    if (
                        message.fromMe
                    ) {

                        return;

                    }


                    if (
                        globalMute
                    ) {

                        return;

                    }


                    await processMessage(
                        message
                    );

                } catch (error) {

                    console.error(
                        '❌ Message handler error:',
                        error
                    );

                }

            }
        );


        // ====================================================
        // INITIALIZE
        // ====================================================

        console.log(
            '🚀 Initializing WhatsApp...'
        );


        await whatsappClient.initialize();


    } catch (error) {

        mongoConnected =
            false;

        console.error(
            '❌ Startup error:',
            error
        );

    }

}


// ============================================================
// CLEANUP
// ============================================================

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                userId,
                timestamp
            ]
            of rateLimits
        ) {

            if (
                now - timestamp >
                60 * 1000
            ) {

                rateLimits.delete(
                    userId
                );

            }

        }

    },
    60 * 1000
);


// ============================================================
// PROCESS ERRORS
// ============================================================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '⚠️ Unhandled rejection:',
            error
        );

    }
);


process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ Uncaught exception:',
            error
        );

    }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {

    if (shuttingDown) {
        return;
    }

    shuttingDown =
        true;


    console.log(
        `🛑 ${signal} received. Shutting down...`
    );


    try {

        if (
            whatsappClient
        ) {

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
            mongoose.connection
                .readyState !== 0
        ) {

            await mongoose.connection.close();

        }

    } catch (error) {

        console.error(
            'MongoDB shutdown error:',
            error.message
        );

    }


    try {

        await new Promise(
            resolve =>
                server.close(
                    resolve
                )
        );

    } catch {
        // Ignore HTTP shutdown errors.
    }


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
// START
// ============================================================

startBot();
