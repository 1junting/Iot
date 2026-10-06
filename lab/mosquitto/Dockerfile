# 把本機實驗用設定放進映像，避免 macOS 上設定檔掛載權限問題。
FROM eclipse-mosquitto:2

# 讓 Mosquitto 使用者可讀取自己的設定檔。
COPY --chown=mosquitto:mosquitto mosquitto.conf /mosquitto/config/mosquitto.conf
