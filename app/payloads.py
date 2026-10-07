"""把虛擬感測器設定轉成真正要傳送的位元組。"""

import json
import math
import random
import re
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .models import DeviceConfig, SensorField


TYPE_IDS = {"float": 1, "integer": 2, "string": 3, "boolean": 4}


@dataclass
class BuiltPayload:
    """body 是實際上線的 bytes；preview 只是給人閱讀的呈現方式。"""

    body: bytes
    content_type: str
    preview: str
    values: dict[str, Any]
    format: str


def _coerce(value: Any, data_type: str) -> Any:
    """把固定輸入值轉成欄位宣告的型別，避免字串數字混進輸出。"""
    if data_type == "float":
        return round(float(value or 0), 4)
    if data_type == "integer":
        return int(float(value or 0))
    if data_type == "boolean":
        if isinstance(value, str):
            return value.lower() in {"true", "1", "yes", "on"}
        return bool(value)
    return str(value if value is not None else "")


def _numeric_bounds(field: SensorField) -> tuple[float, float]:
    """取得數值產生範圍；未填上下界時以固定值附近作預設。"""
    base = float(field.value or 0)
    low = float(field.min_value if field.min_value is not None else base - 1)
    high = float(field.max_value if field.max_value is not None else base + 1)
    return (low, high) if low <= high else (high, low)


def _field_value(field: SensorField, sequence: int) -> Any:
    """依 fixed、random 或 range 模式產生單一感測值。

    range 使用 sequence 決定目前位於哪一格，所以連續發送能依步長循環變化。
    """
    if field.data_type not in {"float", "integer"}:
        if field.mode == "random" and field.data_type == "boolean":
            return bool(random.getrandbits(1))
        return _coerce(field.value, field.data_type)

    low, high = _numeric_bounds(field)
    if field.mode == "fixed":
        value = float(field.value or 0)
    elif field.mode == "random":
        value = random.uniform(low, high)
    else:
        step = abs(float(field.step if field.step not in (None, 0) else 1))
        slots = max(int(math.floor((high - low) / step)) + 1, 1)
        value = low + (sequence % slots) * step
        value = min(value, high)
    return int(round(value)) if field.data_type == "integer" else round(value, 4)


def _binary_payload(device_id: str, timestamp_ms: int, fields: list[SensorField], values: dict[str, Any]) -> bytes:
    """依本專案的 IOT1 實驗格式逐段寫入裝置、時間與欄位資料。

    這是自訂格式；接收方必須用相同順序、長度和型別規則解碼。
    """
    device = device_id.encode("utf-8")[:255]
    # 魔術字 IOT1 讓接收端能辨認這份資料的自訂格式版本。
    result = bytearray(b"IOT1")
    result += struct.pack(">B", len(device)) + device
    result += struct.pack(">QB", timestamp_ms, min(len(fields), 255))
    for field in fields[:255]:
        # 每個欄位先放名稱、型別與單位，再依型別放固定長度或帶長度的值。
        name = field.name.encode("utf-8")[:255]
        unit = field.unit.encode("utf-8")[:255]
        value = values[field.name]
        result += struct.pack(">B", len(name)) + name
        result += struct.pack(">B", TYPE_IDS[field.data_type])
        result += struct.pack(">B", len(unit)) + unit
        if field.data_type == "float":
            result += struct.pack(">d", float(value))
        elif field.data_type == "integer":
            result += struct.pack(">q", int(value))
        elif field.data_type == "boolean":
            result += struct.pack(">?", bool(value))
        else:
            encoded = str(value).encode("utf-8")[:65535]
            result += struct.pack(">H", len(encoded)) + encoded
    return bytes(result)


def _template(value: Any, identity: str, timestamp: str) -> Any:
    """每次發送才展開範本；不同裝置和不同週期均產生自己的資料。"""
    if isinstance(value, dict):
        return {key: _template(item, identity, timestamp) for key, item in value.items()}
    if isinstance(value, list):
        return [_template(item, identity, timestamp) for item in value]
    if not isinstance(value, str):
        return value
    if value == "{{device_id}}":
        return identity
    if value == "{{timestamp}}":
        return timestamp
    match = re.fullmatch(r"\{\{(random|int):([-\d.]+):([-\d.]+)\}\}", value)
    if match:
        low, high = float(match[2]), float(match[3])
        return random.randint(int(low), int(high)) if match[1] == "int" else round(random.uniform(low, high), 4)
    return value


def build_payload(config: DeviceConfig, sequence: int = 0) -> BuiltPayload:
    """由設定產生 body、Content-Type、預覽文字與欄位原值。

    raw_json 先返回，因此畫面選原始 JSON 時不會再走文字或 Binary 分支。
    """
    if config.payload_mode == "raw_json":
        data = config.raw_json
        if config.template_mode:
            data = _template(data, config.name, datetime.now(timezone.utc).isoformat())
            data["device_id"] = config.name
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return BuiltPayload(body, "application/json", json.dumps(data, ensure_ascii=False, indent=2), data, "json")

    fields = config.sensor_fields
    # 同一輪先算好每個欄位；後續 JSON／文字／Binary 都使用相同數值。
    values = {field.name: _field_value(field, sequence) for field in fields}
    now = datetime.now(timezone.utc)
    timestamp = now.isoformat()
    sensor_rows = [
        {"name": field.name, "value": values[field.name], "unit": field.unit, "type": field.data_type}
        for field in fields
    ]

    if config.payload_format == "json":
        # JSON 把感測欄位的名稱、值、單位與型別組成可讀的 sensors 陣列。
        data = {"device_id": config.name, "timestamp": timestamp, "sensors": sensor_rows}
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return BuiltPayload(body, "application/json", json.dumps(data, ensure_ascii=False, indent=2), values, "json")

    if config.payload_format == "plain_text":
        # 文字模式保留裝置與時間，以分號分隔各欄位，方便直接閱讀封包內容。
        parts = [f"device_id={config.name}", f"timestamp={timestamp}"]
        parts.extend(f"{field.name}={values[field.name]}{(' ' + field.unit) if field.unit else ''}" for field in fields)
        preview = ";".join(parts)
        return BuiltPayload(preview.encode("utf-8"), "text/plain; charset=utf-8", preview, values, "plain_text")

    body = _binary_payload(config.name, int(now.timestamp() * 1000), fields, values)
    # Binary 無法直接顯示為文字，因此預覽改用十六進位位元組。
    preview = " ".join(f"{byte:02x}" for byte in body)
    return BuiltPayload(body, "application/octet-stream", preview, values, "binary")
