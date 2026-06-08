// Quest Bot v8 - Single-message flow | KNIGHTOFADITYA
const {
    Client, GatewayIntentBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder,
    TextInputBuilder, TextInputStyle,
    SlashCommandBuilder, REST, Routes,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    MessageFlags,
    InteractionContextType, ApplicationIntegrationType
} = require('discord.js');
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
let BOT_TOKEN = ''; // global bot token for API calls outside startBot

const DATA = path.join(__dirname, 'quest_data.json');
function load() {
    try {
        const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        if (!d.access) d.access = { ownerId: null, allowedUsers: [], halfUsers: [], fullUsers: [] };
        if (!d.access.halfUsers) d.access.halfUsers = [];
        if (!d.access.fullUsers) d.access.fullUsers = [];
        if (!d.orbVault) d.orbVault = { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 };
        if (!d.developer) d.developer = { name: '', id: '' };
        return d;
    } catch { return { bot_tkn: '', user_tkns: {}, active_acc: {}, access: { ownerId: null, allowedUsers: [], halfUsers: [], fullUsers: [] }, orbVault: { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 }, developer: { name: '', id: '' } }; }
}
function save(d) { fs.writeFileSync(DATA, JSON.stringify(d, null, 2)); }

// ── ACCESS CONTROL ────────────────────────────────────────────
// Access levels: owner > full > half
// halfUsers → View Quests, Complete, Refresh only
// fullUsers → + Manage Accounts (add/remove selfbot accounts)
// owner     → everything including Access Control panel
function loadAccess() {
    const ac = load().access || {};
    if (!ac.ownerId) ac.ownerId = null;
    if (!ac.halfUsers) ac.halfUsers = [];
    if (!ac.fullUsers) ac.fullUsers = [];
    if (!ac.allowedUsers) ac.allowedUsers = []; // legacy compat
    return ac;
}
function saveAccess(ac)  { const d = load(); d.access = ac; save(d); }
function setOwner(uid)   {
    const ac = loadAccess(); ac.ownerId = String(uid);
    if (!ac.fullUsers.includes(String(uid))) ac.fullUsers.push(String(uid));
    if (!ac.allowedUsers.includes(String(uid))) ac.allowedUsers.push(String(uid));
    saveAccess(ac);
}
function addHalfUser(uid) {
    const ac = loadAccess(); const id = String(uid);
    ac.halfUsers = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers = ac.fullUsers.filter(u => u !== id);
    if (!ac.halfUsers.includes(id)) ac.halfUsers.push(id);
    if (!ac.allowedUsers.includes(id)) ac.allowedUsers.push(id);
    saveAccess(ac);
}
function addFullUser(uid) {
    const ac = loadAccess(); const id = String(uid);
    ac.halfUsers = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers = ac.fullUsers.filter(u => u !== id);
    if (!ac.fullUsers.includes(id)) ac.fullUsers.push(id);
    if (!ac.allowedUsers.includes(id)) ac.allowedUsers.push(id);
    saveAccess(ac);
}
function addUser(uid)    { addHalfUser(uid); } // default = half
function removeUser(uid) {
    const ac = loadAccess(); const id = String(uid);
    ac.halfUsers = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers = ac.fullUsers.filter(u => u !== id);
    ac.allowedUsers = ac.allowedUsers.filter(u => u !== id);
    saveAccess(ac);
}
// Returns: 'NO_OWNER' | 'owner' | 'full' | 'half' | false
function getAccessLevel(uid) {
    const ac = loadAccess(); const id = String(uid);
    if (!ac.ownerId) return 'NO_OWNER';
    if (ac.ownerId === id) return 'owner';
    if (ac.fullUsers.includes(id)) return 'full';
    if (ac.halfUsers.includes(id)) return 'half';
    // legacy allowedUsers fallback
    if (ac.allowedUsers.includes(id)) return 'half';
    return false;
}

function loadOrbVault()         { return load().orbVault || { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 }; }
function saveOrbVault(v)        { const d = load(); d.orbVault = v; save(d); }
// Update vault from quest data — sums all orb_quantity_claimed across all quests
function updateOrbVaultFromQuests(quests) {
    if (!quests) return;
    let total = 0, completed = 0;
    for (const q of quests) {
        const isClaimed = !!(q.user_status?.claimed_at);
        const cfg = q.config?.rewards_config;
        const rewards = cfg?.rewards || [];
        for (const rw of rewards) {
            // Use orb_quantity_claimed if available, else orb_quantity for claimed quests
            if (typeof rw.orb_quantity_claimed === 'number' && rw.orb_quantity_claimed > 0) {
                total += rw.orb_quantity_claimed;
                completed++;
            } else if (isClaimed && typeof rw.orb_quantity === 'number' && rw.orb_quantity > 0) {
                total += rw.orb_quantity;
                completed++;
            }
        }
    }
    const vault = loadOrbVault();
    vault.lifetimeEarned = total;
    vault.questsCompleted = completed;
    vault.lastUpdated = new Date().toISOString();
    saveOrbVault(vault);
}
function isAllowed(uid) {
    const lvl = getAccessLevel(uid);
    if (lvl === 'NO_OWNER') return 'NO_OWNER';
    return lvl !== false; // true for owner/full/half, false for no access
}

const API  = 'https://discord.com/api/v9';
const AUTH = 'https://discord.com/api/v9/auth/login';
const MFA  = 'https://discord.com/api/v9/auth/mfa/totp';
const UA_MOBILE  = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko)';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9177 Chrome/128.0.6613.186 Electron/32.2.5 Safari/537.36';
const PLAY = ['PLAY_ON_DESKTOP', 'PLAY_ON_DESKTOP_V2', 'PLAY_ACTIVITY', 'STREAM_ON_DESKTOP', 'PLAY_ON_XBOX', 'PLAY_ON_PLAYSTATION'];
const C    = { R: 0xe63946, G: 0x2ecc71, Y: 0xf1c40f, B: 0x5865F2, D: 0x4f545c, P: 0xa855f7, T: 0x1abc9c, O: 0xff8c00 };
const V2   = MessageFlags.IsComponentsV2;
const E_ORBS = '<a:Orbs:1511625467919208558>';

// Small-caps font
const SC = s => s.toUpperCase().split('').map(c => {
    const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c);
    return idx >= 0 ? 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ'.replace('Q','ǫ')[idx] : c;
}).join('');

// ── API ──────────────────────────────────────────────────────
async function api(t, m, p, b = null, extraH = {}) {
    const o = { method: m, headers: { Authorization: t, 'User-Agent': UA_DESKTOP, 'Content-Type': 'application/json', Origin: 'https://discord.com', ...extraH } };
    if (b) o.body = JSON.stringify(b);
    try { const r = await fetch(API + p, o); return { s: r.status, d: await r.json().catch(() => null) }; }
    catch { return { s: 0, d: null }; }
}
async function getQ(t)       { const r = await api(t, 'GET', '/quests/@me'); return r.s === 200 ? (r.d.quests || []) : null; }
async function getMe(t)      { const r = await api(t, 'GET', '/users/@me'); return r.s === 200 ? r.d : null; }
async function hb(t, id)     { return api(t, 'POST', `/quests/${id}/heartbeat`, { stream_key: `call:${id}:1`, terminal: false }); }
async function enroll(t, id) { return api(t, 'POST', `/quests/${id}/enroll`, { location: 11 }); }
async function claim(t, id)  { return api(t, 'POST', `/quests/${id}/claim-reward`, { location: 11, platform: 0 }); }

// ── Discord Email+Password Login (mobile-style, like grab.py) ──
// Returns { token, user } on success, or { error, type, msg, ticket } on failure
async function loginWithEmail(email, password) {
    const body = { login: email, password, undelete: false, login_source: null, gift_code_sku_id: null };
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': UA_MOBILE,
        'Origin': 'https://discord.com',
        'X-Discord-Locale': 'en-US',
        'X-Debug-Options': 'bugReporterEnabled'
    };
    try {
        const r = await fetch(AUTH, { method: 'POST', headers, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));

        // ── SUCCESS ──
        if (r.status === 200 && d.token) {
            return { token: d.token, user: { id: d.user_id, username: d.username } };
        }

        // ── MFA / 2FA Required ──
        if (d.mfa) {
            return { error: 'mfa', type: 'mfa', ticket: d.ticket || '', msg: '2FA required', raw: d };
        }

        // ── Captcha Required ──
        const captchaReasons = ['captcha', 'captcha_key', 'captcha-required', 'hcaptcha'];
        const errStr = JSON.stringify(d).toLowerCase();
        if (r.status === 400 && captchaReasons.some(c => errStr.includes(c))) {
            return { error: 'captcha', type: 'captcha', captcha: true, msg: 'Captcha required! Cannot login with email/password. Try using a token instead.' };
        }

        // ── Email/Phone Verify ──
        if (r.status === 400 && (errStr.includes('verify') || errStr.includes('email') || errStr.includes('phone'))) {
            return { error: 'verify', type: 'verify', msg: 'Email/phone verification required. Check your inbox and verify, then try again.', raw: d };
        }

        // ── Bad credentials ──
        if (r.status === 400) {
            const errMsg = d.message || 'Invalid login. Check email and password.';
            if (d.code === 50035) {
                const errors = d.errors || {};
                const pwErr = errors.password?._errors?.[0]?.message || '';
                const loginErr = errors.login?._errors?.[0]?.message || '';
                if (pwErr || loginErr) {
                    return { error: 'invalid', type: 'bad_creds', msg: `❌ ${pwErr || loginErr}` };
                }
            }
            return { error: 'invalid', type: 'bad_creds', msg: `❌ ${errMsg}` };
        }
        if (r.status === 429) {
            return { error: 'ratelimit', type: 'ratelimit', msg: 'Too many login attempts. Try again later or use a token.' };
        }
        return { error: 'unknown', type: 'unknown', msg: `Unexpected error (${r.status}). Try using a token instead.` };
    } catch(e) {
        return { error: 'network', type: 'network', msg: `Network error: ${e.message}` };
    }
}

// ── Submit MFA/2FA code (like grab.py submit_mfa) ─────────────
async function submitMFA(ticket, code) {
    const body = { code, ticket, login_source: null, gift_code_sku_id: null };
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': UA_MOBILE,
        'Origin': 'https://discord.com',
        'X-Discord-Locale': 'en-US'
    };
    try {
        const r = await fetch(MFA, { method: 'POST', headers, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 200 && d.token) {
            return { token: d.token, user: { id: d.user_id, username: d.username } };
        }
        return { error: 'mfa_fail', msg: 'Invalid or expired 2FA code.' };
    } catch(e) {
        return { error: 'network', msg: `Network error: ${e.message}` };
    }
}

// ── Run grab.py in non-interactive mode and return parsed JSON ──
function runGrab(args = '') {
    const py = path.join(__dirname, 'grab.py');
    try {
        const out = execSync(`python3 "${py}" ${args}`, { timeout: 30000, encoding: 'utf8', cwd: __dirname }).trim();
        // Find JSON in output (last line should be JSON)
        const lines = out.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            try { return JSON.parse(lines[i].trim()); } catch {}
        }
        return { status: 'error', error: 'No JSON output from grab.py', raw: out.slice(0, 500) };
    } catch(e) {
        return { status: 'error', error: `grab.py failed: ${e.message}` };
    }
}

// Helper: save token to user_tkns and return success message
async function saveAccountToken(tk, ownerUid) {
    const data = load();
    if (!data.user_tkns[ownerUid]) data.user_tkns[ownerUid] = [];
    if (data.user_tkns[ownerUid].includes(tk)) return { dup: true, msg: `⚠️ ${SC('already saved!')}` };
    const me = await getMe(tk);
    if (!me) return { bad: true, msg: `❌ ${SC('invalid token!')}` };
    data.user_tkns[ownerUid].push(tk); save(data);
    return { ok: true, name: me.username, id: me.id, count: data.user_tkns[ownerUid].length };
}

function isPlay(q) { const tc = q.config?.task_config_v2 || q.config?.task_config || {}; return Object.values(tc.tasks || {}).some(x => PLAY.includes(x.type || '')); }
function getTarget(q) { const tc = q.config?.task_config_v2 || q.config?.task_config || {}; for (const [k, v] of Object.entries(tc.tasks || {})) { if (PLAY.includes(v.type || k)) return { type: v.type || k, target: v.target || 0 }; } return { type: null, target: 0 }; }
function expired(q)   { const e = q.config?.expires_at; return e ? new Date() > new Date(e) : false; }
function bar(pct, w = 20) { const f = Math.round(Math.min(pct,100)/100*w); return '■'.repeat(f) + '□'.repeat(w-f); }

// Orbs detection — checks reward type fields
function isOrbsQuest(q) {
    try {
        const rewards = q.config?.rewards || [];
        const arr = Array.isArray(rewards) ? rewards : Object.values(rewards);
        for (const rw of arr) {
            const type = (rw.type || rw.reward_type || '').toLowerCase();
            if (type.includes('orb')) return true;
            for (const it of (Array.isArray(rw.items || rw.reward_items) ? (rw.items || rw.reward_items) : [])) {
                if ((it.type||'').toLowerCase().includes('orb') || (it.product_id||'').toLowerCase().includes('orb')) return true;
            }
        }
        const raw = JSON.stringify(q.config?.rewards || {}).toLowerCase();
        return raw.includes('"type":"orb') || raw.includes('orb_credit') || raw.includes('discord_orb');
    } catch { return false; }
}

// Extract orb reward amount from quest config
function getOrbAmount(q) {
    try {
        // Discord stores rewards in rewards_config.rewards, NOT config.rewards
        const rewardsCfg = q.config?.rewards_config;
        const rewards = rewardsCfg?.rewards || q.config?.rewards || [];
        const arr = Array.isArray(rewards) ? rewards : Object.values(rewards);
        for (const rw of arr) {
            // Direct orb_quantity field (Discord's actual field name)
            if (typeof rw.orb_quantity === 'number' && rw.orb_quantity > 0) return rw.orb_quantity;
            if (typeof rw.premium_orb_quantity === 'number' && rw.premium_orb_quantity > 0) return rw.premium_orb_quantity;
            // Fallback: parse "700 Orbs" from messages.name
            const name = rw.messages?.name || '';
            const nameMatch = name.match(/(\d+)\s*Orbs?/i);
            if (nameMatch) return parseInt(nameMatch[1]);
            // Legacy: amount + type check
            if (typeof rw.amount === 'number' && rw.amount > 0) {
                const type = (rw.type || rw.reward_type || '').toString().toLowerCase();
                if (type === '4' || type.includes('orb')) return rw.amount;
            }
            // Check nested items
            const items = Array.isArray(rw.items || rw.reward_items) ? (rw.items || rw.reward_items) : [];
            for (const it of items) {
                if (typeof it.quantity === 'number' && it.quantity > 0) return it.quantity;
                if (typeof it.orb_quantity === 'number' && it.orb_quantity > 0) return it.orb_quantity;
            }
        }
        // Raw JSON scan for orb_quantity
        const raw = JSON.stringify(rewardsCfg || rewards);
        const m = raw.match(/"orb_quantity"\s*:\s*(\d+)/);
        if (m) return parseInt(m[1]);
    } catch {}
    return 0;
}

// ── Caches ───────────────────────────────────────────────────
const infoCache = new Map();
async function cInfo(t) {
    if (infoCache.has(t) && Date.now() - infoCache.get(t).ts < 120000) return infoCache.get(t);
    const m = await getMe(t);
    if (!m) return { name: '?', tag: '', id: '?', ts: 0 };
    const info = { name: m.username, tag: m.discriminator !== '0' ? `#${m.discriminator}` : '', id: m.id, ts: Date.now() };
    infoCache.set(t, info); return info;
}
async function cName(t) { return (await cInfo(t)).name; }

const stopFlags = new Map();
const activeRuns = new Map(); // uid → { states, names, total, sessionId } for in-progress quests
const runSessions = new Map(); // uid → current sessionId (increments on each new /autoquest run)
const pendingMFA = new Map(); // uid → { email, ticket } for 2FA flow

// ============================================================
//  UI BUILDERS  (all return {components, flags} for int.update)
// ============================================================

function mkC(color) { return new ContainerBuilder().setAccentColor(color); }
function footer(c)  { /* no footer text — dev credit is in title */ }
function sep(c)     { c.addSeparatorComponents(new SeparatorBuilder()); }
function pack(c)    { return { components: [c], flags: V2 }; }

function buildInfo(color, text, backBtn = true) {
    const c = mkC(color);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    sep(c);
    if (backBtn) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    }
    footer(c);
    return pack(c);
}

// ── MAIN MENU ─────────────────────────────────────────────────
// Shows first saved selfbot account (the one that will be used)
async function buildMain(d, uid) {
    const ac2  = (d.access || {});
    const ownerUid2 = ac2.ownerId || uid;
    const toks = d.user_tkns[ownerUid2] || [];
    const aa   = d.active_acc?.[ownerUid2];
    const activeTok = (aa !== undefined && toks[aa]) ? toks[aa] : (toks[0] || null);

    const c = mkC(C.O);

    // Developer: terminal/config se dali hui owner ID se naam fetch karo
    const devId = ownerUid2 || BOT_CONFIG.defaultOwnerId || '';
    let devName = devId; // fallback
    if (devId) {
        try {
            const res = await fetch(`https://discord.com/api/v9/users/${devId}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
            });
            if (res.ok) {
                const u = await res.json();
                devName = u.global_name || u.username || devId;
            }
        } catch {}
    }
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E_ORBS} ${SC('discord auto quest completer')}\n` +
        `-# ${SC('complete discord quests automatically & earn orbs effortlessly')}\n` +
        (devId ? `-# <:dev:1459861201239539752> **ᴅᴇᴠᴇʟᴏᴘᴇʀ :** [**${devName}**](https://discord.com/users/${devId})` : '')
    ));
    sep(c);

    // Active selfbot account + all accounts list
    if (toks.length) {
        let accLines = '';
        for (let i = 0; i < toks.length; i++) {
            const info = await cInfo(toks[i]);
            const crown = (aa === i || (aa === undefined && i === 0)) ? ' <a:Crown:1493401405199880312>' : '';
            accLines += '> `' + (i+1) + '.` <@' + info.id + '>' + crown + '\n';
        }
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '### <:owo_yay:1498978297210605608> ' + SC('accounts') + '\n' + accLines
        ));
    } else {
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:owo_yay:1498978297210605608> ${SC('no account added')}\n> ${SC('add a selfbot account to get started')}`
        ));
    }

    // ── Available Quests (fetched from active account) ───────
    let questLines = `### ${E_ORBS} ${SC('available quests')}\n`;
    if (activeTok) {
        try {
            const qs = await getQ(activeTok);
            if (qs) {
                const available = qs.filter(q => {
                    if (!isPlay(q)) return false;
                    if (expired(q)) return false;
                    if (q.user_status?.claimed_at) return false;
                    // Hide completed (progress done but not yet claimed)
                    const { type, target } = getTarget(q);
                    if (target > 0) {
                        const cur = (q.user_status?.progress||{})[type]?.value || 0;
                        if (cur >= target) return false;
                    }
                    return true;
                });
                if (available.length === 0) {
                    questLines += `> <:Welcomer:1459852564634931381> ${SC('all quests claimed!')}\n`;
                } else {
                    const totalAllOrbs = available.reduce((sum, q) => sum + getOrbAmount(q), 0);
                    for (const q of available.slice(0, 4)) {
                        const { type, target } = getTarget(q);
                        const cur = (q.user_status?.progress||{})[type]?.value || 0;
                        const pct = target ? Math.min(100, Math.floor(cur / target * 100)) : 0;
                        const orbAmt = getOrbAmount(q);
                        const lineEmoji = orbAmt > 0 ? E_ORBS : '<:games1:1459863568231956501>';
                        const orbStr = orbAmt > 0 ? ` <:giveaways:1459851717368873118> **${orbAmt}**` : '';
                        const qName = (q.config?.messages?.quest_name || 'Quest').slice(0, 45);
                        questLines += `> ${lineEmoji} **${qName}**${orbStr} — \`${pct}%\`\n`;
                    }
                    if (available.length > 4) questLines += `> -# +${available.length - 4} ${SC('more quests...')}\n`;
                    if (totalAllOrbs > 0) questLines += `> -# <:giveaways:1459851717368873118> ${SC('total potential:')} **${totalAllOrbs} orbs**\n`;
                }
            } else {
                questLines += `> ⚠️ ${SC('could not fetch quests')}\n`;
            }
        } catch {
            questLines += `> ⚠️ ${SC('error fetching quests')}\n`;
        }
    } else {
        questLines += `> -# ${SC('add an account to see quests')}\n`;
    }
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(questLines));
    sep(c);

    // Buttons — Switch Account is inside Manage
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_quests')  .setLabel('View Quests') .setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1511625467919208558', name: 'Orbs', animated: true }),
        new ButtonBuilder().setCustomId('q_complete').setLabel('Complete')    .setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
        new ButtonBuilder().setCustomId('q_accounts').setLabel('Manage')      .setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1495715447130296361', name: 'users' }),
        new ButtonBuilder().setCustomId('q_refresh_main').setLabel('Refresh') .setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
    ));

    footer(c);
    return pack(c);
}

// ── QUEST STATUS ──────────────────────────────────────────────
function buildQuestStatus(rows, accIdx = -1) {
    const c = mkC(C.T);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:info:1495717180434813001> ${SC('quest status')}`));
    sep(c);
    for (const row of rows) { c.addTextDisplayComponents(new TextDisplayBuilder().setContent(row)); sep(c); }
    const btns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_refresh_${accIdx}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    );
    c.addActionRowComponents(btns);
    footer(c);
    return pack(c);
}

// ── ACCOUNT SELECTOR (step 1, only if >1 account) ────────────
function buildAccSelector(opts) {
    const c = mkC(C.P);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E_ORBS} ${SC('select account')}\n-# ${SC('choose which account to complete quests on')}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_account').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}

// ── QUEST SELECTOR (step 2 or step 1 if single account) ──────
function buildQuestSelector(questOpts, accMention, accIdx) {
    // Sum orbs from quest options (parse from description)
    let orbPool = 0;
    for (const o of questOpts) {
        const m = o.description?.match(/^(\d+) Orbs/);
        if (m) orbPool += parseInt(m[1]);
    }
    const poolStr = orbPool > 0 ? `\n-# <:giveaways:1459851717368873118> ${SC('potential:')} **${orbPool} orbs**` : '';
    const c = mkC(C.P);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E_ORBS} ${SC('select quest')}\n-# <:owo_yay:1498978297210605608> ${accMention} — ${SC('choose quest to complete')}${poolStr}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_complete').setPlaceholder(`${SC('choose quest')}...`).addOptions(questOpts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_completeall_${accIdx}`).setLabel('Complete All').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}

// ── PROGRESS ──────────────────────────────────────────────────
function buildProgress(lines, done, total, autoRefreshActive = false) {
    const c = mkC(C.Y);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:giveaways:1459851717368873118> ${SC('completing quests...')}\n${lines}\n### <a:tickk:1512955302629216468> ${done}/${total} ${SC('done')}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_stop').setLabel('Stop').setStyle(ButtonStyle.Danger).setEmoji({ id: '1498992013499039855', name: 'Cross' }),
        new ButtonBuilder().setCustomId('q_progress_refresh_once').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
        new ButtonBuilder().setCustomId('q_progress_autorefresh').setLabel('Auto Refresh').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1483558170935820420', name: 'User' }).setDisabled(autoRefreshActive)
    ));
    footer(c);
    return pack(c);
}

// ── DONE ──────────────────────────────────────────────────────
function buildDone(total, stopped = false, orbTotal = 0) {
    const orbStr = orbTotal > 0 ? `\n<:giveaways:1459851717368873118> **${orbTotal}** ${SC('orbs earned!')}` : '';
    const c = mkC(stopped ? C.D : C.G);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        stopped
            ? `# <:Cross:1498992013499039855> ${SC('stopped')}\n${SC('completed what was possible.')}${orbStr}\n-# ${SC('claim rewards manually in the discord app.')}`
            : `# <a:tickk:1512955302629216468> ${SC('all done!')}\n<:giveaways:1459851717368873118> **${total}** ${SC('quest(s) completed.')}${orbStr}\n-# ${SC('claim rewards manually in the discord app.')}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back').setLabel('Back to Menu').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}

// ── MANAGE ACCOUNTS ───────────────────────────────────────────
async function buildManage(toks, aa, isOwner = false, isFullAccess = false) {
    const c = mkC(C.D);
    let list = '';
    const removeOpts = [];
    const switchOpts = [];
    for (let i = 0; i < toks.length; i++) {
        const info = await cInfo(toks[i]);
        const crown = (aa === i) ? ' <a:Crown:1493401405199880312>' : '';
        list += `> \`${i+1}.\` <@${info.id}> (\`${info.name}\`)${crown}\n`;
        if (isOwner && i < 25) removeOpts.push({ label: `[${i+1}] ${info.name}`, value: `${i}`, description: 'Tap to remove' });
        if (i < 25) switchOpts.push({ label: `${info.name}`, value: `${i}`, description: `Set as active account` });
    }
    if (!list) list = `> *${SC('no accounts yet')}*`;

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:users:1495715447130296361> ${SC('manage accounts')}\n${list}`));
    sep(c);

    // Switch dropdown first (on top)
    if (toks.length > 1) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('sel_switch').setPlaceholder(`🔄 ${SC('switch active account')}...`).addOptions(switchOpts)
        ));
    }
    if (isOwner) {
        if (removeOpts.length) {
            c.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('sel_remove').setPlaceholder(`${SC('select account to remove')}...`).addOptions(removeOpts)
            ));
        }
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_add')     .setLabel('Add Account')    .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_grabtok') .setLabel('Grab Token')      .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
            new ButtonBuilder().setCustomId('q_access')  .setLabel('Access Control') .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493401405199880312', name: 'Crown', animated: true }),
            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')           .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    } else if (isFullAccess) {
        // Full access users — same as owner but no remove-account dropdown
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_add')     .setLabel('Add Account')    .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_grabtok') .setLabel('Grab Token')      .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
            new ButtonBuilder().setCustomId('q_access')  .setLabel('Access Control') .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493401405199880312', name: 'Crown', animated: true }),
            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')           .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    } else {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')           .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    }
    footer(c);
    return pack(c);
}

// ── SWITCH ────────────────────────────────────────────────────
async function buildSwitch(toks) {
    const opts = [];
    for (let i = 0; i < Math.min(toks.length, 25); i++) {
        const nm = await cName(toks[i]);
        opts.push({ label: nm, value: `${i}`, description: `Set as active account` });
    }
    const c = mkC(C.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🔄 ${SC('switch active account')}`));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_switch').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}

// ── ACCESS CONTROL PANEL ─────────────────────────────────────
// Half 🔒 = View Quests + Complete + Refresh only
// Full ⚡ = + Manage Accounts (add/remove selfbot accounts)
// Owner 👑 = everything
function buildAccessPanel(uid) {
    const ac = loadAccess();
    const isOwner = ac.ownerId === String(uid);
    const canControl = isOwner || ac.fullUsers.includes(String(uid));
    const c = mkC(C.B);

    // Header
    let txt = `# <:crown:1494542237718020207> ${SC('access control')}\n`;
    txt += `-# ${SC('manage who can use this bot')}\n\n`;

    // Owner + Your Role
    txt += `-# <:crown:1494542237718020207> **ᴏᴡɴᴇʀ :** ${ac.ownerId ? `<@${ac.ownerId}>` : SC('not set')}\n`;
    const myLevel = getAccessLevel(uid);
    const myLevelLabel = myLevel === 'owner' ? `<:crown:1494542237718020207> ${SC('owner')}` :
                         myLevel === 'full'  ? `<a:HB7f:1498939702915502112> ${SC('full access')}` :
                         myLevel === 'half'  ? `<a:HB6l:1513308976278798357> ${SC('half access')}` : `<:User:1483558170935820420> ${SC('user')}`;
    txt += `-# <:User:1483558170935820420> **ʏᴏᴜʀ ʀᴏʟᴇ :** ${myLevelLabel}\n\n`;

    // Allowed users — combined list (full + half), reference style
    const fullList = ac.fullUsers.filter(u => u !== ac.ownerId);
    const halfList = ac.halfUsers.filter(u => u !== ac.ownerId);
    const allUsers = [
        ...fullList.map(u => ({ id: u, level: 'full' })),
        ...halfList.map(u => ({ id: u, level: 'half' }))
    ];
    txt += `### <:owo_yay:1498978297210605608> ${SC('allowed users')} (${allUsers.length})\n`;
    if (!allUsers.length) {
        txt += `> *${SC('no users added yet')}*\n`;
    } else {
        allUsers.slice(0, 20).forEach((u, i) => {
            const badge = u.level === 'full' ? '<a:HB7f:1498939702915502112>' : '<a:HB6l:1513308976278798357>';
            txt += `> **${i+1}.** ${badge} <@${u.id}> \`${u.id}\`\n`;
        });
    }

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(txt));
    sep(c);

    if (canControl) {
        // Remove dropdown
        if (allUsers.length) {
            c.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('sel_access_remove')
                    .setPlaceholder(`➖ ${SC('select user to remove')}...`)
                    .addOptions(allUsers.slice(0, 25).map(u => ({
                        label: `Remove ${u.id}`,
                        value: u.id,
                        description: `${u.level === 'full' ? 'Full Access' : 'Half Access'} — ${u.id}`,
                        emoji: { id: '1483558170935820420', name: 'User' }
                    })))
            ));
        }
        const btns = [
            new ButtonBuilder().setCustomId('q_access_add_user').setLabel('Add User')     .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_access_ref')     .setLabel('Refresh')      .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
            new ButtonBuilder().setCustomId('q_accounts')       .setLabel('Back')         .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ];
        if (allUsers.length) {
            btns.splice(1, 0, new ButtonBuilder().setCustomId('q_access_manage').setLabel('Manage Access').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493401405199880312', name: 'Crown', animated: true }));
        }
        c.addActionRowComponents(new ActionRowBuilder().addComponents(...btns));
    } else {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_accounts').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    }

    footer(c);
    return pack(c);
}

// ── QUEST ROW HELPER ─────────────────────────────────────────
async function buildQuestRow(tok, info, qs, idx) {
    if (!qs) return `### <@${info.id}>\n❌ ${SC('failed to fetch')}`;
    const allPlay = qs.filter(q => isPlay(q) && !expired(q));

    const isComplete = (q) => {
        if (q.user_status?.claimed_at) return true;
        const { type, target } = getTarget(q);
        if (target > 0) {
            const cur = (q.user_status?.progress||{})[type]?.value || 0;
            if (cur >= target) return true;
        }
        return false;
    };

    const active  = allPlay.filter(q => (q.user_status||{}).enrolled_at && !(q.user_status||{}).claimed_at && !isComplete(q));
    const claimed = allPlay.filter(q => isComplete(q)).length;
    const waiting = allPlay.filter(q => !(q.user_status||{}).enrolled_at && !isComplete(q));
    let txt = `### <@${info.id}>\n`;
    const allShown = [...active, ...waiting];
    const totalOrbs = allShown.reduce((sum, q) => sum + getOrbAmount(q), 0);
    const orbLine = totalOrbs > 0 ? `  ·  <:giveaways:1459851717368873118> **${totalOrbs} orbs**` : '';
    txt += `> ${E_ORBS} ${SC('active:')} **${active.length}**  ·  <a:restarted:1490948727781724160> ${SC('claimed:')} **${claimed}**  ·  <:x_info:1459852029580284088> ${SC('new:')} **${waiting.length}**${orbLine}\n`;
    // Show all non-claimed quests
    if (allShown.length) {
        for (const q of allShown) {
            const { type, target } = getTarget(q);
            const cur = (q.user_status?.progress||{})[type]?.value || 0;
            const pct = target ? Math.min(100, Math.floor(cur/target*100)) : 0;
            const oa = getOrbAmount(q);
            const tag = (q.user_status||{}).enrolled_at ? (oa > 0 ? E_ORBS : '<:games1:1459863568231956501>') : '<a:tickk:1512955302629216468>';
            const orbTag = oa > 0 ? `  — <:giveaways:1459851717368873118> **${oa}**` : '';
            txt += `\n${tag} **${(q.config?.messages?.quest_name||'Quest').slice(0,50)}**${orbTag}\n> \`${bar(pct)}\` **${pct}%**  (${cur}/${target})\n`;
        }
    } else { txt += `\n<:Welcomer:1459852564634931381> ${SC('all claimed!')}`; }
    return txt;
}

// ── MANAGE ACCESS: user select → Full/Half/Remove buttons ───
async function buildManageAccessSelect(uid) {
    const ac = loadAccess();
    const fullList = ac.fullUsers.filter(u => u !== ac.ownerId);
    const halfList = ac.halfUsers.filter(u => u !== ac.ownerId);
    const all = [
        ...fullList.map(u => ({ id: u, type: 'full' })),
        ...halfList.map(u => ({ id: u, type: 'half' }))
    ];
    if (!all.length) return null; // no users

    // Fetch display names via Bot token
    const nameMap = {};
    for (const u of all.slice(0, 25)) {
        try {
            const r = await fetch(`https://discord.com/api/v9/users/${u.id}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
            });
            if (r.ok) {
                const d = await r.json();
                nameMap[u.id] = {
                    display: d.global_name || d.username || u.id,
                    username: d.username || u.id
                };
            }
        } catch {}
        if (!nameMap[u.id]) nameMap[u.id] = { display: u.id, username: u.id };
    }

    const c = mkC(C.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:crown:1494542237718020207> ${SC('manage access')}\n-# ${SC('select a user to change their access level')}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('sel_access_pick_user')
            .setPlaceholder(`${SC('select user')}...`)
            .addOptions(all.slice(0, 25).map(u => {
                const nm = nameMap[u.id];
                const label = nm.display.slice(0, 25);
                const desc = `@${nm.username} · ${u.id} · ${u.type === 'full' ? 'Full Access' : 'Half Access'}`.slice(0, 50);
                return {
                    label,
                    value: u.id,
                    description: desc,
                    emoji: u.type === 'full'
                        ? { id: '1498939702915502112', name: 'HB7f', animated: true }
                        : { id: '1513308976278798357', name: 'HB6l', animated: true }
                };
            }))
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_access').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}

function buildManageAccessUser(targetId) {
    const ac = loadAccess();
    const isFull = ac.fullUsers.includes(targetId);
    const isHalf = ac.halfUsers.includes(targetId);
    const curLabel = isFull ? `<a:HB7f:1498939702915502112> ${SC('full access')}` : isHalf ? `<a:HB6l:1513308976278798357> ${SC('half access')}` : SC('no access');
    const c = mkC(C.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:crown:1494542237718020207> ${SC('manage user')}
> <@${targetId}> \`${targetId}\`
-# **${SC('current')}:** ${curLabel}`
    ));
    sep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_mau_full_${targetId}`) .setLabel('Full Access') .setStyle(isFull  ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }).setDisabled(isFull),
        new ButtonBuilder().setCustomId(`q_mau_half_${targetId}`) .setLabel('Half Access') .setStyle(isHalf  ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji({ id: '1513308976278798357', name: 'HB6l', animated: true }).setDisabled(isHalf),
        new ButtonBuilder().setCustomId(`q_mau_remove_${targetId}`).setLabel('Remove')     .setStyle(ButtonStyle.Danger)                                    .setEmoji({ id: '1498992013499039855', name: 'Cross' }),
        new ButtonBuilder().setCustomId('q_access_manage')        .setLabel('Back')        .setStyle(ButtonStyle.Secondary)                                  .setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    footer(c);
    return pack(c);
}


// ============================================================
//  QUEST RUNNER
// ============================================================
async function runQuests(int, uid, toks, v) {
    let targets = [];

    if (v === 'all_all') {
        for (const t of toks) {
            const qs = await getQ(t); if (!qs) continue;
            for (const q of qs) if (isPlay(q) && !(q.user_status||{}).claimed_at && !expired(q)) targets.push({ tkn: t, qid: q.id, q });
        }
    } else if (v.startsWith('all_acc_')) {
        const t = toks[parseInt(v.split('_')[2])]; if (!t) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
        const qs = await getQ(t); if (qs) for (const q of qs) if (isPlay(q) && !(q.user_status||{}).claimed_at && !expired(q)) targets.push({ tkn: t, qid: q.id, q });
    } else if (v.startsWith('q_')) {
        const parts = v.split('_'); const ai = parseInt(parts[1]); const qid = parts.slice(2).join('_');
        const t = toks[ai]; if (!t) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
        const qs = await getQ(t);
        const q = qs?.find(x => x.id === qid);
        if (q) targets.push({ tkn: t, qid, q });
    }

    if (!targets.length) return int.editReply(buildInfo(C.Y, `⭕ ${SC('no quests to complete! may already be done or expired.')}`));

    // Auto-enroll
    const uniqTkns = [...new Set(targets.map(t => t.tkn))];
    for (const tkn of uniqTkns) {
        const qs = await getQ(tkn); if (!qs) continue;
        for (const q of qs.filter(q => isPlay(q) && !(q.user_status||{}).enrolled_at && !expired(q))) await enroll(tkn, q.id);
    }

    const names = {};
    for (const tkn of uniqTkns) { const inf = await cInfo(tkn); names[tkn] = { name: inf.name, id: inf.id }; }
    const total = targets.length;

    const states = targets.map(t => ({
        tkn: t.tkn, qid: t.qid,
        name:   (t.q.config?.messages?.quest_name || 'Quest').slice(0, 45),
        type:   getTarget(t.q).type,
        target: getTarget(t.q).target,
        cur:    (t.q.user_status?.progress||{})[getTarget(t.q).type]?.value || 0,
        orbAmt: getOrbAmount(t.q),
        done:   false
    }));

    function buildLines() {
        let out = '', prev = '', doneOrbs = 0;
        const inProgress = states.filter(s => {
            if (s.done) return false;
            const pct = s.target ? Math.floor(Math.min(s.cur, s.target)/s.target*100) : 0;
            if (pct >= 100) { s.done = true; return false; } // mark done if 100% but flag missed
            return true;
        });
        const doneList = states.filter(s => s.done);
        for (const st of inProgress) {
            if (st.tkn !== prev) { out += `\n<:owo_yay:1498978297210605608> **Account :** <@${names[st.tkn].id}> (\`${names[st.tkn].name}\`)\n`; prev = st.tkn; }
            const pct = st.target ? Math.floor(Math.min(st.cur, st.target)/st.target*100) : 0;
            const icon = st.orbAmt > 0 ? E_ORBS : '<:games1:1459863568231956501>';
            const orbStr = st.orbAmt > 0 ? ` — <:giveaways:1459851717368873118> **${st.orbAmt}**` : '';
            out += `${icon} **${st.name}**${orbStr}\n> \`${bar(pct)}\` **${pct}%**\n`;
        }
        if (doneList.length) {
            out += '\n';
            for (const st of doneList) {
                const orbStr = st.orbAmt > 0 ? ` — <:giveaways:1459851717368873118> **${st.orbAmt}**` : '';
                const icon = st.orbAmt > 0 ? '<a:tickk:1512955302629216468>' : '<a:tickk:1512955302629216468>';
                out += `${icon} ~~**${st.name}**~~${orbStr}\n`;
                doneOrbs += st.orbAmt;
            }
        }
        if (doneOrbs > 0) out += `\n<:giveaways:1459851717368873118> ${SC('earned so far:')} **${doneOrbs} orbs**\n`;
        return out;
    }

    stopFlags.set(uid, false);
    // Generate new session ID — invalidates any previously running quest loop for this user
    const mySession = (runSessions.get(uid) || 0) + 1;
    runSessions.set(uid, mySession);
    activeRuns.set(uid, { states, names, total, buildLines, sessionId: mySession });
    await int.editReply(buildProgress(buildLines(), 0, total));

    let allDone = false;
    while (!allDone) {
        // Session check — agar naya /autoquest chala toh ye purana loop exit kar de silently
        if (runSessions.get(uid) !== mySession) {
            return; // New session started, this run is now dead
        }

        if (stopFlags.get(uid)) {
            stopFlags.set(uid, false);
            activeRuns.delete(uid);
            const dc = states.filter(s => s.done).length;
            const orbDone = states.filter(s => s.done).reduce((sum, s) => sum + s.orbAmt, 0);
            // Show Done screen immediately — claim in background so user isn't stuck
            int.editReply(buildDone(dc, true, orbDone)).catch(() => {});
            Promise.all(states.filter(s => s.done).map(st => claim(st.tkn, st.qid)))
                .then(async () => {
                    for (const tkn of [...new Set(states.filter(s => s.done).map(s => s.tkn))]) {
                        const qs = await getQ(tkn); if (qs) updateOrbVaultFromQuests(qs);
                    }
                }).catch(() => {});
            return;
        }

        allDone = true;
        await Promise.all(states.map(async (st) => {
            if (st.done) return;
            // Already at target before HB
            if (st.target > 0 && st.cur >= st.target) { st.done = true; return; }
            const { s, d } = await hb(st.tkn, st.qid);
            if (s === 200 && d?.progress) {
                const p = d.progress[st.type];
                if (p) {
                    st.cur = p.value ?? st.cur;
                    if (p.completed_at || st.cur >= st.target) { st.cur = st.target; st.done = true; }
                }
            }
            // Fallback: if somehow cur >= target after update
            if (!st.done && st.target > 0 && st.cur >= st.target) st.done = true;
            if (!st.done) allDone = false;
        }));

        // Data update ho gaya — message update nahi karein
        // Sirf Refresh / Auto Refresh button se message update hoga
        if (!allDone) await new Promise(r => setTimeout(r, 4000));
        // Re-check session after sleep — naya run shuru hua toh exit
        if (runSessions.get(uid) !== mySession) return;
    }

    activeRuns.delete(uid);
    await Promise.all(states.map(st => claim(st.tkn, st.qid)));
    // Refresh orb vault with latest claimed data
    const uniqTkns2 = [...new Set(states.map(s => s.tkn))];
    for (const tkn of uniqTkns2) {
        const qs = await getQ(tkn); if (qs) updateOrbVaultFromQuests(qs);
    }
    const orbAll = states.reduce((sum, s) => sum + s.orbAmt, 0);
    return int.editReply(buildDone(total, false, orbAll)).catch(() => {});
}

// ============================================================
//  BOT
// ============================================================
async function startBot(bt) {
    BOT_TOKEN = bt; // store globally
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });

    // Raw JSON command — UserInstall + GuildInstall, usable in servers, DMs, group chats
    const cmd = {
        name: 'autoquest',
        description: 'Open Quest Auto-Completer',
        integration_types: [
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ],
        contexts: [
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]
    };

    client.once('clientReady', async () => {
        termLog('bot', T.success + T.bold + client.user.tag + T.reset + ' is online ' + T.success + '✓' + T.reset);
        try {
            await new REST({ version: '10' }).setToken(bt).put(Routes.applicationCommands(client.user.id), { body: [cmd] });
            termLog('ok', T.success + '/autoquest registered globally' + T.reset + T.dim + ' (server + DM + group chat)' + T.reset);
        } catch(e) { termLog('err', T.error + 'Register error: ' + e.message + T.reset); }
        termDivider('─');
        termLog('sys', T.primary + T.bold + 'Bot is READY' + T.reset + ' — Waiting for interactions...');
        console.log('');
    });

    client.on('interactionCreate', async (int) => {
        // Helper: safe defer — silently ignores expired interactions (10062)
        async function safeDefer() {
            try {
                if (int.replied || int.deferred) return true;
                if (int.isChatInputCommand() || int.isModalSubmit()) {
                    await int.deferReply({ flags: MessageFlags.Ephemeral });
                } else {
                    await int.deferUpdate();
                }
                return true;
            } catch (e) {
                if (e.code === 10062) return false;
                throw e;
            }
        }
        try {
            const data = load();
            const uid  = int.user.id;
            const ac = loadAccess();
            const ownerUid = ac.ownerId || uid;
            const toks = data.user_tkns[ownerUid] || [];

            // ── /autoquest — send new message, everything else uses update ──
            if (int.isChatInputCommand() && int.commandName === 'autoquest') {
                const access = isAllowed(uid);
                if (access === 'NO_OWNER') {
                    setOwner(uid);
                    try { await int.deferReply(); } catch(e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(await buildMain(data, uid));
                }
                if (!access) {
                    try { await int.deferReply({ flags: MessageFlags.Ephemeral }); } catch(e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(buildInfo(C.R, `# <:clown:1497858276090449950> ${SC('access denied')}\n> **ᴘʜᴇʟᴇ ᴀᴘɴɪ ᴀᴜᴋᴀᴛ ᴅᴇᴋʜ ꜰɪʀ ᴄᴏɴᴛʀᴏʟ ᴋᴀʀɪᴏ ʟᴀᴡᴅᴇ ᴍᴀᴅᴀʀᴄʜᴏᴅ ʀᴀɴᴅɪ** <@${uid}>`, false));
                }
                try { await int.deferReply(); } catch(e) { if (e.code === 10062) return; throw e; }
                return int.editReply(await buildMain(data, uid));
            }

            // ── Block non-allowed users on all interactions ────────
            if (!int.isChatInputCommand()) {
                const access = isAllowed(uid);
                if (access !== 'NO_OWNER' && !access) {
                    if (!await safeDefer()) return;
                    return int.editReply(buildInfo(C.R, `# <:clown:1497858276090449950> ${SC('access denied')}\n> **ᴘʜᴇʟᴇ ᴀᴘɴɪ ᴀᴜᴋᴀᴛ ᴅᴇᴋʜ ꜰɪʀ ᴄᴏɴᴛʀᴏʟ ᴋᴀʀɪᴏ ʟᴀᴡᴅᴇ ᴍᴀᴅᴀʀᴄʜᴏᴅ ʀᴀɴᴅɪ** <@${uid}>`, false));
                }
            }

            // ── Back to main menu ──────────────────────────────────
            if (int.isButton() && int.customId === 'q_back') {
                if (!await safeDefer()) return;
                return int.editReply(await buildMain(load(), uid));
            }

            // ── Refresh main menu ──────────────────────────────────
            if (int.isButton() && int.customId === 'q_refresh_main') {
                if (!await safeDefer()) return;
                // Clear cache for all tokens so fresh data loads
                const d2 = load();
                const ac2 = d2.access || {};
                const ownerUid2 = ac2.ownerId || uid;
                const toks2 = d2.user_tkns[ownerUid2] || [];
                for (const t of toks2) infoCache.delete(t);
                return int.editReply(await buildMain(d2, uid));
            }

            // ── Refresh quests ─────────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_refresh_')) {
                if (!await safeDefer()) return;
                const ai = parseInt(int.customId.split('_')[2]);
                if (ai === -1) {
                    // fallback: go back to main
                    return int.editReply(await buildMain(load(), uid));
                }
                const t = toks[ai]; if (!t) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
                infoCache.delete(t); // clear cache so fresh data loads
                const info = await cInfo(t);
                const qs   = await getQ(t);
                if (qs) updateOrbVaultFromQuests(qs);
                const rows = [await buildQuestRow(t, info, qs, ai)];
                return int.editReply(buildQuestStatus(rows, ai));
            }

            // ── Stop ──────────────────────────────────────────────
            if (int.isButton() && int.customId === 'q_stop') {
                stopFlags.set(uid, true);
                try { await int.deferUpdate(); } catch {}
                return; // runQuests loop will detect flag and show Done screen itself
            }

            // ── Progress Refresh Once — original message refresh, NO ephemeral ──
            if (int.isButton() && int.customId === 'q_progress_refresh_once') {
                // deferUpdate = original message ke saath kaam karega, koi ephemeral nahi
                try { await int.deferUpdate(); } catch(e) { if (e.code === 10062) return; }
                const run = activeRuns.get(uid);
                if (!run || run.sessionId !== runSessions.get(uid)) return;
                const dc = run.states.filter(s => s.done).length;
                try { await int.editReply(buildProgress(run.buildLines(), dc, run.total)); } catch {}
                return;
            }

            // ── Auto Refresh — original message pe loop, NO ephemeral ──
            if (int.isButton() && int.customId === 'q_progress_autorefresh') {
                // Har user ka apna alag autoRefresh flag — ek baar ek hi chal sakta hai
                const arSession = runSessions.get(uid);
                // deferUpdate: original message update karega
                try { await int.deferUpdate(); } catch(e) { if (e.code === 10062) return; }
                // Pehle button disable karke dikhao (taaki dobara press na ho)
                const runNow = activeRuns.get(uid);
                if (!runNow || runNow.sessionId !== arSession) return;
                const dcNow = runNow.states.filter(s => s.done).length;
                try { await int.editReply(buildProgress(runNow.buildLines(), dcNow, runNow.total, true)); } catch {}

                // Auto refresh loop — har 4s mein original message update
                while (true) {
                    await new Promise(r => setTimeout(r, 4000));
                    // Session check — naya run shuru hua toh exit
                    if (runSessions.get(uid) !== arSession) break;
                    const run2 = activeRuns.get(uid);
                    // activeRuns delete ho gaya matlab quest complete/stopped
                    if (!run2 || run2.sessionId !== arSession) {
                        // Quest done ho gaya — Done screen already show ho chuki hai runQuests se
                        break;
                    }
                    const dc2 = run2.states.filter(s => s.done).length;
                    const allDoneNow = run2.states.every(s => s.done);
                    try {
                        if (allDoneNow) {
                            await int.editReply(buildProgress(run2.buildLines(), dc2, run2.total, false));
                            break;
                        }
                        await int.editReply(buildProgress(run2.buildLines(), dc2, run2.total, true));
                    } catch { break; }
                }
                return;
            }

            // ── Add Account (modal) ────────────────────────────────
            if (int.isButton() && int.customId === 'q_add') {
                const modal = new ModalBuilder().setCustomId('modal_add').setTitle('Add Discord Account');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('tk').setLabel('Paste your Discord user token')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Paste your token here (get from Discord web → F12 → Console)')
                            .setMinLength(50).setMaxLength(4000).setRequired(true)
                    )
                );
                return int.showModal(modal);
            }

            // ── Vo Grab Token (email+password → grab.py) ──────────
            if (int.isButton() && int.customId === 'q_grabtok') {
                const modal = new ModalBuilder().setCustomId('modal_grab_emailpass').setTitle('Grab Token');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('grab_email').setLabel('Discord Email')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('discord@email.com')
                            .setMinLength(5).setMaxLength(200).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('grab_pass').setLabel('Discord Password')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('************')
                            .setMinLength(3).setMaxLength(200).setRequired(true)
                    )
                );
                return int.showModal(modal);
            }

            // ── View Quests ────────────────────────────────────────
            if (int.isButton() && int.customId === 'q_quests') {
                if (!toks.length) {
                    try { await int.deferUpdate(); } catch(e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(buildInfo(C.R, `❌ ${SC('no accounts! add one in manage.')}`, false));
                }
                if (!await safeDefer()) return;

                // Single account → show directly
                if (toks.length === 1) {
                    const info = await cInfo(toks[0]);
                    const qs   = await getQ(toks[0]);
                    if (qs) updateOrbVaultFromQuests(qs);
                    const rows = [await buildQuestRow(toks[0], info, qs, 0)];
                    return int.editReply(buildQuestStatus(rows, 0));
                }

                // Multiple accounts → show account selector first
                const infos = await Promise.all(toks.slice(0, 25).map(t => cInfo(t)));
                const opts = infos.map((info, i) => ({ label: `${info.name}`, value: `vq_${i}`, description: `View quests for ${info.name}` }));
                const cv = mkC(C.T);
                cv.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${E_ORBS} ${SC('view quests')}\n-# ${SC('select account to view')}`
                ));
                sep(cv);
                cv.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('sel_vq_account').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
                ));
                cv.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                ));
                footer(cv);
                return int.editReply(pack(cv));
            }

            // ── SELECT: View quests for chosen account ─────────────
            if (int.isStringSelectMenu() && int.customId === 'sel_vq_account') {
                if (!await safeDefer()) return;
                const ai   = parseInt(int.values[0].split('_')[1]);
                const t    = toks[ai]; if (!t) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
                const info = await cInfo(t);
                const qs   = await getQ(t);
                if (qs) updateOrbVaultFromQuests(qs);
                const rows = [await buildQuestRow(t, info, qs, ai)];
                return int.editReply(buildQuestStatus(rows, ai));
            }

            // ── Complete button — always use active account directly ──
            if (int.isButton() && int.customId === 'q_complete') {
                if (!toks.length) {
                    try { await int.deferUpdate(); } catch(e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(buildInfo(C.R, `❌ ${SC('no accounts! add one in manage.')}`, false));
                }
                if (!await safeDefer()) return;
                // ── If a quest is already running, show current progress instead ──
                if (activeRuns.has(uid)) {
                    const run = activeRuns.get(uid);
                    // Only show if it's the current active session
                    if (run.sessionId === runSessions.get(uid)) {
                        const dc = run.states.filter(s => s.done).length;
                        return int.editReply(buildProgress(run.buildLines(), dc, run.total));
                    }
                }
                const ai   = data.active_acc?.[ownerUid] ?? 0;
                const t    = toks[ai] || toks[0];
                const info = await cInfo(t);
                const qs   = await getQ(t);
                if (!qs) return int.editReply(buildInfo(C.R, `❌ ${SC('could not fetch quests.')}`));
                // Filter: not claimed, not expired, not already 100% done
                const playable = qs.filter(q => {
                    if (!isPlay(q)) return false;
                    if (expired(q)) return false;
                    if (q.user_status?.claimed_at) return false;
                    // Also skip if progress already complete
                    const { type, target } = getTarget(q);
                    if (target > 0) {
                        const cur = (q.user_status?.progress||{})[type]?.value || 0;
                        if (cur >= target) return false;
                    }
                    return true;
                });
                const questOpts = buildQuestOpts(playable, info.name, ai);
                if (!questOpts.length) {
                    return int.editReply(buildInfo(C.G, `# ✅ ${SC('no pending quests!')}\n> ${SC('all quests are already completed or claimed.')}`));
                }
                return int.editReply(buildQuestSelector(questOpts, `<@${info.id}>`, ai));
            }

            // ── SELECT: Account chosen → quest selector ────────────
            if (int.isStringSelectMenu() && int.customId === 'sel_account') {
                const v = int.values[0];
                if (!await safeDefer()) return;

                const ai   = parseInt(v.split('_')[1]);
                const t    = toks[ai]; if (!t) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
                const info = await cInfo(t);
                const qs   = await getQ(t);
                if (!qs) return int.editReply(buildInfo(C.R, `❌ ${SC('failed to fetch quests.')}`));
                const playable = qs.filter(q => {
                    if (!isPlay(q)) return false;
                    if (expired(q)) return false;
                    if (q.user_status?.claimed_at) return false;
                    const { type, target } = getTarget(q);
                    if (target > 0) {
                        const cur = (q.user_status?.progress||{})[type]?.value || 0;
                        if (cur >= target) return false;
                    }
                    return true;
                });
                const questOpts = buildQuestOpts(playable, info.name, ai);
                if (!questOpts.length) {
                    return int.editReply(buildInfo(C.G, `# ✅ ${SC('no pending quests!')}\n> ${SC('all quests are already completed or claimed.')}`));
                }
                return int.editReply(buildQuestSelector(questOpts, `<@${info.id}>`, ai));
            }

            // ── SELECT: Quest chosen → run ─────────────────────────
            if (int.isStringSelectMenu() && int.customId === 'sel_complete') {
                if (!await safeDefer()) return;
                return runQuests(int, uid, toks, int.values[0]);
            }

            // ── Complete All ───────────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_completeall_')) {
                if (!toks.length) return int.editReply(buildInfo(C.R, `❌ ${SC('no accounts! add one in manage.')}`));
                if (!await safeDefer()) return;
                const suffix = int.customId.split('_')[2]; // 'all' or account index
                if (suffix === 'all') return runQuests(int, uid, toks, 'all_all');
                return runQuests(int, uid, toks, `all_acc_${suffix}`);
            }

            // ── Switch account ─────────────────────────────────────
            if (int.isButton() && int.customId === 'q_switch') {
                if (!await safeDefer()) return;
                return int.editReply(await buildSwitch(toks));
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_switch') {
                if (!await safeDefer()) return;
                if (!data.active_acc) data.active_acc = {};
                const v = int.values[0];
                if (v === 'all') { delete data.active_acc[ownerUid]; }
                else { const idx = parseInt(v); if (!isNaN(idx) && idx < toks.length) data.active_acc[ownerUid] = idx; }
                save(data);
                return int.editReply(await buildMain(load(), uid));
            }

            // ── Manage accounts ────────────────────────────────────
            if (int.isButton() && int.customId === 'q_accounts') {
                if (!await safeDefer()) return;
                const userLvl = getAccessLevel(uid);
                // Half access wale Manage page nahi dekh sakte
                if (userLvl === 'half') {
                    return int.editReply(buildInfo(C.R, `# <a:HB6l:1513308976278798357> ${SC('half access only')}
> ${SC('you can only view quests & complete them.')}
> ${SC('ask the owner for full access.')}`));
                }
                const isOwnerNow = ac.ownerId === String(uid);
                const isFullNow  = userLvl === 'full';
                return int.editReply(await buildManage(toks, data.active_acc?.[ownerUid], isOwnerNow, isFullNow));
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_remove') {
                if (!await safeDefer()) return;
                if (ac.ownerId !== String(uid)) return int.editReply(buildInfo(C.R, `❌ ${SC('only owner can remove accounts.')}`));
                const idx = parseInt(int.values[0]);
                if (isNaN(idx) || idx >= toks.length) return int.editReply(buildInfo(C.R, '❌ Invalid.'));
                const nm = await cName(toks[idx]);
                toks.splice(idx, 1);
                if (data.active_acc?.[ownerUid] === idx) delete data.active_acc[ownerUid];
                else if ((data.active_acc?.[ownerUid] ?? -1) > idx) data.active_acc[ownerUid]--;
                data.user_tkns[ownerUid] = toks; save(data);
                const lvlAfter = getAccessLevel(uid);
                return int.editReply(await buildManage(toks, data.active_acc?.[ownerUid], ac.ownerId === String(uid), lvlAfter === 'full'));
            }

            // ── Access Control ────────────────────────────────────
            if (int.isButton() && int.customId === 'q_access') {
                if (!await safeDefer()) return;
                return int.editReply(buildAccessPanel(uid));
            }

            if (int.isButton() && int.customId === 'q_access_ref') {
                if (!await safeDefer()) return;
                return int.editReply(buildAccessPanel(uid));
            }

            // ── Add User button (single modal, choose Half or Full inside) ──
            if (int.isButton() && int.customId === 'q_access_add_user') {
                const ac = loadAccess();
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') {
                    if (!await safeDefer()) return;
                    return int.editReply(buildInfo(C.R, `❌ ${SC('only owner or full access can add users.')}`));
                }
                const modal = new ModalBuilder().setCustomId('modal_access_add_user').setTitle('👤 Add User');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('access_uid').setLabel('User ID or Username')
                            .setPlaceholder('Enter User ID (numbers) or username')
                            .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(50).setRequired(true)
                    )
                );
                return int.showModal(modal);
            }

            // ── Manage Access button → show user select menu ─────
            if (int.isButton() && int.customId === 'q_access_manage') {
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('no permission.')}`));
                const panel = await buildManageAccessSelect(uid);
                if (!panel) return int.editReply(buildInfo(C.Y, `⚠️ ${SC('no users to manage yet.')}`));
                return int.editReply(panel);
            }

            // ── User selected from manage menu → show Full/Half/Remove buttons ──
            if (int.isStringSelectMenu() && int.customId === 'sel_access_pick_user') {
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('no permission.')}`));
                const targetId = int.values[0];
                return int.editReply(buildManageAccessUser(targetId));
            }

            // ── Give Full Access ───────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_mau_full_')) {
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_full_', '');
                addFullUser(targetId);
                return int.editReply(buildManageAccessUser(targetId));
            }

            // ── Give Half Access ───────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_mau_half_')) {
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_half_', '');
                addHalfUser(targetId);
                return int.editReply(buildManageAccessUser(targetId));
            }

            // ── Remove user from Manage Access screen ─────────────
            if (int.isButton() && int.customId.startsWith('q_mau_remove_')) {
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_remove_', '');
                if (targetId === ac.ownerId) return int.editReply(buildInfo(C.R, `❌ ${SC('cannot remove the owner.')}`));
                removeUser(targetId);
                const panel = await buildManageAccessSelect(uid);
                if (!panel) return int.editReply(buildAccessPanel(uid));
                return int.editReply(panel);
            }

            // ── MODAL: Add User → auto Half access ───────────────
            if (int.isModalSubmit() && int.customId === 'modal_access_add_user') {
                const ac = loadAccess();
                if (!await safeDefer()) return;
                const lvl = getAccessLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(buildInfo(C.R, `❌ ${SC('only owner or full access can add users.')}`));
                const rawInput = int.fields.getTextInputValue('access_uid').trim();

                let targetId = null;
                let resolvedName = null;

                if (/^\d{17,20}$/.test(rawInput)) {
                    // Direct numeric ID
                    targetId = rawInput;
                    // Try to fetch display name via bot token
                    try {
                        const r = await fetch(`https://discord.com/api/v9/users/${targetId}`, {
                            headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
                        });
                        if (r.ok) { const d = await r.json(); resolvedName = d.global_name || d.username || null; }
                    } catch {}
                } else {
                    // Username lookup — check saved selfbot tokens + friends list
                    const d2 = load();
                    const ownerUid2 = ac.ownerId || uid;
                    const allToks = d2.user_tkns[ownerUid2] || [];
                    const lowerInput = rawInput.toLowerCase();
                    for (const t of allToks) {
                        try {
                            const me = await getMe(t);
                            if (me && (me.username?.toLowerCase() === lowerInput || me.global_name?.toLowerCase() === lowerInput)) {
                                targetId = me.id; resolvedName = me.global_name || me.username; break;
                            }
                        } catch {}
                    }
                    if (!targetId && allToks.length) {
                        try {
                            const r = await api(allToks[0], 'GET', `/users/@me/relationships`);
                            if (r.s === 200 && Array.isArray(r.d)) {
                                const found = r.d.find(rel =>
                                    rel.user?.username?.toLowerCase() === lowerInput ||
                                    rel.user?.global_name?.toLowerCase() === lowerInput
                                );
                                if (found) { targetId = found.user.id; resolvedName = found.user.global_name || found.user.username; }
                            }
                        } catch {}
                    }
                    if (!targetId) {
                        return int.editReply(buildInfo(C.R, `# ❌ ${SC('user not found')}\n> ${SC('enter a valid user id (numbers) or a username from your saved accounts / friends list.')}`));
                    }
                }

                if (targetId === ac.ownerId) {
                    return int.editReply(buildInfo(C.Y, `⚠️ ${SC('that is the owner already!')}`));
                }
                const alreadyLvl = getAccessLevel(targetId);
                if (alreadyLvl === 'half' || alreadyLvl === 'full') {
                    return int.editReply(buildInfo(C.Y, `⚠️ ${SC('user already has access!')}`));
                }

                addHalfUser(targetId);
                const nameStr = resolvedName ? ` (**${resolvedName}**)` : '';
                const c2 = mkC(C.G);
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:User:1483558170935820420> ${SC('user added!')}\n> <@${targetId}>${nameStr} \`${targetId}\`\n> <a:HB6l:1513308976278798357> ${SC('half access — can view quests & complete only.')}\n-# ${SC('use manage access to give full access.')}`
                ));
                sep(c2);
                c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('q_access').setLabel('Back to Access').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                ));
                footer(c2);
                return int.editReply({ components: [c2], flags: V2 });
            }

            // ── MODAL: Add account (token only) ────────────────────
            if (int.isModalSubmit() && int.customId === 'modal_add') {
                const tk = int.fields.getTextInputValue('tk').trim();
                const ownerUid2 = ac.ownerId || uid;
                if (!await safeDefer()) return;

                if (tk.length < 50) return int.editReply(buildInfo(C.R, `❌ ${SC('token too short.')}`));
                const me = await getMe(tk);
                if (!me) return int.editReply(buildInfo(C.R, `❌ ${SC('invalid token!')}`));
                if (!data.user_tkns[ownerUid2]) data.user_tkns[ownerUid2] = [];
                if (data.user_tkns[ownerUid2].includes(tk)) return int.editReply(buildInfo(C.Y, `⚠️ ${SC('already saved!')}`));
                data.user_tkns[ownerUid2].push(tk); save(data);
                const c2 = mkC(C.G);
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ✅ ${SC('account added!')}\n> **${me.username}**  \`${me.id}\`\n📊 **${data.user_tkns[ownerUid2].length}** ${SC('account(s) total')}`
                ));
                sep(c2); footer(c2);
                return int.editReply({ components: [c2], flags: V2 });
            }

            // ── MODAL: Vo Grab Token (email+password submit) ──────
            if (int.isModalSubmit() && int.customId === 'modal_grab_emailpass') {
                const email = int.fields.getTextInputValue('grab_email').trim();
                const pass  = int.fields.getTextInputValue('grab_pass').trim();
                const ownerUid2 = ac.ownerId || uid;
                if (!await safeDefer()) return;

                if (!email.includes('@')) return int.editReply(buildInfo(C.R, `❌ ${SC('invalid email.')}`));
                if (pass.length < 3) return int.editReply(buildInfo(C.R, `❌ ${SC('password too short.')}`));

                // Show thinking indicator
                await int.editReply(buildInfo(C.Y, `# <a:HB7f:1498939702915502112> ${SC('grabbing token...')}\n> <:giveaways:1459851717368873118> \`${email}\`\n-# ${SC('please wait...')}`));

                const result = runGrab(`--email "${email.replace(/"/g,'\\"')}" --password "${pass.replace(/"/g,'\\"')}"`);

                if (result.status === 'success' && result.token) {
                    const saved = await saveAccountToken(result.token, ownerUid2);
                    if (saved.ok) {
                        const c2 = mkC(C.G);
                        c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <a:tickk:1512955302629216468> ${SC('token grabbed!')}\n` +
                            `-# <:owo_yay:1498978297210605608> ${SC('account saved successfully')}\n\n` +
                            `> <:dev:1459861201239539752> **ᴜꜱᴇʀ :** <@${saved.id}> (\`${saved.name}\`)\n` +
                            `> <:giveaways:1459851717368873118> **ᴇᴍᴀɪʟ :** \`${email}\`\n` +
                            `> <a:HB7f:1498939702915502112> **ᴛᴏᴋᴇɴ :** ||\`${result.token.slice(0,25)}...\`||\n` +
                            `> <:users:1495715447130296361> **ᴛᴏᴛᴀʟ ᴀᴄᴄᴏᴜɴᴛꜱ :** \`${saved.count}\``
                        ));
                        sep(c2);
                        c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('q_accounts').setLabel('Manage Accounts').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1495715447130296361', name: 'users' }),
                            new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                        ));
                        footer(c2);
                        return int.editReply({ components: [c2], flags: V2 });
                    }
                    if (saved.dup) return int.editReply(buildInfo(C.Y, saved.msg));
                    return int.editReply(buildInfo(C.R, saved.msg));
                }

                if (result.status === 'mfa' && result.ticket) {
                    pendingMFA.set(uid, { email, ticket: result.ticket });
                    const m = new ModalBuilder().setCustomId('modal_grab_2fa').setTitle('🔐 Enter 2FA Code');
                    m.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('grab_2fa_code').setLabel('6-digit 2FA code from your authenticator')
                                .setStyle(TextInputStyle.Short).setPlaceholder('123456')
                                .setMinLength(6).setMaxLength(8).setRequired(true)
                        )
                    );
                    return int.showModal(m);
                }

                if (result.status === 'captcha') {
                    return int.editReply(buildInfo(C.O, `# 🛡️ ${SC('captcha!')}\n> ${SC('discord wants captcha. use a token instead.')}`));
                }
                if (result.status === 'verify') {
                    return int.editReply(buildInfo(C.O, `# 📧 ${SC('verify!')}\n> ${SC('check email inbox, verify the login, then try again.')}`));
                }
                if (result.status === 'bad_creds') {
                    return int.editReply(buildInfo(C.R, `# ❌ ${SC('wrong creds!')}\n> ${SC('check email and password.')}`));
                }
                return int.editReply(buildInfo(C.R, `❌ ${SC('grab.py error:')} ${result.error || 'unknown'}`));
            }

            // ── MODAL: Vo Grab 2FA code submit ────────────────────
            if (int.isModalSubmit() && int.customId === 'modal_grab_2fa') {
                const code = int.fields.getTextInputValue('grab_2fa_code').trim();
                const pending = pendingMFA.get(uid);
                const ownerUid2 = ac.ownerId || uid;
                if (!await safeDefer()) return;

                if (!pending) return int.editReply(buildInfo(C.R, `❌ ${SC('session expired. try grab again.')}`));

                await int.editReply(buildInfo(C.Y, `# <a:HB7f:1498939702915502112> ${SC('submitting 2fa...')}\n-# ${SC('please wait...')}`));

                const result = runGrab(`--ticket "${pending.ticket}" --code "${code}"`);
                pendingMFA.delete(uid);

                if (result.status === 'success' && result.token) {
                    const saved = await saveAccountToken(result.token, ownerUid2);
                    if (saved.ok) {
                        const c2 = mkC(C.G);
                        c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <a:tickk:1512955302629216468> ${SC('2fa passed! token grabbed!')}\n` +
                            `-# <:owo_yay:1498978297210605608> ${SC('account saved successfully')}\n\n` +
                            `> <:dev:1459861201239539752> **ᴜꜱᴇʀ :** <@${saved.id}> (\`${saved.name}\`)\n` +
                            `> <:giveaways:1459851717368873118> **ᴇᴍᴀɪʟ :** \`${pending.email}\`\n` +
                            `> <a:HB7f:1498939702915502112> **ᴛᴏᴋᴇɴ :** ||\`${result.token.slice(0,25)}...\`||\n` +
                            `> <:users:1495715447130296361> **ᴛᴏᴛᴀʟ ᴀᴄᴄᴏᴜɴᴛꜱ :** \`${saved.count}\``
                        ));
                        sep(c2);
                        c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('q_accounts').setLabel('Manage Accounts').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1495715447130296361', name: 'users' }),
                            new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                        ));
                        footer(c2);
                        return int.editReply({ components: [c2], flags: V2 });
                    }
                    if (saved.dup) return int.editReply(buildInfo(C.Y, saved.msg));
                    return int.editReply(buildInfo(C.R, saved.msg));
                }

                return int.editReply(buildInfo(C.R, `❌ ${SC('2fa failed:')} ${result.error || 'invalid code'}`));
            }

        } catch(e) {
            // Silently ignore expired/unknown interactions (10062) — user already dismissed
            if (e.code === 10062) return;
            termLog('err', e.message?.slice(0,120));
            const ep = buildInfo(C.R, `❌ ${SC('error.')} \`${e.message?.slice(0,120)}\``);
            try {
                if (!int.replied && !int.deferred) await int.reply(ep);
                else await int.editReply(ep);
            } catch {}
        }
    });

    await client.login(bt).catch(e => { console.error('[BOT] Login:', e.message); process.exit(1); });
}

// ── Build quest option list with orbs emoji ──────────────────
function buildQuestOpts(active, accName, accIdx) {
    const opts = [];
    for (const q of active) {
        if (opts.length >= 25) break;
        if (q.user_status?.claimed_at) continue; // skip already claimed
        const { type, target } = getTarget(q);
        const cur  = (q.user_status?.progress||{})[type]?.value || 0;
        const pct  = target ? Math.floor(cur/target*100) : 0;
        if (pct >= 100) continue; // skip completed (progress done)
        const qnm  = (q.config?.messages?.quest_name || 'Quest').slice(0, 90);
        const orbAmt = getOrbAmount(q);
        const desc = orbAmt > 0 ? `${orbAmt} Orbs · ${pct}% done` : `${pct}% done`;
        const opt  = { label: qnm, value: `q_${accIdx}_${q.id}`, description: desc };
        if (orbAmt > 0) opt.emoji = { id: '1511625467919208558', name: 'Orbs', animated: true };
        opts.push(opt);
    }
    return opts;
}

// ============================================================
//  CONFIG — Change settings here
// ============================================================
const BOT_CONFIG = {
    // Developer/Owner Discord User ID — set this to auto-assign owner on first run
    // Leave as null to be prompted in terminal, or set a string ID like '123456789012345678'
    defaultOwnerId: null,

    // Bot name shown in terminal
    botName: 'ᴏʀʙs ǫᴜᴇsᴛ ʙᴏᴛ',
    botVersion: 'ᴠ8',

    // Terminal color theme (ANSI codes)
    // Options: use standard ANSI escape codes
    colors: {
        primary:   '\x1b[38;5;135m',  // Purple
        secondary: '\x1b[38;5;240m',  // Dark grey
        success:   '\x1b[38;5;83m',   // Green
        warning:   '\x1b[38;5;220m',  // Yellow
        error:     '\x1b[38;5;196m',  // Red
        info:      '\x1b[38;5;75m',   // Blue
        dim:       '\x1b[2m',
        bold:      '\x1b[1m',
        reset:     '\x1b[0m',
    }
};

// ============================================================
//  TERMINAL UI HELPERS
// ============================================================
const T = BOT_CONFIG.colors;

function termBox(lines, color = T.primary) {
    const width = 50;
    const top    = color + '┌' + '─'.repeat(width) + '┐' + T.reset;
    const bottom = color + '└' + '─'.repeat(width) + '┘' + T.reset;
    const mid = lines.map(l => {
        const stripped = l.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = Math.max(0, width - stripped.length - 2);
        return color + '│ ' + T.reset + l + ' '.repeat(pad) + color + ' │' + T.reset;
    });
    return [top, ...mid, bottom].join('\n');
}

function termLog(level, msg) {
    const ts = new Date().toTimeString().slice(0,8);
    const lvlMap = {
        ok:   T.success  + '  OK  ' + T.reset,
        err:  T.error    + ' ERR  ' + T.reset,
        warn: T.warning  + ' WARN ' + T.reset,
        info: T.info     + ' INFO ' + T.reset,
        sys:  T.primary  + ' SYS  ' + T.reset,
        bot:  T.primary  + ' BOT  ' + T.reset,
    };
    const tag = lvlMap[level] || level;
    console.log(T.dim + `[${ts}]` + T.reset + ' ' + tag + '  ' + msg);
}

function termDivider(char = '─', color = T.secondary) {
    console.log(color + char.repeat(54) + T.reset);
}

function termInput(prompt) {
    return new Promise(resolve => {
        process.stdout.write(T.primary + '  ▶  ' + T.reset + T.bold + prompt + T.reset + ' ');
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        rl.once('line', line => { rl.close(); resolve(line.trim()); });
    });
}

// ============================================================
//  STARTUP
// ============================================================
async function startup() {
    console.clear();
    console.log('\n');

    // Banner
    console.log(termBox([
        T.bold + T.primary + '  ᴏʀʙs ǫᴜᴇsᴛ ʙᴏᴛ  ᴠ8  —  ᴄᴏᴍᴘ ᴠ2  ' + T.reset,
        T.dim  + '  ᴋɴɪɢʜᴛᴏꜰᴀᴅɪᴛʏᴀ  ·  Discord Quest Auto-Completer  ' + T.reset,
        '',
        T.secondary + '  github.com/knightofaditya  ' + T.reset,
    ], T.primary));

    console.log('');
    termDivider();
    console.log('');

    const d = load();

    // ── Step 1: Developer / Owner ID ─────────────────────────
    const ac = loadAccess();
    if (!ac.ownerId) {
        // Check BOT_CONFIG first
        if (BOT_CONFIG.defaultOwnerId && /^\d{17,20}$/.test(String(BOT_CONFIG.defaultOwnerId))) {
            setOwner(String(BOT_CONFIG.defaultOwnerId));
            termLog('ok', 'Owner set from config: ' + T.primary + BOT_CONFIG.defaultOwnerId + T.reset);
        } else {
            console.log('');
            termDivider('·');
            termLog('sys', T.warning + 'No owner/developer set yet.' + T.reset);
            termLog('info', 'Enter your Discord User ID to become the owner.');
            termLog('info', T.dim + '(Right-click your name in Discord → Copy User ID)' + T.reset);
            console.log('');
            const ownerId = await termInput('Developer Discord User ID:');
            if (ownerId && /^\d{17,20}$/.test(ownerId)) {
                setOwner(ownerId);
                termLog('ok', T.success + 'Owner set → ' + T.reset + T.bold + ownerId + T.reset);
            } else if (ownerId) {
                termLog('warn', T.warning + 'Invalid ID format. Will auto-set on first /autoquest use.' + T.reset);
            } else {
                termLog('warn', T.warning + 'Skipped. First Discord user to run /autoquest becomes owner.' + T.reset);
            }
        }
        console.log('');
    } else {
        termLog('ok', 'Owner/Developer: ' + T.primary + T.bold + ac.ownerId + T.reset);
    }

    // ── Step 2: Bot Token ────────────────────────────────────
    if (!d.bot_tkn) {
        termLog('sys', T.warning + 'No bot token found.' + T.reset);
        termLog('info', 'Get your token from ' + T.info + 'discord.com/developers/applications' + T.reset);
        console.log('');
        const tok = await termInput('Enter Bot Token:');
        if (!tok || tok.length < 20) {
            termLog('err', T.error + 'Invalid token. Exiting.' + T.reset);
            process.exit(1);
        }
        d.bot_tkn = tok;
        save(d);
        termLog('ok', T.success + 'Bot token saved!' + T.reset);
        console.log('');
    } else {
        termLog('ok', 'Bot token ' + T.success + 'loaded from config.' + T.reset);
    }

    // ── Step 3: Launch ───────────────────────────────────────
    termDivider();
    termLog('sys', T.primary + 'Launching bot...' + T.reset);
    console.log('');

    startBot(d.bot_tkn);
}

startup();

