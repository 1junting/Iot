"""以 CoAP POST 將 Payload 送到設定 URI。"""

import asyncio

from aiocoap import Context, Message, POST


# CoAP Content-Format 使用數值代碼；0 對應預設文字格式。
CONTENT_FORMATS = {"application/json": 50, "application/octet-stream": 42}


async def send(target, body: bytes, content_type: str, device_id: str):
    """建立短暫 CoAP client，等待回應並檢查回應碼。"""
    uri = target.get("uri", "coap://receiver:5683/iot")
    context = await Context.create_client_context()
    try:
        content_format = CONTENT_FORMATS.get(content_type.split(";", 1)[0], 0)
        # body 是 Payload Builder 的原始 bytes，CoAP 套件負責封裝 UDP 訊息。
        request = Message(code=POST, uri=uri, payload=body, content_format=content_format)
        response = await asyncio.wait_for(context.request(request).response, timeout=8)
        if not response.code.is_successful():
            raise RuntimeError(f"CoAP receiver returned {response.code}")
        return {"uri": uri, "code": str(response.code), "content_format": content_format}
    finally:
        # 成功與失敗都釋放 client 的 UDP 資源。
        await context.shutdown()
