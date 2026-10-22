// Scripted fake KIP / Decades console for end-to-end tests of the web controller.
// Usage: node fake-console.mjs <bind-ip> [kip|decades] [script]
// Prints one JSON line per event: {ev:'in', type, m} for phone messages,
// {ev:'step', name} when a step starts, {ev:'done'} at the end.
import dgram from 'node:dgram';

const bindIp = process.argv[2] || '127.0.0.1';
const mode = process.argv[3] || 'kip';
const scriptName = process.argv[4] || mode;
const decades = mode === 'decades';
const KIP = 'KnowledgeIsPower.';
const sock = dgram.createSocket('udp4');
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const PKT = decades ? [0xc1, 0x48] : [0xae, 0x7f];
const BODY = decades ? [0xa3, 0xd3] : [0x33, 0x29];
let client = null;
let counter = 10;
const waiters = [];
const seen = new Set();
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

function send(obj) {
  const j = Buffer.from(JSON.stringify(obj));
  const body = Buffer.concat([Buffer.from(BODY), i32(-7503), i32(j.length), j]);
  const pkt = Buffer.concat([Buffer.from(PKT), i32(++counter), i32(1), i32(0), i32(body.length), i32(0), body]);
  sock.send(pkt, 9060, client.ip);
  out({ ev: 'out', type: obj.TypeString.replace(KIP, '') });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(type, ms, test) {
  return new Promise((resolve) => {
    const w = { type, test, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms) };
    waiters.push(w);
  });
}

function onMessage(m) {
  const type = m.TypeString.replace(KIP, '');
  out({ ev: 'in', type, m: type.includes('Image') ? { ImageGUID: m.ImageGUID } : m });
  for (const w of [...waiters]) {
    if (w.type === type && (!w.test || w.test(m))) {
      clearTimeout(w.timer);
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  }
  handshake(m, type);
}

const AVATARS = ['COWGIRL', 'ROBOT', 'SPACEMAN', 'ROCKER', 'MAGICIAN', 'GAMER'];
function handshake(m, type) {
  if (type === 'ClientRequestPlayerIDMessage') {
    send({ TypeString: 'AssignPlayerIDAndSlotMessage', PlayerID: 4, SlotID: 1, UDPPortOffset: 0, DisplayName: 'Player 2', PSNID: '' });
    send({ TypeString: 'ResourceRequirementsMessage', Requirements: [] });
    for (const a of AVATARS) send({ TypeString: `${KIP}ServerAvatarStatusMessage`, AvatarID: a, Available: a !== 'ROBOT' });
  }
  if (type === 'AllResourcesReceivedMessage' && !named) {
    named = true;
    setTimeout(() => send({ TypeString: 'ClientQuizCommandMessage', action: 31, time: 0 }), 300);
  }
  if (type === 'ClientRequestAvatarMessage' && m.Request) {
    send({ TypeString: `${KIP}ServerAvatarRequestResponseMessage`, RequestID: m.RequestID, AvatarID: m.AvatarID, Available: true });
  }
  if (type === 'ClientPlayerProfileMessage') {
    setTimeout(() => send({ TypeString: 'ClientQuizCommandMessage', action: 14, time: 0 }), 600);
  }
  if (type === 'StartGameButtonPressedResponseMessage' && !started) {
    started = true;
    run().catch((e) => out({ ev: 'error', error: String(e.stack || e) }));
  }
}
let started = false;
let named = false;

const tint = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a: 1 });
const holding = (text, type = 1) => send({ TypeString: 'ClientHoldingScreenCommandMessage', action: 0, time: 0, HoldingScreenType: type, HoldingScreenText: text });
const answers = (texts, correct = 0) => texts.map((t, i) => ({ DisplayText: t, DisplayIndex: i, IsCorrect: i === correct }));
const trivia = (q, powerPlays = [], roundType = 1, duration = 15) => send({
  TypeString: `${KIP}ServerBeginTriviaAnsweringPhase`, QuestionText: q, QuestionDuration: duration, RoundType: roundType,
  Answers: answers(['Paris', 'Rome', 'Madrid', 'Berlin']), PowerPlays: powerPlays.map(([t, c]) => ({ PowerType: t, Count: c })),
  BackgroundTint: tint('#2E7D9A'), SecondaryTint: tint('#25657D'),
});

async function step(name, fn) {
  out({ ev: 'step', name });
  await fn();
}

const SCRIPTS = {
  async kip() {
    await step('holding', async () => {
      send({ TypeString: `${KIP}ServerColourMessage`, BackgroundTint: tint('#BFB196'), PrimaryTint: tint('#B69252'), SecondaryTint: tint('#CCA53E') });
      holding('Get ready\\nfor round one!');
      await sleep(1500);
    });
    await step('category', async () => {
      send({
        TypeString: `${KIP}ServerCategorySelectChoices`, BackgroundTint: tint('#6A1B9A'), SecondaryTint: tint('#4A148C'),
        CategoryChoices: ['Science', 'Sport', 'Movies', 'History'].map((t, i) => ({ DisplayText: t, Colour: tint(['#E53935', '#43A047', '#1E88E5', '#FDD835'][i]) })),
      });
      await waitFor('ClientCategorySelectChoice', 8000);
      send({ TypeString: `${KIP}ServerRequestCategorySelectChoice` });
      await waitFor('ClientCategorySelectChoice', 3000);
    });
    await step('powerpick', async () => {
      send({ TypeString: `${KIP}ServerBeginCategorySelectOverride`, DurationSeconds: 4, InitialCategorySelectChoice: 'Sport' });
      await sleep(4000);
      send({ TypeString: `${KIP}ServerStopCategorySelectOverride` });
      await waitFor('ClientStopCategorySelectOverrideResponse', 3000);
      holding('Category chosen');
      await sleep(800);
    });
    await step('powerplay', async () => {
      send({
        TypeString: `${KIP}ServerBeginPowerPlayPhase`, RoundType: 1,
        PowerPlays: [
          { DisplayIndex: 0, PowerType: 4, PowerTypes: [], PowerPlayTargets: [2, 3], New: true, TargetCount: 1 },
          { DisplayIndex: 1, PowerType: 8, PowerTypes: [], PowerPlayTargets: [1, 2, 3], New: false, TargetCount: 3 },
          { DisplayIndex: 2, PowerType: 7, PowerTypes: [], PowerPlayTargets: [2, 3], New: true, TargetCount: 1 },
        ],
        PowerPlayPlayers: [
          { SlotIndex: 1, Name: 'Tester', ImageGUID: '', Self: true, Away: false },
          { SlotIndex: 2, Name: 'Alice', ImageGUID: '', Self: false, Away: false },
          { SlotIndex: 3, Name: 'Bob', ImageGUID: '', Self: false, Away: false },
        ],
      });
      await waitFor('ClientPowerPlayChoice', 12000);
      send({ TypeString: `${KIP}ServerRequestPowerPlayChoice` });
      await waitFor('ClientPowerPlayChoice', 3000);
    });
    const tq = [
      ['trivia-ice-gloop', [[4, 1], [7, 1]]],
      ['trivia-bombs-munchers', [[5, 1], [6, 1]]],
      ['trivia-lockdown', [[20, 1]]],
      ['trivia-bug', [[24, 1]]],
      ['trivia-zippers-scatter-disco', [[22, 1], [28, 1], [29, 1]]],
    ];
    for (const [name, pps] of tq) {
      await step(name, async () => {
        trivia(`Question for ${name}?`, pps);
        await waitFor('ClientTriviaAnswer', 17000);
        holding('Waiting for others');
        await sleep(700);
      });
    }
    await step('finals', async () => {
      trivia('Finals: capital of France?', [], 5);
      await waitFor('ClientTriviaAnswer', 17000);
      holding('Final scores');
      await sleep(700);
    });
    await step('pairs', async () => {
      const pairs = [['Fire', 'Hot'], ['Ice', 'Cold'], ['Day', 'Light'], ['Night', 'Dark']];
      send({
        TypeString: `${KIP}ServerBeginLinkingAnsweringPhase`, QuestionText: 'Link the pairs', QuestionDuration: 25,
        LinkingAnswers: pairs.flatMap(([a, b], i) => [
          { AnswerID: `TopAnswer_${i}`, DisplayText: a, MatchIndex: i, Direction: 1 },
          { AnswerID: `BotAnswer_${i}`, DisplayText: b, MatchIndex: i, Direction: 2 },
        ]),
      });
      await waitFor('ClientLinkingAnswer', 27000);
      holding('Nice linking');
      await sleep(700);
    });
    await step('sorting', async () => {
      send({
        TypeString: `${KIP}ServerBeginSortingAnsweringPhase`, QuestionText: 'Fruit or vegetable?', QuestionDuration: 20,
        LeftBucketID: 'L', RightBucketID: 'R', LeftBucketLabel: 'Fruit', RightBucketLabel: 'Veg',
        SortingAnswers: [['Apple', 1], ['Carrot', 2], ['Pear', 1], ['Leek', 2]].map(([t, d], i) => ({ AnswerID: `S${i}`, DisplayText: t, AnswerDirection: d })),
      });
      await waitFor('ClientSortingAnswer', 22000);
      holding('Sorted');
      await sleep(700);
    });
    await step('endfact', async () => {
      send({ TypeString: 'ClientEndOfGameFactCommandMessage', action: 0, time: 0, FactNumber: 7 });
      await sleep(2500);
      send({ TypeString: 'ClientQuizCommandMessage', action: 31, time: 0 });
      await sleep(1500);
    });
  },

  async decades() {
    await step('holding', async () => {
      holding('Decades round');
      await sleep(1200);
    });
    await step('chain', async () => {
      send({
        TypeString: `${KIP}ServerBeginOrderingAnsweringPhase`, QuestionDuration: 25,
        OrderingAnswerData: [{ WordsInCorrectOrder: ['Walk', 'This', 'Way'], LayoutId: 0 }, { WordsInCorrectOrder: ['Born', 'In', 'The', 'USA'], LayoutId: 0 }],
      });
      await waitFor('ClientToServerOrderingAnswer', 27000);
      holding('Chained');
      await sleep(700);
    });
    await step('elimination', async () => {
      send({
        TypeString: `${KIP}ServerBeginEliminatingAnsweringPhase`, ChallengeId: 'E1', QuestionText: 'Smash the one that is not a planet', QuestionDuration: 20,
        EliminatingAnswerData: [
          { CorrectAnswer: 'Moon', IncorrectAnswers: ['Mars', 'Venus'], CorrectInfo: '', IncorrectInfo: '' },
          { CorrectAnswer: 'Sun', IncorrectAnswers: ['Saturn', 'Jupiter'], CorrectInfo: '', IncorrectInfo: '' },
        ],
      });
      await waitFor('ClientToServerEliminatingAnswer', 22000);
      holding('Smashed');
      await sleep(700);
    });
    await step('matching', async () => {
      send({
        TypeString: `${KIP}ServerBeginMatchingAnsweringPhase`, ChallengeId: 'M1', QuestionDuration: 25,
        MatchingData: [{ QuestionText: 'Who sang Thriller?', AnswerText: 'Michael Jackson' }, { QuestionText: 'Who sang Vogue?', AnswerText: 'Madonna' }],
        DummyAnswerData: ['Prince', 'Cher', 'Sting', 'Bono', 'Adele'],
      });
      await waitFor('ClientToServerMatchingAnswer', 27000);
      holding('Matched');
      await sleep(700);
    });
    await step('missing', async () => {
      send({
        TypeString: `${KIP}ServerBeginMissingLetterAnsweringPhase`, ChallengeId: 'CMP00023', Question: 'Complete the names of the 90s movies', QuestionDuration: 25,
        MissingLetterAnswerData: [
          { answerInfo: 'CLUELESS', correct: 'E', letters: 'AEIOU', finalDisplay: 'CLUELESS' },
          { answerInfo: 'TOY STORY', correct: 'O', letters: 'AEIOU', finalDisplay: 'TOY STORY' },
        ],
      });
      await waitFor('PrototypeClientToServerMissingLetterAnswer', 27000);
      holding('Spelled');
      await sleep(700);
    });
  },

  // Power play request arrives while the phone is offline: the relay must answer it.
  async offline() {
    await step('powerplay-offline', async () => {
      send({
        TypeString: `${KIP}ServerBeginPowerPlayPhase`, RoundType: 1,
        PowerPlays: [{ DisplayIndex: 0, PowerType: 4, PowerTypes: [], PowerPlayTargets: [2], New: false, TargetCount: 1 }],
        PowerPlayPlayers: [{ SlotIndex: 2, Name: 'Alice', ImageGUID: '' }],
      });
      await waitFor('Never', 26000);
      send({ TypeString: `${KIP}ServerRequestPowerPlayChoice` });
      await waitFor('ClientPowerPlayChoice', 3000);
      holding('Back from power play');
      await sleep(4000);
    });
  },
};

async function run() {
  await SCRIPTS[scriptName]();
  out({ ev: 'done' });
}

sock.on('message', (msg, rinfo) => {
  if (msg[0] === 0x8a && msg[1] === 0x33 && msg.readInt32LE(2) === -1) {
    if (client) return;
    client = { ip: rinfo.address };
    out({ ev: 'connect', from: `${rinfo.address}:${rinfo.port}` });
    sock.send(Buffer.concat([Buffer.from([0x8a, 0x33]), i32(-1), Buffer.alloc(32)]), 9060, client.ip);
    send({ TypeString: 'InterfaceVersionMessage', InterfaceVersion: decades ? 'KIP2_2019-01-01-0000' : 'KIP_2016-11-14-1222' });
    send({ TypeString: 'SessionStateMessage', SessionID: 627950993 });
    return;
  }
  if (!client || msg.length < 32) return;
  if (!((msg[0] === PKT[0] && msg[1] === PKT[1]))) return;
  const id = msg.readInt32LE(2);
  sock.send(Buffer.concat([Buffer.from([0x8a, 0x33]), i32(id), Buffer.alloc(32)]), 9060, client.ip);
  if (seen.has(id)) return;
  seen.add(id);
  const total = msg.readInt32LE(6);
  if (total !== 1) return;
  const body = msg.subarray(22);
  if (body.readInt32LE(2) !== -7503) return;
  try {
    onMessage(JSON.parse(body.subarray(10).toString('utf8')));
  } catch { /* image data */ }
});
sock.bind(9066, bindIp, () => out({ ev: 'listening', bindIp, mode, scriptName }));
setTimeout(() => process.exit(0), 300000);
