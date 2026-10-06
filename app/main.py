"""FastAPI 入口：把瀏覽器請求轉交給模擬器，並提供封包查詢。"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .capture import PacketCapture
from .engine import Simulator
from .models import DeviceConfig, PreviewRequest, SendRequest


STATIC = Path(__file__).parent / "static"
# 同一個 capture 物件同時供發送引擎標記封包、API 提供封包列表。
capture = PacketCapture()
simulator = Simulator(capture)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """服務啟動時開始擷取，結束時停止所有背景 Run 與封包監聽。"""
    capture.start()
    yield
    for run_id in list(simulator.tasks):
        simulator.stop(run_id)
    capture.stop()


app = FastAPI(title="IoT Device Simulator + Packet Viewer", version="1.0.0", lifespan=lifespan)
# 前端 HTML 由首頁回傳；JS 與 CSS 等檔案由 /static 提供。
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
async def index():
    """傳回模擬器首頁，瀏覽器再載入其 JavaScript 與樣式。"""
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
async def health():
    """供 Docker 健康檢查使用，並附上封包擷取是否啟動。"""
    return {"status": "ok", "service": "iot-device-simulator", "capture": simulator.status()["capture"]}


@app.get("/api/status")
async def status():
    """回傳發送統計、正在執行的 Run 和最近事件，供 Dashboard 輪詢。"""
    return simulator.status()


@app.post("/api/preview")
async def preview(request: PreviewRequest):
    """先產生並暫存 Payload，供畫面預覽與後續單次發送重用。"""
    return simulator.preview(request.config)


@app.post("/api/send-once")
async def send_once(request: SendRequest):
    """依協議發送一次；結果由 Simulator 統一記錄並回傳。"""
    return await simulator.send_once(request.config, request.preview_id)


@app.post("/api/runs/{run_id}")
async def start_run(run_id: str, config: DeviceConfig):
    """建立定時發送工作；同名 run_id 回傳 409，避免覆蓋現有工作。"""
    try:
        simulator.start(run_id, config)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True, "run_id": run_id}


@app.delete("/api/runs/{run_id}")
async def stop_run(run_id: str):
    """取消指定的背景發送工作；不存在時回傳 ok=false。"""
    return {"ok": simulator.stop(run_id), "run_id": run_id}


@app.get("/api/packets")
async def packets(limit: int = Query(default=200, ge=1, le=1000)):
    """讀取最近封包的摘要；最多 1000 筆以限制畫面與記憶體負擔。"""
    return {"packets": capture.list(limit), "capture": simulator.status()["capture"]}


@app.delete("/api/packets")
async def clear_packets():
    """清空記憶體中的封包與 PCAP 來源，不影響已發送的資料。"""
    capture.clear()
    return {"ok": True}


@app.get("/api/packets.pcap")
async def download_pcap():
    """把目前保留的原始封包匯出成 Wireshark 可讀的 PCAP。"""
    return Response(
        capture.pcap(),
        media_type="application/vnd.tcpdump.pcap",
        headers={"Content-Disposition": 'attachment; filename="iot-device-simulator.pcap"'},
    )
