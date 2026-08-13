# AI Limits

[English](README.md) | 简体中文

[![Chrome 应用商店版本](https://img.shields.io/chrome-web-store/v/hcfdchpajckemcdflcjhigngpipdkdeo.svg?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo)
[![CI](https://github.com/TiantianFlow/ai-limits/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/TiantianFlow/ai-limits/actions/workflows/ci.yml?query=branch%3Amain)
[![GitHub 发布版](https://img.shields.io/github/v/release/TiantianFlow/ai-limits.svg?display_name=release&sort=semver)](https://github.com/TiantianFlow/ai-limits/releases/latest)
[![MIT 许可证](https://img.shields.io/github/license/TiantianFlow/ai-limits.svg)](LICENSE)

**[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo)**

Chrome 应用商店版本可能因审核或发布流程而滞后；应用商店徽章显示当前已发布的版本。
GitHub Releases 会保留对应的源代码和已验证上传包。

AI Limits 支持六个服务：ChatGPT、Claude、Kimi、Cursor、ElevenLabs 和 New API。
它是一款 Chrome 侧边栏扩展，可在一个紧凑的界面中查看这些服务的当前订阅用量
及本地配额历史图表。它会将不同服务商的用量统一为“已用”或“剩余”视图；当
服务商提供完整的重置周期信息时，还会将配额消耗与已过时间比较，显示用量节奏。
扩展初始不读取任何数据；只有当你主动连接某个服务并批准该服务的可选访问权限
后，才会读取其用量。

AI Limits 是 TiantianFlow 开发的独立项目，与 OpenAI、Anthropic、Moonshot AI、
Cursor、ElevenLabs、New API 项目或其关联方不存在隶属、背书或授权关系。

> 当前扩展界面为英文。下图的中文文字是项目介绍文案；嵌入的实际扩展界面
> 仍为英文。后续完成扩展本身的简体中文支持后，我们会重新生成截图。

![AI Limits Chrome 侧边栏展示示例已用视图、订阅用量、重置时间、用量节奏和服务导航](store-assets/chrome-web-store/zh_CN/screenshot-overview-1280x800.png)

## 工作原理

- 每个服务都需要单独启用。Chrome 只会请求该服务的精确主机访问权限。
- ChatGPT、Claude、Kimi 和 Cursor 使用浏览器中已登录的会话。扩展以较低
  频率向这些服务自己的网站会话用量接口发送只读请求，不会抓取页面中渲染的
  内容。
- ElevenLabs 使用由用户创建的 API 密钥，因为其公开且有文档的 API 不提供
  其他服务所采用的免设置网页会话方式。扩展只会把该密钥发送到 ElevenLabs API，
  用于只读订阅请求。
- New API 使用用户提供的一个实例网址和 Relay Key。AI Limits 只读取该密钥的
  用量接口；目前支持有上限和无限额密钥，但不支持账号钱包、订阅、管理员数据
  或多个实例。
- 最新的标准化配额、余额、套餐、刷新状态和偏好设置会保存在当前浏览器配置
  文件的 Chrome 扩展本地存储中。
- 每次刷新成功并完成标准化后，扩展会将配额观测值在本地保存最多 30 天，用于
  “History”历史图表；每个服务设有 1,024 条观测的安全上限。受此上限约束，
  最近 48 小时内的观测按采集粒度保留；更早的留存历史只保留每个 UTC 小时内的
  最后一次观测。升级时，一个有效的当前快照可能按其原始获取时间成为第一条
  观测；扩展不会重建更早的服务商历史，也不会记录余额历史。
- 浏览器会话 Cookie 和访问凭据仅在本次服务数据收集过程中使用，不会保存到
  扩展的持久化存储中。验证成功的 ElevenLabs 和 New API 密钥会单独保存在扩展本地
  存储中，因此手动和定时刷新无需重新打开设置页面。
- 只要仍有至少一个已连接的服务，自动刷新就会默认开启，并大约每 15 分钟
  运行一次。你可以在“Settings”中关闭它。

Kimi 在你主动点击“Connect”或“Refresh”时可能需要额外的会话恢复步骤。
扩展会先检查旧版 Kimi Cookie，再读取已打开 Kimi 页面中名称完全匹配的
`access_token` 项。如果找不到可用凭据，或 Kimi 拒绝该凭据，交互式恢复
可能会创建一个非活动状态的 Kimi 首页标签页。恢复过程最多等待凭据 10 秒，
随后会尽力关闭由扩展创建的标签页；浏览器关闭或 API 错误可能延迟或阻止清理。
定时自动刷新绝不会创建 Kimi 标签页。

ElevenLabs 设置流程会在普通标签页中打开其官方 API 密钥页面。如果你需要先
登录，指南会保持打开，并允许再次打开该页面。指南要求创建仅含 **User → Read**
且不含生成或写入权限的密钥，然后在保存前验证只读订阅请求。ElevenLabs 并未
正式公布该接口与权限选项的精确对应关系，因此以连接检查结果为准；AI Limits
不会静默扩大权限。连接成功后，ElevenLabs 的手动和定时刷新都会在后台运行，
不会打开标签页。密钥的本地存储边界和限制请参阅
[隐私说明（英文）](PRIVACY.md)。

刷新和“History”历史图表的行为请参阅[常见问题](FAQ.zh-CN.md)，各服务连接方式和
限制请参阅[支持的服务](SUPPORTED_PROVIDERS.zh-CN.md)，完整的数据
生命周期请参阅[隐私说明（英文）](PRIVACY.md)，安全报告方式和限制请参阅
[安全说明（英文）](SECURITY.md)。

## 权限

AI Limits 使用 `storage`、`alarms` 和 `sidePanel`，分别用于本地状态、定时
刷新和用户界面。服务来源权限均为可选权限，只有当你点击 **Connect** 或验证
API 密钥连接时才会逐个请求。New API 因可自托管而声明动态可选主机能力，但
Chrome 实际只会请求设置中输入的那个实例来源。可选的
`cookies` 和 `scripting` 权限只用于 Kimi 会话访问和交互式恢复。ElevenLabs
只会获得 `https://api.elevenlabs.io/*` 的可选访问权限；公开设置页面按普通
网页打开，不会获得扩展主机访问权限。扩展不会请求范围更广的 `tabs` 权限。

完整的权限说明和审核步骤请参阅
[Chrome 应用商店文案草稿（英文）](STORE_LISTING.md)。

## 本地开发

请使用 Node 24，以及 `package.json` 中固定版本、由 Corepack 管理的 pnpm。
在仓库根目录运行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

运行完整测试、类型检查、构建和构建目录验证：

```bash
pnpm verify
```

## 加载未打包扩展

运行 `pnpm verify` 后，打开 `chrome://extensions`，启用
**Developer mode（开发者模式）**，再选择 **Load unpacked（加载已解压的扩展程序）**。
从仓库根目录选择：

```text
dist/chrome-mv3
```

`pnpm build` 会将 WXT 生成的 `.output` 目录暂存到这个可见目录，因此它会在
macOS 文件选择器中正常显示。点击扩展工具栏图标即可打开侧边栏。

## 构建上传用 ZIP

使用以下命令创建并验证 Chrome 应用商店上传文件：

```bash
pnpm verify:zip
```

该命令会重新构建扩展，创建 `.output/ai-limits-0.2.3-chrome.zip`，打开压缩包，
并验证清单、入口文件、权限和禁止包含的文件规则。

## 服务兼容性

使用浏览器会话的服务依赖未公开且不受支持的会话和用量接口。ElevenLabs 和
New API 使用有文档的 API，但响应格式、授权范围、安全验证或可用性仍可能随时变更。
AI Limits 会将格式异常或不可用的响应转换为有界的健康状态，但无法保证持续
兼容。

## 参与贡献

提交修改前请阅读[贡献指南（英文）](CONTRIBUTING.md)。本项目使用
[GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) 提供公开支持和
错误报告。请勿在 Issue 中包含 Cookie、访问凭据、私人用量数据或其他机密信息。

## 社区

感谢 [LINUX DO](https://linux.do/) 为中文开发者提供交流与反馈的平台。本致谢不代表双方
存在隶属、合作或官方背书关系。

## 许可证

[MIT](LICENSE) © 2026 TiantianFlow
