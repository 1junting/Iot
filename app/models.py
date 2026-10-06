"""定義前端與 API 共用的輸入格式，讓錯誤設定在發送前就被擋下。"""

from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field, field_validator


# Literal 限制使用者只能選已實作的協議、格式及感測值產生方式。
Protocol = Literal["mqtt", "http", "coap", "amqp", "websocket", "modbus", "lwm2m"]
PayloadFormat = Literal["json", "plain_text", "binary"]
PayloadMode = Literal["graphical", "raw_json"]
DataType = Literal["float", "integer", "string", "boolean"]
GenerationMode = Literal["fixed", "random", "range"]


class SensorField(BaseModel):
    """一個虛擬感測欄位；例如 temperature、25.4、°C 與 random。"""

    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_.-]*$")
    value: Any = 0
    unit: str = Field(default="", max_length=24)
    data_type: DataType = "float"
    mode: GenerationMode = "fixed"
    min_value: float | int | None = None
    max_value: float | int | None = None
    step: float | int | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        """去掉欄位名稱前後空白，避免產生肉眼不易發現的不同欄位。"""
        return value.strip()


class DeviceConfig(BaseModel):
    """一次發送或一個連續 Run 的完整設定。

    target 的內容因協議而異：MQTT 使用 host/topic，HTTP 使用 url/method。
    graphical 模式從 sensor_fields 產生資料；raw_json 模式直接使用 raw_json。
    """

    name: str = Field(default="ENV-SENSOR-001", min_length=1, max_length=64)
    protocol: Protocol = "mqtt"
    interval_ms: int = Field(default=1000, ge=1000, le=3_600_000)
    target: Dict[str, Any] = Field(default_factory=dict)
    payload_mode: PayloadMode = "graphical"
    payload_format: PayloadFormat = "json"
    sensor_fields: List[SensorField] = Field(default_factory=list, max_length=64)
    raw_json: Dict[str, Any] = Field(default_factory=dict)


class PreviewRequest(BaseModel):
    """預覽 API 的請求，只需提供尚未發送的裝置設定。"""

    config: DeviceConfig


class SendRequest(BaseModel):
    """單次發送請求；preview_id 可讓實際送出的位元組沿用畫面預覽。"""

    config: DeviceConfig
    preview_id: str | None = None
