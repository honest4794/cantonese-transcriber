# 粵語轉錄

[開啟網頁](https://honest4794.github.io/cantonese-transcriber/)

簡單的本機粵語轉錄工具。先啟動 Mac 程式，再於網頁選擇錄音。支援行號、時間戳、講者標記、直接修改，以及 TXT／CSV／SRT 下載。

錄音只傳到你自己電腦的 `127.0.0.1`，不會傳至 GitHub 或其他雲端。GitHub Pages 只提供操作介面。

## 安裝與使用

1. 安裝 **Python 3.11 或以上**及 **FFmpeg**。使用 Homebrew 可執行：

   ```sh
   brew install python@3.12 ffmpeg
   ```

2. 下載此 repository 的 ZIP 並解壓，或執行：

   ```sh
   git clone https://github.com/honest4794/cantonese-transcriber.git
   cd cantonese-transcriber
   chmod +x Start.command
   ./Start.command
   ```

3. 之後雙擊 `Start.command` 即可。程式會自動開啟網頁，請保留終端機視窗。若 macOS 不允許雙擊，請在終端機進入該資料夾執行 `bash Start.command`。
4. 選錄音及講者人數，按「開始轉錄」。首次使用需要連線下載約 285 MB 模型；之後使用本機模型。
5. 完成後核對及修改文字／講者，選擇格式下載。點時間可播放對應錄音。

瀏覽器首次可能詢問「本機網絡」或「Loopback network」權限，請允許。如果 Pages 無法連接，使用同一個本機介面：

```sh
./Start.command --local
```

預設連接埠為 `8765`；需要更改可執行 `./Start.command --port 8766`。關閉終端機前可按 **Control-C** 取消工作並停止服務。

## 轉錄與講者

- 支援 FFmpeg 可讀取的 M4A、MP3、WAV、AAC、FLAC、MP4 等格式，檔案上限 512 MB，錄音上限四小時。
- 使用 SenseVoice `zh-en-ja-ko-yue-int8-2025-09-09` 進行粵語識別，再轉為繁體字。
- 使用 sherpa-onnx 的 pyannote segmentation 3.0 與 3D-Speaker 模型分辨講者，按照首次出現標為 A、B 等。
- 講者人數需要按錄音設定，預設兩位。「不分講者」較快。長錄音的講者分析可能需要較多時間，網頁會持續顯示進度。
- **結果是自動轉錄初稿**。口音、遠距錄音、英文、專有名詞、重疊說話及講者歸屬可能有錯，需要對照錄音核對。
- 網頁編輯結果只留在目前分頁；請在關閉或更換錄音前下載。重新整理網頁不會保留稿件。

## 資料與模型位置

- 音檔及解碼檔案只放在每次工作獨立的系統暫存資料夾；完成、取消或失敗後自動移除。強制結束程式或斷電可能留下暫存。
- 模型保存在 `~/Library/Application Support/CantoneseTranscriber/models`，屬於可重用的安裝檔案。
- Python 套件保存在 repository 內的 `.venv`，不提交至 GitHub。
- 移除模型：停止程式後執行 `.venv/bin/python -m transcriber.server --clear-models`；下次轉錄會重新下載。
- 服務只監聽本機，API 使用每次啟動新產生的權杖，限制網頁來源及 Host。權杖經 URL fragment 交給前端後立即從網址移除，請勿分享啟動時尚未移除 fragment 的網址。

## 開發與驗證

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
node --test tests/exports.test.mjs
.venv/bin/python -m transcriber.server --local
```

Pages 由 GitHub Actions 發佈 `web/`。後端 Python 不在 GitHub 執行。

模型來源及原授權請見 [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)、[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 與 [pyannote segmentation](https://huggingface.co/pyannote/segmentation-3.0)。本專案程式碼採 MIT 授權；模型適用各自的授權條款。
