# 免安裝、無雲端轉錄額度的瀏覽器版

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 用瀏覽器內的開源模型處理長粵語錄音，免安裝 Python／FFmpeg／Mac 程式，保持簡單介面及現有匯出功能。

**Architecture:** GitHub Pages 直接提供程式、WebAssembly 與分片模型檔案。首次執行自動載入並快取；錄音只在裝置內解碼及運算。ASR 與講者分析放在獨立 Web Worker，分階段釋放大型模型記憶體。每完成一段立即顯示文字，完成轉錄後才補講者；取消會終止 Worker 並保留已完成文字。

**Tech Stack:** 原生 HTML／JS／CSS、官方 sherpa-onnx ASR v1.12.35／講者 v1.13.7 WebAssembly SIMD、SenseVoice INT8、pyannote／3D-Speaker、OpenCC JS。

**Spec:** 使用者要求免安裝、多裝置、本機 AI 免費、長錄音、不接受免費雲端運算時間額度；保留行號／時間／講者、編輯及 TXT／CSV／SRT。不得承諾所有舊裝置都能處理任意長度或與 PDFLeader 等速。

## Global constraints

- 音訊不傳至伺服器；沒有付費 API、訂閱或雲端運算時數限額。
- 不設固定錄音分鐘限額；實際限制為瀏覽器格式支援、記憶體與裝置效能。
- 模型分成小於 50 MiB 的靜態資源，避免 GitHub 單檔限制；使用固定來源版本及 SHA256。
- 單執行緒 SIMD WASM，不依賴 SharedArrayBuffer／伺服器自訂隔離標頭。
- 同時只保留一個推論 Worker 的模型；保留可取消與可恢復的已完成文字。
- 模型載入與實際轉錄時間分開顯示；不把尚未量測的加速當成保證。

## Review focus

- 模型快取被清除／損壞、離線及下載中斷：可重試，沒有音訊外傳。
- 長音訊的分段完整性、末段、時間戳及靜音，不丟失原有內容。
- Worker 取消／錯誤：不留下忙碌狀態、不覆寫已完成文字。
- 文字提早顯示後講者重新切行：完成前不允許修改，避免編輯被覆寫。
- 長逐字稿的呈現與匯出：使用 DOM 批次附加及 content-visibility；可驗證修改後輸出。

### Task 1: 瀏覽器引擎與模型

**Files:** `web/engine-core.mjs`, `web/model-cache.mjs`, `web/inference-worker.js`, `web/vendor/`, `web/assets/`, `tests/browser-engine.test.mjs`。

**Interfaces:** Worker 接受 `{type:'transcribe'|'speakers', audio:ArrayBuffer, speakers:number}`；回傳 `progress`, `chunk`, `asr-done`, `speaker-done`, `error`。`makeLines(chunks, turns)` 與既有輸出結構一致。

- [x] RED：先測試長音訊分段涵蓋末段、講者切分、快取完整性及中止。
- [x] 提取官方發佈的 runtime，記錄來源／授權／雜湊；加入模型分片及快取載入。
- [x] 實作背景轉錄與講者分析，釋放每段及每個 Worker 的記憶體。

### Task 2: 介面與驗證

**Files:** `web/app.js`, `web/index.html`, `web/style.css`, `README.md`。

- [x] 移除本機服務／權杖／安裝要求，改為選錄音即可執行。
- [x] 保留已完成文字、簡潔進度、講者、音訊定位與匯出；修改只在完整處理後開啟。
- [x] 真實短錄音與長音訊壓力測試；量度首載、快取及處理時間；檢查無上傳請求。

### Task 3: 交付

- [x] 全部舊測試與新增測試通過，獨立 code review，修正重要問題。
- [x] Task-only commit、push、Pages 部署，核對公開資源及 GitHub Actions。

交付驗證：程式版本 `74d0725` 的 [GitHub Actions](https://github.com/honest4794/cantonese-transcriber/actions/runs/42223242092) 成功；公開 HTML、JS、CSS、模型清單與本機版本一致，全部模型分片的公開大小及檔案開頭均符合。網址：https://honest4794.github.io/cantonese-transcriber/
