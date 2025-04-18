# 使用 Python 3.12 slim 作為基礎映像
FROM python:3.12-slim

# 設定工作目錄
WORKDIR /app

# 將 requirements.txt 複製到工作目錄
COPY requirements.txt requirements.txt

# 更新 pip 並安裝 requirements.txt 中定義的依賴
# 使用 --no-cache-dir 減少映像大小
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 將 backend/app 目錄下的所有內容複製到容器的 /app/app 目錄
# 注意：這裡假設您的 FastAPI 程式碼位於 backend/app/ 目錄下
COPY ./app /app/app

# 開放 FastAPI/Uvicorn 預設使用的 8000 埠
EXPOSE 8000

# 容器啟動時執行的命令
# 啟動 Uvicorn 伺服器，監聽所有網路介面 (0.0.0.0) 的 8000 埠
# 指向 app.main 模組中的 app 物件
# 在開發環境中，docker-compose.yml 的 volumes 會掛載本地程式碼，
# 可以加上 --reload 參數讓 Uvicorn 自動重載程式碼變更
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
# 生產環境不建議使用 --reload
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]