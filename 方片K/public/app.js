const api = {
  async post(path, data = {}, timeout = 8000) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      signal: AbortSignal.timeout(timeout), body: JSON.stringify(data)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "请求失败");
    return body;
  },
  async get(path) {
    const response = await fetch(path, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "请求失败");
    return body;
  }
};

function params() {
  return new URLSearchParams(location.search);
}



function renderRules(el, rules) {
  el.innerHTML = rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("");
}

function animateSettlement(el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.querySelectorAll(".round-winner").forEach(node => node.animate([
    { borderColor: "#fff", boxShadow: "0 0 12px #fff5" },
    { borderColor: "#777", boxShadow: "0 0 0 #fff0" },
    { borderColor: "#fff", boxShadow: "0 0 12px #fff5" }
  ], { duration: 1200, iterations: 3 }));
  el.querySelectorAll(".score-change").forEach(node => node.animate([
    { transform: "translateY(-8px)", opacity: 0 },
    { transform: "translateY(0)", opacity: 1 }
  ], { duration: 700, easing: "ease-out" }));
}

function settlementTarget(result) {
  return `<div class="settlement-target"><span>结算目标值</span><strong>${result.target ?? "无"}</strong><small>平均数 ${result.average ?? "无"} × 0.8</small></div>`;
}

function renderPlayers(el, players, phase, result) {
  const view = JSON.stringify([players, phase, result]);
  if (el.dataset.view === view) return;
  el.dataset.view = view;
  el.innerHTML = players.map((player) => `
    <article class="player ${player.eliminated ? "eliminated" : ""} ${result?.winners.some(p => p.seat === player.seat) ? "round-winner" : ""}">
      <div class="row">
        <strong>${escapeHtml(player.name)}</strong>
        <span class="score ${result?.losses.some(p => p.seat === player.seat && p.deduction) ? "score-change" : ""}">${player.score} 分</span>
      </div>
      <p class="muted">座位 ${player.seat}</p>
      ${result?.winners.some(p => p.seat === player.seat) ? '<p class="winner-label">本轮获胜</p>' : ''}
      <p>${!player.joined ? "等待玩家加入" : player.eliminated ? '<span class="danger">已淘汰</span>' : phase === 'playing' ? (player.submitted ? '<span class="ok">已提交</span>' : '等待提交') : (player.ready ? '已准备' : '未准备')}</p>
    </article>
  `).join("");
  if (result && el.dataset.animatedRound !== String(result.round)) {
    el.dataset.animatedRound = String(result.round);
    animateSettlement(el);
  }
}

function renderResult(el, result) {
  if (!result) {
    el.innerHTML = `<p class="muted">等待本轮结算。</p>`;
    return;
  }

  const values = result.values
    .map((item) => `${escapeHtml(item.name)}: ${item.value ?? "超时"}`)
    .join(" / ");
  const winners = result.winners.map((item) => escapeHtml(item.name)).join("、");
  const winnerLine = winners ? `<p class="ok">胜者：${winners}</p>` : `<p class="danger">无人获胜</p>`;
  const duplicated = result.duplicated && result.duplicated.length
    ? `重复失效：${result.duplicated.join("、")}`
    : "";
  const final = result.finalWinner
    ? `<p class="ok"><strong>${escapeHtml(result.finalWinner.name)} 获得最终胜利。</strong></p>`
    : "";
  const extra = [
    duplicated,
    result.exactHit ? "精确命中，失败者加罚。" : "",
    result.specialRule ? "触发 0 与 100 特例。" : ""
  ].filter(Boolean).join(" ");

  el.innerHTML = `
    <p><strong>第 ${result.round} 轮</strong></p>
    ${settlementTarget(result)}
    <p>输入：${values}</p>
    ${winnerLine}
    <p class="blue">${escapeHtml(extra)}</p>
    <p>${result.losses.map(item => `${escapeHtml(item.name)}：${item.timedOut ? "超时，" : ""}扣 ${item.deduction} 分`).join(" / ")}</p>
    ${final}${result.allEliminated ? "<p>全员淘汰，本局无最终胜者。</p>" : ""}
  `;
}

function renderHistory(el, history) {
  el.innerHTML = history.length
    ? history.map((item) => `<div>${escapeHtml(item)}</div>`).join("")
    : `<div>暂无记录</div>`;
}

function setText(id, text) {
  const el = document.querySelector(id);
  if (el) el.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


