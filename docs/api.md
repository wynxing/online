# API 参考

Python Runtime 提供 HTTP REST 接口和 WebSocket 实时推送接口。

**Base URL**: `http://127.0.0.1:8765`（可通过 `ONLINE_RUNTIME_PORT` 环境变量修改）

## HTTP 接口

### 健康检查

```http
GET /api/health
```

**响应**:

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### 设备列表

```http
GET /api/devices
```

**响应**:

```json
{
  "devices": [
    {
      "id": "loopback_0",
      "name": "Speakers (Realtek Audio)",
      "type": "loopback",
      "isDefault": true
    },
    {
      "id": "mic_0",
      "name": "Microphone (USB Audio)",
      "type": "microphone",
      "isDefault": false
    }
  ]
}
```

设备类型：`loopback`（系统音频）、`microphone`（麦克风）、`mock`（模拟设备）。

### 读取配置

```http
GET /api/config
```

**响应**:

```json
{
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "translationModel": "gpt-4o-mini",
  "asrModel": "whisper-1",
  "asrProvider": "whisper",
  "displayMode": "bilingual",
  "fontSize": 16,
  "glossaryEnabled": true
}
```

### 更新配置

```http
POST /api/config
Content-Type: application/json
```

**请求体**:

```json
{
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "translationModel": "gpt-4o-mini",
  "asrModel": "whisper-1",
  "asrProvider": "whisper",
  "displayMode": "bilingual",
  "fontSize": 16,
  "glossaryEnabled": true
}
```

### 开始会话

```http
POST /api/session/start
Content-Type: application/json
```

**请求体**:

```json
{
  "inputDeviceId": "loopback_0",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "displayMode": "bilingual",
  "asrProvider": "whisper",
  "translationProvider": "llm"
}
```

**响应**:

```json
{
  "sessionId": "sess_abc123",
  "status": "started"
}
```

### 停止会话

```http
POST /api/session/stop
```

**响应**:

```json
{
  "sessionId": "sess_abc123",
  "status": "stopped",
  "segmentCount": 42
}
```

### 会话历史

```http
GET /api/sessions
```

**响应**:

```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "title": "2026-06-09 Session",
      "sourceLang": "en",
      "targetLang": "zh-CN",
      "startedAt": "2026-06-09T10:00:00Z",
      "endedAt": "2026-06-09T11:30:00Z",
      "segmentCount": 42
    }
  ]
}
```

### 会话字幕

```http
GET /api/sessions/{sessionId}/segments
```

**响应**:

```json
{
  "segments": [
    {
      "id": "seg_001",
      "sourceText": "Today we are going to talk about edge computing.",
      "translatedText": "今天我们来聊边缘计算。",
      "startTime": 1.25,
      "endTime": 4.8,
      "version": 2
    }
  ]
}
```

### 术语表 CRUD

```http
GET    /api/glossary              # 获取所有术语
POST   /api/glossary              # 添加术语
PUT    /api/glossary/{id}         # 更新术语
DELETE /api/glossary/{id}         # 删除术语
```

**添加术语请求体**:

```json
{
  "source": "edge computing",
  "target": "边缘计算",
  "domain": "技术",
  "enabled": true
}
```

### 测试翻译

```http
POST /api/test-translation
Content-Type: application/json
```

**请求体**:

```json
{
  "text": "Hello, how are you?",
  "sourceLang": "en",
  "targetLang": "zh-CN"
}
```

## WebSocket 接口

### 连接

```text
ws://127.0.0.1:8765/ws/subtitles
```

连接后自动接收当前会话的字幕事件推送。支持自动重连。

### 事件类型

#### segment.created

新字幕段创建（ASR 识别完成）。

```json
{
  "type": "segment.created",
  "payload": {
    "id": "seg_001",
    "sessionId": "sess_abc123",
    "sourceText": "Today we are going to talk about edge computing.",
    "translatedText": "",
    "status": "interim",
    "version": 1,
    "startTime": 1.25,
    "endTime": null,
    "updatedAt": "2026-06-09T10:00:01Z"
  }
}
```

#### segment.updated

字幕段更新（翻译完成或状态变更）。

```json
{
  "type": "segment.updated",
  "payload": {
    "id": "seg_001",
    "sessionId": "sess_abc123",
    "sourceText": "Today we are going to talk about edge computing.",
    "translatedText": "今天我们来聊边缘计算。",
    "status": "final",
    "version": 2,
    "startTime": 1.25,
    "endTime": 4.8,
    "updatedAt": "2026-06-09T10:00:03Z"
  }
}
```

#### segment.corrected

字幕段修正（基于后续上下文修正识别或翻译结果）。

```json
{
  "type": "segment.corrected",
  "payload": {
    "id": "seg_001",
    "sessionId": "sess_abc123",
    "sourceText": "We use caching to reduce latency.",
    "translatedText": "我们使用缓存来降低延迟。",
    "status": "corrected",
    "version": 3,
    "startTime": 1.25,
    "endTime": 4.8,
    "updatedAt": "2026-06-09T10:00:05Z"
  }
}
```

#### pipeline.metrics

管线诊断指标（采样率受控）。

```json
{
  "type": "pipeline.metrics",
  "payload": {
    "asrQueueDepth": 2,
    "translationQueueDepth": 1,
    "asrWorkerCount": 2,
    "translationWorkerCount": 2,
    "segmentsProcessed": 15,
    "avgAsrLatencyMs": 850,
    "avgTranslationLatencyMs": 1200
  }
}
```

#### runtime.error

运行时错误事件。

```json
{
  "type": "runtime.error",
  "payload": {
    "code": "ASR_UNAVAILABLE",
    "message": "ASR service is unavailable.",
    "recoverable": true
  }
}
```

## 错误码

| 错误码 | 说明 |
|--------|------|
| `ASR_UNAVAILABLE` | ASR 服务不可用 |
| `TRANSLATION_FAILED` | 翻译请求失败 |
| `DEVICE_NOT_FOUND` | 指定的音频设备不存在 |
| `SESSION_ALREADY_ACTIVE` | 已有活跃会话，无法重复启动 |
| `NO_SESSION` | 没有活跃会话，无法停止 |
