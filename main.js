var SUPPORTED_LANGUAGES = ['auto', 'zh-Hans', 'zh-Hant', 'en', 'ja'];
var SUPPORTED_LANGUAGE_SET = {
    'zh-Hans': true,
    'zh-Hant': true,
    en: true,
    ja: true,
};

var ERROR_TYPES = {
    unknown: true,
    param: true,
    unsupportedLanguage: true,
    secretKey: true,
    network: true,
    api: true,
    notFound: true,
};

var OCR_BACKEND_MODES = {
    local: true,
    cloud: true,
};

var DEFAULT_OCR_BACKEND_MODE = 'local';
var DEFAULT_SERVER_URL = 'http://127.0.0.1:50000/ocr';
var DEFAULT_CLOUD_BASE_URL = 'https://api.siliconflow.cn/v1';
var DEFAULT_CLOUD_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5';
var DEFAULT_CLOUD_PROMPT = '请识别图片中的全部文字，仅返回纯文本结果，保留原有换行，不要解释。';
var DEFAULT_CLOUD_IMAGE_DETAIL = 'high';
var CLOUD_IMAGE_DETAILS = {
    high: true,
    auto: true,
    low: true,
};

var DEFAULT_REQUEST_TIMEOUT_SEC = 30;
var MIN_REQUEST_TIMEOUT_SEC = 5;
var MAX_REQUEST_TIMEOUT_SEC = 180;
var MIN_PLUGIN_TIMEOUT_SEC = 30;
var MAX_PLUGIN_TIMEOUT_SEC = 300;
var DEFAULT_TEXT_REC_SCORE_THRESH = 0.0;

var MAX_IMAGE_BYTES = 30 * 1024 * 1024;
var MAX_TEXT_ITEMS = 500;
var MAX_TEXT_LENGTH = 2000;

function supportLanguages() {
    return SUPPORTED_LANGUAGES.slice();
}

function pluginTimeoutInterval() {
    var timeout = parseIntegerInRange(
        getOptionString('requestTimeoutSec', String(DEFAULT_REQUEST_TIMEOUT_SEC)),
        DEFAULT_REQUEST_TIMEOUT_SEC,
        MIN_REQUEST_TIMEOUT_SEC,
        MAX_REQUEST_TIMEOUT_SEC
    );

    return clamp(timeout + 10, MIN_PLUGIN_TIMEOUT_SEC, MAX_PLUGIN_TIMEOUT_SEC);
}

function pluginValidate(completion) {
    var done = onceCompletion(completion);
    var config = buildRuntimeConfig();
    if (!config.ok) {
        done({ result: false, error: config.error });
        return;
    }

    if (config.backendMode === 'cloud') {
        validateCloudBackend(config, done);
        return;
    }

    validateLocalBackend(config, done);
}

function validateLocalBackend(config, done) {
    $http.request({
        method: 'GET',
        url: buildLocalHealthUrl(config.serverUrl),
        timeout: clamp(config.requestTimeoutSec, 5, 10),
        handler: function (resp) {
            var healthResult = parseLocalHealthResponse(resp);
            if (healthResult.ok) {
                done({ result: true });
                return;
            }

            done({ result: false, error: healthResult.error });
        },
    });
}

function validateCloudBackend(config, done) {
    $http.request({
        method: 'GET',
        url: buildCloudModelsUrl(config.cloudBaseUrl),
        header: buildCloudHeaders(config.cloudApiKey),
        timeout: clamp(config.requestTimeoutSec, 5, 15),
        handler: function (resp) {
            var parsed = parseCloudValidationResponse(resp);
            if (parsed.ok) {
                done({ result: true });
                return;
            }
            done({ result: false, error: parsed.error });
        },
    });
}

function ocr(query, completion) {
    var done = onceCompletion(completion);

    var queryError = validateQuery(query);
    if (queryError) {
        done({ error: queryError });
        return;
    }

    var languageError = validateLanguage(query);
    if (languageError) {
        done({ error: languageError });
        return;
    }

    var config = buildRuntimeConfig();
    if (!config.ok) {
        done({ error: config.error });
        return;
    }

    var imageBase64 = safeToBase64(query.image);
    if (!imageBase64) {
        done({
            error: makeServiceError('param', '图片数据无法转换为 Base64，请重试。'),
        });
        return;
    }

    if (config.backendMode === 'cloud') {
        runCloudOcr(query, config, imageBase64, done);
        return;
    }

    runLocalOcr(query, config, imageBase64, done);
}

function runLocalOcr(query, config, imageBase64, done) {
    var requestBody = {
        file: imageBase64,
        fileType: 1,
        visualize: false,
        textRecScoreThresh: config.textRecScoreThresh,
        useDocOrientationClassify: config.useDocOrientationClassify,
        useDocUnwarping: config.useDocUnwarping,
        useTextlineOrientation: config.useTextlineOrientation,
    };

    $http.request({
        method: 'POST',
        url: config.serverUrl,
        header: {
            'Content-Type': 'application/json',
        },
        body: requestBody,
        timeout: config.requestTimeoutSec,
        handler: function (resp) {
            var parsed = parseLocalServerResponse(resp);
            if (!parsed.ok) {
                done({ error: parsed.error });
                return;
            }

            var texts = extractTexts(parsed.payload.result.ocrResults);
            if (texts.length === 0) {
                done({
                    error: makeServiceError('notFound', '未识别到可用文本。', {
                        logId: parsed.payload.logId,
                        result: parsed.payload.result,
                    }),
                });
                return;
            }

            var result = {
                texts: texts,
                raw: {
                    backendMode: 'local',
                    logId: parsed.payload.logId,
                    result: parsed.payload.result,
                },
            };

            var resultFrom = chooseResultLanguage(query);
            if (resultFrom) {
                result.from = resultFrom;
            }

            done({ result: result });
        },
    });
}

function runCloudOcr(query, config, imageBase64, done) {
    var cloudUrl = buildCloudChatCompletionsUrl(config.cloudBaseUrl);
    var imageUrl = buildImageDataUrl(imageBase64);

    var requestBody = {
        model: config.cloudModel,
        stream: false,
        temperature: 0,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: config.cloudPrompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: imageUrl,
                            detail: config.cloudImageDetail,
                        },
                    },
                ],
            },
        ],
    };

    $http.request({
        method: 'POST',
        url: cloudUrl,
        header: buildCloudHeaders(config.cloudApiKey),
        body: requestBody,
        timeout: config.requestTimeoutSec,
        handler: function (resp) {
            var parsed = parseCloudOcrResponse(resp);
            if (!parsed.ok) {
                done({ error: parsed.error });
                return;
            }

            var texts = splitCloudTextToTexts(parsed.payload.text);
            if (texts.length === 0) {
                done({
                    error: makeServiceError('notFound', '云端模型未返回可用文本。', {
                        cloudBaseUrl: config.cloudBaseUrl,
                        cloudModel: config.cloudModel,
                        response: parsed.payload.data,
                    }),
                });
                return;
            }

            var result = {
                texts: texts,
                raw: {
                    backendMode: 'cloud',
                    cloudBaseUrl: config.cloudBaseUrl,
                    cloudModel: config.cloudModel,
                    response: parsed.payload.data,
                },
            };

            var resultFrom = chooseResultLanguage(query);
            if (resultFrom) {
                result.from = resultFrom;
            }

            done({ result: result });
        },
    });
}

function validateQuery(query) {
    if (!isPlainObject(query)) {
        return makeServiceError('param', 'query 参数必须是对象。');
    }

    if (!$data.isData(query.image)) {
        return makeServiceError('param', 'query.image 必须是 $data 类型。');
    }

    if (query.image.length <= 0) {
        return makeServiceError('param', '图片数据为空。');
    }

    if (query.image.length > MAX_IMAGE_BYTES) {
        return makeServiceError('param', '图片过大，请控制在 30MB 以内。');
    }

    if (query.from !== undefined && typeof query.from !== 'string') {
        return makeServiceError('param', 'query.from 必须是字符串。');
    }

    if (query.detectFrom !== undefined && typeof query.detectFrom !== 'string') {
        return makeServiceError('param', 'query.detectFrom 必须是字符串。');
    }

    return null;
}

function validateLanguage(query) {
    var from = normalizeLanguageCode(query.from);
    if (from && from !== 'auto' && !isSupportedLanguage(from)) {
        return makeServiceError(
            'unsupportedLanguage',
            '该插件暂不支持源语言: ' + from,
            { supportedLanguages: supportLanguages() }
        );
    }

    return null;
}

function buildRuntimeConfig() {
    var requestTimeoutSec = parseIntegerInRange(
        getOptionString('requestTimeoutSec', String(DEFAULT_REQUEST_TIMEOUT_SEC)),
        DEFAULT_REQUEST_TIMEOUT_SEC,
        MIN_REQUEST_TIMEOUT_SEC,
        MAX_REQUEST_TIMEOUT_SEC
    );

    var backendMode = parseBackendMode(getOptionString('ocrBackendMode', DEFAULT_OCR_BACKEND_MODE));
    if (backendMode === 'cloud') {
        return buildCloudRuntimeConfig(requestTimeoutSec);
    }

    return buildLocalRuntimeConfig(requestTimeoutSec);
}

function buildLocalRuntimeConfig(requestTimeoutSec) {
    var serverUrlRaw = getOptionString('serverUrl', DEFAULT_SERVER_URL);
    var serverUrl = normalizeLocalServerUrl(serverUrlRaw);
    if (!serverUrl) {
        return {
            ok: false,
            error: makeServiceError(
                'param',
                'OCR 服务地址格式不正确，请填写 http:// 或 https:// 开头的地址。',
                { serverUrl: serverUrlRaw }
            ),
        };
    }

    var textRecScoreThresh = parseFloatInRange(
        getOptionString('textRecScoreThresh', String(DEFAULT_TEXT_REC_SCORE_THRESH)),
        DEFAULT_TEXT_REC_SCORE_THRESH,
        0,
        1
    );

    return {
        ok: true,
        backendMode: 'local',
        serverUrl: serverUrl,
        requestTimeoutSec: requestTimeoutSec,
        textRecScoreThresh: textRecScoreThresh,
        useDocOrientationClassify: parseMenuBoolean('useDocOrientationClassify', false),
        useDocUnwarping: parseMenuBoolean('useDocUnwarping', false),
        useTextlineOrientation: parseMenuBoolean('useTextlineOrientation', false),
    };
}

function buildCloudRuntimeConfig(requestTimeoutSec) {
    var cloudBaseUrlRaw = getOptionString('cloudBaseUrl', DEFAULT_CLOUD_BASE_URL);
    var cloudBaseUrl = normalizeCloudBaseUrl(cloudBaseUrlRaw);
    if (!cloudBaseUrl) {
        return {
            ok: false,
            error: makeServiceError(
                'param',
                '云端 Base URL 格式不正确，请填写 http:// 或 https:// 开头的地址。',
                { cloudBaseUrl: cloudBaseUrlRaw }
            ),
        };
    }

    var cloudApiKey = normalizeCloudApiKey(getOptionString('cloudApiKey', ''));
    if (!cloudApiKey) {
        return {
            ok: false,
            error: makeServiceError('secretKey', '云端 API Key 不能为空。'),
        };
    }

    var cloudModelRaw = getOptionString('cloudModel', DEFAULT_CLOUD_MODEL);
    var cloudModel = normalizeCloudModel(cloudModelRaw);
    if (!cloudModel) {
        return {
            ok: false,
            error: makeServiceError('param', '云端模型名格式不正确。', {
                cloudModel: cloudModelRaw,
            }),
        };
    }

    return {
        ok: true,
        backendMode: 'cloud',
        requestTimeoutSec: requestTimeoutSec,
        cloudBaseUrl: cloudBaseUrl,
        cloudApiKey: cloudApiKey,
        cloudModel: cloudModel,
        cloudImageDetail: parseCloudImageDetail('cloudImageDetail', DEFAULT_CLOUD_IMAGE_DETAIL),
        cloudPrompt: normalizeCloudPrompt(
            getOptionString('cloudPrompt', DEFAULT_CLOUD_PROMPT),
            DEFAULT_CLOUD_PROMPT
        ),
    };
}

function parseCloudValidationResponse(resp) {
    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', '云端健康检查返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求云端 OCR 健康检查失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = getResponseStatusCode(resp);
    if (statusCode === 200) {
        return { ok: true };
    }

    var remoteErrorMessage = extractRemoteErrorMessage(resp.data);
    var errorType = statusCode === 401 || statusCode === 403 ? 'secretKey' : 'api';
    var message = '云端 OCR 健康检查状态码异常: ' + statusCode;
    if (statusCode === 404) {
        message = '云端 OCR 健康检查失败（HTTP 404）。请确认 Base URL 是 OpenAI 兼容入口。';
        errorType = 'notFound';
    }
    if (remoteErrorMessage) {
        message += ' ' + remoteErrorMessage;
    }

    return {
        ok: false,
        error: makeServiceError(errorType, message, {
            statusCode: statusCode,
            data: resp.data,
        }),
    };
}

function parseCloudOcrResponse(resp) {
    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', '云端 OCR 返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求云端 OCR 服务失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = getResponseStatusCode(resp);
    if (statusCode !== 200) {
        var remoteErrorMessage = extractRemoteErrorMessage(resp.data);
        var errorType = statusCode === 401 || statusCode === 403 ? 'secretKey' : 'api';
        var message = '云端 OCR 服务返回异常状态码: ' + statusCode;
        if (statusCode === 404) {
            message = '云端 OCR 请求返回 HTTP 404，请检查 Base URL / 接口路径配置。';
            errorType = 'notFound';
        }
        if (remoteErrorMessage) {
            message += ' ' + remoteErrorMessage;
        }
        return {
            ok: false,
            error: makeServiceError(errorType, message, {
                statusCode: statusCode,
                data: resp.data,
            }),
        };
    }

    if (!isPlainObject(resp.data)) {
        return {
            ok: false,
            error: makeServiceError('api', '云端 OCR 响应不是合法 JSON 对象。', {
                data: resp.data,
            }),
        };
    }

    var text = extractCloudOcrText(resp.data);
    if (!text) {
        return {
            ok: false,
            error: makeServiceError('notFound', '云端模型没有返回可解析文本。', {
                data: resp.data,
            }),
        };
    }

    return {
        ok: true,
        payload: {
            text: text,
            data: resp.data,
        },
    };
}

function parseLocalServerResponse(resp) {
    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', '网络层返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求本地 OCR 服务失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = getResponseStatusCode(resp);
    if (statusCode !== 200) {
        return {
            ok: false,
            error: makeServiceError(
                'network',
                '本地 OCR 服务返回异常状态码: ' + statusCode,
                {
                    statusCode: statusCode,
                    data: resp.data,
                }
            ),
        };
    }

    if (!isPlainObject(resp.data)) {
        return {
            ok: false,
            error: makeServiceError('api', 'OCR 服务响应不是合法 JSON 对象。', {
                data: resp.data,
            }),
        };
    }

    var data = resp.data;
    if (data.errorCode !== 0) {
        return {
            ok: false,
            error: makeServiceError(
                'api',
                stringOrDefault(data.errorMsg, 'OCR 服务返回错误。'),
                {
                    errorCode: data.errorCode,
                    logId: data.logId,
                }
            ),
        };
    }

    if (!isPlainObject(data.result) || !Array.isArray(data.result.ocrResults)) {
        return {
            ok: false,
            error: makeServiceError('api', 'OCR 服务结果结构不符合预期。', {
                result: data.result,
            }),
        };
    }

    return {
        ok: true,
        payload: {
            logId: data.logId,
            result: data.result,
        },
    };
}

function parseLocalHealthResponse(resp) {
    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', '健康检查返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求本地 OCR 健康检查失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = getResponseStatusCode(resp);
    if (statusCode !== 200) {
        return {
            ok: false,
            error: makeServiceError(
                'network',
                '本地 OCR 健康检查状态码异常: ' + statusCode,
                {
                    statusCode: statusCode,
                    data: resp.data,
                }
            ),
        };
    }

    if (!isPlainObject(resp.data) || resp.data.status !== 'ok') {
        return {
            ok: false,
            error: makeServiceError('api', '本地 OCR 健康检查返回非预期内容。', {
                data: resp.data,
            }),
        };
    }

    return { ok: true };
}

function extractTexts(ocrResults) {
    var texts = [];
    var i;
    for (i = 0; i < ocrResults.length; i += 1) {
        var page = ocrResults[i];
        if (!isPlainObject(page)) {
            continue;
        }

        var prunedResult = page.prunedResult;
        if (!isPlainObject(prunedResult)) {
            continue;
        }

        var recTexts = prunedResult.rec_texts;
        if (!Array.isArray(recTexts)) {
            continue;
        }

        var j;
        for (j = 0; j < recTexts.length; j += 1) {
            if (texts.length >= MAX_TEXT_ITEMS) {
                return texts;
            }

            var normalized = normalizeExtractedText(recTexts[j]);
            if (!normalized) {
                continue;
            }
            texts.push({ text: normalized });
        }
    }

    return texts;
}

function extractCloudOcrText(data) {
    if (!isPlainObject(data)) {
        return '';
    }

    if (typeof data.output_text === 'string') {
        return cleanupCloudText(data.output_text);
    }
    if (typeof data.result === 'string') {
        return cleanupCloudText(data.result);
    }

    if (Array.isArray(data.output)) {
        var outputParts = [];
        var i;
        for (i = 0; i < data.output.length; i += 1) {
            var outputItem = data.output[i];
            if (!isPlainObject(outputItem)) {
                continue;
            }

            if (outputItem.type === 'message') {
                var outputMessageText = extractTextFromMessageContent(outputItem.content);
                if (outputMessageText) {
                    outputParts.push(outputMessageText);
                }
                continue;
            }

            if (typeof outputItem.text === 'string') {
                outputParts.push(outputItem.text);
            }
        }

        if (outputParts.length > 0) {
            return cleanupCloudText(outputParts.join('\n'));
        }
    }

    if (Array.isArray(data.choices) && data.choices.length > 0) {
        var firstChoice = data.choices[0];
        if (isPlainObject(firstChoice)) {
            if (isPlainObject(firstChoice.message)) {
                var textFromMessage = extractTextFromMessageContent(firstChoice.message.content);
                if (textFromMessage) {
                    return cleanupCloudText(textFromMessage);
                }
                if (typeof firstChoice.message.text === 'string') {
                    return cleanupCloudText(firstChoice.message.text);
                }
            }

            if (typeof firstChoice.text === 'string') {
                return cleanupCloudText(firstChoice.text);
            }
        }
    }

    return '';
}

function splitCloudTextToTexts(text) {
    var normalized = cleanupCloudText(text);
    if (!normalized) {
        return [];
    }

    var lines = normalized.split('\n');
    var texts = [];
    var i;
    for (i = 0; i < lines.length; i += 1) {
        if (texts.length >= MAX_TEXT_ITEMS) {
            break;
        }

        var line = normalizeExtractedText(lines[i]);
        if (!line) {
            continue;
        }

        texts.push({ text: line });
    }

    if (texts.length === 0) {
        var single = normalizeExtractedText(normalized);
        if (single) {
            texts.push({ text: single });
        }
    }

    return texts;
}

function extractTextFromMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        var parts = [];
        var i;
        for (i = 0; i < content.length; i += 1) {
            var item = content[i];
            if (typeof item === 'string') {
                parts.push(item);
                continue;
            }
            if (!isPlainObject(item)) {
                continue;
            }

            if (typeof item.text === 'string') {
                parts.push(item.text);
                continue;
            }
            if (typeof item.output_text === 'string') {
                parts.push(item.output_text);
                continue;
            }
            if (typeof item.content === 'string') {
                parts.push(item.content);
                continue;
            }
            if (Array.isArray(item.content)) {
                var nested = extractTextFromMessageContent(item.content);
                if (nested) {
                    parts.push(nested);
                }
            }
        }
        return parts.join('\n');
    }

    if (isPlainObject(content)) {
        if (typeof content.text === 'string') {
            return content.text;
        }
        if (Array.isArray(content.content)) {
            return extractTextFromMessageContent(content.content);
        }
    }

    return '';
}

function cleanupCloudText(text) {
    if (typeof text !== 'string') {
        return '';
    }

    var normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) {
        return '';
    }

    normalized = normalized
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();

    if (/^```/.test(normalized) && /```$/.test(normalized)) {
        normalized = normalized
            .replace(/^```[A-Za-z0-9_\-]*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
    }

    return normalized;
}

function chooseResultLanguage(query) {
    var from = normalizeLanguageCode(query.from);
    if (from && from !== 'auto' && isSupportedLanguage(from)) {
        return from;
    }

    var detectFrom = normalizeLanguageCode(query.detectFrom);
    if (detectFrom && isSupportedLanguage(detectFrom)) {
        return detectFrom;
    }

    return null;
}

function safeToBase64(data) {
    try {
        var base64 = data.toBase64();
        if (typeof base64 !== 'string' || base64.length === 0) {
            return null;
        }
        return base64;
    } catch (error) {
        $log.error('toBase64 failed', error);
        return null;
    }
}

function makeServiceError(type, message, addition, troubleshootingLink) {
    var errorType = ERROR_TYPES[type] ? type : 'unknown';
    var errorMessage = normalizeErrorMessage(message);

    var error = {
        type: errorType,
        message: errorMessage,
    };

    if (addition !== undefined) {
        error.addition = addition;
    }

    if (typeof troubleshootingLink === 'string' && troubleshootingLink.length > 0) {
        error.troubleshootingLink = troubleshootingLink;
    }

    return error;
}

function normalizeErrorMessage(message) {
    if (typeof message !== 'string') {
        return '未知错误';
    }

    var trimmed = message.trim();
    if (!trimmed) {
        return '未知错误';
    }

    if (trimmed.length > 500) {
        return trimmed.slice(0, 500);
    }

    return trimmed;
}

function normalizeExtractedText(text) {
    if (typeof text !== 'string') {
        return null;
    }

    var normalized = text.trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length > MAX_TEXT_LENGTH) {
        normalized = normalized.slice(0, MAX_TEXT_LENGTH);
    }

    return normalized;
}

function parseBackendMode(value) {
    if (typeof value !== 'string') {
        return DEFAULT_OCR_BACKEND_MODE;
    }

    var normalized = value.trim().toLowerCase();
    if (!OCR_BACKEND_MODES[normalized]) {
        return DEFAULT_OCR_BACKEND_MODE;
    }

    return normalized;
}

function normalizeLocalServerUrl(input) {
    var value = normalizeHttpUrl(input);
    if (!value) {
        return null;
    }

    if (!/\/ocr$/.test(value)) {
        value += '/ocr';
    }

    return value;
}

function normalizeCloudBaseUrl(input) {
    return normalizeHttpUrl(input);
}

function normalizeHttpUrl(input) {
    if (typeof input !== 'string') {
        return null;
    }

    var value = input.trim();
    if (value.length < 10 || value.length > 2048) {
        return null;
    }

    if (!/^https?:\/\/[A-Za-z0-9._:-]+(\/.*)?$/.test(value)) {
        return null;
    }

    return value.replace(/\/+$/, '');
}

function normalizeCloudApiKey(input) {
    if (typeof input !== 'string') {
        return '';
    }

    var value = input.trim();
    if (value.length < 8 || value.length > 4096) {
        return '';
    }

    return value;
}

function normalizeCloudModel(input) {
    if (typeof input !== 'string') {
        return '';
    }

    var value = input.trim();
    if (value.length < 2 || value.length > 200) {
        return '';
    }

    return value;
}

function normalizeCloudPrompt(input, fallback) {
    if (typeof input !== 'string') {
        return fallback;
    }

    var value = input.trim();
    if (!value) {
        return fallback;
    }

    if (value.length > 500) {
        return value.slice(0, 500);
    }

    return value;
}

function parseCloudImageDetail(identifier, fallback) {
    var value = getOptionString(identifier, fallback).toLowerCase();
    if (CLOUD_IMAGE_DETAILS[value]) {
        return value;
    }
    return fallback;
}

function buildLocalHealthUrl(serverUrl) {
    if (typeof serverUrl !== 'string') {
        return '';
    }
    return serverUrl.replace(/\/ocr$/, '/healthz');
}

function buildCloudChatCompletionsUrl(baseUrl) {
    if (typeof baseUrl !== 'string') {
        return '';
    }

    if (/\/chat\/completions$/.test(baseUrl)) {
        return baseUrl;
    }

    return baseUrl + '/chat/completions';
}

function buildCloudModelsUrl(baseUrl) {
    if (typeof baseUrl !== 'string') {
        return '';
    }

    if (/\/chat\/completions$/.test(baseUrl)) {
        return baseUrl.replace(/\/chat\/completions$/, '/models');
    }

    return baseUrl + '/models';
}

function buildCloudHeaders(apiKey) {
    return {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
    };
}

function buildImageDataUrl(imageBase64) {
    return 'data:image/png;base64,' + imageBase64;
}

function getResponseStatusCode(resp) {
    if (!isPlainObject(resp) || !isPlainObject(resp.response)) {
        return 0;
    }

    var statusCode = resp.response.statusCode;
    if (typeof statusCode !== 'number') {
        return 0;
    }

    return statusCode;
}

function extractRemoteErrorMessage(data) {
    if (typeof data === 'string') {
        return data.trim();
    }

    if (!isPlainObject(data)) {
        return '';
    }

    if (typeof data.message === 'string' && data.message.trim()) {
        return data.message.trim();
    }

    if (isPlainObject(data.error)) {
        if (typeof data.error.message === 'string' && data.error.message.trim()) {
            return data.error.message.trim();
        }
        if (typeof data.error.code === 'string' && data.error.code.trim()) {
            return data.error.code.trim();
        }
    }

    return '';
}

function parseIntegerInRange(input, fallback, min, max) {
    if (typeof input !== 'string' || !/^-?[0-9]+$/.test(input.trim())) {
        return fallback;
    }

    var value = parseInt(input, 10);
    if (!isFinite(value)) {
        return fallback;
    }

    return clamp(value, min, max);
}

function parseFloatInRange(input, fallback, min, max) {
    if (typeof input !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(input.trim())) {
        return fallback;
    }

    var value = parseFloat(input);
    if (!isFinite(value)) {
        return fallback;
    }

    return clamp(value, min, max);
}

function parseMenuBoolean(identifier, fallback) {
    var value = getOptionString(identifier, fallback ? 'true' : 'false').toLowerCase();
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    return fallback;
}

function getOptionString(identifier, fallback) {
    var value = $option[identifier];
    if (typeof value !== 'string') {
        return fallback;
    }

    var normalized = value.trim();
    if (!normalized) {
        return fallback;
    }

    return normalized;
}

function normalizeLanguageCode(languageCode) {
    if (typeof languageCode !== 'string') {
        return '';
    }

    var normalized = languageCode.trim();
    if (!normalized) {
        return '';
    }

    if (normalized.length > 20) {
        return '';
    }

    return normalized;
}

function isSupportedLanguage(languageCode) {
    return !!SUPPORTED_LANGUAGE_SET[languageCode];
}

function onceCompletion(completion) {
    var called = false;

    return function (payload) {
        if (called) {
            return;
        }
        called = true;
        completion(payload);
    };
}

function isPlainObject(obj) {
    return !!obj && typeof obj === 'object' && !Array.isArray(obj);
}

function stringOrDefault(value, fallback) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return fallback;
}

function clamp(value, min, max) {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
