#!/usr/bin/env python3
"""Minimal local PP-OCRv5 HTTP server.

Implements a subset of the PaddleX OCR serving API:
POST /ocr
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import logging
import os
import tempfile
import threading
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from paddleocr import PaddleOCR
except Exception as exc:  # pragma: no cover - runtime import guard
    raise SystemExit(
        "导入 paddleocr 失败。请先安装 PaddleOCR（示例：python3 -m pip install 'paddleocr>=3.0.0,<4.0.0'）。"
    ) from exc


MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024
MAX_BASE64_CHARS = 64 * 1024 * 1024


@dataclass(frozen=True)
class OCRRequest:
    image_bytes: bytes
    use_doc_orientation_classify: bool | None
    use_doc_unwarping: bool | None
    use_textline_orientation: bool | None
    text_rec_score_thresh: float | None


class OCRService:
    def __init__(self, det_model_dir: str, rec_model_dir: str, device: str) -> None:
        self._lock = threading.Lock()
        self._pipeline = PaddleOCR(
            text_detection_model_name="PP-OCRv5_server_det",
            text_detection_model_dir=det_model_dir,
            text_recognition_model_name="PP-OCRv5_server_rec",
            text_recognition_model_dir=rec_model_dir,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device=device,
        )

    def infer(self, req: OCRRequest) -> dict[str, Any]:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
            temp_file.write(req.image_bytes)
            temp_path = temp_file.name

        try:
            kwargs: dict[str, Any] = {}
            if req.use_doc_orientation_classify is not None:
                kwargs["use_doc_orientation_classify"] = req.use_doc_orientation_classify
            if req.use_doc_unwarping is not None:
                kwargs["use_doc_unwarping"] = req.use_doc_unwarping
            if req.use_textline_orientation is not None:
                kwargs["use_textline_orientation"] = req.use_textline_orientation
            if req.text_rec_score_thresh is not None:
                kwargs["text_rec_score_thresh"] = req.text_rec_score_thresh

            with self._lock:
                output = self._pipeline.predict(temp_path, **kwargs)
                ocr_results: list[dict[str, Any]] = []
                for res in output:
                    page_json = getattr(res, "json", None)
                    if callable(page_json):
                        page_json = page_json()

                    if not isinstance(page_json, dict):
                        continue

                    pruned_result = page_json.get("res", page_json)
                    ocr_results.append(
                        {
                            "prunedResult": to_json_compatible(pruned_result),
                            "ocrImage": None,
                            "docPreprocessingImage": None,
                            "inputImage": None,
                        }
                    )

            return {
                "ocrResults": ocr_results,
                "dataInfo": {
                    "inputType": "image",
                    "pages": len(ocr_results),
                },
            }
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)


def to_json_compatible(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, dict):
        return {str(k): to_json_compatible(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_json_compatible(item) for item in value]

    if hasattr(value, "tolist"):
        return to_json_compatible(value.tolist())

    return str(value)


def parse_ocr_request(payload: Any) -> OCRRequest:
    if not isinstance(payload, dict):
        raise ValueError("请求体必须是 JSON 对象。")

    file_value = payload.get("file")
    if not isinstance(file_value, str) or not file_value.strip():
        raise ValueError("file 必须是非空 Base64 字符串。")

    if len(file_value) > MAX_BASE64_CHARS:
        raise ValueError("file 过大。")

    try:
        image_bytes = base64.b64decode(file_value, validate=True)
    except binascii.Error as exc:
        raise ValueError("file 不是合法的 Base64 字符串。") from exc

    if not image_bytes:
        raise ValueError("file 解码后为空。")

    file_type = payload.get("fileType", 1)
    if file_type is None:
        file_type = 1

    if file_type != 1:
        raise ValueError("当前服务仅支持图片输入，请将 fileType 设置为 1。")

    use_doc_orientation_classify = parse_optional_bool(
        payload.get("useDocOrientationClassify"), "useDocOrientationClassify"
    )
    use_doc_unwarping = parse_optional_bool(payload.get("useDocUnwarping"), "useDocUnwarping")
    use_textline_orientation = parse_optional_bool(
        payload.get("useTextlineOrientation"), "useTextlineOrientation"
    )
    text_rec_score_thresh = parse_optional_float_range(
        payload.get("textRecScoreThresh"),
        "textRecScoreThresh",
        min_value=0.0,
        max_value=1.0,
    )

    return OCRRequest(
        image_bytes=image_bytes,
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        use_textline_orientation=use_textline_orientation,
        text_rec_score_thresh=text_rec_score_thresh,
    )


def parse_optional_bool(value: Any, field: str) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field} 必须是布尔值。")


def parse_optional_float_range(value: Any, field: str, min_value: float, max_value: float) -> float | None:
    if value is None:
        return None

    if not isinstance(value, (int, float)):
        raise ValueError(f"{field} 必须是数值。")

    float_value = float(value)
    if float_value < min_value or float_value > max_value:
        raise ValueError(f"{field} 必须在 [{min_value}, {max_value}] 范围内。")

    return float_value


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class OCRRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "JKLLMOCRServer/0.1.0"

    ocr_service: OCRService
    logger = logging.getLogger("ppocrv5_http_server")

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ocr":
            self._write_error(HTTPStatus.NOT_FOUND, "接口不存在，仅支持 POST /ocr。")
            return

        try:
            content_length = self._read_content_length()
            if content_length > MAX_REQUEST_BODY_BYTES:
                self._write_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "请求体过大。")
                return

            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            req = parse_ocr_request(payload)
        except ValueError as exc:
            self._write_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except json.JSONDecodeError:
            self._write_error(HTTPStatus.BAD_REQUEST, "请求体不是合法 JSON。")
            return
        except Exception as exc:  # pragma: no cover - defensive
            self.logger.exception("解析请求失败")
            self._write_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"解析请求失败: {exc}")
            return

        try:
            result = self.ocr_service.infer(req)
        except Exception as exc:  # pragma: no cover - runtime error path
            self.logger.exception("OCR 推理失败")
            self._write_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"OCR 推理失败: {exc}")
            return

        response_body = {
            "logId": str(uuid.uuid4()),
            "errorCode": 0,
            "errorMsg": "Success",
            "result": result,
        }
        self._write_json(HTTPStatus.OK, response_body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._write_json(HTTPStatus.OK, {"status": "ok"})
            return
        self._write_error(HTTPStatus.METHOD_NOT_ALLOWED, "仅支持 POST /ocr。")

    def _read_content_length(self) -> int:
        value = self.headers.get("Content-Length")
        if value is None:
            raise ValueError("缺少 Content-Length 头。")

        try:
            content_length = int(value)
        except ValueError as exc:
            raise ValueError("Content-Length 非法。") from exc

        if content_length <= 0:
            raise ValueError("请求体不能为空。")

        return content_length

    def _write_error(self, status: HTTPStatus, message: str) -> None:
        body = {
            "logId": str(uuid.uuid4()),
            "errorCode": int(status),
            "errorMsg": message,
        }
        self._write_json(status, body)

    def _write_json(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt: str, *args: Any) -> None:
        self.logger.info("%s - %s", self.address_string(), fmt % args)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local PP-OCRv5 HTTP server.")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP server host")
    parser.add_argument("--port", type=int, default=8080, help="HTTP server port")
    parser.add_argument("--det-model-dir", required=True, help="PP-OCRv5_server_det model directory")
    parser.add_argument("--rec-model-dir", required=True, help="PP-OCRv5_server_rec model directory")
    parser.add_argument("--device", default="cpu", help="PaddleOCR device, e.g. cpu or gpu")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    return parser.parse_args()


def ensure_model_dir(path: str, name: str) -> None:
    if not os.path.isdir(path):
        raise SystemExit(f"{name} 不存在: {path}")


def main() -> None:
    args = parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    ensure_model_dir(args.det_model_dir, "检测模型目录")
    ensure_model_dir(args.rec_model_dir, "识别模型目录")

    logging.info("加载 PP-OCRv5_server 模型中，请稍候...")
    service = OCRService(args.det_model_dir, args.rec_model_dir, args.device)
    logging.info("模型加载完成")

    OCRRequestHandler.ocr_service = service
    server = ReusableThreadingHTTPServer((args.host, args.port), OCRRequestHandler)

    logging.info("服务启动成功: http://%s:%s/ocr", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("收到退出信号，准备停止服务")
    finally:
        server.server_close()
        logging.info("服务已停止")


if __name__ == "__main__":
    main()

