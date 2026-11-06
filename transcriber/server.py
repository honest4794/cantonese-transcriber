"""Loopback-only, authenticated upload and background-job service."""
import argparse
import hmac
import json
import mimetypes
import secrets
import tempfile
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote

PAGES = "https://honest4794.github.io/cantonese-transcriber/"
WEB = Path(__file__).resolve().parent.parent / "web"
MAX_UPLOAD = 512 * 1024 * 1024


def make_server(port=8765, token=None, runner=None):
    if runner is None:
        from .engine import transcribe
        runner = transcribe
    token = token or secrets.token_urlsafe(32)
    lock = threading.Lock()
    jobs = {}
    workers = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *_):
            pass

        def reply(self, code, data=None, *, content=None, mime="application/json"):
            body = content if content is not None else json.dumps(data or {}, ensure_ascii=False).encode()
            self.send_response(code)
            origin = self.headers.get("Origin")
            if origin in self.allowed_origins():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def allowed_origins(self):
            return {"https://honest4794.github.io", f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}

        def permitted(self, auth=True):
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in hosts:
                self.reply(403, {"error": "只接受本機連接"})
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in self.allowed_origins():
                self.reply(403, {"error": "此網頁未獲授權"})
                return False
            if auth and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.reply(401, {"error": "請從本機啟動程式開啟網頁"})
                return False
            return True

        def do_OPTIONS(self):
            if self.permitted(False):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Content-Length", "0")
                self.end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/":
                if not self.permitted(False):
                    return
                self.send_response(302)
                self.send_header("Location", f"/app/#token={token}&port={self.server.server_port}")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            if path.startswith("/app/") or path == "/":
                if not self.permitted(False):
                    return
                name = "index.html" if path == "/app/" else unquote(path.removeprefix("/app/"))
                file = (WEB / name).resolve()
                if not file.is_relative_to(WEB.resolve()) or not file.is_file():
                    return self.reply(404)
                mime = {".mjs":"text/javascript; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".wasm":"application/wasm"}.get(file.suffix, mimetypes.guess_type(file.name)[0] or "application/octet-stream")
                return self.reply(200, content=file.read_bytes(), mime=mime)
            if not self.permitted():
                return
            if path == "/api/health":
                return self.reply(200, {"service": "cantonese-transcriber", "version": 1})
            with lock:
                job = jobs.get(path.removeprefix("/api/jobs/")) if path.startswith("/api/jobs/") else None
                data = {k: v for k, v in job.items() if k != "cancel"} if job else None
            self.reply(200, data) if data else self.reply(404, {"error": "找不到轉錄工作"})

        def do_POST(self):
            if not self.permitted():
                return
            parsed = urlsplit(self.path)
            if parsed.path != "/api/jobs":
                return self.reply(404)
            try:
                speakers = int(parse_qs(parsed.query).get("speakers", ["2"])[0])
                size = int(self.headers.get("Content-Length", "0"))
                if speakers not in {0, 1, 2, 3, 4, 5, 6} or size <= 0:
                    raise ValueError()
            except ValueError:
                return self.reply(400, {"error": "請選擇音檔及有效的講者人數"})
            if size > MAX_UPLOAD:
                return self.reply(413, {"error": "音檔上限為 512 MB，請先分段"})
            ident = uuid.uuid4().hex
            with lock:
                if any(j["status"] in {"uploading", "running", "cancelling"} for j in jobs.values()):
                    return self.reply(409, {"error": "已有錄音處理中"})
                jobs.clear()
                job = {"id": ident, "status": "uploading", "phase": "uploading", "progress": 0, "message": "讀取錄音", "cancel": threading.Event()}
                jobs[ident] = job
            directory = tempfile.TemporaryDirectory(prefix="cantonese-recording-")
            audio = Path(directory.name) / "input.audio"
            try:
                self.connection.settimeout(30)
                with audio.open("wb") as dest:
                    remaining = size
                    while remaining:
                        block = self.rfile.read(min(1024 * 1024, remaining))
                        if not block:
                            raise ValueError("上傳中斷，請重新選擇錄音")
                        dest.write(block)
                        remaining -= len(block)
            except (OSError, ValueError) as exc:
                directory.cleanup()
                with lock:
                    job.update(status="error", message="上傳中斷，請重試")
                return self.reply(400, {"error": "上傳中斷，請重試"})

            def update(phase, progress, message):
                with lock:
                    job.update(phase=phase, progress=round(progress, 1), message=message)

            def work():
                try:
                    result = runner(audio, speakers, update, job["cancel"].is_set)
                    directory.cleanup()
                    with lock:
                        if job["cancel"].is_set():
                            job.update(status="cancelled", message="已取消")
                        else:
                            job.update(status="done", progress=100, message="轉錄完成，請核對內容及講者", lines=result)
                except InterruptedError:
                    directory.cleanup()
                    with lock:
                        job.update(status="cancelled", message="已取消")
                except Exception as exc:
                    directory.cleanup()
                    with lock:
                        job.update(status="error", message=str(exc) or "轉錄失敗，請重試")
            with lock:
                job["status"] = "running"
            worker = threading.Thread(target=work, daemon=True)
            workers.append(worker)
            worker.start()
            self.reply(202, {"id": ident})

        def do_DELETE(self):
            if not self.permitted():
                return
            path = urlsplit(self.path).path
            with lock:
                job = jobs.get(path.removeprefix("/api/jobs/")) if path.startswith("/api/jobs/") else None
                if job and job["status"] in {"running", "cancelling"}:
                    job["cancel"].set()
                    job.update(status="cancelling", message="正在取消，請稍候")
            self.reply(202) if job else self.reply(404)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.session_token = token
    def stop_jobs():
        with lock:
            for job in jobs.values():
                job["cancel"].set()
        for worker in workers:
            worker.join(timeout=20)
    server.stop_jobs = stop_jobs
    return server


def main():
    parser = argparse.ArgumentParser(description="本機粵語轉錄服務")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--local", action="store_true", help="開啟本機介面")
    parser.add_argument("--clear-models", action="store_true", help="移除已下載模型")
    args = parser.parse_args()
    if args.clear_models:
        from .engine import MODEL_DIR
        for name in ("sensevoice.onnx", "tokens.txt", "embedding.onnx", "segmentation.onnx", "segmentation.tar.bz2"):
            (MODEL_DIR / name).unlink(missing_ok=True)
            (MODEL_DIR / (name + ".part")).unlink(missing_ok=True)
        print("已移除模型，下次轉錄時會重新下載。")
        return
    try:
        server = make_server(args.port)
    except OSError:
        raise SystemExit("無法啟動：連接埠已使用中，請關閉舊的轉錄程式或使用 --port 8766。")
    address = f"http://127.0.0.1:{args.port}/app/" if args.local else PAGES
    print(f"本機轉錄服務已啟動：127.0.0.1:{args.port}；關閉此視窗或按 Control-C 停止。", flush=True)
    if not args.no_open:
        webbrowser.open(f"{address}#token={server.session_token}&port={args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.stop_jobs()
        server.server_close()


if __name__ == "__main__":
    main()
