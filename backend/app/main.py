from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import HTMLResponse  # 稍後可能用於簡單的測試頁面
from fastapi.middleware.cors import CORSMiddleware
import logging
import uvicorn  # 用於直接運行 (如果需要)
import os
import hmac
import hashlib
import json
import time
from datetime import datetime, timedelta

# 假設 ConnectionManager 在 connection_manager.py 中定義
from .connection_manager import ConnectionManager

# 配置日誌記錄
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ezTransfer Signaling Server")

# 從環境變數中讀取 origins，並以逗號分隔
origins = os.getenv("CORS_ALLOW_ORIGINS", "")
allow_origins = [origin.strip() for origin in origins.split(",") if origin.strip()]
print("🚀 CORS origins 設定為：", allow_origins, flush=True)

# 新增 CORS 中介軟體設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

manager = ConnectionManager()


# 根路徑，可以返回一個簡單的 HTML 頁面或狀態信息
@app.get("/")
async def get_root():
    # 簡單的 HTML 響應，表明伺服器正在運行
    html_content = """
    <!DOCTYPE html>
    <html>
        <head>
            <title>ezTransfer Signaling Server</title>
        </head>
        <body>
            <h1>ezTransfer Signaling Server is running!</h1>
            <p>Connect via WebSocket at /ws</p>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)


# API 端點：產生 WebSocket 連線用的 token
@app.get("/api/get-ws-token")
async def get_ws_token():
    secret_key = os.environ.get("SECRET_KEY", "default-secret-key-for-dev")
    iat = int(time.time())
    exp = int((datetime.fromtimestamp(iat) + timedelta(minutes=10)).timestamp())
    payload = {"iat": iat, "exp": exp}
    payload_str = json.dumps(payload, separators=(",", ":"))
    signature = hmac.new(
        secret_key.encode(), payload_str.encode(), hashlib.sha256
    ).hexdigest()
    token = f"{payload_str}.{signature}"
    return {"token": token}


# WebSocket 端點
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    query_params = websocket.query_params
    token = query_params.get("token")
    secret_key = os.environ.get("SECRET_KEY", "default-secret-key-for-dev")

    if not token:
        logger.warning(
            f"Unauthorized connection attempt (no token) from {websocket.client.host if websocket.client else 'unknown'}"
        )
        await websocket.close(code=1008, reason="Unauthorized: No token provided")
        return

    try:
        payload_str, signature = token.rsplit(".", 1)
        expected_signature = hmac.new(
            secret_key.encode(), payload_str.encode(), hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_signature):
            logger.warning(
                f"Unauthorized connection attempt (invalid signature) from {websocket.client.host if websocket.client else 'unknown'}"
            )
            await websocket.close(code=1008, reason="Unauthorized: Invalid signature")
            return

        payload = json.loads(payload_str)
        current_time = int(time.time())
        if not (payload.get("iat", 0) <= current_time <= payload.get("exp", 0)):
            logger.warning(
                f"Unauthorized connection attempt (token expired) from {websocket.client.host if websocket.client else 'unknown'}"
            )
            await websocket.close(code=1008, reason="Unauthorized: Token expired")
            return
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        await websocket.close(code=1008, reason="Unauthorized: Invalid token format")
        return

    # 接受新的 WebSocket 連接
    await manager.connect(websocket)
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client {client_ip} connected.")

    try:
        # 持續監聽來自客戶端的訊息
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received message from {client_ip}: {data}")
            # 將收到的訊息交給 ConnectionManager 處理
            await manager.handle_message(websocket, data)
    except WebSocketDisconnect:
        # 客戶端斷開連接時，從管理器中移除
        logger.info(f"Client {client_ip} disconnected.")
        await manager.disconnect(websocket)
    except Exception as e:
        # 處理其他可能的異常
        logger.error(f"Error handling websocket for {client_ip}: {e}", exc_info=True)
        # 確保在異常情況下也嘗試斷開連接
        await manager.disconnect(websocket)


# 如果直接運行此文件 (例如 python app/main.py)，則啟動 Uvicorn 伺服器
# 在 Docker 環境中，通常由 Dockerfile 中的 CMD 或 docker-compose.yml 啟動
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
