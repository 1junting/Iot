"""驗證群組真的逐台呼叫傳輸 Adapter，並保留既有單裝置與停止行為。"""
import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.engine import Simulator
from app.models import DeviceConfig


class Capture:
    _sniffer = None
    interface = "test"

    def marker(self):
        return 0

    def tag_since(self, *args):
        return 0


class LogicalDeviceTests(unittest.IsolatedAsyncioTestCase):
    async def test_ten_real_adapter_calls_and_fresh_cycle(self):
        sent = []
        async def send(target, body, content_type, identity):
            sent.append((identity, json.loads(body)))
            if identity.endswith("005"):
                raise RuntimeError("one device failed")
            return {"sent": True}
        simulator = Simulator(Capture())
        config = DeviceConfig(name="TEMP-LAB", count=10, template_mode=True, payload_mode="raw_json",
            raw_json={"device_id": "{{device_id}}", "timestamp": "{{timestamp}}", "temperature": "{{random:20:30}}"})
        with patch.dict("app.engine.ADAPTERS", {"mqtt": SimpleNamespace(send=send)}):
            result = await simulator.send_once(config)
            self.assertEqual(len(sent), 10)
            self.assertEqual([identity for identity, _ in sent], [f"TEMP-LAB-{i:03d}" for i in range(1, 11)])
            self.assertTrue(all(identity == body["device_id"] and isinstance(body["temperature"], float) for identity, body in sent))
            self.assertEqual((result["sent"], result["failed"]), (9, 1))
            self.assertEqual(simulator.stats, {"sent": 9, "failed": 1})
            simulator.start("group", config)
            self.assertEqual(simulator.runs["group"]["count"], 10)
            task = simulator.tasks["group"]
            while len(sent) < 20:
                await asyncio.sleep(0.02)
            self.assertNotEqual(sent[0][1]["timestamp"], sent[10][1]["timestamp"])
            self.assertTrue(simulator.stop("group"))
            await task
            self.assertFalse(simulator.tasks)

    async def test_legacy_raw_single_and_explicit_count_one(self):
        sent = []
        async def send(target, body, content_type, identity):
            sent.append(json.loads(body))
        simulator = Simulator(Capture())
        raw = {"device_id": "custom-id", "timestamp": "2026-10-07T00:00:00Z", "value": 1}
        with patch.dict("app.engine.ADAPTERS", {"mqtt": SimpleNamespace(send=send)}):
            single = await simulator.send_once(DeviceConfig(name="legacy", payload_mode="raw_json", raw_json=raw))
            self.assertEqual(sent[0], raw)
            self.assertTrue(single["ok"])
            self.assertIn("transmission_id", single)
            await simulator.send_once(DeviceConfig(name="group", count=1, payload_mode="raw_json", raw_json=raw))
            self.assertEqual(sent[1]["device_id"], "group-001")
            self.assertEqual(raw["device_id"], "custom-id")


if __name__ == "__main__":
    unittest.main()
