"""透過 AMQP Exchange 與 Routing Key 發布感測資料。"""

from urllib.parse import urlsplit

import aio_pika


async def send(target, body: bytes, content_type: str, device_id: str):
    """建立連線、選 Exchange、發布訊息並等待 Broker 確認。"""
    url = target.get("url", "amqp://lab:lab-pass@rabbitmq:5672/")
    routing_key = target.get("routing_key", "iot.sensor")
    connection = await aio_pika.connect_robust(url, timeout=8)
    try:
        # publisher_confirms 讓發布結果由 Broker 確認；mandatory 避免無路由時默默丟棄。
        channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
        exchange_name = target.get("exchange", "")
        exchange = await channel.declare_exchange(exchange_name, durable=True) if exchange_name else channel.default_exchange
        await exchange.publish(
            # AMQP 訊息帶上內容格式及裝置 ID，供接收程式辨識。
            aio_pika.Message(body=body, content_type=content_type, correlation_id=device_id),
            routing_key=routing_key,
            mandatory=True,
        )
    finally:
        # 每次發送結束關閉此連線，避免長期佔用 Broker 連線資源。
        await connection.close()
    return {"host": urlsplit(url).hostname, "routing_key": routing_key, "content_type": content_type}
