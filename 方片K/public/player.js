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
let announcementEnds = 0;
announcement.addEventListener("cancel", event => event.preventDefault());
function showAnnouncement(state) {
  const eliminated = state.result?.eliminated || [];
  const key = `${code}:${state.round}`;
  if (!eliminated.length || key === announcementKey) return;
  announcementKey = key;
  const remaining = (state.announcementUntil || 0) - state.serverNow;
  if (remaining <= 0) return;
  setText("#announcementTitle", state.me.eliminated ? "你已淘汰" : state.newRules.length ? "追加规则公布" : "对局结束");
  setText("#announcementEliminated", eliminated.map(p => `${p.name}：${p.score} 分，已淘汰`).join("；"));
  renderRules(document.querySelector("#announcementRules"), state.newRules);
  announcementEnds = performance.now() + remaining;
  announcement.showModal();
}
setInterval(() => {
  if (!announcement.open) return;
  const seconds = Math.max(0, Math.ceil((announcementEnds - performance.now()) / 1000));
  setText("#announcementCountdown", `${seconds} 秒后自动关闭；播报期间不会进入下一轮。`);
  if (!seconds) { announcement.close(); controls(); }
}, 200);
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
  saveNameBtn.disabled = busy || !connected || latest?.phase !== "lobby";
  nameInput.disabled = saveNameBtn.disabled;
  readyBtn.disabled = busy || !connected || !me || me.eliminated || me.ready || !["lobby", "result"].includes(latest.phase);
  submitBtn.disabled = busy || !connected || !me || me.eliminated || me.submitted || latest.phase !== "playing";
  valueInput.disabled = submitBtn.disabled;
  const announcing = announcement.open || (latest?.announcementUntil || 0) > (latest?.serverNow || 0) + performance.now() - syncedAt;
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
  document.querySelector("#eliminationPanel").hidden = !me.eliminated;
  setText("#eliminationText", `最终得分 ${me.score} 分，已达到淘汰线。不能再选数或准备，可继续观看结果与剩余玩家对局。`);
  showAnnouncement(state);
  setText("#roomInfo", `房间 ${code} / 座位 ${me.seat}`);
  setText("#roundChip", state.round ? `第 ${state.round} 轮` : "等待开始");
  setText("#nameTitle", `${me.name} / ${me.score} 分`);
  if (document.activeElement !== nameInput) nameInput.value = me.name;
  if (me.submitted && state.phase === "playing") valueInput.value = me.value;
  const status = state.phase === "finished" ? (state.result.allEliminated ? "全员淘汰，本局无最终胜者。" : "游戏结束。")
    : me.eliminated ? "你已淘汰，可以继续观看。"
    : state.phase === "playing" ? (me.submitted ? `已锁定数字 ${me.value}，等待结算。` : "请输入数字并确认提交。")
    : me.ready ? "已准备，等待其他存活玩家。" : "阅读规则和结果后，点击准备。";
  setText("#myStatus", state.demo && state.phase !== "finished" ? "点击上方“演示下一轮”查看下一个淘汰场景。" : status);
  readyBtn.textContent = state.phase === "lobby" ? "准备开始" : state.newRules.length ? "已读规则，准备下一轮" : "准备下一轮";
  document.querySelector("#newRulesPanel").hidden = !state.newRules.length || state.phase === "finished";
  renderRules(document.querySelector("#newRules"), state.newRules);
  renderRules(document.querySelector("#rules"), state.visibleRules);
  renderPlayers(document.querySelector("#players"), state.players, state.phase);
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
    const state = await api.post(`/api/rooms/${code}/${action}`, { ...data, round: latest.round });
    connected = true;
    render(state);
  } catch (error) {
    setText("#error", `${error.message} 正在重新同步；提交是否成功以服务器状态为准。`);
    try { await refresh(); } catch { connected = false; }
  } finally { busy = false; controls(); }
}
demoStepBtn.addEventListener("click", () => act("demo_step", {}));
saveNameBtn.addEventListener("click", () => act("join", { name: nameInput.value }));
readyBtn.addEventListener("click", () => act("ready", {}));
submitBtn.addEventListener("click", () => {
  if (!valueInput.value.trim() || !valueInput.checkValidity()) return setText("#error", "请输入 0～100，最多两位小数。");
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




