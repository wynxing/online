# UI 重构计划：配色 / 亮暗主题 / 国际化

> 日期: 2026-06-14
> 分支: codex/python-to-rust-runtime
> 范围: `apps/desktop/src/`

---

## 0. 目标

将当前仅暗色、中英混杂、单文件 CSS 的前端，重构为：
- **暖色调**舒适配色，支持亮/暗双模式
- **中英双语**切换（轻量 i18n 方案，零依赖）
- **CSS 模块化**，拆分为 8 个语义化小文件

---

## 1. 配色体系

### 设计理念

> 暖色调 = 中性暖灰底色 + 琥珀金强调色 + 鼠尾草绿状态色
> 整体氛围：温暖的阅读室，而非冷峻的终端

### 1.1 暗色模式 (Dark)

| Token | 色值 | 用途 |
|-------|------|------|
| `--bg` | `#16140f` | 主背景 — 暖黑，微棕调 |
| `--bg-elevated` | `#1d1a14` | 侧栏/浮层 — 暖深灰 |
| `--panel` | `#242018` | 卡片/面板 — 暖中灰 |
| `--panel-hover` | `#2c2820` | 面板悬停 |
| `--panel-solid` | `#201d17` | 不透明面板底色 |
| `--line` | `rgba(255,235,200,0.08)` | 分隔线 — 暖白低透明度 |
| `--line-strong` | `rgba(212,168,83,0.28)` | 强调分隔线 |
| `--text` | `#f0ece4` | 主文本 — 暖白，非蓝白 |
| `--soft` | `#b5ae9e` | 次要文本 — 暖灰 |
| `--muted` | `#7a7468` | 弱化文本 — 暖暗灰 |
| **`--accent`** | `#d4a853` | **琥珀金** — 主强调色 |
| `--accent-dim` | `#a07b2e` | 强调色暗态 |
| `--accent-glow` | `rgba(212,168,83,0.16)` | 强调色光晕 |
| `--success` | `#7cb88a` | 鼠尾草绿 — 在线/成功 |
| `--success-dim` | `rgba(124,184,138,0.14)` | 成功色底 |
| `--info` | `#7bb8d4` | 暖蓝 — 信息/链接 |
| `--warning` | `#e5a853` | 琥珀 — 警告 |
| `--danger` | `#e06060` | 暖红 — 错误/危险 |

### 1.2 亮色模式 (Light)

| Token | 色值 | 用途 |
|-------|------|------|
| `--bg` | `#f8f5ef` | 主背景 — 暖奶油白 |
| `--bg-elevated` | `#ffffff` | 侧栏/浮层 |
| `--panel` | `#ffffff` | 卡片/面板 |
| `--panel-hover` | `#f3efe8` | 面板悬停 |
| `--panel-solid` | `#ffffff` | 不透明面板 |
| `--line` | `rgba(0,0,0,0.07)` | 分隔线 |
| `--line-strong` | `rgba(160,123,46,0.22)` | 强调分隔线 |
| `--text` | `#2c2820` | 主文本 — 暖深棕 |
| `--soft` | `#6b6358` | 次要文本 |
| `--muted` | `#9e958a` | 弱化文本 |
| **`--accent`** | `#a07b2e` | **深琥珀** — 主强调色（亮模式用暗色调保证对比度） |
| `--accent-dim` | `#d4a853` | 强调色亮态 |
| `--accent-glow` | `rgba(160,123,46,0.10)` | 强调色光晕 |
| `--success` | `#3d8a50` | 深鼠尾草绿 |
| `--success-dim` | `rgba(61,138,80,0.10)` | 成功色底 |
| `--info` | `#2a7da8` | 深暖蓝 |
| `--warning` | `#b8892e` | 深琥珀 |
| `--danger` | `#c43838` | 深暖红 |

### 1.3 切换机制

```css
/* tokens.css */
:root { /* 亮色变量（默认） */ }
:root[data-theme="dark"] { /* 暗色覆写 */ }

/* 首次访问：跟随系统 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* 暗色覆写 */
  }
}
```

```typescript
// hooks/useTheme.ts
// 读取 localStorage / 系统偏好 → 设置 data-theme
// 提供 toggle 函数 → 循环 light → dark → system
```

### 1.4 背景纹理

- **暗色模式**: 保留微网格纹理，改为暖色调（网格线用暖灰低透明度）
- **亮色模式**: 去掉网格，改为极淡的暖色渐变（左上角微暖光晕）

---

## 2. 国际化 (i18n)

### 2.1 方案：零依赖类型安全 i18n

```typescript
// src/i18n/index.ts
export type Lang = "zh" | "en";

const messages: Record<Lang, Record<string, string>> = { zh: {}, en: {} };

export function t(key: string, lang: Lang): string {
  return messages[lang]?.[key] ?? key;
}
```

文件组织：
```
src/i18n/
  index.ts         ← t() 函数 + Lang 类型
  zh.ts            ← 中文翻译
  en.ts            ← 英文翻译
```

### 2.2 语言传递：React Context

```typescript
// src/i18n/LangContext.ts
const LangContext = createContext<Lang>("zh");
export const LangProvider = LangContext.Provider;
export const useLang = () => useContext(LangContext);
```

### 2.3 语言偏好持久化

- 存入 `localStorage` key `lang`
- 首次访问：跟随 `navigator.language`（`zh-*` → zh，其余 → en）
- 切换后立即更新，无需刷新

### 2.4 需翻译文本（约 100+ 项）

| 组件 | 示例 key | zh | en |
|------|----------|----|----|
| App | brand.title | AI 同传助手 | AI Interpretation |
| App | brand.subtitle | 实时双语字幕 | Real-time Bilingual Subtitles |
| App | nav.console | 控制台 | Console |
| App | nav.settings | 设置 | Settings |
| App | nav.history | 历史 | History |
| App | nav.glossary | 术语表 | Glossary |
| App | runtime.online | 运行时在线 | Runtime online |
| App | runtime.offline | 运行时离线 | Runtime offline |
| ControlPanel | btn.start | 开始 | Start |
| ControlPanel | btn.stop | 停止 | Stop |
| ControlPanel | btn.clear | 清除 | Clear |
| SubtitlePanel | subtitle.live | 实时字幕 | Live Subtitles |
| SubtitlePanel | subtitle.waiting | 等待字幕流 | Waiting for stream |
| SettingsPanel | section.asr | 语音识别设置 | ASR Settings |
| ... | ... | ... | ... |

---

## 3. CSS 模块化

### 3.1 文件拆分

```
src/styles/
  tokens.css         ← 所有 CSS 变量（亮/暗两套）+ 背景纹理
  base.css           ← reset, body, 全局元素 (button, input, select)
  sidebar.css        ← .sidebar, .brand, .nav-list, .runtime-card, .status-dot
  workspace.css      ← .workspace, .topbar, .eyebrow
  panels.css         ← .control-panel, .subtitle-panel, .form-panel,
  │                     .preview-panel, .history-list, .history-detail,
  │                     .terms-panel, .latest-panel, .empty-state
  buttons.css        ← .primary-button, .secondary-button, .danger-button,
  │                     .icon-button, .nav-button, .segmented
  floating.css       ← .floating-shell, .floating-toolbar, .floating-card
  animations.css     ← @keyframes (statusPulse, subtitleIn, correctionPulse...)
```

### 3.2 Import 顺序 (main.tsx)

```typescript
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/sidebar.css";
import "./styles/workspace.css";
import "./styles/panels.css";
import "./styles/buttons.css";
import "./styles/floating.css";
import "./styles/animations.css";
```

### 3.3 逐步迁移：逐段剪切 + 验证

---

## 4. Topbar 新增控件

```
[🌙/☀️ 主题切换] [中/EN 语言切换] [↻ Refresh] [Floating subtitles]
```

- 主题切换：循环 `light → dark → system`，图标随状态变化
- 语言切换：切换 `zh ↔ en`，显示当前语言标签

---

## 5. 实施阶段

### Phase 1: CSS 模块化 + 暖色配色（暗色模式）

1. 创建 `src/styles/` 目录 + 8 个 CSS 文件
2. 从 `styles.css` 逐段迁移到对应文件
3. 在 `tokens.css` 中定义暖色暗色模式变量
4. 替换所有硬编码 rgba 值为变量引用
5. 删除原 `styles.css`
6. 更新 `main.tsx` import
7. **验证**：暗色模式下 UI 外观正常，颜色为暖色调

### Phase 2: 亮色模式 + 主题切换

1. 在 `tokens.css` 添加 `:root` 亮色变量
2. 创建 `hooks/useTheme.ts`
3. 在 `main.tsx` 初始化主题
4. Topbar 添加主题切换按钮
5. 背景纹理适配双模式
6. **验证**：亮暗切换流畅，所有面板/按钮/输入框在两种模式下可读

### Phase 3: 国际化

1. 创建 `src/i18n/` 目录 + 三个文件
2. 收集所有硬编码文本，写入 zh.ts / en.ts
3. 创建 `LangContext`
4. 在 `App.tsx` 提供 LangProvider
5. 逐组件替换硬编码文本为 `t()` 调用
6. Topbar 添加语言切换按钮
7. `formatDate()` 适配 locale
8. **验证**：中英切换覆盖所有可见文本，无遗漏

### Phase 4: 验收 + 清理

1. 浏览器控制台无错误/警告
2. 亮/暗模式下所有交互状态正常
3. 中英切换无残留硬编码文本
4. 浮窗模式在两种主题/语言下正常
5. 响应式断点在两种模式下正常
6. 现有测试通过，无回归
7. `localStorage` 持久化主题/语言偏好

---

## 6. 不做的事

- 不引入 CSS 框架（Tailwind / CSS Modules）
- 不引入 i18n 库（i18next / react-intl）
- 不改动组件逻辑 / 状态管理
- 不改动 Rust 后端
- 不重新设计布局结构
- 不新增功能（纯 UI/UX 改造）

---

## 7. 风险 & 缓解

| 风险 | 缓解 |
|------|------|
| 拆分 CSS 时选择器优先级变化 | 逐步迁移，每拆一个文件就验证渲染 |
| 亮色模式下对比度不足 | WCAG AA 标准（4.5:1）验证 |
| 翻译遗漏 | 全局搜索组件中硬编码中文字符串 |
| 浮窗透明背景在亮色下可读性 | 浮窗跟随主窗口主题 |
