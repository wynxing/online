from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class DisplayMode(str, Enum):
    source = "source"
    translated = "translated"
    bilingual = "bilingual"


class SubtitleStatus(str, Enum):
    interim = "interim"
    final = "final"
    corrected = "corrected"


class Device(BaseModel):
    id: str
    name: str
    kind: Literal["system", "microphone", "mock"]
    isDefault: bool = False
    available: bool = True
    description: str | None = None


class RuntimeConfig(BaseModel):
    baseUrl: str = "https://api.openai.com/v1"
    apiKey: str = ""
    translationModel: str = "gpt-4o-mini"
    asrProvider: str = "mock"
    translationProvider: str = "openai-compatible"
    defaultInputDeviceId: str = "system_loopback"
    displayMode: DisplayMode = DisplayMode.bilingual
    fontSize: int = Field(default=24, ge=14, le=56)
    glossaryEnabled: bool = True
    asrBaseUrl: str = ""
    asrApiKey: str = ""
    asrModel: str = "whisper-1"
    asrLanguage: str = "en"
    asrFormat: str = "whisper"  # "whisper" | "chat-completions"
    asrConcurrency: int = Field(default=2, ge=1, le=8)
    translationConcurrency: int = Field(default=3, ge=1, le=8)
    segmentMinDuration: float = Field(default=1.2, ge=0.4, le=10.0)
    segmentMaxDuration: float = Field(default=3.0, ge=0.8, le=20.0)
    segmentSilenceDuration: float = Field(default=0.35, ge=0.1, le=3.0)
    diagnosticsEnabled: bool = True


class TestTranslationRequest(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""
    translationModel: str = ""


class TestAsrRequest(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""
    asrBaseUrl: str = ""
    asrApiKey: str = ""
    asrModel: str = ""


class StartSessionRequest(BaseModel):
    inputDeviceId: str = "system_loopback"
    sourceLang: str = "en"
    targetLang: str = "zh-CN"
    displayMode: DisplayMode = DisplayMode.bilingual
    asrProvider: str = "mock"
    translationProvider: str = "openai-compatible"


class SessionRecord(BaseModel):
    id: str
    title: str
    sourceLang: str
    targetLang: str
    startedAt: str
    endedAt: str | None = None


class SubtitleSegment(BaseModel):
    id: str
    sessionId: str
    sourceText: str
    translatedText: str
    status: SubtitleStatus
    version: int
    startTime: float
    endTime: float | None = None
    updatedAt: str
    supersededBy: str | None = None


class GlossaryTerm(BaseModel):
    id: str
    source: str
    target: str
    domain: str | None = None
    enabled: bool = True


class GlossaryTermInput(BaseModel):
    source: str
    target: str
    domain: str | None = None
    enabled: bool = True


class RuntimeErrorPayload(BaseModel):
    code: str
    message: str
    recoverable: bool = True


class Event(BaseModel):
    type: str
    payload: dict[str, Any]
