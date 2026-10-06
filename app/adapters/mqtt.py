"""把已產生的 Payload bytes 發布到指定 MQTT Broker 與 Topic。"""

import asyncio

import paho.mqtt.publish as publish


async def send(target, body: bytes, content_type: str, device_id: str):
    """執行一次 MQTT publish；body 原樣成為 MQTT 訊息的 Payload。

    此實作沒有傳遞 content_type；接收方須事先知道 Payload 格式。
    """
    host = target.get("host", "broker")
    port = int(target.get("port", 1883))
    topic = target.get("topic", "iot/simulator/data")
    qos = int(target.get("qos", 1))
    auth = None
    if target.get("username"):
        auth = {"username": target["username"], "password": target.get("password")}
    # publish.single 是同步函式；放到執行緒避免堵住 FastAPI 事件迴圈。
    await asyncio.to_thread(
        publish.single,
        topic,
        payload=body,
        hostname=host,
        port=port,
        qos=qos,
        retain=bool(target.get("retain", False)),
        auth=auth,
    )
    return {"host": host, "port": port, "topic": topic, "qos": qos}
