"""以 Scapy 被動監看 Sender 容器的網路介面，供封包檢視與 PCAP 下載。"""

import threading
import time
from collections import deque
from pathlib import Path
from tempfile import TemporaryDirectory

from scapy.all import AsyncSniffer, Ether, IP, IPv6, TCP, UDP, get_if_addr, raw, wrpcap


class PacketCapture:
    """保留有限數量的 TCP/UDP 封包摘要與原始位元組。"""

    def __init__(self, interface: str = "eth0", limit: int = 1000):
        self.interface = interface
        self.local_ip = None
        self._packets = deque(maxlen=limit)
        self._raw_packets = deque(maxlen=limit)
        # Scapy 的擷取回呼在背景執行緒執行；讀寫 deque 時需使用同一把鎖。
        self._lock = threading.Lock()
        self._sequence = 0
        self._sniffer = None

    def start(self):
        """開始監看容器 eth0；擷取失敗不阻止 Sender 的發送功能。"""
        try:
            self.local_ip = get_if_addr(self.interface)
            self._sniffer = AsyncSniffer(iface=self.interface, store=False, prn=self._record)
            self._sniffer.start()
        except Exception:
            self._sniffer = None

    def stop(self):
        """在服務關閉時停止背景監聽器。"""
        if self._sniffer:
            try:
                self._sniffer.stop()
            except Exception:
                pass

    def _record(self, packet):
        """只整理 TCP/UDP 封包，並截取足以供畫面閱讀的預覽內容。"""
        if not (packet.haslayer(TCP) or packet.haslayer(UDP)):
            return
        network = packet.getlayer(IP) or packet.getlayer(IPv6)
        transport = packet.getlayer(TCP) or packet.getlayer(UDP)
        if not network or not transport:
            return
        # 排除瀏覽器輪詢 8080 的流量，避免封包檢視器把自己的查詢也顯示出來。
        if packet.haslayer(TCP) and (transport.sport == 8080 or transport.dport == 8080):
            return
        packet_bytes = raw(packet)
        payload = raw(transport.payload) if transport.payload else b""
        with self._lock:
            # 原始 bytes 用於 PCAP；摘要用於網頁，兩者都只保留最近 limit 筆。
            self._sequence += 1
            record = {
                "id": self._sequence,
                "timestamp": time.time(),
                "direction": "OUT" if network.src == self.local_ip else "IN",
                "transport": "TCP" if packet.haslayer(TCP) else "UDP",
                "source": f"{network.src}:{transport.sport}",
                "destination": f"{network.dst}:{transport.dport}",
                "length": len(packet_bytes),
                "payload_length": len(payload),
                "packet_hex": packet_bytes[:512].hex(" "),
                "hex_preview": payload[:256].hex(" "),
                "ascii_preview": "".join(chr(b) if 32 <= b < 127 else "." for b in payload[:256]),
                "transmission_id": None,
                "application_protocol": None,
                "device_id": None,
            }
            self._packets.append(record)
            self._raw_packets.append((self._sequence, packet_bytes))

    def marker(self) -> int:
        """回傳目前最後序號，讓 Simulator 標記接下來擷取到的封包。"""
        with self._lock:
            return self._sequence

    def tag_since(self, marker: int, transmission_id: str, protocol: str, device_id: str) -> int:
        """把 marker 之後尚未歸屬的封包標上這次傳輸 ID。

        這是依擷取時間關聯封包，不代表解析並驗證了接收端內容。
        """
        tagged = 0
        with self._lock:
            for record in self._packets:
                if record["id"] > marker and record["transmission_id"] is None:
                    record["transmission_id"] = transmission_id
                    record["application_protocol"] = protocol
                    record["device_id"] = device_id
                    tagged += 1
        return tagged

    def list(self, limit: int = 200):
        """以新到舊順序回傳摘要，符合畫面顯示順序。"""
        with self._lock:
            return list(reversed(list(self._packets)[-limit:]))

    def clear(self):
        """清掉目前記憶體內的封包與 PCAP 來源資料。"""
        with self._lock:
            self._packets.clear()
            self._raw_packets.clear()

    def pcap(self) -> bytes:
        """將保存的乙太網路封包暫時寫成 PCAP，再讀回下載用 bytes。"""
        with self._lock:
            packets = [Ether(data) for _, data in self._raw_packets]
        with TemporaryDirectory(prefix="iot-simulator-pcap-") as directory:
            path = Path(directory) / "capture.pcap"
            wrpcap(str(path), packets)
            return path.read_bytes()
