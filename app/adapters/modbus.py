"""把任意 Payload bytes 依實驗格式裝入 Modbus Holding Registers。"""

from pymodbus.client import AsyncModbusTcpClient


async def send(target, body: bytes, content_type: str, device_id: str):
    """以 Write Multiple Registers 將位元組送到指定暫存器位址。

    Modbus 不提供一般訊息 body；本實驗以 2-byte 長度前綴和 16-bit 暫存器保存資料。
    接收端需知道這套額外封裝規則才能還原原始 Payload。
    """
    host = target.get("host", "receiver")
    port = int(target.get("port", 5020))
    address = int(target.get("address", 0))
    unit_id = int(target.get("device_id", 1))
    # 暫存器以兩個位元組為單位；奇數長度補一個零位元組對齊。
    framed = len(body).to_bytes(2, "big") + body
    if len(framed) % 2:
        framed += b"\x00"
    registers = [int.from_bytes(framed[index:index + 2], "big") for index in range(0, len(framed), 2)]
    # 一次寫入最多 123 個 Holding Registers，超過時先明確回報錯誤。
    if len(registers) > 123:
        raise ValueError("Payload too large for one Modbus Write Multiple Registers request (maximum 244 bytes)")
    client = AsyncModbusTcpClient(host, port=port, timeout=8)
    try:
        if not await client.connect():
            raise ConnectionError(f"Modbus connection failed: {host}:{port}")
        try:
            # 相容不同 pymodbus 版本使用的 device_id/slave 參數名稱。
            result = await client.write_registers(address=address, values=registers, device_id=unit_id)
        except TypeError:
            result = await client.write_registers(address=address, values=registers, slave=unit_id)
        if result.isError():
            raise RuntimeError(str(result))
    finally:
        # 發送完成或出錯都關閉 TCP 連線。
        client.close()
    return {"host": host, "port": port, "address": address, "registers": len(registers), "payload_bytes": len(body)}
