#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_DIR="${MODELS_DIR:-${ROOT_DIR}/models}"

mkdir -p "${MODELS_DIR}"
cd "${MODELS_DIR}"

DET_TAR="PP-OCRv5_server_det_infer.tar"
REC_TAR="PP-OCRv5_server_rec_infer.tar"
DET_DIR="PP-OCRv5_server_det_infer"
REC_DIR="PP-OCRv5_server_rec_infer"

# NOTE: Model hosting URL may change in the future. If download fails, check PaddleOCR/PaddleX official docs.
DET_URL="https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_server_det_infer.tar"
REC_URL="https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_server_rec_infer.tar"

if [[ ! -f "${DET_TAR}" ]]; then
  curl -L --retry 3 --retry-delay 2 -o "${DET_TAR}" "${DET_URL}"
fi

if [[ ! -f "${REC_TAR}" ]]; then
  curl -L --retry 3 --retry-delay 2 -o "${REC_TAR}" "${REC_URL}"
fi

if [[ ! -d "${DET_DIR}" ]]; then
  tar -xf "${DET_TAR}"
fi

if [[ ! -d "${REC_DIR}" ]]; then
  tar -xf "${REC_TAR}"
fi

echo "模型准备完成: ${MODELS_DIR}"
ls -lah "${DET_DIR}" "${REC_DIR}"

