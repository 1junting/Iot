"""以 CoAP POST 模擬 LwM2M 路徑的資料發送；屬實驗實作。"""

import asyncio
from urllib.parse import quote

from aiocoap import Context, Message, POST


CONTENT_FORMATS = {"application/json": 50, "application/octet-stream": 42}


async def send(target, body: bytes, content_type: str, device_id: str):
    """把裝置 ID 放在 ep 查詢參數，將 Payload 送往設定的 /dp 路徑。

    這裡只模擬資料 POST，沒有完整 LwM2M 註冊、觀察或資源模型。
    """
    server = target.get("server", "coap://receiver:5683")
    path = target.get("path", "/dp")
    content_format = CONTENT_FORMATS.get(content_type.split(";", 1)[0], 0)
    uri = f"{server.rstrip('/')}/{path.lstrip('/')}?ep={quote(device_id)}"
    context = await Context.create_client_context()
    try:
        request = Message(code=POST, uri=uri, payload=body, content_format=content_format)
        # 限制等待時間，避免沒有回覆的 UDP 目標讓操作一直停住。
        response = await asyncio.wait_for(context.request(request).response, timeout=8)
        if not response.code.is_successful():
            raise RuntimeError(f"LwM2M receiver returned {response.code}")
        return {"uri": uri, "code": str(response.code), "operation": "experimental-data-post", "content_format": content_format}
    finally:
        await context.shutdown()
