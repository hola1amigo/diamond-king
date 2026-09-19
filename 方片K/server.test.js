const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGameServer } = require("./server");
const crypto = require("crypto");
const { chooseBotNumber, BOT_PROFILES } = require("./bots");
const { evaluateRound } = require("./round");

async function setup(t) {
  let time = 1000000;
  const game = createGameServer({ now: () => time });
  await new Promise(resolve => game.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => game.server.close(resolve)));
  const base = `http://127.0.0.1:${game.server.address().port}`;
  async function match(token, name = "测试玩家") {
    const response = await fetch(`${base}/api/match`, {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name })
    });
    return { status: response.status, body: await response.json() };
  }
  const tokens = Array.from({ length: 5 }, () => crypto.randomBytes(24).toString("hex"));
  const created = (await match(tokens[0])).body;
  for (const token of tokens.slice(1)) assert.equal((await match(token)).body.code, created.code);
  const room = game.rooms.get(created.code);
  async function request(seat, action = "", data) {
    const response = await fetch(`${base}/api/rooms/${created.code}${action ? `/${action}` : ""}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[seat - 1] || "wrong"}` },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: response.status, body: await response.json() };
  }
  async function ready() {
    if (room.announcementUntil > time) time = room.announcementUntil;
    const round = room.round;
    for (const p of room.players.filter(p => !p.eliminated)) assert.equal((await request(p.seat, "ready", { round })).status, 200);
  }
  async function submit(values) {
    const round = room.round;
    for (const [seat, value] of values) assert.equal((await request(seat, "submit", { round, value })).status, 200);
  }
  return { ...game, room, base, created, tokens, match, request, ready, submit, advance: ms => { time += ms; } };
}

test("five seats, authentication, private values, ready, locking and stale requests", async t => {
  const g = await setup(t);
  assert.equal(g.created.players.length, 5);
  assert.ok(!("invitations" in g.created));
  assert.equal((await g.request(0)).status, 403);
  assert.equal((await g.request(1, "start", {})).status, 404);
  assert.equal((await fetch(`${g.base}/admin.html`)).status, 404);
  for (let seat = 1; seat <= 4; seat++) await g.request(seat, "ready", { round: 0 });
  assert.equal(g.room.phase, "lobby");
  await g.request(5, "ready", { round: 0 });
  assert.equal(g.room.deadline - (await g.request(1)).body.serverNow, 300000);
  for (const value of ["", null, true, "10", -1, 101, 1.001, 12.34, 20.5]) assert.equal((await g.request(1, "submit", { round: 1, value })).status, 400);
  await g.submit([[1, 12]]);
  const own = (await g.request(1)).body;
  const other = (await g.request(2)).body;
  assert.equal(own.me.value, 12);
  assert.equal(other.me.value, null);
  assert.equal(other.result, null);
  assert.ok(other.players.every(p => !("value" in p) && !("token" in p)));
  assert.ok(!("invitations" in other));
  assert.equal((await g.request(1, "submit", { round: 1, value: 50 })).status, 409);
  await g.submit([[2, 10], [3, 20], [4, 30], [5, 40]]);
  assert.equal(g.room.phase, "result");
  assert.equal(g.room.round, 1);
  assert.equal(g.room.announcementUntil - (await g.request(1)).body.serverNow, 12000);
  assert.equal((await g.request(1, "ready", { round: 1 })).status, 409);
  await g.ready();
  assert.equal(g.room.round, 2);
  assert.equal(g.room.deadline - (await g.request(1)).body.serverNow, 180000);
  assert.equal((await g.request(1, "submit", { round: 1, value: 20 })).status, 409);
  assert.equal((await g.request(1, "ready", { round: 1 })).status, 409);
});

test("deadline settles without polling, missing players lose one and late requests cannot enter", async t => {
  const g = await setup(t);
  await g.ready();
  await g.submit([[1, 20], [2, 30]]);
  g.advance(300000);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(g.room.phase, "result");
  assert.equal(g.room.result.average, 25);
  assert.deepEqual(g.room.result.losses.map(p => p.deduction), [0, 1, 1, 1, 1]);
  assert.equal((await g.request(3, "submit", { round: 1, value: 0 })).status, 409);
  await g.ready();
  g.advance(180000);
  await g.request(1);
  assert.equal(g.room.result.target, null);
  assert.ok(g.room.result.losses.every(p => p.deduction === 1));
});

test("4/3/2 stages, long new-rule rounds, duplicates, exact hits and 0/100", async t => {
  const g = await setup(t);
  await g.ready();
  g.room.players[4].score = -9;
  await g.submit([[1, 10], [2, 20], [3, 30], [4, 40], [5, 100]]);
  assert.equal((await g.request(1, "ready", { round: g.room.round })).status, 409);
  assert.equal(g.room.stage, 1);
  assert.equal(g.room.newRules.length, 1);
  await g.ready();
  assert.equal(g.room.deadline - (await g.request(1)).body.serverNow, 300000);
  g.room.players[3].score = -9;
  await g.submit([[1, 10], [2, 10], [3, 20], [4, 100]]);
  assert.deepEqual(g.room.result.duplicated, [10]);
  assert.deepEqual(g.room.result.winners.map(p => p.seat), [3]);
  assert.equal(g.room.stage, 2);
  await g.ready();
  g.room.players[2].score = -8;
  await g.submit([[1, 20], [2, 25], [3, 30]]);
  assert.equal(g.room.result.target, 20);
  assert.equal(g.room.result.exactHit, true);
  assert.equal(g.room.result.penalty, 2);
  assert.equal(g.room.stage, 3);
  await g.ready();
  g.room.players[0].score = -9;
  await g.submit([[1, 0], [2, 100]]);
  assert.equal(g.room.phase, "finished");
  assert.equal(g.room.result.specialRule, true);
  assert.equal(g.room.result.finalWinner.seat, 2);
  assert.equal((await g.request(2, "ready", { round: g.room.round })).status, 409);
});

test("rounded exact hit changes penalty but preserves raw-target winners and timeout penalty", async t => {
  const g = await setup(t);
  g.room.players[3].eliminated = true;
  g.room.players[4].eliminated = true;
  g.room.stage = 2;
  await g.ready();
  await g.submit([[1, 20], [2, 21], [3, 37]]);
  assert.equal(g.room.result.target, 20.8);
  assert.deepEqual(g.room.result.winners.map(p => p.seat), [2]);
  assert.equal(g.room.result.exactHit, true);
  assert.deepEqual(g.room.result.losses.map(p => p.deduction), [2, 0, 2]);
  await g.ready();
  await g.submit([[1, 20], [2, 25], [3, 34]]);
  assert.equal(g.room.result.exactHit, false);
  assert.equal(g.room.result.penalty, 1);
  await g.ready();
  await g.submit([[1, 21], [2, 31]]);
  g.advance(300000);
  await g.request(1);
  assert.equal(g.room.result.target, 20.8);
  assert.equal(g.room.result.exactHit, true);
  assert.deepEqual(g.room.result.losses.map(p => p.deduction), [0, 2, 1]);
});

test("simultaneous elimination unlocks crossed stages; zero survivors terminates", async t => {
  const g = await setup(t);
  await g.ready();
  g.room.players[3].score = -9;
  g.room.players[4].score = -9;
  await g.submit([[1, 20], [2, 25], [3, 30], [4, 90], [5, 100]]);
  assert.equal(g.room.stage, 2);
  assert.equal(g.room.newRules.length, 2);
  await g.ready();
  for (const p of g.room.players.filter(p => !p.eliminated)) p.score = -9;
  await g.submit([[1, 0], [2, 0], [3, 0]]);
  assert.equal(g.room.phase, "finished");
  assert.equal(g.room.result.allEliminated, true);
});

test("unmodified scores complete an entire game; repeated deadline checks do not double-charge", async t => {
  const g = await setup(t);
  while (g.room.phase !== "finished") {
    await g.ready();
    await g.submit([[2, 20]]);
    g.advance(g.room.deadline - (await g.request(2)).body.serverNow);
    await g.request(2);
  }
  assert.equal(g.room.result.finalWinner.seat, 2);
  const scores = g.room.players.map(p => p.score);
  g.advance(1000000);
  await g.request(2);
  assert.deepEqual(g.room.players.map(p => p.score), scores);
});



test("automatic matchmaking fills five seats, resumes identity, and never exposes other credentials", async t => {
  const g = await setup(t);
  assert.equal((await g.match("wrong")).status, 400);
  const resumed = await g.match(g.tokens[0]);
  assert.equal(resumed.body.code, g.room.code);
  assert.equal(resumed.body.me.seat, 1);
  assert.equal(g.rooms.size, 1);
  const newcomers = Array.from({ length: 5 }, () => crypto.randomBytes(24).toString("hex"));
  const assignments = await Promise.all(newcomers.map(token => g.match(token)));
  assert.equal(new Set(assignments.map(r => r.body.code)).size, 1);
  assert.notEqual(assignments[0].body.code, g.room.code);
  assert.equal(new Set(assignments.map(r => r.body.me.seat)).size, 5);
  assert.ok(assignments.every(r => !JSON.stringify(r.body).includes("token")));
  await g.ready();
  await g.submit([[1, 23]]);
  const recovered = await g.match(g.tokens[0]);
  assert.equal(recovered.body.me.value, 23);
  assert.equal(recovered.body.code, g.room.code);
  const duplicate = crypto.randomBytes(24).toString("hex");
  const retries = await Promise.all([g.match(duplicate), g.match(duplicate)]);
  assert.equal(retries[0].body.code, retries[1].body.code);
  assert.equal(retries[0].body.me.seat, retries[1].body.me.seat);
});

test("waiting seats expire without affecting active games or another player's identity", async t => {
  const g = await setup(t);
  await g.request(1, "ready", { round: 0 });
  g.advance(119000);
  for (let seat = 2; seat <= 5; seat++) await g.request(seat);
  g.advance(1001);
  const replacement = await g.match(crypto.randomBytes(24).toString("hex"));
  assert.equal(replacement.body.code, g.room.code);
  assert.equal(replacement.body.me.seat, 1);
  assert.equal(replacement.body.me.ready, false);
  assert.equal((await g.request(1)).status, 403);
  assert.equal(g.room.phase, "lobby");
  assert.equal((await fetch(`${g.base}/health`)).status, 200);
  assert.equal((await fetch(`${g.base}/api/rooms`, { method: "POST" })).status, 404);
});


test("solo demo is isolated and unlocks rules with a mandatory 12-second announcement", async t => {
  const g = await setup(t);
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${g.tokens[0]}` };
  const demo = await (await fetch(`${g.base}/api/demo`, { method: 'POST', headers, body: JSON.stringify({ name: '体验玩家' }) })).json();
  assert.notEqual(demo.code, g.room.code);
  assert.equal(demo.demo, true);
  assert.equal(demo.newRules.length, 0);
  assert.equal((await g.match(g.tokens[0])).body.code, g.room.code);
  const step = round => fetch(`${g.base}/api/rooms/${demo.code}/demo_step`, { method: 'POST', headers, body: JSON.stringify({ round }) });
  for (let round = 0; round < 4; round++) {
    const res = await step(round);
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.result.eliminated.length, 1);
    assert.equal(s.scoreAnnouncementUntil - s.serverNow, 12000);
    assert.equal(s.announcementUntil - s.serverNow, 24000);
    assert.equal(s.newRules.length, 0);
    assert.equal((await step(round + 1)).status, 409);
    if (round === 3) { assert.equal(s.me.eliminated, true); assert.equal(s.phase, 'finished'); }
    g.advance(12000);
    const afterScore = await (await fetch(`${g.base}/api/rooms/${demo.code}`, { headers })).json();
    assert.equal(afterScore.newRules.length, round < 3 ? 1 : 0);
    if (round < 3) {
      assert.equal((await step(round + 1)).status, 409);
      g.advance(12000);
    }
  }
  assert.equal((await g.request(1, 'demo_step', { round: 0 })).status, 409);
});

test("bot forecasts adapt to public history, obey late rules and are seed-reproducible", () => {
  const rng = () => { let seed = 12345; return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const players = [1, 2, 3, 4, 5].map(seat => ({ seat, score: 0 }));
  const history = value => Array.from({ length: 8 }, () => ({ target: value * .8, values: players.map(p => ({ seat: p.seat, value })) }));
  for (let profile = 0; profile < 4; profile++) {
    const input = { seat: 2, profile, players, history: history(10), stage: 0 };
    const original = JSON.stringify(input);
    const low = chooseBotNumber(input, rng());
    const high = chooseBotNumber({ ...input, history: history(70) }, rng());
    assert.ok(Number.isInteger(low) && low >= 0 && high <= 100);
    assert.ok(high > low + 20, `${BOT_PROFILES[profile].name} must adapt to observed choices`);
    assert.equal(chooseBotNumber(input, rng()), low);
    assert.equal(JSON.stringify(input), original);
    const duel = { ...input, players: players.slice(0, 2), stage: 3,
      history: Array.from({ length: 8 }, () => ({ target: 0, values: [{ seat: 1, value: 0 }, { seat: 2, value: 0 }] })) };
    assert.equal(chooseBotNumber(duel, rng()), 100, "recognises the zero / hundred counterplay");
  }
  assert.deepEqual(evaluateRound([{seat:1,value:10},{seat:2,value:10},{seat:3,value:20}],2).winners.map(p=>p.seat), [3]);
});

test("solo challenge commits private bot choices before human input and completes without preset scores", async t => {
  const g = await setup(t);
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${g.tokens[0]}` };
  const create = () => fetch(`${g.base}/api/solo`, { method: 'POST', headers, body: JSON.stringify({ name: '挑战者' }) }).then(r=>r.json());
  let s = await create();
  const room = g.rooms.get(s.code);
  const request = async (action = '', body) => {
    const r = await fetch(`${g.base}/api/rooms/${room.code}${action ? '/' + action : ''}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  assert.equal(s.solo, true);
  assert.equal(s.demo, false);
  assert.ok(s.players.every(p => p.score === 0));
  assert.deepEqual(s.players.slice(1).map(p=>p.bot), BOT_PROFILES.map(p=>p.style));
  assert.equal((await create()).code, room.code);
  assert.notEqual((await g.match(g.tokens[0])).body.code, room.code);
  const stranger = await fetch(`${g.base}/api/rooms/${room.code}`, { headers: {Authorization:`Bearer ${g.tokens[1]}`} });
  assert.equal(stranger.status, 403);
  assert.equal((await request('demo_step', {round:0})).status, 409);
  s = (await request('ready', {round:0})).body;
  assert.equal(s.phase, 'playing');
  const planned = room.players.slice(1).map(p=>p.plan.value);
  assert.equal(room.botHistory.length, 0);
  assert.ok(s.players.every(p => !('value' in p) && !('plan' in p) && !('token' in p)));
  await request('submit', {round:1,value:100});
  assert.deepEqual(room.players.slice(1).map(p=>p.plan.value), planned);
  g.advance(7000);
  s = (await request()).body;
  assert.equal(s.phase, 'result');
  assert.deepEqual(s.result.values.slice(1).map(p=>p.value), planned);
  assert.ok(s.players.every(p=>p.score >= -1));
  assert.equal(room.botHistory.length, 1);
  assert.equal((await request('ready', {round:1})).status, 409);
  // Play a complete game: real losses only, then observe automatic bot-only rounds.
  let sawHumanElimination = false;
  for (let i=0; i<120 && s.phase !== 'finished'; i++) {
    if (s.phase === 'result') {
      g.advance(s.announcementUntil - s.serverNow);
      s = (await request()).body;
      if (s.phase === 'result') s = (await request('ready', {round:s.round})).body;
    }
    if (s.phase === 'playing') {
      const before = s.players.map(p=>p.score);
      if (!s.me.eliminated) await request('submit', {round:s.round,value:100});
      g.advance(7000);
      s = (await request()).body;
      for (const loss of s.result.losses) assert.equal(s.players[loss.seat-1].score, before[loss.seat-1] - loss.deduction);
      sawHumanElimination ||= s.me.eliminated;
    }
  }
  assert.equal(s.phase, 'finished');
  assert.equal(sawHumanElimination, true);
  assert.ok(room.botHistory.length <= 12);
  const fresh = await create();
  assert.notEqual(fresh.code, room.code);
  assert.ok(fresh.players.every(p=>p.score===0));
  assert.deepEqual(g.rooms.get(fresh.code).botHistory, []);
});


test("rules can be dismissed per player after scoring without skipping other players", async t => {
  const g = await setup(t);
  await g.ready();
  g.room.players[4].score = -9;
  await g.submit([[1,5],[2,10],[3,15],[4,20],[5,100]]);
  const round = g.room.round;
  assert.equal((await g.request(1,"dismiss_rules",{round})).status,409);
  g.advance(12000);
  assert.equal((await g.request(1,"dismiss_rules",{round:round-1})).status,409);
  assert.equal((await g.request(1,"dismiss_rules",{round})).body.me.rulesDismissed,true);
  assert.equal((await g.request(1)).body.me.rulesDismissed,true);
  assert.equal((await g.request(1,"ready",{round})).status,200);
  assert.equal((await g.request(2,"ready",{round})).status,409);
  assert.equal(g.room.phase,"result");
  for (const seat of [2,3,4]) {
    assert.equal((await g.request(seat,"dismiss_rules",{round})).status,200);
    assert.equal((await g.request(seat,"ready",{round})).status,200);
  }
  assert.equal(g.room.phase,"playing");
  assert.equal((await g.request(1)).body.me.rulesDismissed,false);
});
test("bots resist isolated spikes, recognise alternating choices and avoid invalid duplicates", () => {
  const rng = () => { let seed=123; return () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296); };
  const players=[1,2,3,4,5].map(seat=>({seat,score:0}));
  const history = (sequence, all=false) => sequence.map(value=>{
    const values=players.map(p=>({seat:p.seat,value:all || p.seat===1 ? value : 10}));
    return {values,target:values.reduce((s,p)=>s+p.value,0)/5*.8};
  });
  for(let profile=0;profile<4;profile++) {
    const choose=(records,active=players,stage=0)=>chooseBotNumber({seat:2,profile,players:active,history:records,stage},rng());
    const baseline=choose(history(Array(8).fill(10)));
    const shock=choose(history([10,10,10,10,10,10,10,100]));
    const sustained=choose(history([10,10,10,100,100,100,100,100]));
    assert.ok(Math.abs(shock-baseline)<=3,"one spike must not reset the whole forecast");
    assert.ok(sustained>shock+10,"persistent changes still update the forecast");
    const nextLow=choose(history([10,70,10,70,10,70,10,70],true));
    const nextHigh=choose(history([70,10,70,10,70,10,70,10],true));
    assert.ok(nextHigh>nextLow+25,"predict the next alternating mode instead of their average");
    assert.equal(choose(history(Array(8).fill(0),true),players.slice(0,4),1),1,"avoid repeated zero after duplicate rule unlocks");
  }
});
