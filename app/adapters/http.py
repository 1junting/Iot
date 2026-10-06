"""將 Payload bytes 放進 HTTP request body，送往設定的 URL。"""

import httpx


async def send(target, body: bytes, content_type: str, device_id: str):
    """依設定方法送出請求；非 2xx 回應由 raise_for_status 轉為失敗。"""
    url = target.get("url", "http://receiver:8091/iot")
    method = target.get("method", "POST").upper()
    async with httpx.AsyncClient(timeout=float(target.get("timeout", 8))) as client:
        # 與 MQTT 不同，HTTP 會透過 Content-Type 標頭告訴接收方內容格式。
        response = await client.request(method, url, content=body, headers={"Content-Type": content_type, "X-Device-ID": device_id})
        response.raise_for_status()
    return {"url": url, "status": response.status_code, "content_type": content_type}
