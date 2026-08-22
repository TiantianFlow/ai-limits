# 支持的服务

[English](SUPPORTED_PROVIDERS.md) | 简体中文

AI Limits 目前支持七种服务连接。每个服务都需要用户主动启用；标准化用量和
History 只保存在当前 Chrome 配置文件中。

| 服务 | 连接方式 | 读取内容 | 重要差异 |
| --- | --- | --- | --- |
| ChatGPT | 浏览器登录会话 | 服务商报告的消息窗口和 Credits | 使用未公开的网站会话接口。浏览器可能附带 ChatGPT Cookie；请求期间使用的账号标识不会持久化。 |
| Claude | 浏览器登录会话 | 通用及模型专属限制，以及服务商报告的 Extra usage | 使用未公开的网站会话接口。组织选择只在请求期间使用；服务商提供的显示标签可能被保留。 |
| Kimi | 浏览器会话及定向凭据恢复 | 订阅总用量和 Kimi Code 限制 | 可能读取名称完全匹配的旧版 `kimi-auth` Cookie 或 `localStorage.access_token`。手动 Connect 或 Refresh 可能短暂打开一个非活动 Kimi 标签页，让 Kimi 自己刷新会话。自动刷新绝不会打开标签页；没有可用会话时可能延后。 |
| Cursor | 浏览器登录会话及手动页面增强 | Cursor 模型和其他模型的独立月度限制、Grok Bot 每周用量，以及服务商报告的按量支出/额外 Credits 数据 | 基础用量在后台刷新。Connect 或手动 Refresh 可通过一个已经打开的 `cursor.com` 标签页请求 Grok Bot 和额外 Credits JSON；如果当前没有打开的标签页，可能会短暂打开一个非活动的用量页。Chrome 会把已登录的 Cursor Cookie 附加到这些固定的同源请求，但 AI Limits 不会直接检查 Cookie 值。扩展不会激活 Cursor 标签页，并且只关闭它自己创建的标签页。自动刷新绝不会打开标签页或注入代码。上次有效的页面数值会保留到 Grok Bot 的每周重置，卡片会说明为何未能刷新。 |
| Grok | 浏览器登录会话 | 以每周或每月用量池为订阅限额，并在 Grok Build 与 Chat 桶合计等于整池时显示构成，以及 SuperGrok 系列套餐标签。按聊天模式（`fast`、`expert`、`heavy`、`auto`）的短窗速率限制仅在没有用量池时作为回退显示 | 使用 `grok.com` 上未公开的网站会话接口。浏览器可能附带 Grok Cookie；账号标识和原始订阅响应不会持久化。这是面向消费者的 Grok，不是 Cursor 的 Grok Bot。 |
| ElevenLabs | 用户创建的 API 密钥 | 订阅 Credits 和语音容量限制 | 指南建议使用 **User → Read**。AI Limits 调用有文档的订阅接口并在本地保存验证成功的密钥，不复用浏览器会话。 |
| New API | 每个连接各自使用实例网址、标签和一个 Relay Key；支持多个连接 | 每个密钥的总额、已用和剩余配额；无限额密钥则显示绝对用量 | AI Limits 调用 `/api/status` 和只读的 `/api/usage/token/` 接口。请求本身只读，但每个 Relay Key 仍可能具备调用模型的能力。 |

## New API 连接模式

AI Limits 实现 [New API 项目](https://github.com/QuantumNous/new-api)
支持的普通用户 Relay Key 模式：

- 多个相互独立配置的 New API 实例；
- 每个实例各自拥有一个标准化基础网址、可选标签和 Relay Key；
- 有上限密钥的配额，或无限额密钥的绝对用量；
- 连接后的手动和后台自动刷新。

New API 支持多个相互独立的实例。每个已配置实例分别拥有自己的标准化基础网址、标签、Relay Key、用量、History、刷新状态、替换、拒绝和删除生命周期。

同一来源的实例只共享 Chrome 的浏览器全局来源授权；凭据、标签、用量状态和 History 始终相互独立。

New API 还提供账号钱包、订阅、用量历史和管理员 API。AI Limits 目前**不会**
使用这些接口，不会要求管理用 Personal Access Token，也不会读取管理员数据或
其他 Relay Key。

### 可接受的 New API 网址

可以粘贴站点首页、控制台网址或常见 API 网址。AI Limits 会先移除已知后缀，
再验证实例。例如下列网址都会指向同一个根地址：

```text
https://new-api.example.com
https://new-api.example.com/console
https://new-api.example.com/v1
https://new-api.example.com/v1/messages
https://new-api.example.com/api/usage/token/
```

子路径部署会保留：`https://example.com/new-api/v1/messages` 会变成
`https://example.com/new-api`。查询参数和片段会被移除。除本地开发用的
`http://localhost` 和 `http://127.0.0.1` 外，必须使用 HTTPS。

由于 New API 可以部署在任意主机，扩展清单会声明可选的动态主机能力；提交
设置表单时，Chrome 实际只会请求标准化后那个实例的精确来源权限。断开一个
同来源实例时，只要另一个活动实例仍拥有该授权，授权就会保留；断开最后一个
所有者时，会先删除本地数据，再尽力移除授权。从外部移除授权会把所有受影响
实例标记为需要权限，但保留非机密配置、标准化用量、刷新状态和 History，直到
重新连接或明确断开或删除。

成功的配额、计数或支出以及余额观测会按实例遵循统一的留存规则：最近 48 小时
保留原始采集粒度，更早数据按小时压缩，最多 30 天且每个实例最多 1,024 条。
0.3.0 只绘制配额指标。History 不包含凭据或服务商原始响应。

## 兼容性边界

ChatGPT、Claude、Kimi、Cursor 和 Grok 依赖可能随时变化的未公开接口。ElevenLabs
和 New API 使用有文档的接口，但响应和授权行为仍可能变化。对于格式异常或
彼此矛盾的用量，AI Limits 会拒绝数据，而不会虚构百分比、重置时间或用量节奏。

凭据存储、请求目标和删除行为请参阅[隐私说明（英文）](PRIVACY.md)。
