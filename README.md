# IoT All-in-One Sender — Device Simulator + Packet Viewer

`iot-all-in-one-sender` 已升級為圖形化 IoT Device Simulator，並在同一個 Sender 容器內提供真實封包擷取與 Packet Viewer。

介面沿用原本 NEXUS 側欄、系統總覽、裝置卡片、模擬執行與 Payload 範本版型；新增功能放在「資料模擬器」和「封包檢視器」。

## 功能

- Device Template：Environment Sensor、Air Quality Sensor、Smart Power Meter、Custom Device
- Sensor Field：Temperature、Humidity、CO2、PM2.5、Light、Pressure、Battery、Voltage、Current、Power，以及 Custom Field
- 每個欄位包含名稱、數值、單位、Float／Integer／String／Boolean、Fixed／Random／Range
- 原始 JSON 自訂模式
- Application Payload：JSON、Plain Text、Binary
- Payload Preview；Send Once 會送出畫面上同一份預覽資料
- Send Once 與每 1／5／10 秒 Auto Send
- 七種真實後端 adapter：MQTT、HTTP、CoAP、AMQP、WebSocket、Modbus TCP、LwM2M
- Packet Viewer 從 Simulator 容器 `eth0` 擷取真實 TCP／UDP 封包，並可下載 PCAP

## 啟動

```bash
cd /Users/Desktop/專題/發送端/iot-all-in-one-sender
docker compose up --build -d
docker compose ps
```

開啟：<http://localhost:8080>

這個 Compose 會啟動 Sender、MQTT Broker、RabbitMQ 與七協議測試 Receiver。第一次建置需要下載 Docker image 與 Python dependencies。

停止：

```bash
docker compose down
```

## 使用方式

1. 從左側進入「資料模擬器」，選擇 Device Template。
2. 選擇 MQTT、HTTP、CoAP、AMQP、WebSocket、Modbus TCP 或 LwM2M。
3. 在 Sensor Fields 增刪欄位並設定數值、單位、型態和 Fixed／Random／Range。
4. 選擇 JSON、Plain Text 或 Binary，先檢查 Payload Preview。
5. 按 `Send Once`，或選擇 Interval 後啟動 `Auto Send`。
6. 從左側進入「封包檢視器」，查看這次 Transmission 的真實封包、Raw Packet Hex 與 Transport Payload；需要 Wireshark 時按「下載 PCAP」。

## 預設實驗目標

| 協議 | Compose 內部目標 | Mac Host 對照 Port |
| --- | --- | --- |
| MQTT | `broker:1883` | `127.0.0.1:1884` |
| HTTP | `http://receiver:8091/iot` | `http://127.0.0.1:8091/iot` |
| CoAP | `coap://receiver:5683/iot` | UDP `5683` |
| AMQP | `amqp://lab:lab-pass@rabbitmq:5672/` | `127.0.0.1:5673` |
| WebSocket | `ws://receiver:8765` | `ws://127.0.0.1:8765` |
| Modbus TCP | `receiver:5020` | `127.0.0.1:5020` |
| LwM2M | `coap://receiver:5683/dp` | UDP `5683` |

測試 Receiver 的接收紀錄：<http://localhost:8091/events>

## Payload Format

裝置管理的 `count` 代表 Logical Devices。群組 `TEMP-LAB`、count=10 會逐台
發送 `TEMP-LAB-001` 至 `TEMP-LAB-010`，共用設定的目標與 Host，不需 10 個 IP。
「發送一次」送每台一筆；連續 Run 每輪送完所有身分再進入下一輪，停止 Run
會停止整組。範本中的 `{{device_id}}`、`{{timestamp}}` 與隨機值在後端每次傳輸時
展開，避免重複發送首次產生的固定 Payload。

API 的 `DeviceConfig` 新增選填 `count` 與 `template_mode`。未提供 count 時保留
原本單裝置 API／原始 JSON 行為；明確提供 count 時，name 作為群組前綴。
群組的單次結果含 `sent`、`failed` 及逐台 `events`，統計與 Packet Viewer 也逐台記錄。
Simulator 不提供裝置探索清單，HDPCM 應由真正的協議流量建立裝置身分。

JSON 使用帶有 `device_id`、`timestamp` 與 `sensors` 的結構。Plain Text 使用分號分隔的 `key=value unit`。Binary 是供封包大小與結構比較的固定實驗格式：

```text
IOT1 | device-id length + UTF-8 | timestamp-ms | field count |
field name | type id | unit | typed binary value | ...
```

它不是 CBOR、Protobuf 或特定產業標準，也沒有自動 Decoder。目的就是讓相同 Sensor Data 可以產生 JSON、Plain Text、Binary 三種真實 wire payload，供 PCAP 比較。

Modbus TCP 沒有一般 message body，因此實驗 adapter 會在 Payload 前加上 2-byte 長度，再依序裝入 Holding Registers。LwM2M 第一版是送往 `/dp` 的實驗性 CoAP POST，尚未宣稱為完整的 LwM2M 1.1 Send／SenML 實作。

## Packet Viewer 邊界

Packet Viewer 記錄 Simulator 容器 `eth0` 上的 TCP／UDP packet；TCP handshake、ACK、DNS 與回應封包也可能顯示，這正是網路層實驗需要觀察的內容。畫面只保留最近 1000 筆，完整分析請下載 PCAP。未加密協議會直接暴露 Payload，請只使用實驗資料。
