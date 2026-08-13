# 支持的服务

[English](SUPPORTED_PROVIDERS.md) | 简体中文

AI Limits 目前支持六种服务连接。每个服务都需要用户主动启用；标准化用量和
History 只保存在当前 Chrome 配置文件中。

| 服务 | 连接方式 | 读取内容 | 重要差异 |
| --- | --- | --- | --- |
| ChatGPT | 浏览器登录会话 | 服务商报告的消息窗口和 Credits | 使用未公开的网站会话接口。浏览器可能附带 ChatGPT Cookie；请求期间使用的账号标识不会持久化。 |
| Claude | 浏览器登录会话 | 通用及模型专属限制，以及服务商报告的 Extra usage | 使用未公开的网站会话接口。组织选择只在请求期间使用；服务商提供的显示标签可能被保留。 |
| Kimi | 浏览器会话及定向凭据恢复 | 订阅总用量和 Kimi Code 限制 | 可能读取名称完全匹配的旧版 `kimi-auth` Cookie 或 `localStorage.access_token`。手动 Connect 或 Refresh 可能短暂打开一个非活动 Kimi 标签页，让 Kimi 自己刷新会话。自动刷新绝不会打开标签页；没有可用会话时可能延后。 |
| Cursor | 浏览器登录会话 | Cursor 模型和其他模型的独立月度限制，以及服务商报告的按量支出 | 使用未公开的网站会话接口。服务商分别报告两个月度模型池时，AI Limits 会保持分开显示。 |
| ElevenLabs | 用户创建的 API 密钥 | 订阅 Credits 和语音容量限制 | 指南建议使用 **User → Read**。AI Limits 调用有文档的订阅接口并在本地保存验证成功的密钥，不复用浏览器会话。 |
| New API | 实例网址及一个 Relay Key | 该密钥的总额、已用和剩余配额；无限额密钥则显示绝对用量 | AI Limits 调用 `/api/status` 和只读的 `/api/usage/token/` 接口。请求本身只读，但 Relay Key 本身仍可能具备调用模型的能力。 |

## New API 连接模式

当前 AI Limits 只实现 [New API 项目](https://github.com/QuantumNous/new-api)
支持的最小普通用户模式：

- 一个 New API 实例；
- 该实例的一个 Relay Key；
- 有上限密钥的配额，或无限额密钥的绝对用量；
- 连接后的手动和后台自动刷新。

New API 还提供账号钱包、订阅、用量历史和管理员 API。AI Limits 目前**不会**
使用这些接口，不会要求管理用 Personal Access Token，不会读取管理员数据，也不
支持在同一个浏览器配置中连接多个 New API 实例。

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
设置表单时，Chrome 实际只会请求标准化后那个实例的精确来源权限。

## 兼容性边界

ChatGPT、Claude、Kimi 和 Cursor 依赖可能随时变化的未公开接口。ElevenLabs
和 New API 使用有文档的接口，但响应和授权行为仍可能变化。对于格式异常或
彼此矛盾的用量，AI Limits 会拒绝数据，而不会虚构百分比、重置时间或用量节奏。

凭据存储、请求目标和删除行为请参阅[隐私说明（英文）](PRIVACY.md)。
