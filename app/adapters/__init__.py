"""協議登記表：發送引擎依 config.protocol 找到對應模組的 send 函式。"""

from . import amqp, coap, http, lwm2m, modbus, mqtt, websocket

# 每個模組都實作 send(target, body, content_type, device_id)。
# 引擎只需依名稱選擇，不必知道各協議的連線與封裝細節。
ADAPTERS = {
    "mqtt": mqtt,
    "http": http,
    "coap": coap,
    "amqp": amqp,
    "websocket": websocket,
    "modbus": modbus,
    "lwm2m": lwm2m,
}
