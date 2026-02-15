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

var DEFAULT_SERVER_URL = 'http://127.0.0.1:50000/ocr';
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

    $http.request({
        method: 'GET',
        url: buildHealthUrl(config.serverUrl),
        timeout: clamp(config.requestTimeoutSec, 5, 10),
        handler: function (resp) {
            var healthResult = parseHealthResponse(resp);
            if (healthResult.ok) {
                done({ result: true });
                return;
            }

            done({ result: false, error: healthResult.error });
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
            var parsed = parseServerResponse(resp);
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
    var serverUrlRaw = getOptionString('serverUrl', DEFAULT_SERVER_URL);
    var serverUrl = normalizeServerUrl(serverUrlRaw);
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

    var requestTimeoutSec = parseIntegerInRange(
        getOptionString('requestTimeoutSec', String(DEFAULT_REQUEST_TIMEOUT_SEC)),
        DEFAULT_REQUEST_TIMEOUT_SEC,
        MIN_REQUEST_TIMEOUT_SEC,
        MAX_REQUEST_TIMEOUT_SEC
    );

    var textRecScoreThresh = parseFloatInRange(
        getOptionString('textRecScoreThresh', String(DEFAULT_TEXT_REC_SCORE_THRESH)),
        DEFAULT_TEXT_REC_SCORE_THRESH,
        0,
        1
    );
    var useDocOrientationClassify = parseMenuBoolean('useDocOrientationClassify', false);
    var useDocUnwarping = parseMenuBoolean('useDocUnwarping', false);
    var useTextlineOrientation = parseMenuBoolean('useTextlineOrientation', false);

    return {
        ok: true,
        serverUrl: serverUrl,
        requestTimeoutSec: requestTimeoutSec,
        textRecScoreThresh: textRecScoreThresh,
        useDocOrientationClassify: useDocOrientationClassify,
        useDocUnwarping: useDocUnwarping,
        useTextlineOrientation: useTextlineOrientation,
    };
}

function parseServerResponse(resp) {
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

    var statusCode = resp.response && resp.response.statusCode;
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

function parseHealthResponse(resp) {
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

    var statusCode = resp.response && resp.response.statusCode;
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

function normalizeServerUrl(input) {
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

    value = value.replace(/\/+$/, '');
    if (!/\/ocr$/.test(value)) {
        value += '/ocr';
    }

    return value;
}

function buildHealthUrl(serverUrl) {
    if (typeof serverUrl !== 'string') {
        return '';
    }
    return serverUrl.replace(/\/ocr$/, '/healthz');
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
