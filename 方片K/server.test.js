const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGameServer } = require("./server");
const crypto = require("crypto");

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
  assert.equal(g.room.deadline, 1300000);
  for (const value of ["", null, true, "10", -1, 101, 1.001]) assert.equal((await g.request(1, "submit", { round: 1, value })).status, 400);
  await g.submit([[1, 12.34]]);
  const own = (await g.request(1)).body;
  const other = (await g.request(2)).body;
  assert.equal(own.me.value, 12.34);
  assert.equal(other.me.value, null);
  assert.equal(other.result, null);
  assert.ok(other.players.every(p => !("value" in p) && !("token" in p)));
  assert.ok(!("invitations" in other));
  assert.equal((await g.request(1, "submit", { round: 1, value: 50 })).status, 409);
  await g.submit([[2, 10], [3, 20], [4, 30], [5, 40]]);
  assert.equal(g.room.phase, "result");
  assert.equal(g.room.round, 1);
  await g.ready();
  assert.equal(g.room.round, 2);
  assert.equal(g.room.deadline, 1180000);
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
  assert.equal(g.room.stage, 1);
  assert.equal(g.room.newRules.length, 1);
  await g.ready();
  assert.equal(g.room.deadline, 1300000);
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
