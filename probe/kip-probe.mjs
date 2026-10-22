#!/usr/bin/env node
// Knowledge Is Power multi-player-per-IP probe.
//
// Answers one question before the web relay is built: can two players join the
// console from the SAME computer (same IP address)? The console sends replies to
// UDP port 9060 (+ UDPPortOffset?) on the sender's IP, so this decides whether one
// relay computer can serve every phone, or only one.
//
// Usage:  node kip-probe.mjs            (auto-discovers the PS4/PS5)
//         node kip-probe.mjs 192.168.1.50
//         node kip-probe.mjs --second-ip 192.168.1.240   (player B uses a second address of this computer)
// Have the game open on the "join with your phone" screen. No other phones needed.
// Zero dependencies. Writes kip-probe-log.txt next to this file.

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = 9066;
const LISTEN_PORTS = [9060, 9061, 9062, 9063, 9064, 9065, 9067, 9068];
const LOG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kip-probe-log.txt');

const MAGIC = {
  packetKip: [0xae, 0x7f], packetDecades: [0xc1, 0x48],
  bodyKip: [0x33, 0x29], bodyDecades: [0xa3, 0xd3],
  uidKip: [0x0c, 0x89, 0xe8, 0x84, 0x61, 0x03, 0xf4],
  uidDecades: [0xaf, 0xe4, 0x87, 0x3d, 0x82, 0xed, 0x6c],
  ack: [0x8a, 0x33],
};
const TYPE_JSON = -7503;
const TYPE_MULTIJSON = -297790844;
const TYPE_JPEG = -520103681;
const HANDSHAKE_TYPES = new Set([
  'InterfaceVersionMessage', 'SessionStateMessage', 'AssignPlayerIDAndSlotMessage', 'ResourceRequirementsMessage',
]);

const logLines = [];
const t0 = Date.now();
function log(...parts) {
  const line = `[${((Date.now() - t0) / 1000).toFixed(2).padStart(6)}s] ${parts.join(' ')}`;
  console.log(line);
  logLines.push(line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- encoding

function int32le(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}

function encodeConnectionRequest() {
  return Buffer.concat([Buffer.from(MAGIC.ack), int32le(-1), Buffer.alloc(32)]);
}

function encodeAck(messageId) {
  return Buffer.concat([Buffer.from(MAGIC.ack), int32le(messageId), Buffer.alloc(32)]);
}

function encodeDeviceUid(uid, decades) {
  const uidBytes = Buffer.from(uid, 'utf8');
  return Buffer.concat([
    Buffer.from(decades ? MAGIC.uidDecades : MAGIC.uidKip), Buffer.from([0x63]), int32le(uidBytes.length), uidBytes,
  ]);
}

function encodeJsonMessage(session, obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const body = Buffer.concat([
    Buffer.from(session.decades ? MAGIC.bodyDecades : MAGIC.bodyKip), int32le(TYPE_JSON), int32le(json.length), json,
  ]);
  const messageId = ++session.counter;
  const total = Math.ceil(body.length / 1002);
  const packets = [];
  for (let i = 0, offset = 0; i < total; i++) {
    const chunk = body.subarray(i * 1002, Math.min((i + 1) * 1002, body.length));
    packets.push(Buffer.concat([
      Buffer.from(session.decades ? MAGIC.packetDecades : MAGIC.packetKip),
      int32le(messageId), int32le(total), int32le(i), int32le(chunk.length), int32le(offset), chunk,
    ]));
    offset += chunk.length;
  }
  return packets;
}

// ---------------------------------------------------------------- decoding

const fragments = new Map(); // `${port}:${messageId}` -> Map(idx -> Buffer)

function decodePacket(port, data) {
  if (data.length < 8) return { kind: 'short' };
  const m16 = (data[0] << 8) | data[1];
  if (data.length === 8 && m16 === 0x4edd) return { kind: 'uidAck' };
  if (m16 === 0x8a33) {
    const id = data.readInt32LE(2);
    if (id === -1) return { kind: 'connectionInit' };
    const nack = data.subarray(6).some((b) => b !== 0);
    return { kind: nack ? 'nack' : 'ack', id };
  }
  if (m16 !== 0xae7f && m16 !== 0xc148) return { kind: 'unknown', hex: data.subarray(0, 16).toString('hex') };
  if (data.length < 22) return { kind: 'short' };
  const id = data.readInt32LE(2);
  const total = data.readInt32LE(6);
  const idx = data.readInt32LE(10);
  const payload = data.subarray(22);
  if (total <= 1) return { kind: 'data', id, ...decodeBody(payload) };
  const key = `${port}:${id}`;
  if (!fragments.has(key)) fragments.set(key, new Map());
  const parts = fragments.get(key);
  parts.set(idx, payload);
  if (parts.size < total) return { kind: 'fragment', id, idx, total };
  fragments.delete(key);
  const whole = Buffer.concat([...Array(total).keys()].map((i) => parts.get(i)));
  return { kind: 'data', id, ...decodeBody(whole) };
}

function decodeBody(body) {
  let pos = 2;
  let type = body.readInt32LE(pos); pos += 4;
  const length = body.readInt32LE(pos); pos += 4;
  if (type > 0) { type = body.readInt32LE(pos); pos += 4; }
  if (type === TYPE_JPEG) return { messages: [], jpeg: true };
  if (type === TYPE_JSON) return { messages: parseJson(body.subarray(pos, pos + length)) };
  if (type === TYPE_MULTIJSON) {
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
  return { messages: [], unknownType: type };
}

function parseJson(buf) {
  try {
    const obj = JSON.parse(buf.toString('utf8'));
    return obj && obj.TypeString ? [obj] : [];
  } catch {
    return [];
  }
}

const shortType = (t) => t.replace(/^KnowledgeIsPower\./, '');

// ---------------------------------------------------------------- discovery

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

async function discoverConsole() {
  const sock = dgram.createSocket('udp4');
  const found = new Map();
  sock.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (!text.startsWith('HTTP/')) return;
    const headers = Object.fromEntries(text.split('\n').slice(1)
      .map((l) => l.split(':')).filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k.trim().toLowerCase(), v.join(':').trim()]));
    found.set(rinfo.address, `${headers['host-name'] || '?'} (${headers['host-type'] || '?'}, status ${text.split(' ')[1]})`);
  });
  await new Promise((r) => sock.bind(0, r));
  sock.setBroadcast(true);
  for (const addr of broadcastAddresses()) {
    sock.send(Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00020020\n'), 987, addr);
    sock.send(Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n'), 9302, addr);
  }
  await sleep(3000);
  sock.close();
  return found;
}

// ---------------------------------------------------------------- sessions

function newSession(name, consoleIp, localIp) {
  const sock = dgram.createSocket('udp4');
  return {
    name, consoleIp, localIp, sock, counter: 0, decades: false,
    // Stable per address so a quick re-run looks like the same device rejoining;
    // the console keeps a dropped player's session alive for a while.
    uid: crypto.createHash('md5').update(`kip-probe|${os.hostname()}|${localIp || 'default'}|${name}`).digest('hex'),
    connected: false, lastRcvId: null, playerId: null, slotId: null, portOffset: null,
    ports: new Set(), kicked: false,
  };
}

function send(session, buf) {
  session.sock.send(buf, SERVER_PORT, session.consoleIp);
}

function sendMessage(session, obj) {
  log(`  ${session.name} > ${shortType(obj.TypeString)}`);
  encodeJsonMessage(session, obj).forEach((p) => send(session, p));
}

async function startSession(session) {
  await new Promise((r) => session.sock.bind(0, session.localIp, r));
  const { address, port } = session.sock.address();
  log(`${session.name}: sending from ${address}:${port}, UID ${session.uid}`);
  session.timer = setInterval(() => {
    if (session.lastRcvId === null) {
      send(session, encodeConnectionRequest());
      send(session, encodeDeviceUid(session.uid, false));
      send(session, encodeDeviceUid(session.uid, true));
    } else {
      send(session, encodeAck(session.lastRcvId));
    }
  }, 1000);
}

function handleMessage(session, msg) {
  const type = shortType(msg.TypeString);
  switch (type) {
    case 'InterfaceVersionMessage':
      session.decades = String(msg.InterfaceVersion).startsWith('KIP2_');
      log(`  ${session.name}: game version ${msg.InterfaceVersion}${session.decades ? ' (Decades)' : ''}`);
      break;
    case 'SessionStateMessage':
      if (session.playerId !== null) log(`  !! ${session.name} got a NEW SessionStateMessage after joining (session reset)`);
      sendMessage(session, { TypeString: 'ClientRequestPlayerIDMessage', UID: session.uid });
      break;
    case 'AssignPlayerIDAndSlotMessage':
      session.playerId = msg.PlayerID;
      session.slotId = msg.SlotID;
      session.portOffset = msg.UDPPortOffset;
      log(`  ** ${session.name} ASSIGNED PlayerID=${msg.PlayerID} SlotID=${msg.SlotID} UDPPortOffset=${msg.UDPPortOffset} DisplayName="${msg.DisplayName}"`);
      sendMessage(session, {
        TypeString: 'DeviceInfoMessage', Response: 10, DeviceSize: 2, DeviceOS: 1,
        DeviceModel: `Probe ${session.name}`, DeviceType: 'Handheld', DeviceUID: session.uid,
        DeviceOperatingSystem: 'Android OS 14 / API-34 (probe)',
      });
      sendMessage(session, { TypeString: 'KnowledgeIsPower.ClientRequestAvatarStatusMessage' });
      break;
    case 'ResourceRequirementsMessage':
      sendMessage(session, { TypeString: 'AllResourcesReceivedMessage', Requirements: msg.Requirements || [] });
      break;
    case 'PlayerLeftMessage':
      log(`  ${session.name} sees PlayerLeft PlayerID=${msg.PlayerID}`);
      break;
    default:
      break;
  }
}

// Packets arrive on listen ports, not on session sockets, so each port is
// attributed to whichever session was handshaking when that port first saw traffic.
function makeRouter(sessions) {
  const portOwners = new Map(); // port -> Set(session)
  let handshaking = null;

  function ownersFor(key, decoded) {
    if (!portOwners.has(key)) portOwners.set(key, new Set());
    const owners = portOwners.get(key);
    const isHandshake = decoded.kind === 'connectionInit'
      || (decoded.kind === 'data' && decoded.messages.some((m) => HANDSHAKE_TYPES.has(shortType(m.TypeString))));
    if (handshaking && isHandshake && !owners.has(handshaking)) {
      if (owners.size) log(`  !! ${key} is now SHARED by ${[...owners, handshaking].map((s) => s.name).join(' + ')}`);
      owners.add(handshaking);
      handshaking.ports.add(key);
    }
    return owners;
  }

  function onPacket(key, data) {
    const decoded = decodePacket(key, data);
    const owners = ownersFor(key, decoded);
    const ownerNames = [...owners].map((s) => s.name).join('+') || 'nobody';
    if (decoded.kind === 'ack' || decoded.kind === 'fragment') return;
    if (decoded.kind === 'connectionInit') {
      log(`${key} [${ownerNames}] < connection accepted`);
      owners.forEach((s) => { s.connected = true; });
      return;
    }
    if (decoded.kind === 'uidAck') {
      log(`${key} [${ownerNames}] < device ID acknowledged`);
      return;
    }
    if (decoded.kind !== 'data') {
      log(`${key} [${ownerNames}] < ${decoded.kind} ${decoded.hex || decoded.id || ''}`);
      return;
    }
    const names = decoded.jpeg ? 'JPEG' : decoded.messages.map((m) => shortType(m.TypeString)).join(', ') || '(empty)';
    log(`${key} [${ownerNames}] < #${decoded.id} ${names}`);
    for (const session of owners) {
      session.lastRcvId = decoded.id;
      send(session, encodeAck(decoded.id));
    }
    for (const msg of decoded.messages) {
      const type = shortType(msg.TypeString);
      const targets = HANDSHAKE_TYPES.has(type) && handshaking && owners.has(handshaking) ? [handshaking] : [...owners];
      targets.forEach((s) => handleMessage(s, msg));
      if (type === 'PlayerLeftMessage') {
        sessions.filter((s) => s.playerId === msg.PlayerID).forEach((s) => { s.kicked = true; });
      }
    }
  }

  return { onPacket, setHandshaking: (s) => { handshaking = s; } };
}

async function waitFor(predicate, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(200);
  }
  return predicate();
}

// ---------------------------------------------------------------- main

function verdict(a, b) {
  log('');
  log('================ RESULT ================');
  if (!a.connected) {
    log('The console never answered.');
    log('Check: game is open on the "join with your phone" screen; this computer is on the same');
    log('network as the PS4; Windows Firewall allowed Node.js on private networks (a popup appears');
    log('on first run; if you dismissed it, allow node.exe for UDP in Windows Defender Firewall).');
    return 'NO_CONSOLE';
  }
  if (a.playerId === null) {
    log('The console answered but never assigned player A. Send me kip-probe-log.txt.');
    return 'UNCLEAR';
  }
  const from = b.localIp ? ` from the second address ${b.localIp}` : ' from the same address';
  if (b.playerId === null) {
    log(`NO: the console accepted player A but not player B${from}.`);
    log(b.localIp
      ? 'Check the second address is on the same network and that B received nothing above. Send me kip-probe-log.txt.'
      : 'Run again with --second-ip <free address> to test one address per player.');
    return 'NO';
  }
  if (b.playerId === a.playerId || a.kicked) {
    log(`NO: the console treated player B${from} as the same player (player A was replaced).`);
    return 'NO';
  }
  const aKeys = [...a.ports].join(',');
  const bKeys = [...b.ports].join(',');
  if (bKeys && ![...b.ports].some((k) => a.ports.has(k))) {
    log(`YES: two players joined. A on ${aKeys} (PlayerID ${a.playerId}, offset ${a.portOffset}),`);
    log(`B on ${bKeys} (PlayerID ${b.playerId}, offset ${b.portOffset}).`);
    log(b.localIp
      ? 'One relay computer works if it has one network address per player.'
      : 'One relay computer can serve every phone from a single address.');
    return 'YES';
  }
  log(`PARTIAL: both players joined (A=${a.playerId}, B=${b.playerId}) but the console sends both to ${aKeys}.`);
  log('The relay may still be able to tell them apart. Send me kip-probe-log.txt.');
  return 'PARTIAL';
}

function parseArgs(argv) {
  const args = { consoleIp: null, secondIp: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--second-ip') args.secondIp = argv[++i];
    else args.consoleIp = argv[i];
  }
  return args;
}

function localIpFacing(consoleIp, exclude) {
  const target = consoleIp.split('.').map(Number);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.address === exclude) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      if (ip.every((o, i) => (o & mask[i]) === (target[i] & mask[i]))) return a.address;
    }
  }
  return null;
}

function hasLocalAddress(ip) {
  return ip.startsWith('127.') || Object.values(os.networkInterfaces()).flat().some((a) => a && a.address === ip);
}

async function main() {
  log(`kip-probe on ${os.hostname()} (${os.platform()}), Node ${process.version}`);
  const args = parseArgs(process.argv.slice(2));
  let { consoleIp } = args;
  if (args.secondIp && !hasLocalAddress(args.secondIp)) {
    log(`${args.secondIp} is not an address of this computer. Add it first (see the instructions you were given).`);
    return finish('NO_SECOND_IP');
  }
  if (!consoleIp) {
    log('Searching for PlayStation consoles...');
    const found = await discoverConsole();
    for (const [ip, desc] of found) log(`  found ${ip}: ${desc}`);
    if (!found.size) {
      log('No console found. Run again with its IP address: node kip-probe.mjs 192.168.x.x');
      log('(PS4: Settings > Network > View Connection Status.)');
      return finish('NO_CONSOLE');
    }
    consoleIp = [...found.keys()][0];
  }
  log(`Using console at ${consoleIp}`);

  // With a second address, each player sends and listens on its own address so
  // the console sees two separate devices.
  const primaryIp = args.secondIp ? localIpFacing(consoleIp, args.secondIp) : null;
  if (args.secondIp && !primaryIp) {
    log(`This computer has no address on ${consoleIp}'s network other than ${args.secondIp}.`);
    log('Its normal address is missing, so adding the second one probably switched off automatic addressing.');
    log('Restore it in an administrator PowerShell:');
    log(`  netsh interface ipv4 delete address "Wi-Fi" ${args.secondIp}`);
    log('  netsh interface ipv4 set address "Wi-Fi" source=dhcp');
    log('  netsh interface ipv4 set dnsservers "Wi-Fi" source=dhcp');
    return finish('NO_PRIMARY_IP');
  }
  const a = newSession('A', consoleIp, primaryIp || undefined);
  const b = newSession('B', consoleIp, args.secondIp || undefined);
  const router = makeRouter([a, b]);

  const listenIps = args.secondIp ? [primaryIp, args.secondIp] : ['0.0.0.0'];
  const listeners = [];
  for (const ip of listenIps) {
    for (const port of LISTEN_PORTS) {
      const key = args.secondIp ? `${ip}:${port}` : `:${port}`;
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      sock.on('message', (msg, rinfo) => { if (rinfo.address === consoleIp) router.onPacket(key, msg); });
      sock.on('error', (e) => log(`  could not listen on UDP ${ip}:${port}: ${e.code} (another app using it?)`));
      sock.bind(port, ip);
      listeners.push(sock);
    }
  }
  await sleep(300);

  log('--- Phase 1: player A joins');
  router.setHandshaking(a);
  await startSession(a);
  await waitFor(() => a.playerId !== null, 15000);
  if (a.playerId === null) return finish(verdict(a, b), [a, b], listeners);

  await sleep(3000);
  log(`--- Phase 2: player B joins from ${args.secondIp ? `the second address ${args.secondIp}` : 'the same address'}`);
  router.setHandshaking(b);
  await startSession(b);
  await waitFor(() => b.playerId !== null, 15000);
  router.setHandshaking(null);

  log('--- Phase 3: watching both players for 10 s');
  await sleep(10000);
  return finish(verdict(a, b), [a, b], listeners);
}

function finish(result, sessions = [], listeners = []) {
  sessions.forEach((s) => { clearInterval(s.timer); try { s.sock.close(); } catch { /* not bound */ } });
  listeners.forEach((s) => { try { s.close(); } catch { /* not bound */ } });
  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n');
  console.log(`\nFull log saved to ${LOG_FILE}`);
  console.log('The two test players will drop out of the lobby on their own after this exits.');
  process.exitCode = result === 'YES' ? 0 : 1;
}

main().catch((e) => {
  log(`Probe crashed: ${e.stack || e}`);
  finish('CRASH');
});
