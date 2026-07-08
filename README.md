# Feishu Codex Bridge

把飞书订阅事件桥接到你本地的 Codex 服务，适合用手机在飞书里发指令，再把结果回到原会话。

## 当前实现

- 支持飞书长连接接收事件
- 保留飞书 `webhook` 模式作为备用
- 支持文本消息事件解析
- 支持按 `chat_id` 白名单限制触发范围
- 支持私聊直接触发、群聊 `@机器人` 触发，以及 `/codex` 显式命令
- 默认用飞书互动卡片回发 Codex 结果
- 支持 5 种 Codex 适配模式：
  - `http`: 转发到本地 HTTP 服务
  - `openai_compatible`: 调用 OpenAI-compatible Chat Completions API
  - `cli`: 通过标准输入调用本地 CLI
  - `codex_exec`: 原生调用 `codex exec`
  - `mock`: 本地联调
- 支持通过飞书机器人把结果回发到原会话

## 快速开始

1. 复制环境变量

```bash
cp .env.example .env
```

2. 按你的情况修改 `.env`

如果你本机装的是 Codex CLI，推荐直接用 `codex_exec`：

```env
PORT=3000
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=
FEISHU_DELIVERY_MODE=long_connection
FEISHU_TRIGGER_MODE=mention_or_prefix
FEISHU_REPLY_FORMAT=card
COMMAND_PREFIX=/codex
CODEX_MODE=codex_exec
CODEX_EXEC_COMMAND=codex
CODEX_EXEC_WORKDIR=/Users/kevin/CodeWorkSpace/garrytan-gstack
CODEX_EXEC_ARGS=exec,--skip-git-repo-check
```

如果不填 `CODEX_EXEC_WORKDIR`，bridge 会默认取你启动服务时所在位置对应的 git 仓库根目录。

如果你已经另外包了一层本地 HTTP 服务，也可以用 `http` 模式：

```env
PORT=3000
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
COMMAND_PREFIX=/codex
CODEX_MODE=http
CODEX_HTTP_URL=http://127.0.0.1:4000/run
```

如果你想走第三方 OpenAI-compatible API：

```env
CODEX_MODE=openai_compatible
OPENAI_COMPAT_PROVIDER=qhaigc
QHAIGC_API_KEY=sk_xxx
OPENAI_COMPAT_TEMPERATURE=0.2
OPENAI_COMPAT_MAX_TOKENS=2000
```

内置供应商预设：

```env
# Xingwan: https://xingwan.store/v1, 默认模型 gpt-5.4-mini
OPENAI_COMPAT_PROVIDER=xingwan
XINGWAN_API_KEY=sk_xxx
```

```env
# QHAIGC: https://api.qhaigc.net/v1, 默认模型 deepseek-chat
OPENAI_COMPAT_PROVIDER=qhaigc
QHAIGC_API_KEY=sk_xxx
```

切回本地 Codex CLI：

```env
CODEX_MODE=codex_exec
```

切换到第三方供应商：

```env
CODEX_MODE=openai_compatible
OPENAI_COMPAT_PROVIDER=xingwan
```

或者：

```env
CODEX_MODE=openai_compatible
OPENAI_COMPAT_PROVIDER=qhaigc
```

切换后重启服务：

```bash
launchctl kickstart -k gui/$(id -u)/com.kevin.feishu-codex
```

如果供应商的完整接口不是 `BASE_URL/chat/completions`，或你想覆盖默认模型，可以直接设置：

```env
OPENAI_COMPAT_BASE_URL=https://example.com/v1
OPENAI_COMPAT_CHAT_COMPLETIONS_URL=https://example.com/custom/chat/completions
OPENAI_COMPAT_MODEL=your-model
```

注意：`openai_compatible` 模式适合普通问答、总结、生成文本。它不会像本地 `codex_exec` 一样直接读写本地仓库或执行 shell 命令。

3. 启动服务

```bash
node --env-file=.env src/server.mjs
```

4. 在飞书开放平台里把事件订阅方式切到“使用长连接接收事件”

飞书后台保存时要求本地 bridge 已经在线，否则会提示应用未建立长连接。

5. 飞书里发：

私聊机器人时可以直接发：

```text
帮我总结今天这个仓库要做什么
```

群聊里建议发：

```text
@机器人 帮我总结今天这个仓库要做什么
```

也可以继续用显式命令：

```text
/codex 帮我总结今天这个仓库要做什么
```

`/codex` 的作用是防止群聊里普通聊天误触发本地 Codex。默认 `FEISHU_TRIGGER_MODE=mention_or_prefix` 下，私聊无需前缀，群聊 `@机器人` 无需前缀，`/codex` 仍然可用。

## 消息流转

```text
Feishu Long Connection
  -> local bridge process
  -> local Codex service
  -> send message back to chat
```

## 本地 Codex 接口约定

### `codex_exec` 模式

bridge 会执行一条类似这样的命令：

```bash
codex exec --skip-git-repo-check -C /your/project-root --output-last-message /tmp/last-message.txt -
```

然后把飞书里的文本作为标准输入喂给 Codex，并把最后一条模型消息回发到飞书。

这个模式最适合你现在这种本机已经能跑：

```bash
codex
```

或者：

```bash
codex exec "Summarize recent commits"
```

的场景，不需要 MCP。

## 备用 webhook 模式

如果你以后想切回 `ngrok + webhook`，在 `.env` 里改成：

```env
FEISHU_DELIVERY_MODE=webhook
```

然后把飞书事件订阅地址配置为：

```text
https://你的-ngrok-域名/webhook/feishu
```

### `http` 模式

如果你用 `http` 模式，bridge 默认会发：

```json
{
  "prompt": "用户输入的内容",
  "source": "feishu",
  "context": {
    "chatId": "oc_xxx",
    "messageId": "om_xxx",
    "chatType": "p2p",
    "text": "/codex hello",
    "eventId": "evt_xxx",
    "eventType": "im.message.receive_v1"
  }
}
```

你的本地服务返回以下任一字段即可：

```json
{ "reply": "..." }
```

```json
{ "output": "..." }
```

```json
{ "result": "..." }
```

或者直接返回纯文本。

## 验证

```bash
npm run check
```

## macOS 开机自启

本机已配置用户登录后自动启动：

```text
/Users/kevin/Library/LaunchAgents/com.kevin.feishu-codex.plist
```

查看状态：

```bash
launchctl print gui/$(id -u)/com.kevin.feishu-codex
```

重启服务：

```bash
launchctl kickstart -k gui/$(id -u)/com.kevin.feishu-codex
```

停止并取消当前登录会话中的启动：

```bash
launchctl bootout gui/$(id -u) /Users/kevin/Library/LaunchAgents/com.kevin.feishu-codex.plist
```

日志位置：

```text
logs/launchd.out.log
logs/launchd.err.log
```

## 后续建议

- 给危险命令加二次确认
- 给每条消息加用户白名单
- 加队列，避免同一聊天并发打爆本地服务
- 如果你的 Codex 服务不是 HTTP，而是 CLI 或 WebSocket，再把适配层改成对应协议即可
