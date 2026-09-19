const code = params().get("room");
let token;
try { token = localStorage.getItem("diamond-king-token"); } catch {}
api.token = token;
const nameInput = document.querySelector("#nameInput");
const valueInput = document.querySelector("#valueInput");
const saveNameBtn = document.querySelector("#saveNameBtn");
const readyBtn = document.querySelector("#readyBtn");
const submitBtn = document.querySelector("#submitBtn");
const announcement = document.querySelector("#announcement");
const demoStepBtn = document.querySelector("#demoStepBtn");
let announcementKey = null;
announcement.addEventListener("cancel", event => event.preventDefault());
function showAnnouncement(state) {
  if (!state?.result) { if (announcement.open) announcement.close(); return; }
  const serverTime = state.serverNow + performance.now() - syncedAt;
  const scoring = serverTime < state.scoreAnnouncementUntil;
  const victory = !scoring && Boolean(state.result.finalWinner);
  const active = serverTime < state.announcementUntil;
  if (!active || (!scoring && !victory && state.me.rulesDismissed)) {
    if (announcement.open) { announcement.close(); controls(); }
    return;
  }
  // New rules are supplied by the server only after the scoring broadcast ends.
  if (!scoring && !victory && !state.newRules.length) return;
  const key = `${code}:${state.round}:${scoring ? "score" : victory ? "victory" : "rules"}`;
  if (key !== announcementKey) {
    announcementKey = key;
    announcement.dataset.phase = scoring ? "score" : victory ? "victory" : "rules";
    announcement.scrollTop = 0;
    document.querySelector("#announcementClose").hidden = scoring || victory;
    document.querySelector("#announcementCountdown").hidden = victory;
    setText("#announcementTitle", scoring ? `第 ${state.round} 轮 · 记分播报` : victory ? "游戏结束" : state.earlyRuleUnlock ? "追加规则 1 · 提前解锁" : "追加规则公布");
    const eliminated = state.result.eliminated || [];
    setText("#announcementEliminated", scoring && eliminated.length ? `本轮淘汰：${eliminated.map(p => `${p.seat} 号 ${p.name}（${p.score} 分）`).join("、")}` : "");
    const score = document.querySelector("#announcementScore");
    score.hidden = !scoring && !victory;
    if (victory) {
      const winner = state.result.finalWinner;
      score.innerHTML = `<p class="ok">${escapeHtml(winner.name)} 获得胜利</p><p>方片K挑战结束</p>`;
    }
    if (scoring) {
      const r = state.result;
      const label = p => `${p.seat} 号 ${escapeHtml(p.name)}`;
      const winners = r.winners.map(label).join("、");
      score.innerHTML = `<div class="board-selections" aria-label="各玩家选数">${r.values.map(p => `<div><span>${p.seat} 号</span><strong>${p.value ?? "超时"}</strong></div>`).join("")}</div>
        <div class="board-equation" aria-label="平均数乘以零点八得到结算目标值"><div class="board-average"><span>平均数</span><strong>${r.average ?? "无"}</strong></div><span class="board-operator">×</span><div class="board-factor"><span>常数</span><strong>0.8</strong></div><span class="board-operator">=</span><div class="board-target"><span>结算目标值</span><strong>${r.target ?? "无"}</strong></div></div>
        <p class="ok">${winners ? `${winners}${r.specialRule ? "触发 0／100 特例" : "最接近目标值"}，本轮获胜。` : "本轮无人获胜。"}</p>
        ${r.exactHit ? '<p class="board-note">获胜者命中四舍五入后的目标，已提交失败者扣 2 分。</p>' : ''}
        <div class="settlement-players">${r.values.map(p => {
          const deduction = r.losses.find(loss => loss.seat === p.seat)?.deduction || 0;
          const total = state.players.find(player => player.seat === p.seat).score;
          const won = r.winners.some(winner => winner.seat === p.seat);
          return `<div class="settlement-player ${won ? "round-winner" : ""}"><span class="board-outcome">${won ? "WIN · 本轮获胜" : total <= -10 ? "OUT · 已淘汰" : "本轮扣分"}</span><div class="board-seat" aria-label="${p.seat} 号玩家">${String(p.seat).padStart(2, "0")}</div><strong class="board-name">${escapeHtml(p.name)}</strong><span class="board-choice">${p.value === null ? "超时未提交" : `选择 ${p.value}`}</span><div class="settlement-points"><span class="${deduction ? "danger" : "muted"}">扣 ${deduction} 分</span><div class="board-total"><span>${total + deduction} → </span><strong class="${deduction ? "score-change" : ""}">${total}</strong></div><small>累计积分</small></div></div>`;
        }).join("")}</div>
        ${r.duplicated.length ? `<p>重复失效数字：${r.duplicated.join("、")}</p>` : ""}
        ${r.finalWinner ? `<p class="ok">${label(r.finalWinner)} 获得最终胜利。</p>` : r.allEliminated ? "<p>全员淘汰，本局无最终胜者。</p>" : ""}`;
    }
    renderRules(document.querySelector("#announcementRules"), scoring || victory ? [] : state.newRules);
    if (!announcement.open) announcement.showModal();
    if (scoring) animateSettlement(score);
  }
  const seconds = Math.max(0, Math.ceil(((scoring ? state.scoreAnnouncementUntil : state.announcementUntil) - serverTime) / 1000));
  setText("#announcementCountdown", `${seconds} 秒后${scoring && state.announcementUntil > state.scoreAnnouncementUntil ? state.result.finalWinner ? "播报最终胜利" : "播报追加规则" : "关闭"}${state.phase === "finished" ? "。" : "；播报期间不会进入下一轮。"}`);
}
setInterval(() => showAnnouncement(latest), 200);
let latest = null;
let busy = false;
let polling = false;
let revision = 0;
let connected = false;
let remainingAtSync = 0;
let syncedAt = 0;

function countdown() {
  const el = document.querySelector("#timer");
  if (!latest || latest.phase !== "playing") {
    el.textContent = latest?.phase === "finished" ? "游戏结束" : latest?.demo ? "演示模式 · 手动推进" : "等待全员准备";
    el.className = "";
    return;
  }
  const seconds = Math.max(0, Math.ceil((remainingAtSync - (performance.now() - syncedAt)) / 1000));
  el.textContent = seconds ? `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${seconds <= 10 ? " · 即将截止" : ""}` : "已到截止时间，等待服务器结算";
  el.className = seconds <= 30 ? "danger" : "";
  if (!seconds) { submitBtn.disabled = true; valueInput.disabled = true; }
}
function controls() {
  const me = latest?.me;
  document.querySelector("#saveBotsBtn").disabled = busy || !connected || !latest?.isHost || latest?.phase !== "lobby";
  saveNameBtn.disabled = busy || !connected || latest?.phase !== "lobby";
  nameInput.disabled = saveNameBtn.disabled;
  readyBtn.disabled = busy || !connected || !me || me.eliminated || me.ready || !["lobby", "result"].includes(latest.phase);
  submitBtn.disabled = busy || !connected || !me || me.eliminated || me.submitted || latest.phase !== "playing";
  valueInput.disabled = submitBtn.disabled;
  const announcing = announcement.open || (!latest?.me?.rulesDismissed && (latest?.announcementUntil || 0) > (latest?.serverNow || 0) + performance.now() - syncedAt);
  readyBtn.disabled ||= announcing || Boolean(latest?.demo);
  saveNameBtn.disabled ||= Boolean(latest?.demo);
  nameInput.disabled = saveNameBtn.disabled;
  submitBtn.disabled ||= Boolean(latest?.demo);
  valueInput.disabled = submitBtn.disabled;
  demoStepBtn.disabled = busy || !connected || announcing || latest?.phase === "finished";
  countdown();
}
function render(state) {
  if (latest && latest.round !== state.round) valueInput.value = "";
  latest = state;
  remainingAtSync = state.deadline === null ? 0 : state.deadline - state.serverNow;
  syncedAt = performance.now();
  const me = state.me;
  document.querySelector("#demoPanel").hidden = !state.demo;

  document.querySelector("#soloPanel").hidden = !state.solo;
  document.querySelector("#friendPanel").hidden = !state.friend;
  if (state.friend) {
    setText("#friendRoomCode",state.code);
    const editable=state.isHost && state.phase==="lobby";
    document.querySelector("#friendHost").hidden=!editable;
    const botBox=document.querySelector("#friendBots");
    if (editable && botBox.dataset.version!==String(state.rosterVersion)) {
      botBox.dataset.version=String(state.rosterVersion);
      botBox.innerHTML=state.botProfiles.map(p=>`<label><input type="checkbox" value="${p.id}" ${state.players.some(player=>player.bot===p.style)?"checked":""}> ${escapeHtml(p.name)} · ${escapeHtml(p.style)}</label>`).join("");
    }
    const bots=state.players.filter(p=>p.bot).length, humans=state.players.filter(p=>p.joined&&!p.bot).length;
    setText("#friendRoster",`当前：${humans} 名真人 + ${bots} 名机器人；${5-humans-bots} 个空位。${state.phase==="lobby"?"阵容变化后需重新准备。":"本局阵容已固定。"}`);
    document.querySelector("#saveBotsBtn").disabled=busy || !connected || !editable;
    setText("#connectionHint","好友房通过房间码加入。对局中离线不会暂停；同一浏览器输入原房间码可恢复座位。服务器重启后房间消失。");
  }
  if (state.solo) setText("#connectionHint", "对局中离线不会暂停计时。同一浏览器再次选择单人挑战可恢复未结束的对局；服务器重启后无法恢复。");
  document.querySelector("#eliminationPanel").hidden = !me.eliminated;
  setText("#eliminationText", `最终得分 ${me.score} 分，已达到淘汰线。不能再选数或准备，可继续观看结果与剩余玩家对局。`);
  showAnnouncement(state);
  setText("#roomInfo", `${state.friend ? "好友房 / " : state.solo ? "单人挑战 / " : ""}房间 ${code} / 座位 ${me.seat}`);
  setText("#roundChip", state.round ? `第 ${state.round} 轮` : "等待开始");
  setText("#nameTitle", `${me.name} / ${me.score} 分`);
  if (document.activeElement !== nameInput) nameInput.value = me.name;
  if (me.submitted && state.phase === "playing") valueInput.value = me.value;
  const status = state.phase === "finished" ? (state.result.allEliminated ? "全员淘汰，本局无最终胜者。" : "游戏结束。")
    : me.eliminated ? (state.solo ? "你已淘汰，机器人将在播报结束后自动继续，你可以观战。" : "你已淘汰，可以继续观看。")
    : state.phase === "playing" ? (me.submitted ? `已锁定数字 ${me.value}，等待结算。` : "请输入数字并确认提交。")
    : me.ready ? "已准备，等待其他存活玩家。" : state.solo ? "机器人会自动准备。阅读规则和结果后，点击准备即可开局。" : "阅读规则和结果后，点击准备。";
  setText("#myStatus", state.demo && state.phase !== "finished" ? "点击上方“演示下一轮”查看下一个淘汰场景。" : status);
  readyBtn.textContent = state.phase === "lobby" ? "准备开始" : state.newRules.length ? "已读规则，准备下一轮" : "准备下一轮";
  document.querySelector("#newRulesPanel").hidden = !state.newRules.length || state.phase === "finished";
  renderRules(document.querySelector("#newRules"), state.newRules);
  renderRules(document.querySelector("#rules"), state.visibleRules);
  renderPlayers(document.querySelector("#players"), state.players, state.phase, state.result);
  renderResult(document.querySelector("#result"), state.result);
  renderHistory(document.querySelector("#history"), state.history);
  controls();
}
async function refresh(expectedRevision = revision) {
  const state = await api.get(`/api/rooms/${code}`);
  if (expectedRevision !== revision) return;
  connected = true;
  render(state);
}
async function act(action, data) {
  if (busy || !latest) return;
  busy = true;
  revision += 1;
  controls();
  setText("#error", "");
  try {
    const state = await api.post(`/api/rooms/${code}/${action}`, { ...data, round: latest.round, rosterVersion: latest.rosterVersion });
    connected = true;
    render(state);
  } catch (error) {
    setText("#error", `${error.message} 正在重新同步；提交是否成功以服务器状态为准。`);
    try { await refresh(); } catch { connected = false; }
  } finally { busy = false; controls(); }
}
document.querySelector("#saveBotsBtn").addEventListener("click",()=>act("configure_bots",{profiles:[...document.querySelectorAll("#friendBots input:checked")].map(input=>Number(input.value))}));
document.querySelector("#announcementClose").addEventListener("click", () => act("dismiss_rules", {}));
demoStepBtn.addEventListener("click", () => act("demo_step", {}));
saveNameBtn.addEventListener("click", () => act("join", { name: nameInput.value }));
readyBtn.addEventListener("click", () => act("ready", {}));
submitBtn.addEventListener("click", () => {
  if (!valueInput.value.trim() || !valueInput.checkValidity() || !Number.isInteger(Number(valueInput.value))) return setText("#error", "请输入 0～100 的整数。");
  act("submit", { value: Number(valueInput.value) });
});
async function poll() {
  if (!busy && !polling) {
    polling = true;
    const expectedRevision = revision;
    try {
      await refresh(expectedRevision);
      if (expectedRevision === revision) setText("#error", "");
    } catch (error) {
      if (expectedRevision === revision) {
        connected = false;
        setText("#error", `连接失败：${error.message} 将自动重试，计时不会暂停。`);
      }
    } finally { polling = false; controls(); }
  }
  setTimeout(poll, 1000);
}
if (!code || !token) setText("#error", "请返回首页，输入昵称加入游戏。");
else poll();
setInterval(countdown, 200);





