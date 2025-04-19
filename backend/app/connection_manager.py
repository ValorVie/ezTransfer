import asyncio
import json
import logging
import random
import string
from typing import Dict, List, Optional, Tuple

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # 儲存活躍的 WebSocket 連接，以 client_id (這裡用 websocket 物件本身作為 key) 為鍵
        self.active_connections: Dict[WebSocket, str] = {}
        # 儲存等待配對的接收者，以 6 位數代碼為鍵
        self.pending_receivers: Dict[str, WebSocket] = {}
        # 儲存已成功配對的連接，以一方的 WebSocket 為鍵，另一方的 WebSocket 為值
        self.paired_connections: Dict[WebSocket, WebSocket] = {}

    async def connect(self, websocket: WebSocket):
        """接受新的 WebSocket 連接"""
        await websocket.accept()
        # 暫時不分配代碼或配對，等待客戶端發送請求
        self.active_connections[websocket] = "connected"  # 標記為已連接但未分配角色

    async def disconnect(self, websocket: WebSocket):
        """處理 WebSocket 斷開連接"""
        # 從活躍連接中移除
        self.active_connections.pop(websocket, None)

        # 如果是等待中的接收者，從 pending_receivers 移除
        code_to_remove = None
        for code, ws in self.pending_receivers.items():
            if ws == websocket:
                code_to_remove = code
                break
        if code_to_remove:
            self.pending_receivers.pop(code_to_remove, None)
            logger.info(f"Pending receiver with code {code_to_remove} disconnected.")

        # 如果已配對，通知對方斷開連接並移除配對關係
        peer = self.paired_connections.pop(websocket, None)
        if peer:
            self.paired_connections.pop(peer, None)  # 移除雙向配對
            logger.info(
                f"Paired connection broken for {websocket.client.host if websocket.client else 'unknown'}"
            )
            try:
                await self.send_personal_message(peer, {"type": "peer_disconnected"})
            except Exception as e:
                logger.warning(f"Failed to notify peer about disconnection: {e}")

    def _generate_code(self) -> str:
        """生成一個唯一的 6 位數字代碼"""
        while True:
            code = "".join(random.choices(string.digits, k=6))
            if code not in self.pending_receivers:
                return code

    async def send_personal_message(self, websocket: WebSocket, message: dict):
        """向指定的 WebSocket 發送 JSON 訊息"""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(
                f"Failed to send message to {websocket.client.host if websocket.client else 'unknown'}: {e}"
            )
            # 發送失敗可能表示連接已斷開，嘗試清理
            await self.disconnect(websocket)

    async def handle_message(self, websocket: WebSocket, data: str):
        """處理從客戶端收到的訊息"""
        try:
            message = json.loads(data)
            message_type = message.get("type")
            client_ip = websocket.client.host if websocket.client else "unknown"
            logger.debug(f"Handling message type '{message_type}' from {client_ip}")

            if message_type == "request_code":  # 接收方請求代碼
                if websocket in self.paired_connections or any(
                    ws == websocket for ws in self.pending_receivers.values()
                ):
                    logger.warning(
                        f"Client {client_ip} already has a role or is paired. Ignoring request_code."
                    )
                    await self.send_personal_message(
                        websocket,
                        {
                            "type": "error",
                            "message": "Already has a role or is paired.",
                        },
                    )
                    return

                code = self._generate_code()
                self.pending_receivers[code] = websocket
                self.active_connections[websocket] = f"receiver_{code}"  # 更新狀態
                logger.info(f"Generated code {code} for receiver {client_ip}")
                await self.send_personal_message(
                    websocket, {"type": "code_generated", "code": code}
                )

            elif message_type == "request_connection":  # 傳輸方請求連接
                code = message.get("code")
                if not code or code not in self.pending_receivers:
                    logger.warning(
                        f"Invalid or unknown code '{code}' from sender {client_ip}"
                    )
                    await self.send_personal_message(
                        websocket,
                        {"type": "error", "message": "Invalid or unknown code."},
                    )
                    return

                if websocket in self.paired_connections:
                    logger.warning(
                        f"Sender {client_ip} is already paired. Ignoring request_connection."
                    )
                    await self.send_personal_message(
                        websocket, {"type": "error", "message": "Already paired."}
                    )
                    return

                receiver_ws = self.pending_receivers.pop(code)  # 從等待隊列中取出接收者
                self.paired_connections[websocket] = receiver_ws
                self.paired_connections[receiver_ws] = websocket
                self.active_connections[websocket] = (
                    f"sender_paired_with_{receiver_ws.client.host if receiver_ws.client else 'unknown'}"
                )
                self.active_connections[receiver_ws] = (
                    f"receiver_paired_with_{client_ip}"
                )

                logger.info(
                    f"Paired sender {client_ip} with receiver {receiver_ws.client.host if receiver_ws.client else 'unknown'} using code {code}"
                )

                # 通知雙方連接成功
                await self.send_personal_message(
                    websocket, {"type": "connection_ready"}
                )  # 通知傳輸方可以開始 WebRTC
                await self.send_personal_message(
                    receiver_ws, {"type": "peer_connected"}
                )  # 通知接收方有對等方連接

            elif message_type in [
                "send_offer",
                "send_answer",
                "send_ice",
            ]:  # WebRTC 信令轉發
                peer = self.paired_connections.get(websocket)
                if peer:
                    # 構建轉發的訊息類型
                    forward_type_map = {
                        "send_offer": "offer_received",
                        "send_answer": "answer_received",
                        "send_ice": "ice_received",
                    }
                    forward_message = message.copy()  # 複製原始訊息
                    forward_message["type"] = forward_type_map[message_type]  # 修改類型
                    logger.debug(
                        f"Forwarding {message_type} from {client_ip} to peer {peer.client.host if peer.client else 'unknown'}"
                    )
                    await self.send_personal_message(peer, forward_message)
                else:
                    logger.warning(
                        f"Received {message_type} from unpaired client {client_ip}. Ignoring."
                    )
                    await self.send_personal_message(
                        websocket,
                        {"type": "error", "message": "Not paired with anyone."},
                    )

            else:
                logger.warning(
                    f"Received unknown message type '{message_type}' from {client_ip}"
                )
                await self.send_personal_message(
                    websocket,
                    {
                        "type": "error",
                        "message": f"Unknown message type: {message_type}",
                    },
                )

        except json.JSONDecodeError:
            logger.error(
                f"Failed to decode JSON from {websocket.client.host if websocket.client else 'unknown'}: {data}"
            )
            await self.send_personal_message(
                websocket, {"type": "error", "message": "Invalid JSON format."}
            )
        except Exception as e:
            logger.error(
                f"Error handling message from {websocket.client.host if websocket.client else 'unknown'}: {e}",
                exc_info=True,
            )
            # 嘗試發送通用錯誤訊息
            try:
                await self.send_personal_message(
                    websocket,
                    {"type": "error", "message": "An internal server error occurred."},
                )
            except:
                pass  # 如果發送也失敗，可能連接已斷開，會在 disconnect 中處理
