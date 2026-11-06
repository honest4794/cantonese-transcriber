"""Offline Cantonese ASR and speaker diarization; imports stay off the HTTP path."""
import os
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

MODEL_DIR = Path(os.environ.get("CANTONESE_MODEL_DIR", Path.home() / "Library/Application Support/CantoneseTranscriber/models"))
SENSE = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main/"
GITHUB = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"


def check(cancelled):
    if cancelled():
        raise InterruptedError()


def download(url, dest, update, cancelled):
    import requests
    if dest.is_file() and dest.stat().st_size:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=(15, 15)) as response:
            response.raise_for_status()
            total = int(response.headers.get("Content-Length", 0))
            done = 0
            with part.open("wb") as f:
                for block in response.iter_content(1024 * 512):
                    check(cancelled)
                    f.write(block)
                    done += len(block)
                    update("models", 0, f"首次下載模型：{done // 1048576} MB" + (f" / {total // 1048576} MB" if total else ""))
            if total and done != total:
                raise RuntimeError("模型下載未完成，請重新開始")
        check(cancelled)
        part.replace(dest)
    finally:
        part.unlink(missing_ok=True)


def prepare_models(speakers, update, cancelled):
    download(SENSE + "model.int8.onnx", MODEL_DIR / "sensevoice.onnx", update, cancelled)
    download(SENSE + "tokens.txt", MODEL_DIR / "tokens.txt", update, cancelled)
    if speakers:
        download(GITHUB + "speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx", MODEL_DIR / "embedding.onnx", update, cancelled)
        if not (MODEL_DIR / "segmentation.onnx").exists():
            archive = MODEL_DIR / "segmentation.tar.bz2"
            download(GITHUB + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2", archive, update, cancelled)
            # Read a single named file, never extract arbitrary archive paths.
            with tarfile.open(archive) as tar:
                members = {Path(m.name).name: m for m in tar.getmembers() if m.isfile()}
                member = members.get("model.int8.onnx") or members.get("model.onnx")
                if not member:
                    raise RuntimeError("講者模型檔案不完整，請刪除模型後重試")
                with tar.extractfile(member) as src, (MODEL_DIR / "segmentation.onnx.part").open("wb") as dest:
                    shutil.copyfileobj(src, dest)
            (MODEL_DIR / "segmentation.onnx.part").replace(MODEL_DIR / "segmentation.onnx")
            archive.unlink()


def transcribe(path, speakers, update, cancelled):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("找不到 FFmpeg。請先執行 brew install ffmpeg，再重新啟動。")
    check(cancelled)
    prepare_models(speakers, update, cancelled)
    import numpy as np
    import soundfile as sf
    import sherpa_onnx
    from .formatting import make_lines
    wave = path.parent / "decoded.wav"
    update("decoding", 1, "讀取錄音")
    process = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-t", "14401", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wave)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        while process.poll() is None:
            check(cancelled)
            time.sleep(.1)
        if process.returncode:
            raise RuntimeError("無法讀取此錄音，請選擇有效的 M4A、MP3、WAV 或影片檔。")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    info = sf.info(wave)
    if info.duration > 4 * 3600:
        raise RuntimeError("錄音上限為四小時，請先分段")
    audio, sr = sf.read(wave, dtype="float32")
    if len(audio) < sr * .2:
        raise RuntimeError("錄音太短，請選擇包含說話內容的檔案")
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=str(MODEL_DIR / "sensevoice.onnx"), tokens=str(MODEL_DIR / "tokens.txt"), language="yue", use_itn=True, num_threads=2)
    duration = len(audio) / sr
    bounds = [0.]
    for target in np.arange(15, duration - 4, 15):
        points = np.arange(target - 1.5, target + 1.5, .1)
        energy = [np.mean(audio[int(t * sr):int((t + .15) * sr)] ** 2) for t in points]
        bounds.append(float(points[int(np.argmin(energy))] + .075))
    bounds.append(duration)
    chunks = []
    for i, (a, b) in enumerate(zip(bounds, bounds[1:])):
        check(cancelled)
        stream = recognizer.create_stream()
        stream.accept_waveform(sr, audio[int(a * sr):int(b * sr)])
        recognizer.decode_stream(stream)
        chunks.append({"tokens": list(stream.result.tokens), "timestamps": [float(t) + a for t in stream.result.timestamps], "end": b})
        update("transcribing", 5 + (50 if speakers else 90) * (i + 1) / (len(bounds) - 1), f"粵語轉錄 {i + 1} / {len(bounds) - 1}")
    del recognizer
    turns = []
    if speakers:
        check(cancelled)
        update("speakers", 55, "分辨講者，長錄音需要較多時間")
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(MODEL_DIR / "segmentation.onnx"), window_shift_ratio=.5), num_threads=2),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(MODEL_DIR / "embedding.onnx"), num_threads=2),
            clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speakers, threshold=.5), min_duration_on=.3, min_duration_off=.4)
        if not config.validate():
            raise RuntimeError("講者模型設定無效，請檢查模型檔案")
        diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
        def progress(n, total):
            update("speakers", 55 + 40 * n / max(total, 1), f"分辨講者 {round(100 * n / max(total, 1))}%")
            return 1 if cancelled() else 0
        result = diarizer.process(audio, callback=progress).sort_by_start_time()
        check(cancelled)
        turns = [{"start": t.start, "end": t.end, "speaker": t.speaker} for t in result]
    check(cancelled)
    update("formatting", 98, "整理行號與時間戳")
    lines = make_lines(chunks, turns)
    if not lines:
        raise RuntimeError("未能辨識到說話內容，請檢查錄音")
    return lines
