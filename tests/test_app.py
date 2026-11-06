import http.client
import json
import threading
import time
import unittest
from pathlib import Path


class TranscriptTests(unittest.TestCase):
    def test_words_follow_speaker_changes_and_keep_cantonese(self):
        from transcriber.formatting import make_lines
        chunks = [{"tokens": ["我", "唔", "系", "嗯"], "timestamps": [0.1, 0.3, 0.5, 1.3], "end": 1.8}]
        turns = [{"start": 0, "end": 1, "speaker": 0}, {"start": 1, "end": 2, "speaker": 1}]
        rows = make_lines(chunks, turns)
        self.assertEqual([r["speaker"] for r in rows], ["講者 A", "講者 B"])
        self.assertEqual([r["text"] for r in rows], ["我唔係", "嗯"])
        self.assertEqual([r["line"] for r in rows], [1, 2])


class ServerTests(unittest.TestCase):
    def setUp(self):
        from transcriber.server import make_server
        self.started = threading.Event()
        self.release = threading.Event()
        self.audio_path = None
        self.failure = None
        def runner(path, speakers, update, cancelled):
            self.audio_path = Path(path)
            self.started.set()
            update("transcribing", 50, "轉錄中")
            while not self.release.wait(.01):
                if cancelled():
                    raise InterruptedError()
            if self.failure:
                raise RuntimeError(self.failure)
            return [{"line": 1, "start": 0, "end": 1, "speaker": "講者 A", "text": "你好"}]
        self.server = make_server(0, "test-token", runner)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, token="test-token", origin="https://honest4794.github.io"):
        c = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        headers = {"Authorization": "Bearer " + token, "Origin": origin, "Content-Type": "application/octet-stream"}
        c.request(method, path, body, headers)
        r = c.getresponse()
        payload = r.read()
        c.close()
        return r.status, json.loads(payload) if payload else {}

    def test_untrusted_origin_and_bad_token_cannot_upload(self):
        self.assertEqual(self.request("POST", "/api/jobs?speakers=2", b"audio", origin="https://evil.example")[0], 403)
        self.assertEqual(self.request("POST", "/api/jobs?speakers=2", b"audio", token="wrong")[0], 401)
        self.assertFalse(self.started.is_set())

    def test_job_does_not_block_status_and_removes_uploaded_audio(self):
        code, job = self.request("POST", "/api/jobs?speakers=2", b"audio")
        self.assertEqual(code, 202)
        self.assertTrue(self.started.wait(2))
        self.assertTrue(self.audio_path.exists())
        self.assertEqual(self.request("POST", "/api/jobs?speakers=2", b"second")[0], 409)
        self.assertEqual(self.request("GET", "/api/jobs/" + job["id"])[1]["progress"], 50)
        self.release.set()
        for _ in range(100):
            _, result = self.request("GET", "/api/jobs/" + job["id"])
            if result["status"] == "done":
                break
            time.sleep(.01)
        self.assertEqual(result["lines"][0]["text"], "你好")
        self.assertFalse(self.audio_path.exists())

    def test_cancel_cleans_audio_and_accepts_another_job(self):
        _, job = self.request("POST", "/api/jobs?speakers=0", b"audio")
        self.assertTrue(self.started.wait(2))
        self.assertEqual(self.request("DELETE", "/api/jobs/" + job["id"])[0], 202)
        for _ in range(100):
            _, result = self.request("GET", "/api/jobs/" + job["id"])
            if result["status"] == "cancelled":
                break
            time.sleep(.01)
        self.assertEqual(result["status"], "cancelled")
        self.assertFalse(self.audio_path.exists())
        self.assertEqual(self.request("POST", "/api/jobs?speakers=0", b"again")[0], 202)

    def test_invalid_speaker_count_and_empty_upload_are_rejected(self):
        self.assertEqual(self.request("POST", "/api/jobs?speakers=-1", b"audio")[0], 400)
        self.assertEqual(self.request("POST", "/api/jobs?speakers=2", b"")[0], 400)

    def test_failed_processing_removes_audio(self):
        self.failure = "無效音檔"
        _, job = self.request("POST", "/api/jobs?speakers=0", b"audio")
        self.assertTrue(self.started.wait(2))
        self.release.set()
        for _ in range(100):
            _, result = self.request("GET", "/api/jobs/" + job["id"])
            if result["status"] == "error":
                break
            time.sleep(.01)
        self.assertEqual(result["message"], "無效音檔")
        self.assertFalse(self.audio_path.exists())

    def test_bad_host_and_oversized_body_are_rejected_before_reading(self):
        for headers, expected in [({"Host": "evil.example", "Authorization": "Bearer test-token"}, 403), ({"Authorization": "Bearer test-token", "Content-Length": str(513 * 1024 * 1024)}, 413)]:
            c = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
            c.request("POST", "/api/jobs?speakers=2", b"", headers)
            r = c.getresponse()
            self.assertEqual(r.status, expected)
            r.read()
            c.close()


if __name__ == "__main__":
    unittest.main()
