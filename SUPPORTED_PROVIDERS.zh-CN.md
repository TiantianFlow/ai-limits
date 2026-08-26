# 支持的服务

[English](SUPPORTED_PROVIDERS.md) | 简体中文

AI Limits 目前支持二十种服务连接。每个服务都需要用户主动启用；标准化用量和
History 只保存在当前 Chrome 配置文件中。

来源等级描述的是响应结构证据，而不是当前可用性：**OBSERVED** 表示字段有开发期间
捕获的服务响应或上游已观测响应样例支持；**INFERRED** 表示结构来自文档或客户端
契约，仍需实时捕获确认。

余额展示策略按服务明确分类：

- **余额为主** — Mistral、sub2api、DeepSeek、Moonshot、DeepInfra、OpenAI 和
  OpenRouter。服务报告的零余额仍会显示。
- **套餐/用量池为主** — ChatGPT、Claude、Cursor、Grok、Perplexity 和
  ElevenLabs。为零的辅助或额外额度会隐藏，因为套餐或用量池才是主要信号。
- **当前无余额指标** — Kimi、New API、LiteLLM、ClawRouter、LLM Proxy、
  Fireworks 和 GroqCloud；当前契约报告配额或计数。

| 服务 | 连接方式 | 读取内容 | 来源等级 | 重要差异 |
| --- | --- | --- | --- | --- |
| ChatGPT | 浏览器登录会话 | 服务商报告的消息窗口和 Credits | **OBSERVED** | 使用未公开的网站会话接口。浏览器可能附带 ChatGPT Cookie；请求期间使用的账号标识不会持久化。 |
| Claude | 浏览器登录会话 | 通用及模型专属限制，以及服务商报告的 Extra usage | **OBSERVED** | 使用未公开的网站会话接口。组织选择只在请求期间使用；服务商提供的显示标签可能被保留。 |
| Kimi | 浏览器会话及定向凭据恢复 | 订阅总用量和 Kimi Code 限制 | **OBSERVED** | 可能读取名称完全匹配的旧版 `kimi-auth` Cookie 或 `localStorage.access_token`。手动 Connect 或 Refresh 可能短暂打开一个非活动 Kimi 标签页，让 Kimi 自己刷新会话。自动刷新绝不会打开标签页；没有可用会话时可能延后。 |
| Cursor | 浏览器登录会话及手动页面增强 | Cursor 模型和其他模型的独立月度限制、Grok Bot 每周用量，以及服务商报告的按量支出/额外 Credits 数据 | **OBSERVED** | 基础用量在后台刷新。Connect 或手动 Refresh 可通过一个已经打开的 `cursor.com` 标签页请求 Grok Bot 和额外 Credits JSON；如果当前没有打开的标签页，可能会短暂打开一个非活动的用量页。Chrome 会把已登录的 Cursor Cookie 附加到这些固定的同源请求，但 AI Limits 不会直接检查 Cookie 值。扩展不会激活 Cursor 标签页，并且只关闭它自己创建的标签页。自动刷新绝不会打开标签页或注入代码。上次有效的页面数值会保留到 Grok Bot 的每周重置，卡片会说明为何未能刷新。 |
| Grok | 浏览器登录会话及页面来源读取 | 以每周或每月用量池为订阅限额，并在 Grok Build 与 Chat 桶合计等于整池时显示构成，以及 SuperGrok 系列套餐标签 | **OBSERVED** | grok.com 会拒绝扩展后台的会话和用量请求，因此 AI Limits 从已经打开的 grok.com 标签页读取。Connect 或手动 Refresh 在没有打开的标签页时可能会短暂打开一个非活动 grok.com 标签页。Chrome 会把已登录的 Grok Cookie 附加到这些同源请求，但 AI Limits 不会直接检查 Cookie 值。扩展不会激活 Grok 标签页，并且只关闭它自己创建的标签页。定时刷新可能向已经打开的 grok.com 标签页注入代码，但绝不会新建标签页。SuperGrok 用量池账号不会显示按聊天模式返回的短窗速率限制。这是面向消费者的 Grok，不是 Cursor 的 Grok Bot。 |
| Mistral | 浏览器登录会话 | 本月至今支出、令牌总量和可用额度 | **INFERRED** | Chrome 会附加同源 Cookie，但无法暴露构造 `X-CSRFTOKEN` 所需的 CSRF Cookie 值；需要实时测试确认服务能接受缺少该请求头的请求。 |
| Perplexity | 浏览器登录会话 | 周期性、已购买和促销额度池，以及套餐推断 | **INFERRED** | 使用私有账单接口和 Chrome 附加的同源 Cookie。额度过期与瀑布式归因遵循推断的响应契约。 |
| ElevenLabs | 用户创建的 API 密钥 | 订阅 Credits 和语音容量限制 | **OBSERVED** | 指南建议使用 **User → Read**。AI Limits 调用有文档的订阅接口并在本地保存验证成功的密钥，不复用浏览器会话。 |
| New API | 每个连接各自使用实例网址、标签和一个 Relay Key；支持多个连接 | 每个密钥的总额、已用和剩余配额；无限额密钥则显示绝对用量 | **OBSERVED** | AI Limits 调用 `/api/status` 和只读的 `/api/usage/token/` 接口。请求本身只读，但每个 Relay Key 仍可能具备调用模型的能力。 |
| LiteLLM | 每个连接各自使用实例网址、标签和一个虚拟密钥；支持多个连接 | 来自 `/key/info` 的密钥花费；当响应包含 `max_budget` 时显示预算额度 | **OBSERVED** | AI Limits 只调用只读的 `/key/info` 接口，不会继续请求 `/user/info` 或 `/team/info`，因此仅存在于后两个接口中的用户/团队预算窗口会被省略。 |
| ClawRouter | 每个连接各自使用实例网址、标签和一个策略密钥；支持多个连接。默认地址为 `https://clawrouter.openclaw.ai` | 按策略计量时显示每月剩余预算，否则显示本月实际费用 | **INFERRED** | AI Limits 调用只读的 `/v1/usage` 接口。微美元整数字段会换算为美元。 |
| sub2api | 每个连接各自使用实例网址、标签和一个分组密钥；支持多个连接 | 有上限密钥额度、每日/每周/每月订阅窗口、钱包余额，以及可选的 5 小时/1 天/7 天速率限制 | **INFERRED** | AI Limits 调用只读的 `/v1/usage?days=30&timezone=UTC` 接口。必须使用 HTTPS，本地开发的 localhost 除外。 |
| LLM Proxy | 每个连接各自使用实例网址、标签和一个 API 密钥；支持多个连接 | 最低剩余额度百分比；未报告剩余百分比时回退为请求/令牌计数 | **OBSERVED** | AI Limits 调用只读的 `/v1/quota-stats` 接口。 |
| DeepSeek | 用户创建的 API 密钥 | 服务商所报告币种的可用账户余额 | **INFERRED** | AI Limits 调用只读的 `https://api.deepseek.com/user/balance` 接口，并从服务商报告的余额行中选择一项，不虚构汇率换算。 |
| Moonshot | 用户创建的 API 密钥 | 国际开发平台的可用美元余额 | **INFERRED** | AI Limits 调用只读的 `https://api.moonshot.ai/v1/users/me/balance` 接口。这是 Moonshot 开发平台，与 Kimi Code 用量不同。 |
| DeepInfra | 用户创建的 API 密钥 | 当月支出相对消费上限的配额；未报告上限时显示账户余额 | **INFERRED** | AI Limits 调用 `api.deepinfra.com` 上只读的付款清单和当期用量接口。 |
| Fireworks | 用户创建的 API 密钥 | 单个可访问账户最近 30 天的已计价支出 | **INFERRED** | AI Limits 读取 `api.fireworks.ai` 上的账户列表和账单摘要。零个或多个可选账户标识需要账户选择器，目前尚不支持。 |
| OpenAI | 用户创建的 API 密钥 | 组织支出、补全请求/令牌总量，或旧版可用额度 | **INFERRED** | 这是平台组织/开发者账单接口，不是 ChatGPT 消费者会话。优先读取组织用量；未设置项目范围时，组织请求失败会回退到旧版额度接口。可能需要组织或管理员范围。 |
| GroqCloud | 用户创建的 API 密钥 | 五分钟 Prometheus 请求、令牌和缓存命中速率 | **INFERRED** | 标准 Groq 密钥在 Prometheus 接口上返回 404，并会显示为需要更高凭据范围。 |
| OpenRouter | 用户创建的 API 密钥 | 额度余额和可选 API 密钥预算 | **INFERRED** | 读取 `/credits` 和 `/key`；只有服务报告可用上限时才显示密钥预算。 |

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
History 只绘制配额指标。History 不包含凭据或服务商原始响应。

## 兼容性边界

ChatGPT、Claude、Kimi、Cursor、Grok、Mistral 和 Perplexity 依赖可能随时变化的
未公开接口。API 密钥服务使用有文档或已逆向的 HTTP 接口，但响应和授权行为仍
可能变化。对于格式异常或彼此矛盾的用量，AI Limits 会拒绝数据，而不会虚构
百分比、重置时间或用量节奏。

凭据存储、请求目标和删除行为请参阅[隐私说明（英文）](PRIVACY.md)。
