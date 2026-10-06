"""舊版七協議驗收接收端；目前 Compose 啟動的是 app.receiver:app。

本模組會把可解析的 JSON 及協議特定事件存進記憶體，保留供閱讀的驗收邏輯。
"""

from __future__ import annotations

import asyncio
import json
import os
import struct
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock
from urllib.parse import parse_qs

import aio_pika
import paho.mqtt.client as mqtt
import websockets
from aiocoap import BAD_REQUEST, CHANGED, CREATED, Context, Message, resource
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse


class EventStore:
    """給接收事件遞增 ID，並保留最近 1000 筆以供 since 查詢。"""

    def __init__(self) -> None:
        self.lock = Lock()
        self.sequence = 0
        self.events: deque[dict] = deque(maxlen=1000)

    def add(self, protocol: str, details: dict) -> dict:
        """加上時間與協議後保存事件，回傳其 ID 供回應使用。"""
        with self.lock:
            self.sequence += 1
            event = {
                "id": self.sequence,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "protocol": protocol,
                **details,
            }
            self.events.append(event)
            return event

    def list(self, protocol: str | None, since: int, limit: int) -> list[dict]:
        """按協議與最後看過的 ID 過濾，驗收程式可只查新事件。"""
        with self.lock:
            return [
                event for event in reversed(self.events)
                if event["id"] > since and (protocol is None or event["protocol"] == protocol)
            ][:limit]


store = EventStore()


class IoTResource(resource.Resource):
    """實驗 CoAP /iot 入口，只接受 JSON 物件。"""

    async def render_post(self, request: Message) -> Message:
        """解析 Payload，存入事件並回覆其事件 ID。"""
        try:
            payload = json.loads(request.payload.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON object required")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            return Message(code=BAD_REQUEST, payload=b'{"ok":false,"error":"invalid JSON"}')
        event = store.add("coap", {"payload": payload})
        return Message(code=CHANGED, payload=json.dumps({"ok": True, "event_id": event["id"]}).encode())


class RegistrationResource(resource.Resource):
    """簡化的 /rd 註冊入口，用 endpoint 名稱表示一筆 LwM2M 事件。"""

    async def render_post(self, request: Message) -> Message:
        """從 URI query 讀取 ep、lt、b，回傳實驗性 location path。"""
        query = parse_qs("&".join(request.opt.uri_query))
        endpoint = query.get("ep", [""])[0]
        if not endpoint:
            return Message(code=BAD_REQUEST, payload=b'{"ok":false,"error":"ep required"}')
        event = store.add("lwm2m", {
            "endpoint": endpoint,
            "lifetime": query.get("lt", [""])[0],
            "binding": query.get("b", [""])[0],
            "objects": request.payload.decode("utf-8", errors="replace"),
        })
        response = Message(code=CREATED, payload=json.dumps({"ok": True, "event_id": event["id"]}).encode())
        response.opt.location_path = ("rd", endpoint)
        return response


async def websocket_handler(connection) -> None:
    """解析每個 WebSocket frame 為 JSON，回覆成功或格式錯誤。"""
    async for raw in connection:
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("JSON object required")
            event = store.add("websocket", {"payload": payload})
            await connection.send(json.dumps({"ok": True, "event_id": event["id"]}))
        except (json.JSONDecodeError, ValueError):
            await connection.send(json.dumps({"ok": False, "error": "invalid JSON"}))


async def modbus_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """接收 Modbus 功能碼 6 的單一暫存器寫入，並回傳同內容確認。"""
    try:
        while True:
            header = await reader.readexactly(7)
            transaction, protocol_id, length, unit_id = struct.unpack(">HHHB", header)
            if protocol_id != 0 or length < 2 or length > 253:
                break
            pdu = await reader.readexactly(length - 1)
            if len(pdu) == 5 and pdu[0] == 6:
                # Modbus TCP 的 MBAP 標頭是 7 bytes；PDU 內拆出位址和值。
                _, address, value = struct.unpack(">BHH", pdu)
                store.add("modbus", {"unit_id": unit_id, "address": address, "value": value})
                writer.write(header + pdu)
            else:
                function = pdu[0] if pdu else 0
                error_pdu = bytes([function | 0x80, 1])
                writer.write(struct.pack(">HHHB", transaction, 0, len(error_pdu) + 1, unit_id) + error_pdu)
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        writer.close()
        await writer.wait_closed()


def make_mqtt_client() -> mqtt.Client:
    """連到實驗 Broker 並訂閱所有 Topic，以 JSON 物件記錄訊息。"""
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="sender-lab-receiver")

    def on_connect(client, userdata, flags, reason_code, properties):
        if not reason_code.is_failure:
            client.subscribe("#", qos=1)

    def on_message(client, userdata, message):
        # 此舊版驗收端僅記錄可解析成 JSON object 的 MQTT 訊息。
        try:
            payload = json.loads(message.payload.decode("utf-8"))
            if isinstance(payload, dict):
                store.add("mqtt", {"topic": message.topic, "payload": payload})
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(os.getenv("LAB_MQTT_HOST", "lab-mosquitto"), 1883)
    client.loop_start()
    return client


async def consume_amqp(connection: aio_pika.RobustConnection) -> None:
    """消費 RabbitMQ queue，記錄可解析的 JSON 物件。"""
    channel = await connection.channel()
    queue = await channel.declare_queue("iot.sensor", durable=True)

    async def on_message(message: aio_pika.IncomingMessage) -> None:
        async with message.process():
            try:
                payload = json.loads(message.body.decode("utf-8"))
                if isinstance(payload, dict):
                    store.add("amqp", {"routing_key": message.routing_key, "payload": payload})
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass

    await queue.consume(on_message)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """集中啟動 MQTT、AMQP、CoAP、WebSocket、Modbus 接收服務。"""
    mqtt_client = make_mqtt_client()
    amqp_connection = await aio_pika.connect_robust(os.getenv("LAB_AMQP_URL", "amqp://lab:lab-pass@lab-rabbitmq:5672/"))
    await consume_amqp(amqp_connection)
    site = resource.Site()
    site.add_resource(["iot"], IoTResource())
    site.add_resource(["rd"], RegistrationResource())
    coap_context = await Context.create_server_context(site, bind=("0.0.0.0", 5683))
    websocket_server = await websockets.serve(websocket_handler, "0.0.0.0", 8765)
    modbus_server = await asyncio.start_server(modbus_handler, "0.0.0.0", 5020)
    application.state.ready = True
    try:
        yield
    finally:
        # 即使請求處理期間發生例外，服務關閉時仍釋放所有協議資源。
        application.state.ready = False
        modbus_server.close()
        await modbus_server.wait_closed()
        websocket_server.close()
        await websocket_server.wait_closed()
        await coap_context.shutdown()
        await amqp_connection.close()
        mqtt_client.disconnect()
        mqtt_client.loop_stop()


app = FastAPI(title="Sender Lab Receiver", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    """回應實驗端健康檢查。"""
    return {"status": "ok", "service": "sender-lab-receiver"}


@app.get("/events")
async def events(
    protocol: str | None = None,
    since: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> list[dict]:
    """查詢指定協議、指定 ID 之後的接收紀錄。"""
    return store.list(protocol, since, limit)


@app.post("/iot")
async def ingest_http(request: Request) -> dict:
    """僅接受 JSON object，並回傳對應的事件 ID。"""
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(422, "JSON object required")
    event = store.add("http", {"payload": payload})
    return {"ok": True, "event_id": event["id"]}


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    """提供可在瀏覽器檢視七協議事件的簡易 HTML 頁面。"""
    return """<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>七協議測試接收端</title><style>body{font:16px system-ui;margin:32px;max-width:1100px;color:#172b35}h1{font-size:28px}small{color:#667782}table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}code{font-size:12px;word-break:break-all}button{padding:8px 14px}select{padding:8px}</style>
<h1>七協議測試接收端</h1><p>這裡顯示本機實驗室接收紀錄。LwM2M 是註冊事件；Modbus 是暫存器寫入，其餘顯示訊息內容。</p>
<label>協議 <select id="protocol"><option value="">全部</option><option>mqtt</option><option>coap</option><option>http</option><option>amqp</option><option>websocket</option><option>modbus</option><option>lwm2m</option></select></label> <button onclick="load()">重新整理</button> <small id="updated"></small>
<table><thead><tr><th>時間</th><th>協議</th><th>接收內容</th></tr></thead><tbody id="rows"></tbody></table>
<script>async function load(){const p=document.getElementById('protocol').value;const r=await fetch('/events?limit=100'+(p?'&protocol='+p:''));const data=await r.json();const rows=document.getElementById('rows');rows.replaceChildren();for(const e of data){const tr=document.createElement('tr');for(const value of [new Date(e.received_at).toLocaleString('zh-TW'),e.protocol,JSON.stringify(e.payload||{endpoint:e.endpoint,objects:e.objects,unit_id:e.unit_id,address:e.address,value:e.value})]){const td=document.createElement('td');td.textContent=value;tr.append(td)}rows.append(tr)}document.getElementById('updated').textContent='共 '+data.length+' 筆，最近更新 '+new Date().toLocaleTimeString('zh-TW')}document.getElementById('protocol').onchange=load;load();setInterval(load,3000)</script></html>"""
