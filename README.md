# 粵語轉錄

**[開啟網頁直接使用](https://honest4794.github.io/cantonese-transcriber/)**

免費、免安裝的瀏覽器本機粵語轉錄工具。錄音不會上傳，沒有付費 API、訂閱或雲端轉錄時數額度。

## 使用

1. 開啟網頁，選擇錄音。
2. 選講者人數，按「開始轉錄」。「不分講者」較快；只有一位講者時不會載入額外講者模型。
3. 文字會逐段出現，文字完成後再補講者標記。處理途中可先下載文字，或停止並保留已完成的部分。
4. 完成後直接修改文字／講者，下載 TXT、CSV 或 SRT。點時間可播放對應錄音。

**不需要 Python、FFmpeg、Start.command、API Key 或 AI 帳戶。** 網站本身已包含模型及運算程式。支援時自動使用 WebGPU，未能使用時改用 CPU。首次使用會自動載入約 250–600 MB 模型資源，視乎運算方式及講者設定；之後盡量重用瀏覽器快取。GPU 失敗而改用 CPU 時可能額外載入 CPU 模型；清除瀏覽器資料後需要重新載入。

## 長錄音與速度

- 沒有每日使用分鐘或錄音時長配額。音訊以約 15 秒一段處理，不必等整段完成才看到文字。
- 轉錄及講者分析由背景 Web Worker 執行。GPU 模式讓最多三個小型 CPU worker 在轉文字期間處理講者交界，再釋放大型語音模型、用 GPU 比較聲紋（每個局部講者最多抽取 3 秒純語音；10 秒交界視窗覆蓋全段錄音，避免重複計算）；兩個大型 GPU 模型不會同時載入。CPU 備用模式仍依序處理。
- GPU 不支援、模型啟動失敗或運算中失效時，保留已完成文字並從下一段改用 CPU；若文字已完成，只重試講者分析。GPU 模式保留一份音訊恢復緩衝區，記憶體需求較 CPU 模式高。
- 錄音仍須由瀏覽器讀取及解碼，因此可處理的長度受裝置記憶體、音訊格式及瀏覽器限制。長錄音建議使用電腦，並保持分頁開啟；不保證所有舊手機都能處理任意長度。
- 第一次模型下載、模型初始化、實際轉錄是不同階段。完成畫面分開顯示「文字完成於」（包括載入）及「講者補標記」時間；GPU 模式的部分講者運算已在文字處理期間並行完成。網絡、硬件及錄音內容均會影響時間，不能保證每台裝置都能在 1–2 分鐘內處理 40 分鐘錄音。
- 模型只略過完全為零的數碼靜音，不會因為說話細聲而自行丟棄該段。

2026-11-08 本機實測：Apple M2（8GB）、Chrome 157、低電量模式，一段 **40 分 21 秒真實粵語錄音**的完整網頁流程約 **3 分 16 秒**，包含讀取錄音、本機模型載入及講者標記，未包括首次從網上下載模型。產生 892 行，在 390px 窄畫面完成編輯及三種格式匯出核對。1–2 分鐘仍是優化目標，未有達成保證。文字與較慢 GPU 流程一致；快速講者流程與該流程在語音時段約 92% 時間標記相同，此為兩個自動流程的一致程度，並非人工核對的正確率。

## 支援與資料

使用較新版本、支援 WebAssembly SIMD 及 Web Worker 的 Chrome、Edge、Firefox 或 Safari。MP3、M4A、WAV 等能否讀取，取決於瀏覽器的音訊解碼支援。

所有音訊解碼、語音識別、講者分析及匯出都在裝置內完成。網頁只會下載公開程式與模型檔案，不會把錄音傳到 GitHub、Hugging Face 或 AI 伺服器。模型由 GitHub Pages 同源提供，分片及 SHA-256 檢查避免損壞快取進入推論。

逐字稿只保留在目前分頁，關閉前請下載保存。若發生錯誤或按停止，已完成文字會保留；不完整稿件會在畫面及下載檔名標示。網站的「清除模型快取」只清除此工具的模型快取。

輸出是**自動轉錄初稿**；英文、專有名詞、遠距錄音、重疊語音及講者歸屬需要對照錄音核對。

## 模型與授權

- 語音識別：SenseVoiceSmall（FunAudioLLM／阿里巴巴），INT8，透過 sherpa-onnx v1.12.35 官方 WebAssembly SIMD 發佈包。
- GPU 語音識別：同一 SenseVoiceSmall 家族，FunASR ONNX 匯出，權重以 float16 儲存、運算保持 float32；ONNX Runtime Web 1.29.0。特徵提取以獨立 kaldi-native-fbank 黃金資料核對。
- 講者分析：pyannote segmentation 3.0 與 3D-Speaker ERes2Net，透過 sherpa-onnx v1.13.7 官方發佈包。
- 繁體轉換：OpenCC JS v1.4.2。
- 本專案程式碼採 MIT；模型及第三方 runtime 採各自授權。SenseVoice 模型依 FunASR Model Open Source License Agreement 提供，並非本專案的 MIT 授權。

完整來源與授權見 [NOTICE](web/vendor/NOTICE.txt)；模型分片、大小及雜湊見 [models.json](web/models.json)。公開發佈包的預載 `.data` 內容保持原樣，只拆分為小於 50 MiB 的靜態檔案。

## 開發

靜態網站位於 `web/`，可用任何靜態 HTTP 伺服器預覽：

```sh
python3 -m http.server 8080 --directory web
node --test tests/*.test.mjs
```

如要執行保留的舊 Python 伴隨服務測試：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

舊 Mac 伴隨服務程式保留作開發及比較，公開網站已不依賴它。重新包裝 CPU 模型可用 `tools/package-browser-assets.py`；來源為官方 sherpa-onnx GitHub release。GPU 模型可用 `tools/package-gpu-assets.py`，固定來源、完整 SHA256、ORT 版本及精度寫在腳本與 `models.json`；開發環境需安裝 `onnx==1.20.1` 和 NumPy，提供原始模型、`am.mvn`、`vocab.txt` 及 npm `onnxruntime-web@1.29.0` 的 `dist/` 目錄。正常使用者毋須執行。

GitHub Actions 驗證程式後發佈 `web/` 至 Pages。
