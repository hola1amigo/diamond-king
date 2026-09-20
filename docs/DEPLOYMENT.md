# 自行部署方片 K

只需一位组织者部署服务，其他玩家打开他的同一个 HTTPS 网址。不同服务器之间没有公共大厅，也不会互相同步房间。客户端使用相对路径请求本机服务，不需要修改为作者的服务器地址。

## 推荐：Fork 后部署到自己的 Render

1. 在本仓库点击 **Fork**，将代码复制到自己的 GitHub 账号。
2. 登录自己的 [Render](https://dashboard.render.com/) 账号，连接 GitHub，并只授权需要部署的仓库。
3. 选择 **New → Blueprint**，选择自己的 Fork，使用根目录的 `render.yaml`。
4. 核对创建的是一个 **Free Web Service**，没有额外数据库或付费服务，再部署。套餐是否可用、额度与收费以当时平台页面为准。
5. 状态变为 Live 后，打开 Render 为该服务分配的 HTTPS 网址，并把它发给朋友。

Fork 的代码不会因作者提交而自行合并更新。需要新版时，在自己的 Fork 使用 **Sync fork**；如果服务开启自动部署，自己的分支更新后会触发部署。请在没有正在进行的对局时更新。无需购买独立域名即可使用平台分配的网址。

配置参考：[Render Blueprint](https://render.com/docs/blueprint-spec)。

### 手动创建 Web Service

也可以连接自己的 Fork 后选择 **New → Web Service**：

| 字段 | 填写内容 |
| --- | --- |
| Runtime / Language | Node |
| Branch | main |
| Root Directory | **留空**，不要填写中文目录 |
| Build Command | `node --test "方片K/server.test.js"` |
| Start Command | `node "方片K/server.js"` |
| Instance Type | Free（如账号当前支持） |
| Environment Variable | `NODE_VERSION` = `22` |
| Health Check Path | `/health` |

项目没有第三方 npm 依赖，构建阶段直接运行测试。服务器自动读取平台提供的 `PORT`，无需手动写死端口。

Free 服务空闲 15 分钟会休眠，之后首次打开可能需要约一分钟唤醒；平台也可能重启实例。**这不是只能玩 15 分钟，但服务重启会使内存中的房间消失。**免费服务受额度限制，不作为持续在线保证。详见 [Render 免费服务说明](https://render.com/docs/free)。

## 自己的 Node.js 服务器

安装 Node.js 22，下载或克隆仓库，在仓库根目录运行：

```sh
node --test "方片K/server.test.js"
node "方片K/server.js"
```

默认监听 `0.0.0.0:3000`。如需修改端口，在进程环境设置 `PORT`：

```powershell
# Windows PowerShell
$env:PORT = '8080'
node "方片K/server.js"
```

```sh
# Linux / macOS
PORT=8080 node "方片K/server.js"
```

公网部署时，通过托管平台或反向代理提供 HTTPS，并把首页、静态文件和 `/api/` 转发到同一个 Node 服务。按服务器环境使用进程管理器维持运行；关闭前台终端会停止前台服务。当前版本没有自动加载 `.env` 文件的代码，请使用平台环境变量或上面的 shell 设置方式。

只运行 **一个 Node 进程、一个服务实例**。不要开启集群或多个副本，否则内存房间无法在进程间共享。无需数据库、Redis 或机器人 API key。

不能只上传到 GitHub Pages：它提供静态网站托管，本项目还需要运行 Node 后端。参见 [GitHub Pages 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

## 部署后检查

1. 访问 `/health`，确认 HTTP 200；这只能说明服务存活。
2. 打开首页，用单人挑战检查准备、提交、记分与下一轮。
3. 用两个独立浏览器身份创建/加入同一个好友房，添加三名机器人并开局。
4. 检查选数在结算前不会向对方展示；刷新后能够恢复原座位。
5. 确认手机通过部署后的 HTTPS 网址可进入相同房间。多个普通标签页共享身份，不能代表多个玩家。

## 常见问题

**其他人自建后会消耗作者的服务器资源吗？**

不会。游戏和机器人运行在部署者自己的服务器，房间也只存在于该服务器内存。

**源码公开后，原先的私用站点还能用吗？**

可以保留原来的服务和网址。仓库可见性与站点访问权限独立；知道旧网址的人依然可以访问旧服务，公开源码不会自动给旧站点加密码。

**朋友进不来或没有进入同一房间？**

先确认使用同一个部署的网址，而不是 localhost、服务器内部 IP 或不同 Fork 的服务网址。熟人组队使用相同好友房码；自动匹配可能把超过五人的访客分配到不同房间。

**更新或重启后对局不见了？**

当前没有持久化存档。这是内存服务的限制，浏览器身份恢复只能恢复仍存在的对局。
