# 修复总结

## 问题 1：Runtime 连接问题（400 Bad Request）

### 根本原因
CORS 配置中 `allow_credentials=True` 与 `allow_origins=["*"]` 冲突，导致 OPTIONS 预检请求返回 400。

### 修复方案
- **文件**：`runtime/app/main.py`
- **修改**：移除 `allow_credentials=True`，改为 `allow_credentials=False`
- **原因**：本地 API 不需要 cookies，移除 credentials 避免 CORS 冲突

---

## 问题 2：版本管理问题

### 根本原因
版本号硬编码且不同步：
- `apps/desktop/package.json` → `0.1.0`（未同步）
- `apps/desktop/src-tauri/tauri.conf.json` → `0.4.1`
- `apps/desktop/src-tauri/Cargo.toml` → `0.4.1`

### 修复方案

#### 2.1 同步版本号
- **文件**：`apps/desktop/package.json`
- **修改**：将 `"version": "0.1.0"` 改为 `"version": "0.4.1"`

#### 2.2 改进版本管理脚本
- **文件**：`scripts/bump-version.ps1`
- **修改**：添加验证步骤，确保三个文件版本号一致后再提交
- **原因**：防止未来出现版本不同步问题

---

## 问题 3：Sidecar 稳定性问题

### 根本原因
Sidecar 意外终止后没有自动重启机制，导致 Runtime 无法恢复。

### 修复方案
- **文件**：`apps/desktop/src-tauri/src/lib.rs`
- **修改**：
  1. 添加重启计数器和常量（最大重试 3 次，延迟 2 秒）
  2. 在 `CommandEvent::Terminated` 处理器中添加自动重启逻辑
  3. 成功启动时重置重启计数器
- **原因**：Sidecar 意外终止后应自动恢复，避免用户手动重启

---

## 问题 4：Bootstrap 逻辑优化

### 根本原因
当前 bootstrap 逻辑先检查 sidecar 进程状态，再尝试健康检查。如果 runtime 已在运行（比如用户手动启动了），会尝试启动一个新的，导致端口冲突和资源浪费。

### 修复方案
- **文件**：`apps/desktop/src/App.tsx`
- **修改**：改进 bootstrap 流程：
  1. **先尝试健康检查**（快速检测 Runtime 是否已存在）
     - 如果成功，直接连接，跳过 sidecar 启动
     - 如果失败，继续步骤 2
  2. **检查 sidecar 进程状态**
     - 如果进程在运行但健康检查失败，等待并重试
     - 如果进程不在运行且有错误信息，显示错误
     - 如果进程不在运行且无错误，尝试启动 sidecar
  3. **轮询健康检查**（等待 sidecar 就绪）
     - 最多重试 15 次，每次间隔 1 秒
     - 成功后连接

### 优势
- **智能检测**：先检查 runtime 是否已存在，避免重复启动
- **快速连接**：如果 runtime 已在运行，立即连接
- **资源节省**：避免启动多个 runtime 进程
- **端口冲突**：避免端口 8765 被占用

---

## 问题 5：WebSocket 重连问题

### 根本原因
WebSocket 重连使用固定延迟（1.2 秒），没有退避策略，导致频繁重连请求。

### 修复方案

#### 4.1 实现指数退避重连
- **文件**：`apps/desktop/src/hooks/useSubtitleSocket.ts`
- **修改**：
  1. 添加重试计数器
  2. 实现指数退避延迟（1s, 2s, 4s, 8s, ...）
  3. 添加最大重试次数限制（10 次）
  4. 成功连接时重置计数器
- **原因**：避免频繁重连请求，提供更好的用户体验

#### 4.2 显示重连次数
- **文件**：`apps/desktop/src/App.tsx`
- **修改**：在 WebSocket 状态显示中添加重连次数
- **原因**：帮助用户了解连接状态

---

## 测试结果

### 前端测试
- ✅ 5 个测试文件全部通过
- ✅ 43 个测试用例全部通过

### Runtime 测试
- ✅ 81 个测试用例全部通过

### Rust 代码检查
- ✅ 编译检查通过

---

## 修改的文件

1. `runtime/app/main.py` - 修复 CORS 配置
2. `apps/desktop/package.json` - 同步版本号
3. `apps/desktop/src-tauri/tauri.conf.json` - 版本号（已同步）
4. `apps/desktop/src-tauri/Cargo.toml` - 版本号（已同步）
5. `apps/desktop/src-tauri/src/lib.rs` - 添加 Sidecar 自动重启
6. `apps/desktop/src/hooks/useSubtitleSocket.ts` - 实现 WebSocket 指数退避重连
7. `apps/desktop/src/App.tsx` - 显示重连次数 + 改进 Bootstrap 逻辑
8. `scripts/bump-version.ps1` - 添加版本验证

---

## 后续建议

1. **监控 Sidecar 重启**：添加日志记录，监控自动重启的频率和原因
2. **优化重连策略**：根据实际网络情况调整重连延迟和最大重试次数
3. **添加健康检查**：在 Sidecar 启动后添加健康检查，确保服务完全就绪
4. **改进错误提示**：在 UI 中显示更详细的错误信息和解决建议
