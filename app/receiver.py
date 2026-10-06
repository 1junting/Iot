"""本機七協議實驗接收端；Compose 以 app.receiver:app 啟動此模組。

它把各協議收到的原始內容整理成短期記憶體紀錄，供 /events 頁面觀察。
這個接收端是實驗用，不會把訊息寫入 HDPCM 的 SQLite。
"""

import asyncio
import json
import os
import struct
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock

import aio_pika
import paho.mqtt.client as mqtt
import websockets
from aiocoap import CHANGED, Context, Message, resource
from fastapi import FastAPI, Query, Request


class Store:
    """使用有大小上限的 deque 保存最近 1000 筆接收事件。"""

    def __init__(self):
        self.events = deque(maxlen=1000)
        self.sequence = 0
        self.lock = Lock()

    def add(self, protocol: str, body: bytes, **details):
        """記錄原始資料長度及文字／十六進位預覽，避免整包內容佔滿畫面。"""
        with self.lock:
            self.sequence += 1
            self.events.append({
                "id": self.sequence,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "protocol": protocol,
                "bytes": len(body),
                "text_preview": body[:300].decode("utf-8", errors="replace"),
                "hex_preview": body[:120].hex(" "),
                **details,
            })

    def list(self, limit: int):
        """以最新在前的順序提供網頁與 API 查詢。"""
        with self.lock:
            return list(reversed(list(self.events)[-limit:]))


store = Store()


class RawCoapResource(resource.Resource):
    """CoAP /iot 與實驗性 /dp 共用的原始 Payload 接收器。"""

    def __init__(self, protocol: str):
        super().__init__()
        self.protocol = protocol

    async def render_post(self, request: Message):
        """收下 POST body，依資源建立時指定的協議名稱存入事件。"""
        store.add(self.protocol, request.payload, content_format=request.opt.content_format)
        return Message(code=CHANGED, payload=b'{"ok":true}')


async def websocket_handler(connection):
    """逐個接收文字或 Binary frame，記錄後回覆簡單確認訊息。"""
    async for message in connection:
        body = message if isinstance(message, bytes) else message.encode("utf-8")
        store.add("websocket", body, frame="binary" if isinstance(message, bytes) else "text")
        await connection.send('{"ok":true}')


async def modbus_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """解析 Modbus TCP 標頭與功能碼 16 的多暫存器寫入請求。"""
    try:
        while True:
            header = await reader.readexactly(7)
            transaction, protocol_id, length, unit_id = struct.unpack(">HHHB", header)
            pdu = await reader.readexactly(length - 1)
            if protocol_id != 0 or not pdu:
                break
            function = pdu[0]
            if function == 16 and len(pdu) >= 6:
                # Write Multiple Registers：拆出起始位址、數量與暫存器內容。
                address, count, byte_count = struct.unpack(">HHB", pdu[1:6])
                values = pdu[6:6 + byte_count]
                store.add("modbus", values, unit_id=unit_id, address=address, registers=count)
                response_pdu = struct.pack(">BHH", 16, address, count)
                writer.write(struct.pack(">HHHB", transaction, 0, len(response_pdu) + 1, unit_id) + response_pdu)
            else:
                # 不支援的功能碼回傳 Modbus exception response。
                error = bytes([function | 0x80, 1])
                writer.write(struct.pack(">HHHB", transaction, 0, len(error) + 1, unit_id) + error)
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        writer.close()
        await writer.wait_closed()


def mqtt_client():
    """建立背景 MQTT 訂閱者，接收 Broker 轉發的所有 Topic。"""
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="device-simulator-receiver")

    def on_connect(connected, userdata, flags, reason_code, properties):
        # 連線成功後訂閱所有 Topic，讓實驗接收端看得到不同測試主題。
        if not reason_code.is_failure:
            connected.subscribe("#", qos=1)

    def on_message(connected, userdata, message):
        # 此接收端保留原始 bytes；無須假設每個 MQTT Payload 都是 JSON。
        store.add("mqtt", message.payload, topic=message.topic)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(os.getenv("MQTT_HOST", "broker"), 1883)
    client.loop_start()
    return client


async def start_amqp():
    """連上 RabbitMQ 並消費 iot.sensor queue 的訊息。"""
    connection = await aio_pika.connect_robust(os.getenv("AMQP_URL", "amqp://lab:lab-pass@rabbitmq:5672/"))
    channel = await connection.channel()
    queue = await channel.declare_queue("iot.sensor", durable=True)

    async def consume(message: aio_pika.IncomingMessage):
        # message.process 會在處理完成後向 Broker 確認此訊息。
        async with message.process():
            store.add("amqp", message.body, routing_key=message.routing_key, content_type=message.content_type)

    await queue.consume(consume)
    return connection


@asynccontextmanager
async def lifespan(application: FastAPI):
    """啟動七協議所需的接收服務，關閉時依序釋放連線。"""
    mqtt_connection = mqtt_client()
    amqp_connection = await start_amqp()
    site = resource.Site()
    # CoAP 和實驗性 LwM2M 共用 5683/UDP，但由 URL 路徑區分。
    site.add_resource(["iot"], RawCoapResource("coap"))
    site.add_resource(["dp"], RawCoapResource("lwm2m"))
    coap_server = await Context.create_server_context(site, bind=("0.0.0.0", 5683))
    websocket_server = await websockets.serve(websocket_handler, "0.0.0.0", 8765)
    modbus_server = await asyncio.start_server(modbus_handler, "0.0.0.0", 5020)
    yield
    modbus_server.close()
    await modbus_server.wait_closed()
    websocket_server.close()
    await websocket_server.wait_closed()
    await coap_server.shutdown()
    await amqp_connection.close()
    mqtt_connection.disconnect()
    mqtt_connection.loop_stop()


app = FastAPI(title="IoT Device Simulator Lab Receiver", lifespan=lifespan)


@app.get("/health")
async def health():
    """供 Compose 檢查接收端的 HTTP 服務是否可連線。"""
    return {"status": "ok"}


@app.get("/events")
async def events(limit: int = Query(default=100, ge=1, le=1000)):
    """供瀏覽器查看最近收到的實驗封包。"""
    return store.list(limit)


@app.api_route("/iot", methods=["POST", "PUT", "PATCH"])
async def http_ingest(request: Request):
    """收下 HTTP body 並記錄格式標頭及位元組長度。"""
    body = await request.body()
    store.add("http", body, content_type=request.headers.get("content-type"))
    return {"ok": True, "bytes": len(body)}
