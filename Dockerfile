# Sender 與 lab-receiver 共用這個 Python 映像；執行指令可由 Compose 覆蓋。
FROM python:3.12-slim

# 不產生 pyc 檔，並讓容器日誌即時輸出。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 先複製依賴清單以利用 Docker build cache；程式碼變動不必重裝套件。
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 預設啟動 Sender API；lab-receiver 服務在 Compose 中改用另一個指令。
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
