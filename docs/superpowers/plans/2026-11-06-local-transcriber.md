# 本機粵語轉錄實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 將已驗證的粵語本機轉錄流程做成簡單網頁，發佈至 GitHub Pages。

**Architecture:** 使用者已選擇先啟動 Mac 本機程式，再用 Pages 介面。Python 服務只監聽 127.0.0.1，以啟動時產生的權杖驗證 API；錄音串流寫入暫存，背景進行 SenseVoice 轉錄與講者分組。靜態網頁只處理上傳、進度、編輯及匯出，沒有前端框架。

**Tech Stack:** Python 3.11+、標準庫 HTTP 服務、sherpa-onnx、NumPy、SoundFile、OpenCC、原生 HTML/CSS/JavaScript。

**Spec:** 使用者對話：介面簡單不卡頓；沿用本機模型；行號、時間戳、講者；建立 repository 並發佈 GitHub Pages。

## Global Constraints

- 繁體中文介面；不提交錄音、逐字稿、模型、權杖或使用者路徑。
- 背景作業不阻塞進度 API；一次處理一個錄音，可取消。
- 限制檔案大小；禁止未授權或其他網站操作本機服務。
- 講者預設兩位，可選不分講者或其他人數；標記為自動結果。
- 軟件與模型可重用；每次作業的音檔暫存自動刪除。

## Review Focus

- 中斷上傳、無效音檔：清除暫存並顯示可理解錯誤。
- 未授權來源、錯誤 token、Host：拒絕本機讀寫。
- 第二個並行任務：回覆忙碌，不覆寫現有結果。
- 取消模型下載或轉錄：停止工作並可重新開始。
- 長錄音、大量行數及匯出：UI 保持可操作，修改後匯出保留內容。

### Task 1: 本機作業與轉錄管線

**Files:** `transcriber/server.py`, `transcriber/engine.py`, `transcriber/formatting.py`, `tests/test_app.py`, `requirements.txt`。

**Interfaces:** `transcribe(path, speakers, update, cancelled) -> list[dict]`；`make_server(port, token, runner) -> ThreadingHTTPServer`；API `/api/health`, `/api/jobs`, `/api/jobs/<id>`。

- [x] 先寫並執行行號／講者／時間分配及 API 權限、忙碌、清理測試，確認未實作時失敗。
- [x] 實作背景任務、上傳、取消、驗證；SenseVoice 與已知人數的 pyannote/3D-Speaker 分組。
- [x] 執行 `python3 -m unittest discover -s tests -v`，確認通過；commit。

### Task 2: 簡潔操作與本機啟動

**Files:** `web/index.html`, `web/style.css`, `web/app.js`, `Start.command`, `README.md`。

**Interfaces:** 使用 Task 1 API；啟動時開啟 Pages 並以 URL fragment 傳遞權杖，網頁立即移除 fragment。

- [x] 實作白底、青綠操作鍵、系統字體、單欄操作與寬版逐字稿；沒有動畫或外部字體。
- [x] 完成連接、上傳、進度、取消、音訊定位、編輯、TXT/CSV/SRT 下載。
- [x] 以瀏覽器檢查桌面／窄版及錯誤狀態，並用真實短音訊測試本機轉錄；commit。

### Task 3: 發佈

**Files:** `.github/workflows/pages.yml`。

- [x] 執行完整測試、JavaScript 語法檢查及獨立 code review，修正重要問題。
- [x] 建立公開 `honest4794/cantonese-transcriber`，僅 push 本次程式及文件。
- [ ] 啟用 Pages，確認 Actions 成功及公開網址回傳正確內容，開啟 repository 與 Pages。
