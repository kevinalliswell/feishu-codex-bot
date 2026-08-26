# Feishu Codex

把飞书里的随手文字和口述，安全地写进 Mac 上的 Obsidian。每天的多条记录按时间戳追加到同一个 Markdown，复盘时再整理进长期笔记。

```text
飞书私聊机器人
  ├─ /note 或 /n ───────────────┐
  └─ 语音 ─> FFmpeg ─> Whisper ─┤
                                  ↓
       00_Inbox/feishu/每日口述/YYYY-MM-DD.md
                                  ↓ 每周复盘
       生活笔记/家庭育儿、健康、技能学习或生活随笔
```

## macOS 桌面版

`v0.2.0-beta.1` 起，Feishu Codex 是一个 Apple Silicon macOS 菜单栏 App：

- 下载 DMG，拖入 Applications，通过向导配置，不需要安装 Node.js、Homebrew、FFmpeg 或 whisper.cpp。
- App Secret 和 API Key 保存在 macOS 钥匙串，不写进 `config.json`。
- FFmpeg、whisper.cpp 和 Node bridge 都作为 arm64 Sidecar 随 App 分发。
- Obsidian Vault 与 Codex 目录必须通过系统目录选择器授权。
- Codex 只响应 `/codex`；具有工作区写权限的请求必须在 Mac 上逐次确认，确认五分钟后失效。
- Beta 更新包使用独立密钥签名并强制验签。

当前 Beta 使用 ad-hoc 签名，macOS 第一次打开时仍会显示 Gatekeeper 提示。请在 Finder 中右键 App，选择“打开”并再次确认。面向普通用户的 `v0.2.0` 稳定版必须完成 Apple Developer ID 签名和公证后才发布。

### 安装与首次配置

1. 从 [GitHub Releases](https://github.com/kevinalliswell/feishu-codex-bot/releases) 下载 Apple Silicon DMG。
2. 将 `Feishu Codex.app` 拖进 Applications，然后打开。
3. 在飞书开放平台创建企业自建应用，开启机器人能力并订阅 `im.message.receive_v1`，接收方式选择长连接。
4. 在向导中填写 App ID、App Secret 和允许的私聊 `chat_id`；App 会立即验证凭据。
5. 选择 Obsidian Vault。默认写入 `00_Inbox/feishu/每日口述`。
6. 下载约 548 MB 的 Whisper 模型。下载支持断点续传、SHA-256 校验和失败重试。
7. 按需配置 Codex 工作目录、OpenAI-compatible 服务和图片生成服务，然后运行端到端自检。

所有功能都会显示在设置页。缺少模型、密钥或目录授权时，模块会明确标为“待配置”，不会伪装成可用。

### 日常使用

在白名单私聊中发送：

```text
/n 今天陪孩子去公园了。
/note 晚上散步三十分钟，状态不错。
```

也可以直接发送语音。当天的内容会写成：

```markdown
# 每日口述 2026-08-26

## 09:15
上午整理了今天的安排。

## 14:40
下午完成了半小时运动。
```

需要让 Codex 处理任务时必须显式发送：

```text
/codex 总结这个项目最近的变更
```

菜单栏提供“打开今日笔记”“暂停 / 继续接收”“重新连接”“打开设置”和“退出”。关闭设置窗口不会停止后台连接。

### 从 v0.1 源码版迁移

首次启动会检查旧版 `com.kevin.feishu-codex` LaunchAgent。也可以在欢迎页手动选择原来的 `.env`：

1. App 只把 `.env` 当作数据解析，不执行其中的 Shell 表达式。
2. 页面先展示 App ID、Vault、目录和白名单等非敏感预览。
3. 密钥转入 macOS 钥匙串；原 `.env` 以 `0600` 权限备份到应用数据目录。
4. 完成飞书连接与 Obsidian 写入自检后，再由用户明确停用旧服务。

新版验证成功前不会自动停用旧进程，以便回退；验证后应尽快停用旧服务，避免两个连接同时消费飞书消息。

## 隐私与安全边界

- 普通配置：`~/Library/Application Support/Feishu Codex/config.json`，schema 版本化、原子写入、权限 `0600`。
- 密钥：macOS Keychain，界面只显示“已配置”，不回显完整值。
- 模型和队列：`~/Library/Application Support/Feishu Codex/`。
- 日志：`~/Library/Logs/Feishu Codex/`，限制长度并脱敏，不记录笔记正文或完整提示词。
- 只处理配置允许名单内的飞书私聊；桌面模式拒绝空白名单启动。
- Vault 目标在写入前解析真实路径，阻止 `..`、绝对相对目录和软链接逃逸。
- 前端不能执行任意命令。Rust 只暴露固定命令，Tauri 只允许声明过的 Sidecar 和更新能力。
- Codex 永不使用跳过 sandbox 或 approval 的危险参数。只读目录自动执行；可写目录每次在本机确认。
- 语音由本机 FFmpeg 和 whisper.cpp 处理，不发送到云端语音识别服务。飞书仍负责提供消息事件与音频文件。

更多信息见 [PRIVACY.md](./PRIVACY.md) 和 [SECURITY.md](./SECURITY.md)。

## 桌面架构

```text
React / TypeScript UI
        │ 固定 Tauri commands + events
        ↓
Rust main process
  ├─ config / Keychain / path authorization
  ├─ tray / autostart / updater / approval TTL
  └─ versioned NDJSON over stdin/stdout
        ↓
Node Sidecar
  ├─ Feishu long connection
  ├─ persistent queue and deduplication
  ├─ daily Markdown append
  └─ fixed ffmpeg / whisper-cli / Codex adapters
```

协议只有三种消息：请求、响应和事件，当前 `version` 为 `1`。前端不访问本地端口；桌面 Sidecar 的健康检查仅绑定 loopback，并限制请求体大小。

更完整的设计和威胁边界见 [docs/architecture.md](./docs/architecture.md)。

## 从源码开发

要求：Apple Silicon Mac、Node.js 22+、Rust stable、Xcode Command Line Tools、CMake。只有开发模式会借用本机 Homebrew 的 FFmpeg/whisper.cpp；Release 始终从固定版本源码构建最小化 Sidecar。

```bash
npm ci
npm run check
cargo test --manifest-path desktop/src-tauri/Cargo.toml
npm run tauri:dev
```

生成 Release 构建：

```bash
npm run tauri:build
```

该命令会构建：

- `@yao-pkg/pkg` 打包的 Node 22 arm64 Sidecar；
- 固定为 FFmpeg 9.0.1 的最小 LGPL 静态构建；
- 固定为 whisper.cpp 1.9.2 的 arm64 静态构建；
- Tauri `.app`、DMG 和带签名的更新包。

常用检查：

```bash
npm run check
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
npm run licenses:generate
```

旧的纯 Node 入口仍保留给开发者和迁移用户：

```bash
cp .env.example .env
node --env-file=.env src/server.mjs
```

桌面版不会读取项目目录里的 `.env`，除非用户在迁移页面明确选择它。

## 发布与版本管理

项目遵循 Semantic Versioning。推送 `v0.2.*` 标签会触发 macOS arm64 发布流水线，生成 DMG、更新包、SHA-256、SPDX SBOM 和第三方许可证清单。流水线会先扫描完整 Git 历史中的密钥。

更新包使用 Tauri 独立密钥签名。私钥只存在于维护者钥匙文件和 GitHub Actions Secret `TAURI_SIGNING_PRIVATE_KEY`；仓库中的公钥用于客户端验签。Beta 的 `latest.json` 会发布到固定 `desktop-beta` 更新通道。

稳定版还需要这些 GitHub Secrets：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

没有 Apple Developer ID 时只能发布带 Gatekeeper 提示的测试版，不能把它描述为完整的一键安装。

## 路线图

- `v0.2.0-beta.1`：菜单栏骨架、Sidecar、配置 schema、Keychain、飞书测试和旧版迁移。
- `v0.2.0-beta.2`：内置 FFmpeg/Whisper、模型下载、Vault 授权与文字/语音完整链路。
- `v0.2.0-beta.3`：Codex 本机审批、图片配置、诊断、登录启动、更新和安装 QA。
- `v0.2.0`：Developer ID 签名、公证后的首个普通用户稳定版。
- `v0.3`：每周复盘、分类建议、模板与失败任务可视化重试。
- `v0.4`：Universal Binary/Intel、更多模型与服务商、配置导入导出。
- `v1.0`：稳定迁移与备份、兼容性承诺、安全审计和完整用户文档。

## 贡献与许可

欢迎 Issue 和 Pull Request。提交前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。项目使用 [MIT License](./LICENSE)；随 App 分发的第三方组件按各自许可发布，见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
