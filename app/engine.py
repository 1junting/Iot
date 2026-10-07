"""協調預覽、一次發送、連續發送、統計與封包標記的核心引擎。"""

import asyncio
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from .adapters import ADAPTERS
from .capture import PacketCapture
from .models import DeviceConfig
from .payloads import BuiltPayload, build_payload


class Simulator:
    """與協議無關的發送控制器；協議細節交給 app.adapters。"""

    def __init__(self, capture: PacketCapture):
        self.capture = capture
        # tasks/runs 只存在記憶體；重啟 Sender 容器後不會自動恢復 Run。
        self.tasks: dict[str, asyncio.Task] = {}
        self.runs: dict[str, dict] = {}
        self.stats = {"sent": 0, "failed": 0}
        self.protocol_stats = defaultdict(lambda: {"sent": 0, "failed": 0})
        self.events: list[dict] = []
        # preview_id 對應已產生的 bytes，讓「預覽」和「送出」使用同一份資料。
        self.previews: dict[str, tuple[float, BuiltPayload]] = {}
        self.started_at = time.time()
        self._event_id = 0
        # 擷取器以時間區間標記封包；序列化發送可避免兩次操作互相混淆。
        self._send_lock = asyncio.Lock()
        self._sequence = 0

    def _log(self, event: dict):
        """替事件編號並保留最近 500 筆，供 Dashboard 顯示。"""
        self._event_id += 1
        self.events.append({
            "id": self._event_id,
            "timestamp": time.time(),
            "time": datetime.now(timezone.utc).isoformat(),
            **event,
        })
        self.events = self.events[-500:]

    def preview(self, config: DeviceConfig):
        """建立 Payload 預覽，並用隨機 ID 暫存十分鐘。"""
        self._sequence += 1
        payload = build_payload(config, self._sequence)
        preview_id = str(uuid.uuid4())
        self.previews[preview_id] = (time.time(), payload)
        self.previews = {key: value for key, value in self.previews.items() if time.time() - value[0] < 600}
        return {
            "preview_id": preview_id,
            "preview": payload.preview,
            "byte_length": len(payload.body),
            "content_type": payload.content_type,
            "payload_format": payload.format,
            "values": payload.values,
        }

    def _prepared(self, config: DeviceConfig, preview_id: str | None) -> BuiltPayload:
        """優先取出預覽過的位元組；ID 無效或過期才重新產生。"""
        if preview_id:
            item = self.previews.pop(preview_id, None)
            if item and time.time() - item[0] < 600:
                return item[1]
        self._sequence += 1
        return build_payload(config, self._sequence)

    async def send_once(self, config: DeviceConfig, preview_id: str | None = None, run_id: str | None = None):
        """完整的一次發送：準備資料、呼叫 Adapter、標記封包並記錄結果。"""
        if config.count is not None:
            # 每個 Logical Device 都呼叫真實 Adapter；群組共用主機和目標設定。
            events = []
            for index in range(1, config.count + 1):
                identity = f"{config.name}-{index:03d}"
                child = config.model_copy(deep=True, update={"name": identity, "count": None})
                if child.payload_mode == "raw_json" and not child.template_mode:
                    child.raw_json["device_id"] = identity
                events.append(await self.send_once(child, run_id=run_id))
            failed = sum(not event["ok"] for event in events)
            return {"ok": failed == 0, "protocol": config.protocol, "device": config.name,
                    "count": config.count, "sent": len(events) - failed, "failed": failed,
                    "events": events, "error": f"{failed} 個裝置發送失敗" if failed else None,
                    "payload_bytes": sum(event["payload_bytes"] for event in events),
                    "packet_count": sum(event["packet_count"] for event in events)}
        payload = self._prepared(config, preview_id)
        transmission_id = str(uuid.uuid4())[:12]
        async with self._send_lock:
            # 先記住擷取序號，只標記這次發送開始後看到的封包。
            marker = self.capture.marker()
            try:
                # 各 Adapter 共用 target/body/content_type/device_id 呼叫形式。
                result = await ADAPTERS[config.protocol].send(
                    config.target, payload.body, payload.content_type, config.name
                )
                ok, error = True, None
            except Exception as exc:
                # Adapter 的連線或協議錯誤轉成失敗事件，避免整個 API 中斷。
                result, ok, error = None, False, str(exc)
            # 給非同步封包監聽器一小段時間收錄此傳輸的尾端封包。
            await asyncio.sleep(0.2)
            packet_count = self.capture.tag_since(
                marker, transmission_id, config.protocol, config.name
            )

        counter = "sent" if ok else "failed"
        # sent 表示 Adapter 未拋錯；接收程式是否保存需另查接收端紀錄。
        self.stats[counter] += 1
        self.protocol_stats[config.protocol][counter] += 1
        event = {
            "type": "message",
            "ok": ok,
            "protocol": config.protocol,
            "device": config.name,
            "run_id": run_id,
            "transmission_id": transmission_id,
            "packet_count": packet_count,
            "payload_preview": payload.preview,
            "payload_bytes": len(payload.body),
            "payload_format": payload.format,
            "content_type": payload.content_type,
            "result": result,
            "error": error,
        }
        self._log(event)
        return event

    async def _loop(self, run_id: str, config: DeviceConfig):
        """連續發送共用 send_once，並扣除發送耗時維持設定間隔。"""
        try:
            while True:
                cycle_started = time.monotonic()
                await self.send_once(config, run_id=run_id)
                elapsed = time.monotonic() - cycle_started
                await asyncio.sleep(max(config.interval_ms / 1000 - elapsed, 0))
        except asyncio.CancelledError:
            pass

    def start(self, run_id: str, config: DeviceConfig):
        """為指定 Run 建立 asyncio 背景工作並記下顯示資訊。"""
        if run_id in self.tasks:
            raise ValueError("run_id already exists")
        self.tasks[run_id] = asyncio.create_task(self._loop(run_id, config))
        self.runs[run_id] = {
            "run_id": run_id,
            "name": config.name,
            "count": config.count or 1,
            "protocol": config.protocol,
            "interval_ms": config.interval_ms,
            "payload_format": config.payload_format if config.payload_mode == "graphical" else "json",
            "started_at": time.time(),
        }
        self._log({"type": "run.started", "ok": True, **self.runs[run_id]})

    def stop(self, run_id: str) -> bool:
        """取消背景工作；取消訊號會在下一個 await 點生效。"""
        task = self.tasks.pop(run_id, None)
        run = self.runs.pop(run_id, None)
        if not task:
            return False
        task.cancel()
        self._log({"type": "run.stopped", "ok": True, "run_id": run_id, "protocol": run["protocol"], "device": run["name"]})
        return True

    def status(self):
        """整合 Dashboard 所需的計數、近期事件、Run 與擷取器狀態。"""
        total = self.stats["sent"] + self.stats["failed"]
        uptime = max(time.time() - self.started_at, 0.001)
        return {
            **self.stats,
            "runs": list(self.runs.values()),
            "events": list(reversed(self.events[-100:])),
            "protocols": dict(self.protocol_stats),
            "messages_per_second": round(total / uptime, 3),
            "success_rate": round(self.stats["sent"] / total * 100, 1) if total else 100.0,
            "capture": {"active": self.capture._sniffer is not None, "interface": self.capture.interface},
        }
