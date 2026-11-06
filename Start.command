#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PIP_DISABLE_PIP_VERSION_CHECK=1
if [ ! -x .venv/bin/python ]; then
  TRANSCRIBER_PYTHON=""
  for candidate in /opt/homebrew/opt/python@3.12/bin/python3.12 /usr/local/bin/python3 /opt/homebrew/bin/python3 python3; do
    if "$candidate" -c 'import sys; assert sys.version_info >= (3, 11)' >/dev/null 2>&1; then
      TRANSCRIBER_PYTHON="$candidate"
      break
    fi
  done
  if [ -z "$TRANSCRIBER_PYTHON" ]; then
    echo '請先安裝 Python 3.11 或以上版本：https://www.python.org/downloads/'
    read -r -p '按 Enter 關閉。'
    exit 1
  fi
  "$TRANSCRIBER_PYTHON" -m venv .venv
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo '請先安裝 FFmpeg：brew install ffmpeg'
  read -r -p '按 Enter 關閉。'
  exit 1
fi
echo '準備本機轉錄程式…'
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  .venv/bin/python -m ensurepip --upgrade
fi
if ! .venv/bin/python -m pip install --no-cache-dir -q -r requirements.txt; then
  echo '套件安裝失敗，請檢查網絡後重新開啟。'
  read -r -p '按 Enter 關閉。'
  exit 1
fi
exec .venv/bin/python -m transcriber.server "$@"
