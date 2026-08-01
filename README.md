# Feishu Codex Bridge

把飞书变成 Mac 上 Codex 与 Obsidian 的移动入口：在手机里随手说、随手写，内容在本机处理后自动进入当天的 Markdown，等待每周复盘时再归档到长期笔记。

## 为什么做这个项目

有价值的生活记录经常消失在“稍后再整理”里。这个项目把记录阶段的摩擦降到最低，同时把隐私和文件所有权留在自己手上：

- **先捕捉，后整理**：当天的语音和文字先进入每日 Inbox，不在记录时打断思路做分类。
- **本地优先**：语音通过 Mac 上的 FFmpeg 与 whisper.cpp 转写，不依赖云端语音识别服务。
- **开放格式**：最终结果是普通 Markdown，不被某个 SaaS 或数据库锁定。
- **可靠可追溯**：消息先进入持久化队列，按飞书消息 ID 去重；同日记录集中在一个文件并保留时间戳。
- **兼顾行动与知识**：普通消息仍可调用 Codex，`/note` 与 `/n` 专门负责沉淀笔记。

## 核心工作流

```text
飞书机器人私聊
  ├─ 语音消息 ──> FFmpeg ──> whisper.cpp 本地转写 ─┐
  └─ /note 或 /n ───────────> 文字正文 ───────────┤
                                                   ↓
                                            本地持久化队列
                                                   ↓
                       00_Inbox/feishu/每日口述/YYYY-MM-DD.md
                                                   ↓ 每周复盘
                         生活笔记/家庭育儿、健康、技能学习或生活随笔
```

记录时只负责把想法留下；分类、提炼和迁移发生在复盘阶段。这让 Inbox 保持低门槛，也让“生活笔记”只留下值得长期复用的内容。

## 当前实现

- 支持飞书长连接接收事件
- 保留飞书 `webhook` 模式作为备用
- 支持文本消息事件解析
- 支持按 `chat_id` 白名单限制触发范围
- 支持私聊直接触发、群聊 `@机器人` 触发，以及 `/codex` 显式命令
- 默认用飞书互动卡片回发 Codex 结果
- 支持 Xingwan 图片生成并把图片发回飞书
- 支持把白名单私聊中的飞书语音在 Mac 本地转写，并写入 Obsidian 每日口述 Inbox
- 支持在白名单私聊中用 `/note` 或 `/n` 把文字追加到同一个 Obsidian 每日口述文件
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

图片生成走单独配置，默认使用 Xingwan 的 `gpt-image-2`：

```env
IMAGE_GENERATION_PROVIDER=xingwan
XINGWAN_API_KEY=sk_xxx
IMAGE_GENERATION_MODEL=gpt-image-2
IMAGE_GENERATION_SIZE=1024x1024
```

如果想给图片生成单独使用另一把 key，也可以设置：

```env
IMAGE_GENERATION_API_KEY=sk_xxx
```

图片请求会自动识别这些表达：

```text
画一张清晨山湖风景照
生成一张赛博朋克城市海报
/image a cinematic mountain lake at sunrise
```

文字聊天和图片生成可以使用不同供应商。例如：`CODEX_MODE=openai_compatible` + `OPENAI_COMPAT_PROVIDER=qhaigc` 负责文字，`IMAGE_GENERATION_PROVIDER=xingwan` 负责生图。

### 飞书语音和文字写入 Obsidian

语音笔记只接受白名单中的机器人私聊。事件先持久化到本地队列，飞书回调会立即完成；后台随后下载音频、使用 whisper.cpp 本地转写、追加到当天的 Markdown，并回复保存结果。音频和转写临时文件处理后会删除，任务成功后队列记录不会保留正文。

文字笔记使用同一份私聊白名单和持久化队列，不经过音频下载或转写。待处理或失败重试期间，正文仅保存在本机权限为 `0600` 的任务文件中，成功后会从任务记录中移除。发送以下任一命令即可：

```text
/note 今天陪孩子去公园了。
/n 今天完成了半小时运动。
```

语音和文字按 `Asia/Shanghai` 时区合并到当天的同一个文件，不同时间的记录以二级标题区分：

```markdown
# 每日口述 2026-08-01

## 09:15
上午整理了今天的安排。

## 14:40
下午完成了半小时运动。
```

语音转文字在 Mac 本地完成：飞书提供语音消息事件和音频文件，FFmpeg 负责转换音频格式，whisper.cpp 负责运行基于 OpenAI Whisper 的本地模型。当前没有文字转语音功能，也不会把语音正文发送到云端转写服务。

安装本地依赖：

```bash
brew install whisper-cpp ffmpeg
```

从 whisper.cpp 官方模型仓库下载中文效果更好的量化模型：

```bash
mkdir -p models
curl -L --fail --output models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

配置示例：

```env
VOICE_NOTES_ENABLED=true
OBSIDIAN_VAULT_PATH=/Users/kevin/Documents/Obsidian Vault
VOICE_NOTE_RELATIVE_DIR=00_Inbox/feishu/每日口述
VOICE_NOTE_ALLOWED_CHAT_IDS=oc_xxx
VOICE_NOTE_TIME_ZONE=Asia/Shanghai
VOICE_NOTE_QUEUE_DIR=.data/voice-note-jobs
VOICE_NOTE_LANGUAGE=zh
VOICE_NOTE_INITIAL_PROMPT=这是一段飞书口述笔记，内容涉及 Obsidian、Codex、每周复盘和生活笔记。
FFMPEG_COMMAND=/opt/homebrew/bin/ffmpeg
WHISPER_COMMAND=/opt/homebrew/bin/whisper-cli
WHISPER_MODEL_PATH=/absolute/path/to/models/ggml-large-v3-turbo-q5_0.bin
```

`VOICE_NOTE_ALLOWED_CHAT_IDS` 必须显式配置；为空时所有语音都会被拒绝。当前仅接收私聊语音，群聊语音不会写入笔记。默认输出到：

```text
00_Inbox/feishu/每日口述/YYYY-MM-DD.md
```

飞书下载消息音频需要应用具有“获取单聊、群组消息”或等价权限。接口和 `type=file` 参数说明见飞书官方文档：

https://open.feishu.cn/document/server-docs/im-v1/message/get-2?lang=zh-CN

whisper.cpp 的安装、模型和 CLI 参数说明：

https://github.com/ggml-org/whisper.cpp/blob/master/README.md

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

把文字记入当天的 Obsidian 文件：

```text
/note 今天需要复盘和孩子沟通时的耐心。
/n 晚上散步三十分钟，状态不错。
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
