# 瀏覽器 GPU 加速實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 加速 40 分鐘粵語錄音；以 1–2 分鐘為測試目標，依完整錄音量度結果交付，不能以短片推算當成承諾。

**Architecture:** 瀏覽器自動偵測 WebGPU，使用 ONNX Runtime Web 和 SenseVoice；不支援或 GPU 失敗時回到現有 WASM。半精度儲存權重、完整精度運算；ASR 逐段處理，聲紋固定八段一批，避免已在試驗中發現的全半精度錯誤輸出。每個局部講者抽取最多 3 秒純語音比較聲紋，10 秒交界視窗覆蓋全段且不重疊；保持原本 UI、時間戳、講者、取消、保留初稿及匯出。

**Tech Stack:** 原生 JS／Web Worker、ONNX Runtime Web 1.29.0、SenseVoiceSmall、既有 pyannote／3D-Speaker。

**Spec:** 本次對話：使用者要求長錄音由 27 分鐘接近 1–2 分鐘，並授權試做 GPU 加速；既有免費、免安裝、錄音不上傳、不接受雲端時數額度要求繼續適用。

## Global Constraints

- 錄音只在裝置內處理；只下載公開靜態模型及程式。
- 不降低講者功能或悄悄改用雲端；不能把短片外推當成長錄音實測。
- GitHub Pages 資源共小於 1 GB；每個模型分片小於 50 MiB。
- 大型 GPU 語音模型與講者模型依序處理，小型 CPU 分段模型可與 GPU 語音模型並行；發生錯誤仍保留已完成文字。

## Review Focus

- 不支援 GPU、初始化及推論途中裝置失效：可取消、保留初稿並自動回復 WASM。
- 非整段長度、短尾段及句子跨段：原音訊時間軸不可壓縮或漏掉尾段。
- 濾波器與 LFR／CMVN：以 kaldi-native-fbank 黃金資料測試，避免錯誤特徵令辨識品質下降。
- 不正確或損壞模型快取：仍使用大小／SHA256 驗證。
- 講者運算仍慢時，顯示分項耗時，不把文字完成時間說成全部完成時間。

### Task 1: GPU 引擎及運算核對

**Files:** `web/audio-features.mjs`, `web/gpu-engine.mjs`, `web/gpu-worker.js`, `web/assets/`, `web/vendor/`, `web/models.json`, `tools/package-gpu-assets.py`, `tests/gpu-engine.test.mjs`。

**Interfaces:** `Fbank.process(samples)` 回傳 `{features,frames}`；`senseVoiceFeatures(samples,cmvn)` 回傳 560 維 LFR／CMVN；GPU Worker 使用現有 chunk／progress／asr-done／speaker-done 訊息。

- [x] 先寫黃金特徵、CTC 時間戳、短尾段及 GPU 失效保留文字測試，確認 RED。
- [x] 實作 GPU ASR；以同一段真實粵語對照 WASM／FP32，記錄實際 GPU dispatch。
- [x] 實測講者模型 GPU 運算；只整合有結果核對及速度改善的路徑。
- [x] 包裝已驗證模型分片及授權，跑測試及完整性檢查，commit 本次檔案。

### Task 2: 自動選擇、長錄音驗證及發佈

**Files:** `web/app.js`, `web/transcription-session.mjs`, `web/index.html`, `README.md`, `tests/browser-engine.test.mjs`。

**Interfaces:** 延用 Task 1 Worker 訊息；GPU 失效重試不重複已完成 chunk。

- [x] 先測試不支援 GPU、初始化失敗、運算中失敗、取消及過期訊息。
- [x] 接上自動選擇及清楚分項耗時；保留原本簡單版面。
- [x] 真實完整 40 分鐘錄音驗證時間、逐段文字、尾段、講者、取消及匯出；記錄限制。
- [ ] 全部測試、獨立 review、task-only commit／push／Pages 公開檔案驗證。

實際驗證：39 項 Node、10 項 Python 測試通過；獨立 reviewer 核准 `f3157fa`，無待修問題。40 分 21 秒真實錄音在完整網頁約 3 分 16 秒完成（M2／8GB／Chrome157／低電量模式；首次網絡下載另計），892 行、390px 無橫向溢出，修改後 TXT／CSV／SRT 均通過。真實 GPUDevice.destroy 注入後，自動啟動兩個 CPU 階段完成餘下文字及講者；取消則保留初稿，三種匯出均標示部分稿件。
