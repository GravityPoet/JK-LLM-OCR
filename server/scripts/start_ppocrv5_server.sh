#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_DIR_DEFAULT="${ROOT_DIR}/models"
VENV_PYTHON_DEFAULT="${ROOT_DIR}/.venv/bin/python"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
DEVICE="${DEVICE:-cpu}"
DET_MODEL_DIR="${DET_MODEL_DIR:-${MODELS_DIR_DEFAULT}/PP-OCRv5_server_det_infer}"
REC_MODEL_DIR="${REC_MODEL_DIR:-${MODELS_DIR_DEFAULT}/PP-OCRv5_server_rec_infer}"
PYTHON_BIN="${PYTHON_BIN:-}"
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK="${PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:-True}"

if [[ -z "${PYTHON_BIN}" && -x "${VENV_PYTHON_DEFAULT}" ]]; then
  PYTHON_BIN="${VENV_PYTHON_DEFAULT}"
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  fi
fi

if [[ -z "${PYTHON_BIN}" || ! -x "${PYTHON_BIN}" ]]; then
  echo "[ERROR] 未找到可用 Python 解释器。请安装 python3，或在 server/ 下创建 .venv。"
  exit 1
fi

if ! "${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1
import importlib.util
raise SystemExit(0 if importlib.util.find_spec('paddleocr') else 1)
PY
then
  cat <<'MSG'
[ERROR] 未检测到 paddleocr 依赖。
请先安装依赖（示例）：
  cd server
  python3 -m venv .venv
  source .venv/bin/activate
  python -m pip install --upgrade pip
  python -m pip install "paddlepaddle==3.2.2" -f https://www.paddlepaddle.org.cn/packages/stable/cpu/
  python -m pip install "paddleocr==3.4.0" "paddlex==3.4.1"
MSG
  exit 1
fi

if [[ ! -d "${DET_MODEL_DIR}" ]]; then
  echo "[ERROR] 检测模型目录不存在: ${DET_MODEL_DIR}"
  echo "       可运行: ./scripts/download_ppocrv5_server_models.sh"
  exit 1
fi

if [[ ! -d "${REC_MODEL_DIR}" ]]; then
  echo "[ERROR] 识别模型目录不存在: ${REC_MODEL_DIR}"
  echo "       可运行: ./scripts/download_ppocrv5_server_models.sh"
  exit 1
fi

echo "[INFO] Using Python: ${PYTHON_BIN}"
echo "[INFO] PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=${PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK}"
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK

exec "${PYTHON_BIN}" "${ROOT_DIR}/scripts/ppocrv5_http_server.py" \
  --host "${HOST}" \
  --port "${PORT}" \
  --device "${DEVICE}" \
  --det-model-dir "${DET_MODEL_DIR}" \
  --rec-model-dir "${REC_MODEL_DIR}"

