"""建立 WebSocket 連線，發送單一 frame 並等待接收端回覆。"""

import websockets


async def send(target, body: bytes, content_type: str, device_id: str):
    """Binary 使用二進位 frame；其他可解碼文字使用文字 frame。"""
    url = target.get("url", "ws://receiver:8765")
    async with websockets.connect(url, open_timeout=8) as connection:
        if content_type.startswith("application/octet-stream"):
            await connection.send(body)
        else:
            await connection.send(body.decode("utf-8"))
        # 等待應用層回覆，讓「已送出」不只代表 socket 寫入成功。
        acknowledgement = await connection.recv()
    return {"url": url, "frame": "binary" if content_type.startswith("application/octet-stream") else "text", "ack": str(acknowledgement)[:120]}
