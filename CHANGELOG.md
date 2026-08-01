# Changelog

本文件记录每个正式版本中对使用者有影响的变化。项目遵循 [Semantic Versioning](https://semver.org/)。

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
