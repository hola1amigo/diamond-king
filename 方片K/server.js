const http = require("http");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { evaluateRound } = require("./round");
const { BOT_PROFILES, chooseBotNumber } = require("./bots");

const PUBLIC_DIR = path.join(__dirname, "public");
const BASE_RULES = [
  "选择 0～100 的整数。已提交数字的平均数 × 0.8 为目标值，最接近者获胜，其余提交者扣 1 分；同距离并列获胜。",
  "达到 −10 分淘汰，最后一人获胜。每淘汰一人追加规则，已有规则持续有效。",
  "首轮及追加规则后的轮次限时 5 分钟，普通轮 3 分钟。提交后锁定，全员提交立即结算。",
  "网络版：超时未提交者扣 1 分，不计入平均数；全员超时则全员扣 1 分。"
];
const EXTRA_RULES = [
  "相同数字无效，不能获胜，但仍计入平均数。",
  "选数等于目标值四舍五入后的整数，视为精确命中，其余失败者扣 2 分。",
  "两人对决时，若一方选 0、另一方选 100，100 获胜。"
];
const stageFor = (count) => Math.min(3, 5 - count);
const identity = (p) => ({ seat: p.seat, name: p.name });

function createGameServer({ now = Date.now } = {}) {
  const rooms = new Map();
  function createRoom() {
    let code;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
    const room = { code, round: 0, phase: "lobby", deadline: null, stage: 0, newRules: [], result: null, history: [],
      players: Array.from({ length: 5 }, (_, i) => ({ seat: i + 1, name: `玩家 ${i + 1}`, token: null, lastSeen: 0, score: 0, value: null, submitted: false, eliminated: false, ready: false })) };
    rooms.set(code, room);
    return room;
  }
  function state(room, me) {
    const hideNewRules = room.result && now() < room.scoreAnnouncementUntil;
    const view = (p) => ({ ...identity(p), bot: p.bot === undefined ? null : BOT_PROFILES[p.bot].style, joined: Boolean(p.token), score: p.score, submitted: p.submitted, eliminated: p.eliminated, ready: p.ready });
    return { code: room.code, friend: Boolean(room.friend), isHost: Boolean(me && room.hostToken === me.token), rosterVersion: room.rosterVersion || 0, botProfiles: room.friend ? BOT_PROFILES.map((p,id)=>({id,name:p.name,style:p.style})) : [], demo: Boolean(room.demo), solo: Boolean(room.solo), announcementUntil: room.announcementUntil || null, scoreAnnouncementUntil: room.scoreAnnouncementUntil || null, round: room.round, phase: room.phase, serverNow: now(), deadline: room.deadline,
      activeCount: room.players.filter(p => !p.eliminated).length,
      me: me ? { ...view(me), value: me.value, rulesDismissed: me.rulesReadRound === room.round } : null, players: room.players.map(view),
      visibleRules: [...BASE_RULES, ...EXTRA_RULES.slice(0, hideNewRules ? room.stage - room.newRules.length : room.stage)], newRules: hideNewRules ? [] : room.newRules,
      result: room.result, history: room.history };
  }
  function begin(room) {
    room.round += 1;
    room.deadline = now() + (room.round === 1 || room.newRules.length ? 300000 : 180000);
    room.phase = "playing";
    room.result = null;
    room.newRules = [];
    for (const p of room.players) { p.ready = false; p.submitted = false; p.value = null; }
    if (room.solo || room.friend) {
      const players = room.players.filter(p => !p.eliminated).map(p => ({ seat: p.seat, score: p.score }));
      for (const p of room.players.filter(p => p.bot !== undefined && !p.eliminated)) {
        p.plan = { value: chooseBotNumber({ seat: p.seat, profile: p.bot, players, history: room.botHistory, stage: room.stage }), submitAt: now() + crypto.randomInt(2000, 6001) };
      }
    }
  }
  function settle(room) {
    if (room.phase !== "playing") return;
    const active = room.players.filter(p => !p.eliminated);
    if (now() < room.deadline && active.some(p => !p.submitted)) return;
    const outcome = evaluateRound(active.map(p => ({ seat: p.seat, value: p.submitted ? p.value : null })), room.stage);
    const { average, target, duplicated, exactHit, penalty, specialRule } = outcome;
    const winners = active.filter(p => outcome.winners.some(winner => winner.seat === p.seat));
    const losses = active.map(p => {
      const deduction = !p.submitted ? 1 : winners.includes(p) ? 0 : penalty;
      p.score -= deduction;
      p.eliminated = p.score <= -10;
      p.ready = false;
      return { ...identity(p), deduction, timedOut: !p.submitted };
    });
    const remaining = active.filter(p => !p.eliminated);
    const nextStage = stageFor(remaining.length);
    room.newRules = EXTRA_RULES.slice(room.stage, nextStage);
    room.stage = nextStage;
    room.phase = remaining.length <= 1 ? "finished" : "result";
    if (room.phase === "finished") room.newRules = [];
    const eliminated = active.filter(p => p.eliminated).map(p => ({ ...identity(p), score: p.score }));
    room.scoreAnnouncementUntil = now() + 12000;
    room.announcementUntil = room.scoreAnnouncementUntil + (room.newRules.length || remaining.length === 1 ? 12000 : 0);
    room.deadline = null;
    room.result = { round: room.round, average: average === null ? null : Number(average.toFixed(4)), target: target === null ? null : Number(target.toFixed(4)),
      values: active.map(p => ({ ...identity(p), value: p.value })), winners: winners.map(identity), duplicated,
      penalty, exactHit, specialRule, losses, eliminated, finalWinner: remaining.length === 1 ? identity(remaining[0]) : null, allEliminated: remaining.length === 0 };
    if (room.solo || room.friend) {
      room.botHistory.push({ target, values: room.result.values.map(p => ({ seat: p.seat, value: p.value })) });
      room.botHistory = room.botHistory.slice(-12);
      for (const p of room.players) delete p.plan;
    }
    room.history.unshift(`第 ${room.round} 轮：目标 ${room.result.target ?? "无"}，胜者 ${winners.map(p => p.name).join("、") || "无"}。`);
    room.history = room.history.slice(0, 12);
  }
  function advance(room) {
    if (room.solo || room.friend) {
      if (room.phase === "result" && now() >= room.scoreAnnouncementUntil) {
        for (const p of room.players) if (p.bot !== undefined && !p.eliminated) p.ready = true;
        if (room.players.filter(p=>p.token && p.bot === undefined).every(p=>p.eliminated) && now() >= room.announcementUntil) begin(room);
      }
      if (room.phase === "playing") {
        for (const p of room.players) {
          if (!p.eliminated && !p.submitted && p.plan && now() >= p.plan.submitAt) {
            p.value = p.plan.value;
            p.submitted = true;
          }
        }
      }
    }
    settle(room);
  }
  function releaseIdleSeats(room) {
    if (room.demo || room.solo || room.friend) return;
    if (room.phase !== "lobby") return;
    for (const p of room.players) {
      if (p.token && now() - p.lastSeen >= 120000) {
        p.token = null;
        p.ready = false;
        p.name = `玩家 ${p.seat}`;
      }
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
      if (req.method === "POST" && ["/api/match", "/api/demo", "/api/solo"].includes(url.pathname)) {
        const body = await readBody(req);
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        if (!/^[a-f0-9]{48}$/.test(token)) return sendJson(res, 400, { error: "浏览器身份无效，请返回首页重新加入。" });
        if (typeof body.name !== "string" || !body.name.trim()) return sendJson(res, 400, { error: "请输入昵称" });
        const demo = url.pathname === "/api/demo";
        const solo = url.pathname === "/api/solo";
        for (const room of rooms.values()) {
          if (room.friend || Boolean(room.demo) !== demo || Boolean(room.solo) !== solo) continue;
          releaseIdleSeats(room);
          advance(room);
          const me = room.players.find(p => p.token === token);
          if (me && room.phase !== "finished") {
            me.lastSeen = now();
            return sendJson(res, 200, state(room, me));
          }
        }
        const room = (!demo && !solo && [...rooms.values()].find(r => !r.friend && !r.demo && !r.solo && r.phase === "lobby" && r.players.some(p => !p.token))) || createRoom();
        room.demo = demo;
        room.solo = solo;
        if (solo) room.botHistory = [];
        const me = room.players.find(p => !p.token);
        me.token = token;
        me.name = body.name.trim().slice(0, 16);
        me.lastSeen = now();
        if (demo || solo) for (const p of room.players.slice(1)) {
          p.token = crypto.randomBytes(24).toString("hex");
          p.name = solo ? BOT_PROFILES[p.seat - 2].name : `模拟玩家 ${p.seat}`;
          if (solo) { p.bot = p.seat - 2; p.ready = true; }
        }
        return sendJson(res, 201, state(room, me));
      }

      if (req.method === "POST" && ["/api/friends/create", "/api/friends/join"].includes(url.pathname)) {
        const body = await readBody(req);
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        if (!/^[a-f0-9]{48}$/.test(token) || typeof body.name !== "string" || !body.name.trim()) return sendJson(res, 400, {error:"请输入昵称并允许浏览器保存身份。"});
        let room;
        if (url.pathname.endsWith("/create")) {
          room = [...rooms.values()].find(r=>r.friend && r.hostToken===token && r.phase!=="finished");
          if (!room) { room=createRoom(); room.friend=true; room.hostToken=token; room.botHistory=[]; room.rosterVersion=0; }
        } else {
          const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
          room=rooms.get(code);
          if (!room?.friend) return sendJson(res,404,{error:"好友房不存在，请检查房间码。"});
        }
        const existing=room.players.find(p=>p.token===token);
        if (existing) return sendJson(res,200,state(room,existing));
        if (room.phase!=="lobby") return sendJson(res,409,{error:"对局已开始，不能中途加入。"});
        const me=room.players.find(p=>!p.token);
        if (!me) return sendJson(res,409,{error:"房间已满，请房主先减少机器人数量。"});
        me.token=token; me.name=body.name.trim().slice(0,16); me.lastSeen=now();
        room.rosterVersion++;
        for (const p of room.players) p.ready=p.bot!==undefined;
        return sendJson(res,200,state(room,me));
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{6})(?:\/(\w+))?$/);
      if (match) {
        const room = rooms.get(match[1]);
        if (!room) return sendJson(res, 404, { error: "房间不存在，可能服务器已重启。" });
        releaseIdleSeats(room);
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const me = room.players.find(p => p.token === token);
        if (!me) return sendJson(res, 403, { error: "座位已失效，请返回首页重新加入。" });
        me.lastSeen = now();
        advance(room);
        const action = match[2];
        if (req.method === "GET" && !action) return sendJson(res, 200, state(room, me));
        if (req.method !== "POST" || !["join", "ready", "submit", "demo_step", "dismiss_rules", "configure_bots"].includes(action)) return sendJson(res, 404, { error: "操作不存在" });
        const body = await readBody(req);
        // Recheck after awaiting the request body: the deadline or round may have changed.
        if (me.token !== token) return sendJson(res, 403, { error: "座位已失效，请返回首页重新加入。" });
        advance(room);

        if (action === "configure_bots") {
          if (!room.friend || room.hostToken!==token) return sendJson(res,403,{error:"只有好友房房主能设置机器人。"});
          if (room.phase!=="lobby") return sendJson(res,409,{error:"开局后阵容固定。"});
          const ids=body.profiles;
          if (!Array.isArray(ids) || ids.length>4 || new Set(ids).size!==ids.length || ids.some(id=>!Number.isInteger(id)||id<0||id>=BOT_PROFILES.length)) return sendJson(res,400,{error:"请选择不重复的机器人类型。"});
          const humans=room.players.filter(p=>p.token && p.bot===undefined).length;
          if (humans+ids.length>5) return sendJson(res,409,{error:"真人与机器人合计不能超过五人。"});
          for (const p of room.players) if (p.bot!==undefined) { p.token=null; p.name=`玩家 ${p.seat}`; delete p.bot; }
          const empty=room.players.filter(p=>!p.token);
          ids.forEach((id,i)=>{const p=empty[i];p.bot=id;p.token=crypto.randomBytes(24).toString("hex");p.name=BOT_PROFILES[id].name;});
          room.rosterVersion++;
          for (const p of room.players) p.ready=p.bot!==undefined;
          return sendJson(res,200,state(room,me));
        }
        if (action === "dismiss_rules") {
          if (body.round !== room.round || room.phase !== "result" || !room.newRules.length || now() < room.scoreAnnouncementUntil) return sendJson(res, 409, { error: "当前没有可关闭的追加规则。" });
          me.rulesReadRound = room.round;
          return sendJson(res, 200, state(room, me));
        }
        if (action === "demo_step") {
          if (!room.demo || me.seat !== 1 || body.round !== room.round || !["lobby", "result"].includes(room.phase) || (now() < room.announcementUntil && me.rulesReadRound !== room.round)) return sendJson(res, 409, { error: "当前不能推进演示，请等待播报结束。" });
          begin(room);
          const active = room.players.filter(p => !p.eliminated);
          const victim = active.length === 2 ? me : active[active.length - 1];
          victim.score = -9;
          for (const p of active) { p.value = p === victim ? 100 : p.seat * 5; p.submitted = true; }
          settle(room);
          return sendJson(res, 200, state(room, me));
        }
        if (room.demo) return sendJson(res, 409, { error: "演示局请使用演示按钮。" });
        if (action === "join") {
          if (room.phase !== "lobby") return sendJson(res, 409, { error: "开始后不能改名" });
          if (typeof body.name !== "string" || !body.name.trim()) return sendJson(res, 400, { error: "请输入姓名" });
          me.name = body.name.trim().slice(0, 16);
        } else {
          if (body.round !== room.round || me.eliminated) return sendJson(res, 409, { error: "轮次已变化或你已淘汰，请同步后重试。" });
          if (action === "ready") {
            if (room.friend && body.rosterVersion !== room.rosterVersion) return sendJson(res,409,{error:"阵容已变化，请查看后重新准备。"});
            if (now() < room.announcementUntil && me.rulesReadRound !== room.round) return sendJson(res, 409, { error: "请等待记分和追加规则播报结束。" });
            if (!["lobby", "result"].includes(room.phase)) return sendJson(res, 409, { error: "当前不能准备" });
            me.ready = true;
            if (room.players.filter(p => !p.eliminated).every(p => p.token && p.ready)) begin(room);
          } else {
            if (room.phase !== "playing" || me.submitted) return sendJson(res, 409, { error: "本轮已截止或已提交，不能修改。" });
            const value = body.value;
            if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) return sendJson(res, 400, { error: "请输入 0～100 的整数。" });
            me.value = value;
            me.submitted = true;
            settle(room);
          }
        }
        return sendJson(res, 200, state(room, me));
      }
      if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "接口不存在" });
      if (req.method !== "GET") { res.writeHead(405); return res.end(); }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!["index.html", "player.html", "app.js", "player.js", "lobby.js", "styles.css", "background.png", "king-card.jpg"].includes(file)) { res.writeHead(404); return res.end("Not found"); }
      const data = await fs.promises.readFile(path.join(PUBLIC_DIR, file));
      const type = file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".png") ? "image/png" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      res.writeHead(200, { "content-type": type.startsWith("image/") ? type : `${type}; charset=utf-8`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end(data);
    } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : "服务器错误" }); }
  });
  const timer = setInterval(() => { for (const room of rooms.values()) advance(room); }, 250);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return { server, rooms, settle };
}
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) throw Object.assign(new Error("请求过大"), { status: 413 });
  }
  try {
    const parsed = JSON.parse(body || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw Object.assign(new Error("请求格式错误"), { status: 400 }); }
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createGameServer().server.listen(port, "0.0.0.0", () => {
    console.log(`方片 K 五人版：http://localhost:${port}`);
    for (const addresses of Object.values(os.networkInterfaces())) for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) console.log(`同 Wi-Fi：http://${address.address}:${port}`);
    }
  });
}
module.exports = { createGameServer };



