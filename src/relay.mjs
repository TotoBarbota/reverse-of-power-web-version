#!/usr/bin/env node
// Knowledge Is Power relay.
//
// Runs on a computer on the same network as the PS4/PS5. Phones open the page it
// serves; it translates between their WebSocket connection and the console's UDP
// protocol. The console accepts one player per IP address, so every extra phone
// gets its own temporary address on this computer (needs administrator rights).
//
// Usage: node kip-relay.mjs [--port 8080] [--console 192.168.1.50] [--single] [--no-elevate]
//
// GPL-3.0. Protocol knowledge and game assets derived from
// https://github.com/synchrone/reverse-of-power (GPL-3.0).

import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/*@@include shared/qr.js@@*/

const EMBEDDED = /*@@EMBEDDED@@*/ null;

const RELAY_VERSION = '1.0.0';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STATE_FILE = path.join(path.dirname(SCRIPT_PATH), 'kip-relay-state.json');
const SERVER_PORT = 9066;
const CLIENT_PORT = 9060;
const MAX_PLAYERS = 8;
const HISTORY_LIMIT = 400;
const SESSION_IDLE_MS = 30 * 60 * 1000;

// ================================================================ utilities

const args = parseArgs(process.argv.slice(2));
const isWindows = process.platform === 'win32';

function parseArgs(argv) {
  const out = { port: 8080, console: null, single: false, noElevate: false, elevated: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--console') out.console = argv[++i];
    else if (a === '--single') out.single = true;
    else if (a === '--no-elevate') out.noElevate = true;
    else if (a === '--elevated') out.elevated = true;
    else if (a === '--verbose') out.verbose = true;
  }
  return out;
}

function log(...parts) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] ${parts.join(' ')}`);
}
function debug(...parts) {
  if (args.verbose) log(...parts);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
}
function intToIp(n) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}
function sameSubnet(a, b, mask) {
  const m = ipToInt(mask);
  return (ipToInt(a) & m) === (ipToInt(b) & m);
}
function localIPv4s() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask, cidr: a.cidr });
    }
  }
  return out;
}
function hasLocalAddress(ip) {
  return localIPv4s().some((a) => a.address === ip);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { devices: {}, addedAddresses: [] };
  }
}
let relayState = readState();
relayState.devices ||= {};
relayState.addedAddresses ||= [];
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(relayState, null, 2));
  } catch (e) {
    log(`Could not save ${STATE_FILE}: ${e.message}`);
  }
}

function run(cmd, cmdArgs, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, cmdArgs, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

// ================================================================ protocol codec

const MAGIC = {
  packetKip: Buffer.from([0xae, 0x7f]),
  packetDecades: Buffer.from([0xc1, 0x48]),
  bodyKip: Buffer.from([0x33, 0x29]),
  bodyDecades: Buffer.from([0xa3, 0xd3]),
  uidKip: Buffer.from([0x0c, 0x89, 0xe8, 0x84, 0x61, 0x03, 0xf4]),
  uidDecades: Buffer.from([0xaf, 0xe4, 0x87, 0x3d, 0x82, 0xed, 0x6c]),
  ack: Buffer.from([0x8a, 0x33]),
};
const TYPE_JSON = -7503;
const TYPE_MULTIJSON = -297790844;
const TYPE_JPEG = -520103681;
const FRAGMENT_SIZE = 1002;

function int32le(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0);
  return b;
}

const codec = {
  connectionRequest() {
    return Buffer.concat([MAGIC.ack, int32le(-1), Buffer.alloc(32)]);
  },
  ack(messageId) {
    return Buffer.concat([MAGIC.ack, int32le(messageId), Buffer.alloc(32)]);
  },
  deviceUid(uid, decades) {
    const uidBytes = Buffer.from(uid, 'utf8');
    return Buffer.concat([decades ? MAGIC.uidDecades : MAGIC.uidKip, Buffer.from([0x63]), int32le(uidBytes.length), uidBytes]);
  },
  chunk(body, messageId, decades) {
    const total = Math.max(1, Math.ceil(body.length / FRAGMENT_SIZE));
    const packets = [];
    for (let i = 0, offset = 0; i < total; i++) {
      const part = body.subarray(i * FRAGMENT_SIZE, Math.min((i + 1) * FRAGMENT_SIZE, body.length));
      packets.push(Buffer.concat([
        decades ? MAGIC.packetDecades : MAGIC.packetKip,
        int32le(messageId), int32le(total), int32le(i), int32le(part.length), int32le(offset), part,
      ]));
      offset += part.length;
    }
    return packets;
  },
  jsonBody(obj, decades) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    return Buffer.concat([decades ? MAGIC.bodyDecades : MAGIC.bodyKip, int32le(TYPE_JSON), int32le(json.length), json]);
  },
  imageBody(jpeg, transferId, decades) {
    return Buffer.concat([decades ? MAGIC.bodyDecades : MAGIC.bodyKip, int32le(transferId), int32le(jpeg.length), jpeg]);
  },
};

// Parses one UDP datagram. Fragments are collected in `fragments` (Map) until complete.
function decodePacket(data, fragments) {
  if (data.length < 8) return { kind: 'short' };
  const m16 = (data[0] << 8) | data[1];
  if (data.length === 8 && m16 === 0x4edd) return { kind: 'uidAck' };
  if (m16 === 0x8a33) {
    const id = data.readInt32LE(2);
    if (id === -1) return { kind: 'connectionInit' };
    const nack = data.subarray(6).some((b) => b !== 0);
    return { kind: nack ? 'nack' : 'ack', id };
  }
  if (m16 !== 0xae7f && m16 !== 0xc148) return { kind: 'unknown' };
  if (data.length < 22) return { kind: 'short' };
  const id = data.readInt32LE(2);
  const total = data.readInt32LE(6);
  const idx = data.readInt32LE(10);
  const payload = data.subarray(22);
  if (total <= 1) return { kind: 'data', id, ...decodeBody(payload) };
  if (!fragments.has(id)) fragments.set(id, { parts: new Map(), at: Date.now() });
  const entry = fragments.get(id);
  entry.parts.set(idx, payload);
  if (entry.parts.size < total) return { kind: 'fragment', id };
  fragments.delete(id);
  const whole = Buffer.concat([...Array(total).keys()].map((i) => entry.parts.get(i) || Buffer.alloc(0)));
  return { kind: 'data', id, ...decodeBody(whole) };
}

function decodeBody(body) {
  if (body.length < 10) return { messages: [] };
  let pos = 2;
  let type = body.readInt32LE(pos); pos += 4;
  const length = body.readInt32LE(pos); pos += 4;
  let transferId = -1;
  if (type > 0) {
    transferId = type;
    if (body.length < pos + 4) return { messages: [] };
    type = body.readInt32LE(pos);
  } else if (type === TYPE_JSON) {
    return { messages: parseJson(body.subarray(pos, pos + length)) };
  }
  if (transferId > 0 && type === TYPE_JPEG) return { messages: [], jpeg: body.subarray(pos), transferId };
  if (type === TYPE_MULTIJSON) {
    if (transferId > 0) pos += 4;
    const messages = [];
    while (pos + 8 <= body.length) {
      const docLen = body.readInt32LE(pos);
      const docType = body.readInt32LE(pos + 4);
      if (docLen <= 0 || pos + 8 + docLen > body.length) break;
      if (docType === TYPE_JSON) messages.push(...parseJson(body.subarray(pos + 8, pos + 8 + docLen)));
      pos += 8 + docLen;
    }
    return { messages };
  }
  if (transferId > 0) return { messages: [], jpeg: body.subarray(pos), transferId };
  return { messages: [], unknownType: type };
}

function parseJson(buf) {
  try {
    const obj = JSON.parse(buf.toString('utf8'));
    return obj && typeof obj.TypeString === 'string' ? [obj] : [];
  } catch {
    return [];
  }
}

const shortType = (t) => String(t).replace(/^.*\./, '');

// The console expects a JFIF JPEG (FFD8 FFE0). Some phone encoders write Exif or
// no APP0 segment, so insert a minimal JFIF header when it is missing.
function ensureJfif(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) return jpeg;
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([jpeg.subarray(0, 2), app0, jpeg.subarray(2)]);
}

// ================================================================ console discovery

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const a of localIPv4s()) {
    out.add(intToIp((ipToInt(a.address) & ipToInt(a.netmask)) | (~ipToInt(a.netmask) >>> 0)));
  }
  return [...out];
}

async function discoverConsoles(timeoutMs = 2500) {
  const sock = dgram.createSocket('udp4');
  const found = new Map();
  sock.on('error', () => {});
  sock.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (!text.startsWith('HTTP/')) return;
    const headers = {};
    for (const line of text.split('\n').slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const status = Number(text.split(' ')[1]);
    found.set(rinfo.address, {
      ip: rinfo.address,
      name: headers['host-name'] || headers['host-type'] || 'PlayStation',
      type: headers['host-type'] || 'PS',
      awake: status === 200,
    });
  });
  try {
    await new Promise((resolve, reject) => { sock.once('error', reject); sock.bind(0, resolve); });
    sock.setBroadcast(true);
    for (const addr of broadcastAddresses()) {
      sock.send(Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00020020\n'), 987, addr);
      sock.send(Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n'), 9302, addr);
    }
    await sleep(timeoutMs);
  } catch (e) {
    log(`Console search failed: ${e.message}`);
  } finally {
    try { sock.close(); } catch { /* closed */ }
  }
  return [...found.values()];
}

let knownConsoles = [];
async function refreshConsoles() {
  if (args.console) {
    knownConsoles = [{ ip: args.console, name: 'PlayStation', type: 'PS', awake: true }];
    return knownConsoles;
  }
  knownConsoles = await discoverConsoles();
  return knownConsoles;
}

// ================================================================ address pool

// One local IPv4 address per player. Slot 0 is the computer's own address; the
// others are temporary addresses added to the same adapter and removed on exit.
const pool = {
  isAdmin: false,
  multiEnabled: false,
  iface: null, // { name, address, netmask }
  inUse: new Map(), // ip -> deviceUid
  added: new Set(),
  coexistenceWasDisabled: false,
  lock: Promise.resolve(),

  async init() {
    this.isAdmin = await checkAdmin();
    this.multiEnabled = this.isAdmin && !args.single;
    await this.cleanupStale();
  },

  ifaceFor(consoleIp) {
    return localIPv4s().find((a) => sameSubnet(a.address, consoleIp, a.netmask) && !this.added.has(a.address)) || null;
  },

  // Serialised so two phones joining at once never pick the same address.
  acquire(deviceUid, consoleIp) {
    const next = this.lock.then(() => this.acquireUnlocked(deviceUid, consoleIp));
    this.lock = next.catch(() => {});
    return next;
  },

  async acquireUnlocked(deviceUid, consoleIp) {
    const iface = this.ifaceFor(consoleIp);
    if (!iface) throw new Error(`This computer has no network address on the same network as the console (${consoleIp}).`);
    this.iface = iface;
    for (const [ip, owner] of this.inUse) if (owner === deviceUid) return ip;
    const remembered = relayState.devices[deviceUid]?.ip;
    if (remembered && !this.inUse.has(remembered) && (remembered === iface.address || hasLocalAddress(remembered))) {
      this.inUse.set(remembered, deviceUid);
      return remembered;
    }
    if (!this.inUse.has(iface.address)) {
      this.inUse.set(iface.address, deviceUid);
      return iface.address;
    }
    if (!this.multiEnabled) {
      throw new Error(this.isAdmin
        ? 'Only one phone can play: the relay was started with --single.'
        : 'Only one phone can play because the relay is not running as administrator. Restart it and accept the administrator prompt to allow more players.');
    }
    if (this.inUse.size >= MAX_PLAYERS) throw new Error(`All ${MAX_PLAYERS} player slots are taken.`);
    for (const ip of this.added) {
      if (!this.inUse.has(ip)) {
        this.inUse.set(ip, deviceUid);
        return ip;
      }
    }
    const ip = await this.addAddress(iface);
    this.inUse.set(ip, deviceUid);
    return ip;
  },

  release(ip) {
    this.inUse.delete(ip);
  },

  candidates(iface) {
    const base = ipToInt(iface.address) & ipToInt(iface.netmask);
    const broadcast = base | (~ipToInt(iface.netmask) >>> 0);
    const out = [];
    for (let host = 240; host >= 200; host--) {
      const n = (base + host) >>> 0;
      if (n >= broadcast || n === base) continue;
      const ip = intToIp(n);
      if (ip !== iface.address && !this.added.has(ip)) out.push(ip);
    }
    return out;
  },

  async addAddress(iface) {
    for (const ip of this.candidates(iface)) {
      if (await addressTaken(ip)) {
        debug(`${ip} is in use on the network, skipping`);
        continue;
      }
      log(`Adding temporary address ${ip} to "${iface.name}" for another player`);
      const ok = await addLocalAddress(iface, ip);
      if (!ok) continue;
      this.added.add(ip);
      relayState.addedAddresses = [...new Set([...relayState.addedAddresses, `${iface.name}|${ip}`])];
      saveState();
      if (!(await waitFor(() => hasLocalAddress(ip), 5000))) {
        log(`  ${ip} did not appear on the adapter; skipping it`);
        continue;
      }
      if (!(await waitFor(() => hasLocalAddress(iface.address), 3000))) {
        log(`  !! Adding ${ip} removed this computer's own address ${iface.address}. Rolling back.`);
        await restoreAdapter(iface, ip);
        this.multiEnabled = false;
        throw new Error('Adding a player address disturbed this computer\'s network settings, so the relay undid it. Only one phone can play.');
      }
      await sleep(300);
      return ip;
    }
    throw new Error('No free network address was found for another player.');
  },

  async cleanupStale() {
    const stale = relayState.addedAddresses || [];
    if (!stale.length || !this.isAdmin) return;
    for (const entry of stale) {
      const [name, ip] = entry.split('|');
      if (hasLocalAddress(ip)) {
        log(`Removing address ${ip} left over from a previous run`);
        await removeLocalAddress(name, ip);
      }
    }
    relayState.addedAddresses = [];
    saveState();
  },

  removeAllSync() {
    for (const ip of this.added) {
      const name = this.iface?.name;
      if (!name) continue;
      try {
        if (isWindows) execFileSync('netsh', ['interface', 'ipv4', 'delete', 'address', name, ip], { windowsHide: true, stdio: 'ignore' });
        else if (process.platform === 'darwin') execFileSync('ifconfig', [name, '-alias', ip], { stdio: 'ignore' });
        else execFileSync('ip', ['-4', 'addr', 'del', `${ip}/${maskToPrefix(this.iface.netmask)}`, 'dev', name], { stdio: 'ignore' });
      } catch { /* already gone */ }
    }
    if (isWindows && this.coexistenceWasDisabled && this.iface) {
      try {
        execFileSync('netsh', ['interface', 'ipv4', 'set', 'interface', this.iface.name, 'dhcpstaticipcoexistence=disabled'], { windowsHide: true, stdio: 'ignore' });
      } catch { /* leave enabled */ }
    }
    if (this.added.size) {
      relayState.addedAddresses = [];
      saveState();
    }
    this.added.clear();
  },
};

function maskToPrefix(mask) {
  return ipToInt(mask).toString(2).replace(/0/g, '').length;
}

async function waitFor(predicate, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(150);
  }
  return predicate();
}

async function checkAdmin() {
  if (isWindows) return (await run('net', ['session'], 5000)).ok;
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

async function addressTaken(ip) {
  const pingArgs = isWindows ? ['-n', '1', '-w', '500', ip] : ['-c', '1', '-W', '1', ip];
  const ping = await run('ping', pingArgs, 4000);
  if (ping.ok && /ttl[=:]/i.test(ping.out)) return true;
  const arp = await run('arp', isWindows ? ['-a', ip] : ['-n', ip], 4000);
  const macMatch = arp.out.match(/([0-9a-f]{1,2}[-:]){5}[0-9a-f]{1,2}/i);
  return Boolean(macMatch && !/^(ff[-:]){5}ff$/i.test(macMatch[0]) && arp.out.includes(ip));
}

async function addLocalAddress(iface, ip) {
  if (isWindows) {
    const show = await run('netsh', ['interface', 'ipv4', 'show', 'interface', iface.name]);
    const coexist = show.out.match(/coexistence\s*:\s*(\w+)/i);
    if (coexist && /disabled/i.test(coexist[1])) pool.coexistenceWasDisabled = true;
    // Without coexistence, adding a fixed address to a DHCP adapter switches DHCP
    // off and drops the computer's own address.
    const set = await run('netsh', ['interface', 'ipv4', 'set', 'interface', iface.name, 'dhcpstaticipcoexistence=enabled']);
    if (!set.ok) {
      log(`  Could not enable DHCP/static coexistence on "${iface.name}": ${set.out.trim()}`);
      return false;
    }
    const add = await run('netsh', ['interface', 'ipv4', 'add', 'address', iface.name, ip, iface.netmask, 'store=active', 'skipassource=true']);
    if (!add.ok) log(`  Could not add ${ip}: ${add.out.trim()}`);
    return add.ok;
  }
  if (process.platform === 'darwin') {
    const r = await run('ifconfig', [iface.name, 'alias', ip, iface.netmask]);
    if (!r.ok) log(`  Could not add ${ip}: ${r.out.trim()}`);
    return r.ok;
  }
  const r = await run('ip', ['-4', 'addr', 'add', `${ip}/${maskToPrefix(iface.netmask)}`, 'dev', iface.name]);
  if (!r.ok) log(`  Could not add ${ip}: ${r.out.trim()}`);
  return r.ok;
}

async function removeLocalAddress(name, ip) {
  if (isWindows) return run('netsh', ['interface', 'ipv4', 'delete', 'address', name, ip]);
  if (process.platform === 'darwin') return run('ifconfig', [name, '-alias', ip]);
  const iface = localIPv4s().find((a) => a.address === ip);
  return run('ip', ['-4', 'addr', 'del', `${ip}/${iface ? maskToPrefix(iface.netmask) : 24}`, 'dev', name]);
}

async function restoreAdapter(iface, ip) {
  await removeLocalAddress(iface.name, ip);
  pool.added.delete(ip);
  if (isWindows) {
    await run('netsh', ['interface', 'ipv4', 'set', 'address', iface.name, 'source=dhcp']);
    await run('netsh', ['interface', 'ipv4', 'set', 'dnsservers', iface.name, 'source=dhcp']);
  }
}

// ================================================================ console session

// One UDP session with the console per phone. It outlives the phone's WebSocket so
// a phone that locks its screen or reloads the page stays in the game.
class ConsoleSession {
  constructor({ deviceUid, consoleIp, localIp, device }) {
    this.deviceUid = deviceUid;
    this.consoleIp = consoleIp;
    this.localIp = localIp;
    this.device = device;
    this.state = 'connecting';
    this.error = null;
    this.decades = false;
    this.counter = 0;
    this.lastRcvId = null;
    this.seenIds = new Set();
    this.fragments = new Map();
    this.unacked = new Map();
    this.history = [];
    this.images = new Map();
    this.ownImageGuids = new Set();
    this.pendingImageControls = new Map();
    this.pendingImages = new Map();
    this.receivedResources = new Set();
    this.pendingResources = new Map();
    this.pendingRequirements = null;
    this.client = null;
    this.lastClientAt = Date.now();
    this.uidAcks = 0;
    this.connectStartedAt = Date.now();
    this.playerId = null;
    this.slotId = null;
    this.sid = crypto.randomBytes(4).toString('hex');
    this.seq = 0;
  }

  async start() {
    this.sendSock = dgram.createSocket('udp4');
    this.recvSock = dgram.createSocket('udp4');
    this.sendSock.on('error', (e) => log(`[${this.tag()}] send socket error: ${e.message}`));
    this.recvSock.on('error', (e) => this.fail(`Could not listen on ${this.localIp}:${CLIENT_PORT} (${e.code}). Is another copy of the relay or the probe running?`));
    this.recvSock.on('message', (msg, rinfo) => {
      if (rinfo.address === this.consoleIp) this.onPacket(msg);
    });
    await new Promise((resolve, reject) => {
      this.recvSock.once('error', reject);
      this.recvSock.bind(CLIENT_PORT, this.localIp, resolve);
    });
    await new Promise((resolve) => this.sendSock.bind(0, this.localIp, resolve));
    log(`[${this.tag()}] connecting to ${this.consoleIp} from ${this.localIp}`);
    this.timer = setInterval(() => this.tick(), 1000);
    this.retransmitTimer = setInterval(() => this.retransmit(), 250);
    this.tick();
  }

  tag() {
    return this.device?.name ? `${this.device.name}@${this.localIp}` : this.localIp;
  }

  tick() {
    if (this.state === 'closed') return;
    if (this.lastRcvId === null) {
      this.raw(codec.connectionRequest());
      this.raw(codec.deviceUid(this.deviceUid, false));
      this.raw(codec.deviceUid(this.deviceUid, true));
      const waited = Date.now() - this.connectStartedAt;
      if (waited > 10000 && this.state === 'connecting') {
        this.fail(this.uidAcks > 0
          ? 'The console still holds an earlier connection from this address. Wait a minute, or leave and reopen the join screen on the TV, then try again.'
          : 'The console did not answer. Make sure the game is open on the TV and the PS4 is on this Wi-Fi network.');
      }
    } else {
      this.raw(codec.ack(this.lastRcvId));
    }
    this.retryResources();
    for (const [id, entry] of this.fragments) if (Date.now() - entry.at > 15000) this.fragments.delete(id);
  }

  raw(buf) {
    if (this.state === 'closed') return;
    this.sendSock.send(buf, SERVER_PORT, this.consoleIp);
  }

  sendBody(body) {
    const id = ++this.counter;
    const packets = codec.chunk(body, id, this.decades);
    packets.forEach((p) => this.raw(p));
    this.unacked.set(id, { packets, sentAt: Date.now(), tries: 1 });
    return id;
  }

  sendMessage(obj, fromPhone = false) {
    debug(`[${this.tag()}] > ${shortType(obj.TypeString)}`);
    this.sendBody(codec.jsonBody(obj, this.decades));
    this.record({ dir: 'out', m: obj, auto: !fromPhone });
  }

  sendImage(jpeg, guid, transferId, imgType = 2) {
    const fixed = ensureJfif(jpeg);
    this.images.set(guid, fixed);
    this.ownImageGuids.add(guid);
    this.sendMessage({ TypeString: 'ClientImageResourceContentTransferMessage', TransferID: transferId, ImageGUID: guid, ImgType: imgType });
    this.sendBody(codec.imageBody(fixed, transferId, this.decades));
    debug(`[${this.tag()}] > image ${guid} (${fixed.length} bytes, transfer ${transferId})`);
  }

  // Unacknowledged messages are resent with the same message ID. Acknowledgements
  // are treated as cumulative: the console repeats the last ID it received.
  retransmit() {
    const now = Date.now();
    for (const [id, entry] of this.unacked) {
      if (now - entry.sentAt < 700) continue;
      if (entry.tries >= 10) {
        this.unacked.delete(id);
        log(`[${this.tag()}] message ${id} was never acknowledged`);
        continue;
      }
      entry.packets.forEach((p) => this.raw(p));
      entry.sentAt = now;
      entry.tries++;
    }
  }

  onAck(id) {
    for (const key of this.unacked.keys()) if (key <= id) this.unacked.delete(key);
  }

  onPacket(data) {
    const decoded = decodePacket(data, this.fragments);
    switch (decoded.kind) {
      case 'connectionInit':
        if (this.state === 'connecting') debug(`[${this.tag()}] connection accepted`);
        return;
      case 'uidAck':
        this.uidAcks++;
        return;
      case 'ack':
        this.onAck(decoded.id);
        return;
      case 'nack':
        debug(`[${this.tag()}] NACK ${decoded.id}`);
        return;
      case 'data':
        this.onData(decoded);
        return;
      default:
        return;
    }
  }

  onData(decoded) {
    this.raw(codec.ack(decoded.id));
    const isNewSession = decoded.messages.some((m) => m.TypeString === 'InterfaceVersionMessage');
    if (isNewSession) {
      this.seenIds.clear();
      this.unacked.clear();
    }
    if (this.seenIds.has(decoded.id)) return;
    this.seenIds.add(decoded.id);
    if (this.seenIds.size > 5000) this.seenIds = new Set([...this.seenIds].slice(-2000));
    this.lastRcvId = decoded.id;

    if (decoded.jpeg) {
      this.onImageData(decoded.transferId, Buffer.from(decoded.jpeg));
      return;
    }
    for (const msg of decoded.messages) {
      debug(`[${this.tag()}] < ${shortType(msg.TypeString)}`);
      if (msg.TypeString === 'ImageResourceContentTransferMessage') {
        this.onImageControl(msg);
        continue;
      }
      this.handleProtocol(msg);
      this.record({ dir: 'in', m: msg });
    }
  }

  handleProtocol(msg) {
    const type = shortType(msg.TypeString);
    switch (type) {
      case 'InterfaceVersionMessage':
        this.decades = String(msg.InterfaceVersion).startsWith('KIP2_');
        this.history = [];
        this.setState('connected');
        log(`[${this.tag()}] joined ${this.decades ? 'Knowledge is Power: Decades' : 'Knowledge is Power'} (${msg.InterfaceVersion})`);
        break;
      case 'SessionStateMessage':
        this.sendMessage({ TypeString: 'ClientRequestPlayerIDMessage', UID: this.deviceUid });
        break;
      case 'AssignPlayerIDAndSlotMessage':
        this.playerId = msg.PlayerID;
        this.slotId = msg.SlotID;
        this.sendMessage({
          TypeString: 'DeviceInfoMessage', Response: 10, DeviceSize: 2, DeviceOS: 1,
          DeviceModel: this.device?.model || 'Web phone', DeviceType: 'Handheld', DeviceUID: this.deviceUid,
          DeviceOperatingSystem: this.device?.os || 'Web',
        });
        this.sendMessage({ TypeString: 'KnowledgeIsPower.ClientRequestAvatarStatusMessage' });
        break;
      case 'ResourceRequirementsMessage':
        this.onResourceRequirements(msg.Requirements || []);
        break;
      case 'RequestResourceMessage':
        this.onResourceRequested(msg.ResourceGUID);
        break;
      case 'ServerRequestEndOfGameFactCount':
        this.sendMessage({ TypeString: 'KnowledgeIsPower.ClientEndOfGameFactCount', FactCount: this.device?.factCount || 63 });
        break;
      case 'ServerRequestPowerPlayChoice':
      case 'ServerRequestCategorySelectChoice':
      case 'ServerStopCategorySelectOverride':
        if (!this.phoneReachable()) this.answerForAbsentPhone(type);
        break;
      default:
        break;
    }
  }

  // A phone whose socket has been silent past two heartbeats is treated as gone.
  phoneReachable() {
    return !!this.client && Date.now() - (this.client.lastMsgAt || 0) < 20000;
  }

  sentSince(type, sinceType) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      const t = shortType(h.m.TypeString);
      if (h.dir === 'out' && t === type) return h.m;
      if (h.dir === 'in' && t === sinceType) return null;
    }
    return null;
  }

  // The console waits on these replies before it moves on, so a phone that is
  // offline at that moment would stall the whole room.
  answerForAbsentPhone(type) {
    log(`[${this.tag()}] phone is offline, answering ${type} for it`);
    if (type === 'ServerRequestPowerPlayChoice') {
      if (this.sentSince('ClientPowerPlayChoice', 'ServerBeginPowerPlayPhase')) return;
      this.sendMessage({ TypeString: 'KnowledgeIsPower.ClientPowerPlayChoice', PowerPlaySlotIndex: -1, TargetSlotIndex: [] });
    } else if (type === 'ServerRequestCategorySelectChoice') {
      const prior = this.sentSince('ClientCategorySelectChoice', 'ServerCategorySelectChoices');
      this.sendMessage({ TypeString: 'KnowledgeIsPower.ClientCategorySelectChoice', ChosenCategoryIndex: prior ? prior.ChosenCategoryIndex : -1 });
    } else {
      const sent = !!this.sentSince('ClientCategorySelectOverride', 'ServerBeginCategorySelectOverride');
      this.sendMessage({ TypeString: 'KnowledgeIsPower.ClientStopCategorySelectOverrideResponse', OverrideSent: sent });
    }
  }

  // The console lists images (player photos) the phone must hold. Request the
  // missing ones, re-request any that do not arrive, and confirm once with the full
  // list when everything is in.
  onResourceRequirements(requirements) {
    const missing = requirements.filter((r) => !this.receivedResources.has(r.GUID) && !this.images.has(r.GUID));
    if (!missing.length) {
      this.sendMessage({ TypeString: 'AllResourcesReceivedMessage', Requirements: requirements });
      return;
    }
    this.pendingRequirements = requirements;
    for (const r of missing) {
      this.pendingResources.set(r.GUID, Date.now());
      this.sendMessage({ TypeString: 'RequestResourceMessage', ResourceGUID: r.GUID });
    }
  }

  retryResources() {
    const now = Date.now();
    for (const [guid, at] of this.pendingResources) {
      if (now - at < 5000) continue;
      this.pendingResources.set(guid, now);
      debug(`[${this.tag()}] re-requesting image ${guid}`);
      this.sendMessage({ TypeString: 'RequestResourceMessage', ResourceGUID: guid });
    }
  }

  onResourceRequested(guid) {
    const jpeg = this.images.get(guid);
    if (!jpeg || !this.ownImageGuids.has(guid)) return;
    log(`[${this.tag()}] console asked for this player's photo again, resending`);
    this.sendImage(jpeg, guid, 1000 + Math.floor(Math.random() * 50000));
  }

  onImageControl(msg) {
    const jpeg = this.pendingImages.get(msg.TransferID);
    if (jpeg) {
      this.pendingImages.delete(msg.TransferID);
      this.imageComplete(msg.ImageGUID, jpeg);
    } else {
      this.pendingImageControls.set(msg.TransferID, msg.ImageGUID);
    }
  }

  onImageData(transferId, jpeg) {
    const guid = this.pendingImageControls.get(transferId);
    if (guid) {
      this.pendingImageControls.delete(transferId);
      this.imageComplete(guid, jpeg);
    } else {
      this.pendingImages.set(transferId, jpeg);
    }
  }

  imageComplete(guid, jpeg) {
    this.images.set(guid, jpeg);
    this.receivedResources.add(guid);
    this.pendingResources.delete(guid);
    this.toClient({ op: 'image', guid, data: jpeg.toString('base64') });
    if (this.pendingRequirements && this.pendingResources.size === 0) {
      const requirements = this.pendingRequirements;
      this.pendingRequirements = null;
      this.sendMessage({ TypeString: 'AllResourcesReceivedMessage', Requirements: requirements });
    }
  }

  record(entry) {
    const item = { ...entry, t: Date.now(), seq: ++this.seq };
    this.history.push(item);
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    if (entry.dir === 'in' || entry.auto) this.toClient({ op: 'msg', dir: entry.dir, m: entry.m, age: 0, seq: item.seq });
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.toClient(this.statusMessage());
  }

  statusMessage() {
    return {
      op: 'status', state: this.state, error: this.error, decades: this.decades,
      consoleIp: this.consoleIp, localIp: this.localIp, playerId: this.playerId, slotId: this.slotId, sid: this.sid,
    };
  }

  attach(client) {
    if (this.client && this.client !== client) this.client.close(4000, 'replaced');
    this.client = client;
    this.lastClientAt = Date.now();
    const now = Date.now();
    client.sendJson({ ...this.statusMessage(), replay: true });
    client.sendJson({ op: 'replayStart', count: this.history.length });
    for (const [guid, jpeg] of this.images) client.sendJson({ op: 'image', guid, data: jpeg.toString('base64') });
    for (const h of this.history) client.sendJson({ op: 'msg', dir: h.dir, m: h.m, age: now - h.t, seq: h.seq, replay: true });
    client.sendJson({ op: 'replayEnd' });
  }

  detach(client) {
    if (this.client === client) {
      this.client = null;
      this.lastClientAt = Date.now();
    }
  }

  toClient(obj) {
    if (this.client) this.client.sendJson(obj);
  }

  fail(error) {
    log(`[${this.tag()}] ${error}`);
    this.setState('failed', error);
    this.close();
  }

  close() {
    if (this.state !== 'failed') this.state = 'closed';
    clearInterval(this.timer);
    clearInterval(this.retransmitTimer);
    try { this.sendSock?.close(); } catch { /* closed */ }
    try { this.recvSock?.close(); } catch { /* closed */ }
    pool.release(this.localIp);
    sessions.delete(this.deviceUid);
  }
}

const sessions = new Map(); // deviceUid -> ConsoleSession

setInterval(() => {
  for (const s of sessions.values()) {
    if (!s.client && Date.now() - s.lastClientAt > SESSION_IDLE_MS) {
      log(`[${s.tag()}] phone gone for 30 minutes, leaving the game`);
      s.close();
    }
  }
}, 60000);

// ================================================================ WebSocket server

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    this.lastPong = Date.now();
    this.onMessage = () => {};
    this.onClose = () => {};
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > 45000) return this.close(1001, 'timeout');
      this.frame(0x9, Buffer.alloc(0));
    }, 15000);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      let len = b1 & 0x7f;
      let pos = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        pos = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        pos = 10;
      }
      if (len > 8 * 1024 * 1024) return this.close(1009, 'too big');
      const masked = (b1 & 0x80) !== 0;
      const maskLen = masked ? 4 : 0;
      if (this.buffer.length < pos + maskLen + len) return;
      const mask = masked ? this.buffer.subarray(pos, pos + 4) : null;
      const payload = Buffer.from(this.buffer.subarray(pos + maskLen, pos + maskLen + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(pos + maskLen + len);
      this.onFrame(b0 & 0x80, b0 & 0x0f, payload);
    }
  }

  onFrame(fin, opcode, payload) {
    if (opcode === 0x8) return this.close(1000, '');
    if (opcode === 0x9) return this.frame(0xa, payload);
    if (opcode === 0xa) { this.lastPong = Date.now(); return; }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      this.fragments.push(payload);
      if (!fin) return;
      const whole = Buffer.concat(this.fragments);
      this.fragments = [];
      this.lastPong = Date.now();
      let parsed;
      try {
        parsed = JSON.parse(whole.toString('utf8'));
      } catch {
        return;
      }
      try {
        this.onMessage(parsed);
      } catch (e) {
        log(`Error handling phone message: ${e.stack || e}`);
      }
    }
  }

  frame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  sendJson(obj) {
    this.frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.frame(0x8, body);
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    this.onClose();
  }
}

function handlePhone(client, remote) {
  let deviceUid = null;
  let session = null;

  client.onClose = () => {
    if (session) session.detach(client);
    debug(`phone ${remote} disconnected`);
  };

  client.onMessage = async (msg) => {
    client.lastMsgAt = Date.now();
    switch (msg.op) {
      case 'hello': {
        deviceUid = String(msg.deviceUid || '').replace(/[^a-f0-9]/gi, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');
        const device = { name: String(msg.name || '').slice(0, 24), model: String(msg.model || 'Web phone').slice(0, 60), os: String(msg.os || 'Web').slice(0, 80), factCount: Number(msg.factCount) || 63 };
        client.device = device;
        relayState.devices[deviceUid] = { ...(relayState.devices[deviceUid] || {}), name: device.name, lastSeen: new Date().toISOString() };
        saveState();
        if (knownConsoles.length === 0) await refreshConsoles();
        client.sendJson({
          op: 'welcome', relayVersion: RELAY_VERSION, consoles: knownConsoles,
          multiPlayer: pool.multiEnabled, playersConnected: sessions.size, maxPlayers: pool.multiEnabled ? MAX_PLAYERS : 1,
          shareUrl: shareUrl(),
        });
        session = sessions.get(deviceUid) || null;
        if (session) {
          session.device = { ...session.device, ...device };
          session.attach(client);
        }
        break;
      }
      case 'discover': {
        await refreshConsoles();
        client.sendJson({ op: 'consoles', consoles: knownConsoles });
        break;
      }
      case 'connect': {
        if (!deviceUid) return;
        if (session && session.state !== 'failed' && session.state !== 'closed') {
          session.attach(client);
          return;
        }
        const consoleIp = msg.consoleIp || knownConsoles.find((c) => c.awake)?.ip || knownConsoles[0]?.ip;
        if (!consoleIp) {
          client.sendJson({ op: 'status', state: 'failed', error: 'No PlayStation found on this network. Turn the console on and open the game.' });
          return;
        }
        client.sendJson({ op: 'status', state: 'connecting', consoleIp });
        let localIp;
        try {
          localIp = await pool.acquire(deviceUid, consoleIp);
        } catch (e) {
          client.sendJson({ op: 'status', state: 'failed', error: e.message });
          return;
        }
        relayState.devices[deviceUid] = { ...(relayState.devices[deviceUid] || {}), ip: localIp };
        saveState();
        session = new ConsoleSession({ deviceUid, consoleIp, localIp, device: client.device });
        sessions.set(deviceUid, session);
        session.client = client;
        try {
          await session.start();
        } catch (e) {
          session.fail(`Could not open the game connection: ${e.message}`);
        }
        break;
      }
      case 'send': {
        if (!session || session.state !== 'connected') return;
        if (!msg.m || typeof msg.m.TypeString !== 'string') return;
        session.sendMessage(msg.m, true);
        break;
      }
      case 'image': {
        if (!session || session.state !== 'connected') return;
        const jpeg = Buffer.from(String(msg.data || ''), 'base64');
        if (jpeg.length < 100) return;
        session.sendImage(jpeg, String(msg.guid), Number(msg.transferId) || 1000, Number(msg.imgType) || 2);
        break;
      }
      case 'leave': {
        if (session) {
          log(`[${session.tag()}] left the game`);
          session.close();
          session = null;
        }
        client.sendJson({ op: 'status', state: 'idle' });
        break;
      }
      case 'ping':
        client.sendJson({ op: 'pong', t: msg.t });
        break;
      default:
        break;
    }
  };
}

// ================================================================ HTTP server

function shareUrl() {
  const ip = pool.iface?.address || preferredLanAddress();
  return ip ? `http://${ip}:${httpPort}/` : null;
}

function preferredLanAddress() {
  const consoleIp = knownConsoles[0]?.ip;
  const all = localIPv4s().filter((a) => !pool.added.has(a.address));
  const onConsoleNet = consoleIp && all.find((a) => sameSubnet(a.address, consoleIp, a.netmask));
  if (onConsoleNet) return onConsoleNet.address;
  const privateLan = all.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address) && !/^172\.(1[6-9]|2\d|3[01])\./.test(a.address));
  return (privateLan || all[0])?.address || null;
}

const MANIFEST = JSON.stringify({
  name: 'Knowledge is Power controller',
  short_name: 'KiP',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'landscape',
  background_color: '#2a1257',
  theme_color: '#2a1257',
  icons: [
    { src: 'icon.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  ],
});

const SERVICE_WORKER = `self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open('kip').then((c) => c.add('./'))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then((r) => { caches.open('kip').then((c) => c.put('./', r.clone())); return r; }).catch(() => caches.match('./')));
});`;

function loadPage() {
  if (EMBEDDED) return { html: EMBEDDED.html, icon: Buffer.from(EMBEDDED.icon, 'base64') };
  const dir = path.dirname(SCRIPT_PATH);
  return { html: fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), icon: Buffer.alloc(0) };
}

let httpPort = args.port;

function startHttp() {
  const page = loadPage();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
      res.end(body);
    };
    switch (url.pathname) {
      case '/':
      case '/index.html':
        return send(200, 'text/html; charset=utf-8', page.html);
      case '/manifest.webmanifest':
        return send(200, 'application/manifest+json', MANIFEST);
      case '/sw.js':
        return send(200, 'text/javascript', SERVICE_WORKER);
      case '/icon.png':
      case '/apple-touch-icon.png':
      case '/apple-touch-icon-precomposed.png':
      case '/favicon.ico':
        return page.icon.length ? send(200, 'image/png', page.icon) : send(404, 'text/plain', 'not found');
      case '/health':
        return send(200, 'application/json', JSON.stringify({ ok: true, version: RELAY_VERSION, players: sessions.size }));
      default:
        return send(404, 'text/plain', 'not found');
    }
  });
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const remote = socket.remoteAddress?.replace('::ffff:', '');
    debug(`phone ${remote} connected`);
    handlePhone(new WsClient(socket), remote);
  });
  return new Promise((resolve) => {
    const tryListen = (port, attemptsLeft) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && attemptsLeft > 0) return tryListen(port + 1, attemptsLeft - 1);
        log(`Could not start the web server: ${e.message}`);
        process.exit(1);
      });
      server.listen(port, '0.0.0.0', () => {
        httpPort = port;
        resolve(server);
      });
    };
    tryListen(httpPort, 10);
  });
}

// ================================================================ startup

function printQr(text) {
  try {
    const { size, modules } = qrEncode(text);
    const quiet = 2;
    const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x];
    const lines = [];
    for (let y = -quiet; y < size + quiet; y += 2) {
      let line = '\x1b[30;47m';
      for (let x = -quiet; x < size + quiet; x++) {
        const top = dark(x, y);
        const bottom = dark(x, y + 1);
        line += top && bottom ? '\u2588' : top ? '\u2580' : bottom ? '\u2584' : ' ';
      }
      lines.push(`  ${line}\x1b[0m`);
    }
    console.log(lines.join('\n'));
  } catch (e) {
    debug(`QR code failed: ${e.message}`);
  }
}

function relaunchElevated() {
  const nodeArgs = [SCRIPT_PATH, ...process.argv.slice(2), '--elevated'];
  const quoted = nodeArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const cwd = process.cwd().replace(/'/g, "''");
  const ps = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList @(${quoted}) -WorkingDirectory '${cwd}' -Verb RunAs`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

async function ensureFirewallRule() {
  if (!isWindows || !pool.isAdmin) return;
  const name = 'Knowledge is Power relay';
  const existing = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`]);
  if (existing.ok && existing.out.includes(process.execPath)) return;
  if (existing.ok) await run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`]);
  const add = await run('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${name}`, 'dir=in', 'action=allow', `program=${process.execPath}`, 'enable=yes', 'profile=private,domain']);
  if (add.ok) log('Allowed the relay through Windows Firewall on private networks.');
}

function installExitHandlers() {
  let exiting = false;
  const cleanup = () => {
    if (exiting) return;
    exiting = true;
    for (const s of sessions.values()) {
      try { s.close(); } catch { /* closing */ }
    }
    pool.removeAllSync();
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => {
      log('Stopping: removing temporary addresses...');
      cleanup();
      process.exit(0);
    });
  }
  process.on('uncaughtException', (e) => {
    log(`Unexpected error: ${e.stack || e}`);
  });
}

async function main() {
  console.log('');
  console.log('  Knowledge is Power relay ' + RELAY_VERSION);
  console.log('  ------------------------------');

  if (isWindows && !args.elevated && !args.noElevate && !args.single && !(await checkAdmin())) {
    log('Asking for administrator rights so several phones can play (one network address per phone)...');
    if (relaunchElevated()) {
      log('The relay continues in the new administrator window. You can close this one.');
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    log('Administrator rights were not granted. Continuing: only one phone can play.');
  }

  installExitHandlers();
  await pool.init();
  await ensureFirewallRule();
  await startHttp();

  log('Looking for the PlayStation...');
  await refreshConsoles();
  if (knownConsoles.length) {
    for (const c of knownConsoles) log(`  found ${c.name} (${c.type}) at ${c.ip}${c.awake ? '' : ' (in rest mode)'}`);
  } else {
    log('  none found yet. Turn on the console and open the game; phones can search again from the page.');
  }

  const url = shareUrl();
  console.log('');
  log(pool.multiEnabled
    ? `Ready for up to ${MAX_PLAYERS} phones.`
    : 'Ready for ONE phone (run as administrator to allow more).');
  console.log('');
  console.log(`  On each phone, join this Wi-Fi and open:  ${url}`);
  console.log('  or scan this code with the phone camera:');
  console.log('');
  if (url) printQr(url);
  console.log('');
  log('Keep this window open while you play. Press Ctrl+C to stop.');

  setInterval(() => {
    if (!sessions.size) refreshConsoles().catch(() => {});
  }, 30000);
}

main().catch((e) => {
  log(`Relay failed to start: ${e.stack || e}`);
  pool.removeAllSync();
  process.exit(1);
});
