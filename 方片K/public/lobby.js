const nickname = document.querySelector("#nickname");
const joinBtn = document.querySelector("#joinBtn");
try { nickname.value = localStorage.getItem("diamond-king-name") || ""; } catch {}
document.querySelector("#joinForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!nickname.value.trim()) return setText("#status", "请输入昵称。");
  joinBtn.disabled = true;
  setText("#status", "正在连接并分配房间；免费服务首次唤醒可能需要约一分钟，请稍候。这个页面可以重试，不会重复占座。");
  try {
    let token = localStorage.getItem("diamond-king-token");
    if (!/^[a-f0-9]{48}$/.test(token || "")) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("diamond-king-token", token);
    }
    localStorage.setItem("diamond-king-name", nickname.value.trim());
    api.token = token;
    const room = await api.post("/api/match", { name: nickname.value.trim() }, 90000);
    location.assign(`/player.html?room=${encodeURIComponent(room.code)}`);
  } catch (error) {
    setText("#status", `加入失败：${error.message}。请允许浏览器本地存储后重试；若服务刚启动，可稍后再试。`);
    joinBtn.disabled = false;
  }
});
