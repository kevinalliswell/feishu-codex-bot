# Changelog

本文件记录每个正式版本中对使用者有影响的变化。项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.2.0-beta.1] - 2026-08-26

### Added

- 新增 Tauri 2 + React/TypeScript 菜单栏 App、六步首次配置向导和七个设置区域。
- 新增独立 Node arm64 Sidecar 与 version 1 NDJSON 协议，普通用户不再需要安装 Node.js。
- 新增 macOS Keychain 密钥存储、版本化原子配置、本地诊断和登录启动。
- 新增飞书凭据即时测试、Obsidian 系统目录选择、Whisper 模型断点续传与 SHA-256 校验。
- 新增 Codex 授权目录、五分钟单次本机写入审批、菜单栏状态和签名更新通道。
- 新增旧版 `.env` 与 LaunchAgent 迁移流程，以及 arm64 DMG、SBOM、校验和、许可证清单发布流水线。

### Security

- 桌面模式必须配置飞书会话白名单，空白名单拒绝启动。
- Vault 与 Codex 根目录均解析真实路径，阻止父目录穿越和软链接逃逸。
- 前端不具备任意 Shell 能力；Codex 危险 bypass 参数会被移除。
- 更新包必须通过独立 Minisign 公钥验证，即使 Beta 只使用 ad-hoc Apple 签名。

## [0.1.0] - 2026-08-01

### Added

- 通过飞书长连接接收文字和语音消息，并保留 webhook 备用模式。
- 在白名单私聊中把语音交给 Mac 本地的 FFmpeg 与 whisper.cpp 转写。
- 使用 `/note` 或 `/n` 把文字直接追加到 Obsidian 每日 Inbox。
- 将同一天的记录集中到一个 Markdown 文件，并按录入时间生成独立小节。
- 持久化任务队列、按飞书消息 ID 去重，以及失败后的本地重试能力。
- 支持本地 Codex、HTTP、OpenAI-compatible API、CLI 与 `codex exec` 适配模式。
- 支持生成图片并回发飞书，以及 macOS LaunchAgent 登录自启。

### Security

- 语音和文字笔记默认关闭，启用时必须配置私聊 `chat_id` 白名单。
- 音频与转写临时文件在处理后删除，正文不会写入业务日志或已完成任务记录。
- Obsidian 目标路径限制在配置的 Vault 内，外部消息标识与正文在写入前经过校验和清理。
