"""舊版七協議驗收輔助流程：發送一筆後搜尋接收端新事件。

目前此檔未由 main.py 掛上 API；其 send_once 呼叫形式與現行 Simulator
介面不同，/events 篩選參數也對應舊版 lab_receiver.py。
因此下列程式用來理解驗收設計，不能直接視為現行可執行的驗收入口。
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import httpx

from .engine import Simulator
from .models import Protocol


PROTOCOLS: tuple[Protocol, ...] = (
    "mqtt", "coap", "http", "amqp", "websocket", "modbus", "lwm2m"
)
LAB_EVENTS_URL = "http://lab-receiver:8091/events"


def target_for(protocol: Protocol, marker: str, register_value: int) -> dict:
    """為每種協議指定本機實驗接收目標；marker 用於唯一識別這次測試。"""
    return {
        "mqtt": {"host": "lab-mosquitto", "port": 1883, "topic": "iot/lab/verify", "qos": 1},
        "coap": {"uri": "coap://lab-receiver:5683/iot"},
        "http": {"url": "http://lab-receiver:8091/iot", "method": "POST"},
        "amqp": {"url": "amqp://lab:lab-pass@lab-rabbitmq:5672/", "routing_key": "iot.sensor"},
        "websocket": {"url": "ws://lab-receiver:8765"},
        "modbus": {
            "host": "lab-receiver", "port": 5020, "address": 0,
            "device_id": 1, "value_key": "register_value",
        },
        "lwm2m": {
            "server": "coap://lab-receiver:5683", "endpoint": f"lab-{marker}",
            "lifetime": 300, "binding": "U", "objects": "</3/0>,</3303/0>",
        },
    }[protocol]


def matches(protocol: Protocol, event: dict, marker: str, register_value: int) -> bool:
    """依協議判斷接收事件是否對應這次發送。

Modbus 比對暫存器值，LwM2M 比對 endpoint，其餘比對 Payload 中的 ID。
    """
    if protocol == "modbus":
        return event.get("value") == register_value
    if protocol == "lwm2m":
        return event.get("endpoint") == f"lab-{marker}"
    return event.get("payload", {}).get("verification_id") == marker


async def verify_one(sim: Simulator, protocol: Protocol, client: httpx.AsyncClient) -> dict:
    """先記下接收端目前事件 ID，再發送並輪詢是否出現新的匹配事件。"""
    marker = uuid4().hex[:12]
    register_value = int(marker[:4], 16)
    baseline = (await client.get(LAB_EVENTS_URL, params={"limit": 1})).json()
    # since 排除測試前已存在的資料，避免舊事件被誤判為此次成功。
    since = baseline[0]["id"] if baseline else 0
    payload = {
        "device_id": f"LAB-{protocol.upper()}-{marker}",
        "verification_id": marker,
        "timestamp": "{{timestamp}}",
        "temperature": "{{random:20:35}}",
        "register_value": register_value,
    }
    result = await asyncio.wait_for(
        sim.send_once(protocol, target_for(protocol, marker, register_value), payload, payload["device_id"]),
        timeout=12,
    )
    if not result["ok"]:
        return {"protocol": protocol, "sent": False, "received": False, "error": result["error"]}
    # 發送 API 返回後，接收端可能仍在處理，因此短暫輪詢新事件。
    for _ in range(20):
        response = await client.get(LAB_EVENTS_URL, params={"protocol": protocol, "since": since, "limit": 100})
        response.raise_for_status()
        match = next((event for event in response.json() if matches(protocol, event, marker, register_value)), None)
        if match:
            return {"protocol": protocol, "sent": True, "received": True, "event": match}
        await asyncio.sleep(0.1)
    return {"protocol": protocol, "sent": True, "received": False, "error": "接收端未找到這筆資料"}


async def verify_all(sim: Simulator) -> dict:
    """依序執行七個協議的檢查，彙整真正有接收紀錄的數量。"""
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get("http://lab-receiver:8091/health")
        response.raise_for_status()
        results = []
        for protocol in PROTOCOLS:
            try:
                results.append(await verify_one(sim, protocol, client))
            except Exception as exc:
                results.append({"protocol": protocol, "sent": False, "received": False, "error": str(exc)})
    return {"passed": sum(item["received"] for item in results), "total": len(results), "results": results}
