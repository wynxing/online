# UI 交互功能清单

本文档用于重新排版和设计 UI 时参考，只盘点当前项目已经具备的交互能力、状态和数据来源，不定义新功能，也不提供视觉方案。

## 1. 全局结构

应用是 Tauri 桌面端实时同传字幕工具。主窗口包含侧边导航、顶部操作区和工作区；另有一个独立的悬浮字幕窗口。

| 区域 | 入口 | 主要用途 | 数据来源 |
| --- | --- | --- | --- |
| 主控制台 | 侧边栏 Console | 启停同传、选择音频源、查看实时字幕 | `list_devices`、`start_session`、`stop_session`、运行时事件 |
| 设置页 | 侧边栏 Settings | 配置 ASR、翻译、分段、显示和诊断 | `get_config`、`save_config`、`test_asr`、`test_translation` |
| 历史页 | 侧边栏 History | 查看已保存会话和字幕片段 | `list_sessions`、`get_segments` |
| 术语表页 | 侧边栏 Glossary | 管理翻译术语 | `list_glossary`、`create_glossary`、`update_glossary`、`delete_glossary` |
| 悬浮字幕窗 | 顶部 Floating subtitles | 独立置顶显示最新字幕 | `/?view=floating`、运行时事件、`localStorage` |
| 更新横幅 | 主窗口顶部 | 检查、下载、安装应用更新 | Tauri updater plugin |

## 2. 主控制台

### 2.1 音频源选择

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页左侧控制面板，Audio source 区域 |
| 用户操作 | 从下拉框选择捕获源 |
| 控件类型建议 | Select，下方显示当前设备说明 |
| 数据来源 | `list_devices`，前端每 5 秒刷新一次设备列表 |
| 关键状态 | 无设备时显示空选项；选中设备后显示描述、默认设备标记和设备 ID；当前配置设备不可用时自动优先选择系统音频源，其次选择第一个设备 |
| 设计注意点 | 设备名可能很长，需要支持截断或换行；系统音频和麦克风可用不同图标辅助识别 |

设备类型：

| 值 | 含义 |
| --- | --- |
| `system` | 系统音频或虚拟监听源 |
| `microphone` | 麦克风输入 |
| `mock` | 类型仍存在于前端类型中，但当前可见 ASR 模式只提供真实 OpenAI-compatible ASR |

### 2.2 字幕显示模式

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页控制面板 |
| 用户操作 | 在 Source、Translation、Bilingual 三个模式中切换 |
| 控件类型建议 | Segmented control |
| 数据来源 | `RuntimeConfig.displayMode` |
| 关键状态 | 当前模式高亮；切换立即影响主字幕列表和最新稳定字幕显示 |
| 设计注意点 | 三个模式需要在主窗口和悬浮窗中保持概念一致，但悬浮窗有自己的本地显示模式记忆 |

### 2.3 开始会话

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页控制面板 Start 按钮 |
| 用户操作 | 点击 Start |
| 控件类型建议 | Primary button，带播放图标 |
| 后端命令 | `start_session` |
| 必要输入 | 音频设备 ID、源语言、目标语言、显示模式、ASR provider、翻译 provider |
| 前置校验 | ASR Base URL、ASR API Key、Translation API Key、音频输入设备必须存在 |
| 关键状态 | 运行中禁用 Start；校验失败时顶部运行提示显示 Cannot start；启动成功后清空当前字幕、错误日志和诊断数据 |
| 设计注意点 | 校验失败信息可能包含多条错误，提示区域需要容纳较长文本 |

### 2.4 停止会话

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页控制面板 Stop 按钮 |
| 用户操作 | 点击 Stop |
| 控件类型建议 | Danger button，带停止图标 |
| 后端命令 | `stop_session` |
| 关键状态 | 未运行时禁用 Stop；停止成功后刷新历史会话列表，并显示会话已保存 |
| 设计注意点 | 停止后最终字幕会进入历史页，设计上可给用户明确的保存完成反馈 |

### 2.5 清空当前字幕

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页控制面板 Clear subtitles 按钮 |
| 用户操作 | 点击清空 |
| 控件类型建议 | Secondary full-width button，带删除图标 |
| 数据来源 | 前端本地状态 `segments` |
| 关键状态 | 清空只影响当前前端显示，不调用后端删除历史 |
| 设计注意点 | 文案需要避免让用户误解为删除历史记录 |

### 2.6 实时字幕列表

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页 Live Stream 面板 |
| 用户操作 | 主要是查看，无直接编辑操作 |
| 控件类型建议 | 可滚动列表，片段卡片或紧凑行 |
| 数据来源 | 运行时事件 `subtitle:segment-created`、`subtitle:segment-updated`、`subtitle:segment-corrected` |
| 关键状态 | 无字幕时显示空状态；有新片段时自动滚动到底部；被替代的片段通过 `supersededBy` 隐藏；修正片段短暂高亮 |
| 设计注意点 | 每条片段包含 ID、版本、状态、源文和译文；设计时需要兼容 interim、final、corrected 三种状态 |

### 2.7 会话状态和诊断信息

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页 Live Stream 面板顶部 |
| 用户操作 | 查看状态；诊断显示可在 Settings 页关闭 |
| 控件类型建议 | Status pills、诊断指标条、错误日志列表 |
| 数据来源 | `session:status`、`pipeline:metrics`、`runtime:error` |
| 关键状态 | Runtime online/offline；会话状态；片段数；真实模式；ASR 耗时、翻译耗时、端到端耗时、丢弃数、队列大小、低能量丢弃 |
| 设计注意点 | 诊断信息属于辅助信息，可弱化但不能遮挡字幕；错误日志最多展示前 5 条 |

### 2.8 最新稳定字幕

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Console 页 Latest stable 面板 |
| 用户操作 | 查看最新非 interim 字幕 |
| 控件类型建议 | 重点文本区域 |
| 数据来源 | 当前可见字幕片段 |
| 关键状态 | 优先显示最近的 final 或 corrected；没有稳定字幕时显示空提示 |
| 设计注意点 | 译文使用完整字号，源文使用较小字号；适合设计成演示或会议场景下的重点阅读区域 |

## 3. 设置页

### 3.1 ASR 配置

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 Speech recognition 区域 |
| 用户操作 | 选择 API format，填写 ASR Base URL、ASR API Key、ASR model、Recognition language |
| 控件类型建议 | Select、password input、text input、说明文本 |
| 数据来源 | `RuntimeConfig` |
| 关键状态 | ASR Base URL 为空时使用翻译 Base URL；ASR API Key 为空时使用翻译 API Key |
| 设计注意点 | API format 不同会改变说明：`whisper` 使用音频文件转写端点，`chat-completions` 使用 base64 音频发送到 Chat Completions 兼容端点 |

### 3.2 测试 ASR 连接

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 ASR 区域按钮 |
| 用户操作 | 点击 Test ASR connection |
| 控件类型建议 | Secondary button，测试中禁用所有测试按钮 |
| 后端命令 | `test_asr` |
| 关键状态 | 默认文案；Testing... 加载态；成功显示 Connected 和 base URL；失败显示错误信息 |
| 设计注意点 | 测试结果应紧跟按钮展示，成功和失败需要明显但不抢占主要表单 |

### 3.3 翻译配置

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 Translation service 区域 |
| 用户操作 | 填写 Base URL、API Key、Translation model、Source language、Target language |
| 控件类型建议 | Text input、password input、双列语言输入 |
| 数据来源 | `RuntimeConfig` |
| 关键状态 | 空语言值在后端归一化为默认 `en` 和 `zh-CN` |
| 设计注意点 | 语言输入是自由文本，不是固定下拉；设计时应支持 `en`、`zh-CN`、`auto` 等短代码 |

### 3.4 测试翻译连接

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 Translation service 区域按钮 |
| 用户操作 | 点击 Test translation connection |
| 控件类型建议 | Secondary button |
| 后端命令 | `test_translation` |
| 关键状态 | Testing... 加载态；成功显示 Connected 和 sample；失败显示错误信息 |
| 设计注意点 | sample 文本可能较长，需要允许换行 |

### 3.5 实时管线参数

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 Realtime pipeline 区域 |
| 用户操作 | 输入 Min segment seconds、Max segment seconds、Silence split seconds |
| 控件类型建议 | Number input 或带步进的数字控件 |
| 数据来源 | `RuntimeConfig` |
| 关键状态 | 当前前端约束：最小时长 0.4-10，最大时长 0.8-20，静音切分 0.1-3；后端保存时也会 clamp |
| 设计注意点 | 参数影响实时性和稳定性，建议设计为专业设置，不宜过度突出 |

### 3.6 字幕显示设置

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页 Subtitle display 区域 |
| 用户操作 | 拖动 Subtitle font size；开关 Use glossary during translation；开关 Show realtime diagnostics |
| 控件类型建议 | Range slider、checkbox 或 switch |
| 数据来源 | `RuntimeConfig`、`localStorage.fontSize` |
| 关键状态 | 字号范围 14-56；字号变化立即影响预览和主窗口字幕，并写入 localStorage 供悬浮窗同步；术语表和诊断开关保存后影响运行逻辑或显示 |
| 设计注意点 | 字号预览必须跟随滑块实时变化；开关文案需要明确作用对象 |

### 3.7 保存配置和预览

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Settings 页底部和右侧 Subtitle Preview |
| 用户操作 | 点击 Save configuration；查看预览 |
| 控件类型建议 | Primary button、预览面板 |
| 后端命令 | `save_config` |
| 关键状态 | 保存成功后显示 Configuration saved；预览始终显示示例源文和译文 |
| 设计注意点 | 保存动作是显式的，设计上不要让用户误以为所有设置都已经持久化 |

## 4. 历史页

### 4.1 会话列表

| 项目 | 说明 |
| --- | --- |
| 入口位置 | History 页左侧列表 |
| 用户操作 | 点击一个历史会话 |
| 控件类型建议 | List item button |
| 数据来源 | `list_sessions` |
| 关键状态 | 无会话时显示空状态；选中项高亮；会话项显示标题和开始时间 |
| 设计注意点 | 会话标题格式当前为 `Interpretation HH:mm:ss`，设计不能依赖标题一定具有业务语义 |

### 4.2 历史字幕详情

| 项目 | 说明 |
| --- | --- |
| 入口位置 | History 页右侧详情 |
| 用户操作 | 查看所选会话保存的字幕片段 |
| 控件类型建议 | 可滚动字幕列表 |
| 数据来源 | `get_segments(sessionId)` |
| 关键状态 | 未选择或无片段时显示空状态；历史详情固定使用 bilingual 显示模式 |
| 设计注意点 | 历史页当前没有删除、导出、搜索或编辑功能，设计文档中不应加入这些操作 |

## 5. 术语表页

### 5.1 新增术语

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Glossary 页左侧表单 |
| 用户操作 | 填写源术语、目标译法、领域，点击添加 |
| 控件类型建议 | Form、text inputs、primary submit button |
| 后端命令 | `create_glossary` |
| 必要输入 | source 和 target 不能为空；domain 可为空 |
| 关键状态 | source 或 target 为空时提交无效果；创建成功后表单清空，新术语按 source 排序加入列表 |
| 设计注意点 | 当前没有表单错误文案，设计可预留但不要写成已实现功能 |

### 5.2 启用或停用术语

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Glossary 页术语列表每一行 |
| 用户操作 | 点击开关 |
| 控件类型建议 | Switch |
| 后端命令 | `update_glossary` |
| 关键状态 | enabled 为 true 时开关高亮；切换后更新该行 |
| 设计注意点 | 开关影响后续翻译时是否使用术语；已运行会话是否立即受影响取决于运行时启动时加载的术语，文档不应承诺热更新 |

### 5.3 删除术语

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Glossary 页术语列表每一行删除按钮 |
| 用户操作 | 点击删除图标 |
| 控件类型建议 | Icon button，带 tooltip |
| 后端命令 | `delete_glossary` |
| 关键状态 | 删除成功后该行从列表移除 |
| 设计注意点 | 当前源码没有确认弹窗，设计时不要把二次确认作为已存在能力 |

### 5.4 领域标签

| 项目 | 说明 |
| --- | --- |
| 入口位置 | Glossary 页术语行 |
| 用户操作 | 查看领域 |
| 控件类型建议 | Small label 或 metadata text |
| 数据来源 | `GlossaryTerm.domain` |
| 关键状态 | domain 为空时显示 General |
| 设计注意点 | 领域不是筛选器，当前仅用于展示和发送给翻译提示 |

## 6. 悬浮字幕窗

### 6.1 打开悬浮窗

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 主窗口顶部 Floating subtitles 按钮 |
| 用户操作 | 点击按钮 |
| 控件类型建议 | Secondary button，带外部窗口图标 |
| 数据来源 | 路由 `/?view=floating` |
| 关键状态 | Tauri 环境中复用已有 label 为 `floating-subtitles` 的窗口；不存在则创建无边框、透明、置顶、可缩放窗口；浏览器环境中使用 `window.open` |
| 设计注意点 | 悬浮窗是实际使用场景中的核心展示区域，需要独立考虑小尺寸布局 |

### 6.2 拖拽和关闭

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 悬浮窗工具栏 |
| 用户操作 | 按住工具栏空白区域拖拽；点击关闭按钮 |
| 控件类型建议 | Drag handle toolbar、close icon button |
| 数据来源 | Tauri window API 或浏览器 window API |
| 关键状态 | 点击按钮时不触发拖拽；关闭后窗口销毁 |
| 设计注意点 | 无边框窗口需要明显但克制的拖拽区域；关闭按钮要有可点击热区 |

### 6.3 悬浮窗显示模式

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 悬浮窗工具栏 |
| 用户操作 | 切换 Source、Translation、Bilingual |
| 控件类型建议 | Segmented control |
| 数据来源 | `localStorage.floatingDisplayMode` |
| 关键状态 | 默认 bilingual；切换后写入 localStorage；只影响悬浮窗自身 |
| 设计注意点 | 工具栏空间有限，模式标签需要短且可识别 |

### 6.4 悬浮字幕内容

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 悬浮窗内容区域 |
| 用户操作 | 查看最新字幕 |
| 控件类型建议 | 大字号字幕卡或透明字幕层 |
| 数据来源 | 运行时字幕事件、`localStorage.fontSize` |
| 关键状态 | 优先显示最近 final 或 corrected；没有字幕时显示等待提示；主窗口字号变化通过 storage 事件同步；被修正的最新字幕显示 corrected 高亮 |
| 设计注意点 | 窗口默认尺寸 960x260，最小 520x180；需要保证长句换行后仍可读 |

## 7. 更新横幅

### 7.1 发现更新

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 主窗口工作区顶部 |
| 用户操作 | 查看新版本信息；点击立即更新或关闭 |
| 控件类型建议 | Banner，带下载图标、主按钮、关闭按钮 |
| 数据来源 | Tauri updater plugin |
| 关键状态 | `idle` 和 `checking` 不显示；`available` 显示版本号和 notes |
| 设计注意点 | Banner 不应挤压核心字幕区域太多；notes 可选且可能较长 |

### 7.2 下载和安装

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 更新横幅 |
| 用户操作 | 点击立即更新 |
| 控件类型建议 | Primary button、progress bar |
| 数据来源 | updater `download` progress |
| 关键状态 | `downloading` 显示百分比和进度条；`ready` 显示已安装并准备重启；安装后调用 relaunch |
| 设计注意点 | 下载中不显示关闭按钮，避免用户误以为可以取消 |

### 7.3 错误和忽略

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 更新横幅 |
| 用户操作 | 错误时点击重试；点击关闭忽略本次更新提示 |
| 控件类型建议 | Error banner、retry button、close icon |
| 数据来源 | updater error |
| 关键状态 | `error` 显示错误文本；关闭后本次会话不再检查 |
| 设计注意点 | 错误文案来自底层异常，需要允许较长文本换行 |

## 8. 导航和运行时状态

| 项目 | 说明 |
| --- | --- |
| 入口位置 | 侧边栏和顶部栏 |
| 用户操作 | 切换 Console、Settings、History、Glossary；点击刷新运行时 |
| 控件类型建议 | Sidebar nav buttons、icon button |
| 数据来源 | 前端 tab 状态、`bootstrap()`、运行时事件监听状态 |
| 关键状态 | 当前页高亮；Runtime online/offline；刷新会重新加载配置、设备、术语表和会话 |
| 设计注意点 | 运行时状态不是网络状态，而是前端是否成功订阅 Tauri 事件和初始化运行时数据 |

## 9. 设计需要关心的数据模型

### 9.1 `RuntimeConfig`

| 字段 | 设计含义 |
| --- | --- |
| `baseUrl`、`apiKey`、`translationModel` | 翻译服务配置 |
| `asrBaseUrl`、`asrApiKey`、`asrModel`、`asrLanguage`、`asrFormat` | ASR 服务配置 |
| `sourceLang`、`targetLang` | 会话源语言和目标语言 |
| `defaultInputDeviceId` | 当前默认音频输入 |
| `displayMode` | 字幕显示模式：`source`、`translated`、`bilingual` |
| `fontSize` | 字幕字号，范围 14-56 |
| `glossaryEnabled` | 翻译时是否使用术语表 |
| `diagnosticsEnabled` | 是否显示实时诊断 |
| `segmentMinDuration`、`segmentMaxDuration`、`segmentSilenceDuration` | 分段控制参数 |
| `asrConcurrency`、`translationConcurrency` | 后端存在并会归一化，但当前设置页没有可见控件 |

### 9.2 `Device`

| 字段 | 设计含义 |
| --- | --- |
| `id` | 设备唯一值，可能较长 |
| `name`、`displayName` | 设备显示名，优先使用 `displayName` |
| `kind` | `system`、`microphone` 或 `mock` |
| `isDefault` | 是否默认设备 |
| `available` | 是否可用 |
| `description` | 设备说明文本 |

### 9.3 `SessionRecord`

| 字段 | 设计含义 |
| --- | --- |
| `id` | 会话 ID |
| `title` | 会话标题 |
| `sourceLang`、`targetLang` | 会话语言方向 |
| `startedAt`、`endedAt` | 开始和结束时间 |

### 9.4 `SubtitleSegment`

| 字段 | 设计含义 |
| --- | --- |
| `id` | 片段 ID |
| `sessionId` | 所属会话 |
| `sourceText`、`translatedText` | 源文和译文 |
| `status` | `interim`、`final`、`corrected` |
| `version` | 版本号 |
| `startTime`、`endTime` | 音频时间范围 |
| `updatedAt` | 最近更新时间 |
| `supersededBy` | 被替代时隐藏当前片段 |

### 9.5 `GlossaryTerm`

| 字段 | 设计含义 |
| --- | --- |
| `id` | 术语 ID |
| `source` | 源术语 |
| `target` | 目标译法 |
| `domain` | 领域，可为空 |
| `enabled` | 是否启用 |

## 10. 运行时事件

| 事件 | 作用 | UI 影响 |
| --- | --- | --- |
| `session:status` | 推送会话状态 | 更新状态 pill |
| `subtitle:segment-created` | 新建字幕片段 | 加入实时字幕列表 |
| `subtitle:segment-updated` | 更新字幕片段 | 合并同 ID 片段 |
| `subtitle:segment-corrected` | 推送修正字幕 | 合并片段并短暂高亮 |
| `pipeline:metrics` | 推送管线指标 | 更新诊断条 |
| `runtime:error` | 推送运行时错误 | 加入错误日志 |

## 11. 明确不属于当前可用交互的功能

以下功能当前代码中没有可见入口，重新设计时不要默认加入：

- 历史会话删除、搜索、重命名、导出。
- 字幕片段手动编辑、复制、收藏。
- 术语表搜索、批量导入、批量删除、二次确认弹窗。
- 运行中热切换术语表并保证立即影响当前会话。
- 多种 ASR provider 下拉选择；当前可见选项只有 OpenAI-compatible ASR。
- 手动取消更新下载。
