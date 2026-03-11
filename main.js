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

var SERVICE_MODE_SET = {
    local: true,
    providerCloud: true,
    cloudAsync: true,
};

var CLOUD_ASYNC_MODEL_SET = {
    auto: true,
    'PaddleOCR-VL-1.5': true,
    'PaddleOCR-VL': true,
    custom: true,
};

var ASYNC_JSON_DOWNLOAD_STRATEGY_SET = {
    directOnly: true,
    directThenRelay: true,
    relayOnly: true,
};

var CLOUD_ASYNC_MODEL_CANDIDATES = ['PaddleOCR-VL-1.5', 'PaddleOCR-VL'];

var DEFAULT_SERVER_URL = 'http://127.0.0.1:50000/ocr';
var DEFAULT_BAIDU_SERVER_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr';
var DEFAULT_SERVICE_MODE = 'local';
var DEFAULT_CLOUD_MODEL_NAME = 'auto';
var DEFAULT_CLOUD_BASE_URL = 'https://api.siliconflow.cn/v1';
var DEFAULT_CLOUD_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5';
var DEFAULT_CLOUD_PROMPT = '请识别图片中的全部文字，仅返回纯文本结果，保留原有换行，不要解释。';
var DEFAULT_CLOUD_IMAGE_DETAIL = 'high';
var CLOUD_IMAGE_DETAILS = {
    high: true,
    auto: true,
    low: true,
};
var DEFAULT_ASYNC_RESULT_RELAY_URL = 'http://127.0.0.1:50123/fetch-jsonl';
var DEFAULT_ASYNC_JSON_DOWNLOAD_STRATEGY = 'relayOnly';
var DEFAULT_REQUEST_TIMEOUT_SEC = 60;
var MIN_REQUEST_TIMEOUT_SEC = 5;
var MAX_REQUEST_TIMEOUT_SEC = 180;
var MIN_PLUGIN_TIMEOUT_SEC = 30;
var MAX_PLUGIN_TIMEOUT_SEC = 300;
var DEFAULT_TEXT_REC_SCORE_THRESH = 0.0;

var MAX_IMAGE_BYTES = 30 * 1024 * 1024;
var MAX_TEXT_ITEMS = 500;
var MAX_TEXT_LENGTH = 2000;
var ASYNC_POLL_INTERVAL_SEC = 3;

var VALIDATION_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

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

    if (config.serviceMode === 'providerCloud') {
        validateCloudBackend(config, done);
        return;
    }

    if (config.serviceMode === 'cloudAsync') {
        validateAsyncJob(config, done);
        return;
    }

    var body = {
        file: VALIDATION_IMAGE_BASE64,
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
        header: buildRequestHeaders(config),
        body: body,
        timeout: clamp(config.requestTimeoutSec, 5, 10),
        handler: function (resp) {
            var validateResult = parseServerResponse(resp, config);
            if (validateResult.ok) {
                done({ result: true });
                return;
            }

            done({ result: false, error: validateResult.error });
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

    if (config.serviceMode === 'cloudAsync') {
        ocrWithAsyncJob(query, config, done);
        return;
    }

    var imageBase64 = safeToBase64(query.image);
    if (!imageBase64) {
        done({
            error: makeServiceError('param', '图片数据无法转换为 Base64，请重试。'),
        });
        return;
    }

    if (config.serviceMode === 'providerCloud') {
        var openAiFileValidation = validateOpenAiCompatibleInputFile(imageBase64);
        if (!openAiFileValidation.ok) {
            done({ error: openAiFileValidation.error });
            return;
        }

        runCloudOcr(query, config, imageBase64, done);
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
        header: buildRequestHeaders(config),
        body: requestBody,
        timeout: config.requestTimeoutSec,
        handler: function (resp) {
            var parsed = parseServerResponse(resp, config);
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

function runCloudOcr(query, config, imageBase64, done) {
    var cloudUrl = buildCloudChatCompletionsUrl(config.cloudBaseUrl);
    var imageUrl = buildImageDataUrl(imageBase64, detectBase64FileKind(imageBase64));

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
                    backendMode: 'providerCloud',
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

function validateOpenAiCompatibleInputFile(imageBase64) {
    var fileKind = detectBase64FileKind(imageBase64);
    if (fileKind === 'png' || fileKind === 'jpg') {
        return { ok: true };
    }

    var message =
        '云端服务商 OCR 当前仅支持 PNG/JPG 图片输入。请改用 PNG/JPG 截图。';
    if (fileKind === 'pdf') {
        message = '云端服务商 OCR 当前不支持 PDF 作为 image_url。请改用 PNG/JPG。';
    }

    return {
        ok: false,
        error: makeServiceError('param', message, {
            detectedKind: fileKind,
            hint: '若你使用的是 macOS 剪贴板截图，可能是 TIFF/HEIC。',
        }),
    };
}

function buildRuntimeConfig() {
    var serviceMode = parseMenuChoice('serviceMode', DEFAULT_SERVICE_MODE, SERVICE_MODE_SET);
    var requestTimeoutSec = parseIntegerInRange(
        getOptionString('requestTimeoutSec', String(DEFAULT_REQUEST_TIMEOUT_SEC)),
        DEFAULT_REQUEST_TIMEOUT_SEC,
        MIN_REQUEST_TIMEOUT_SEC,
        MAX_REQUEST_TIMEOUT_SEC
    );

    if (serviceMode === 'providerCloud') {
        return buildProviderCloudRuntimeConfig(serviceMode, requestTimeoutSec);
    }

    var serverUrlRaw = resolveServerUrlOption(serviceMode);
    var serverUrl = normalizeServerUrl(serverUrlRaw, serviceMode);
    if (!serverUrl) {
        return {
            ok: false,
            error: makeServiceError(
                'param',
                buildServerUrlErrorMessage(serviceMode),
                { serverUrl: serverUrlRaw }
            ),
        };
    }

    var accessToken = getOptionString('accessToken', '');
    if (serviceMode === 'cloudAsync' && !accessToken) {
        return {
            ok: false,
            error: makeServiceError(
                'secretKey',
                '百度异步 jobs 模式必须填写访问令牌。',
                null,
                'https://ai.baidu.com/ai-doc/AISTUDIO/slmkadt9z'
            ),
        };
    }

    var textRecScoreThresh = parseFloatInRange(
        getOptionString('textRecScoreThresh', String(DEFAULT_TEXT_REC_SCORE_THRESH)),
        DEFAULT_TEXT_REC_SCORE_THRESH,
        0,
        1
    );

    var useDocOrientationClassify = parseMenuBoolean('useDocOrientationClassify', false);
    var useDocUnwarping = parseMenuBoolean('useDocUnwarping', false);
    var useTextlineOrientation = parseMenuBoolean('useTextlineOrientation', false);
    var useChartRecognition = parseMenuBoolean('useChartRecognition', false);
    var cloudModelPreset = parseMenuChoice('cloudModelPreset', DEFAULT_CLOUD_MODEL_NAME, CLOUD_ASYNC_MODEL_SET);
    var cloudCustomModelName = getOptionString('cloudCustomModelName', '');
    var asyncJsonDownloadStrategy = parseMenuChoice(
        'asyncJsonDownloadStrategy',
        DEFAULT_ASYNC_JSON_DOWNLOAD_STRATEGY,
        ASYNC_JSON_DOWNLOAD_STRATEGY_SET
    );
    var asyncResultRelayUrlRaw = getOptionStringAllowEmpty(
        'asyncResultRelayUrl',
        DEFAULT_ASYNC_RESULT_RELAY_URL
    );
    var asyncResultRelayUrl = '';

    if (serviceMode === 'cloudAsync' && cloudModelPreset === 'custom' && !cloudCustomModelName) {
        return {
            ok: false,
            error: makeServiceError(
                'param',
                '你已选择“自定义模型 ID”，但未填写自定义模型名。'
            ),
        };
    }

    if (serviceMode === 'cloudAsync' && asyncJsonDownloadStrategy !== 'directOnly') {
        if (!asyncResultRelayUrlRaw) {
            return {
                ok: false,
                error: makeServiceError(
                    'param',
                    '[百度异步] 当前结果下载策略需要填写 Relay 地址。',
                    { asyncJsonDownloadStrategy: asyncJsonDownloadStrategy }
                ),
            };
        }

        asyncResultRelayUrl = normalizeRelayUrl(asyncResultRelayUrlRaw);
        if (!asyncResultRelayUrl) {
            return {
                ok: false,
                error: makeServiceError(
                    'param',
                    '异步结果 Relay 地址格式不正确，请填写 http:// 或 https:// 开头的地址，或留空禁用。',
                    { asyncResultRelayUrl: asyncResultRelayUrlRaw }
                ),
            };
        }
    }

    return {
        ok: true,
        serviceMode: serviceMode,
        serverUrl: serverUrl,
        accessToken: accessToken,
        cloudModelPreset: cloudModelPreset,
        cloudCustomModelName: cloudCustomModelName,
        asyncJsonDownloadStrategy: asyncJsonDownloadStrategy,
        asyncResultRelayUrl: asyncResultRelayUrl,
        requestTimeoutSec: requestTimeoutSec,
        textRecScoreThresh: textRecScoreThresh,
        useDocOrientationClassify: useDocOrientationClassify,
        useDocUnwarping: useDocUnwarping,
        useTextlineOrientation: useTextlineOrientation,
        useChartRecognition: useChartRecognition,
    };
}

function buildProviderCloudRuntimeConfig(serviceMode, requestTimeoutSec) {
    var cloudApiKey = normalizeCloudApiKey(getOptionString('cloudApiKey', ''));
    if (!cloudApiKey) {
        return {
            ok: false,
            error: makeServiceError('secretKey', '服务商云端 API Key 不能为空。'),
        };
    }

    var cloudBaseUrlRaw = getOptionString('cloudBaseUrl', DEFAULT_CLOUD_BASE_URL);
    var cloudBaseUrl = normalizeCloudBaseUrl(cloudBaseUrlRaw);
    if (!cloudBaseUrl) {
        return {
            ok: false,
            error: makeServiceError(
                'param',
                '服务商 Base URL 格式不正确，请填写 http:// 或 https:// 开头的地址。',
                { cloudBaseUrl: cloudBaseUrlRaw }
            ),
        };
    }

    var cloudModelRaw = getOptionString('cloudModel', DEFAULT_CLOUD_MODEL);
    var cloudModel = normalizeCloudModel(cloudModelRaw);
    if (!cloudModel) {
        return {
            ok: false,
            error: makeServiceError('param', '服务商模型名格式不正确。', {
                cloudModel: cloudModelRaw,
            }),
        };
    }

    return {
        ok: true,
        serviceMode: serviceMode,
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

function buildRequestHeaders(config) {
    var headers = {};

    if (config && config.serviceMode === 'cloudAsync') {
        headers.Authorization = 'bearer ' + config.accessToken;
        return headers;
    }

    headers['Content-Type'] = 'application/json';

    return headers;
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

function validateAsyncJob(config, done) {
    var validationData = validationImageData();
    if (!validationData) {
        done({
            result: false,
            error: makeServiceError('param', '插件内置校验图片生成失败。'),
        });
        return;
    }

    submitAsyncJob(validationData, config, function (submitted) {
        if (!submitted.ok) {
            done({ result: false, error: submitted.error });
            return;
        }

        done({ result: true });
    });
}

function ocrWithAsyncJob(query, config, done) {
    submitAsyncJob(query.image, config, function (submitted) {
        if (!submitted.ok) {
            done({ error: submitted.error });
            return;
        }

        pollAsyncJob(submitted.jobId, config, new Date().getTime(), function (polled) {
            if (!polled.ok) {
                done({ error: polled.error });
                return;
            }

            var result = {
                texts: polled.texts,
                raw: {
                    jobId: submitted.jobId,
                    selectedModel: submitted.model,
                    jsonUrl: polled.jsonUrl,
                    pageCount: polled.pageCount,
                },
            };

            var resultFrom = chooseResultLanguage(query);
            if (resultFrom) {
                result.from = resultFrom;
            }

            done({ result: result });
        });
    });
}

function submitAsyncJob(fileData, config, done) {
    var fileMeta = detectUploadFileMeta(fileData);
    if (!fileMeta) {
        done({
            ok: false,
            error: makeServiceError('param', '当前图片格式无法用于百度异步文档解析 jobs。仅支持 PNG/JPG/PDF。'),
        });
        return;
    }

    submitAsyncJobWithModels(fileData, fileMeta, config, buildCloudModelsToTry(config), 0, done);
}

function submitAsyncJobWithModels(fileData, fileMeta, config, modelsToTry, index, done) {
    var model = modelsToTry[index];
    if (!model) {
        done({
            ok: false,
            error: makeServiceError('api', '自动检测失败：当前 token 下未探测到可用云端模型。', {
                triedModels: modelsToTry.slice(),
            }),
        });
        return;
    }

    var optionalPayload = JSON.stringify(buildAsyncOptionalPayload(config));
    var multipart = buildMultipartBody(model, optionalPayload, fileData, fileMeta);
    if (!multipart) {
        done({
            ok: false,
            error: makeServiceError('param', '构造 multipart 请求体失败。'),
        });
        return;
    }

    $http.request({
        method: 'POST',
        url: config.serverUrl,
        header: buildAsyncMultipartHeaders(config, multipart.contentType),
        body: multipart.bodyData,
        timeout: clamp(config.requestTimeoutSec, MIN_REQUEST_TIMEOUT_SEC, MAX_REQUEST_TIMEOUT_SEC),
        handler: function (resp) {
            var created = parseAsyncJobCreateResponse(resp, config);
            if (!created.ok && shouldRetryWithNextModel(config, created.error, modelsToTry, index)) {
                submitAsyncJobWithModels(fileData, fileMeta, config, modelsToTry, index + 1, done);
                return;
            }

            if (!created.ok) {
                done(created);
                return;
            }

            created.model = model;
            done(created);
        },
    });
}

function buildAsyncMultipartHeaders(config, contentType) {
    var headers = {
        Authorization: 'bearer ' + config.accessToken,
        'Content-Type': contentType,
    };
    return headers;
}

function buildMultipartBody(model, optionalPayload, fileData, fileMeta) {
    if (typeof model !== 'string' || !model) {
        return null;
    }
    if (typeof optionalPayload !== 'string') {
        return null;
    }
    if (!$data.isData(fileData)) {
        return null;
    }
    if (!fileMeta || typeof fileMeta.filename !== 'string' || typeof fileMeta.contentType !== 'string') {
        return null;
    }

    var boundary = '----BobPluginBoundary' + String(new Date().getTime());
    var CRLF = '\r\n';
    var body = $data.fromUTF8('');
    if (!$data.isData(body)) {
        return null;
    }

    // model field
    body.appendData(
        $data.fromUTF8(
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="model"' + CRLF + CRLF +
            model + CRLF
        )
    );

    // optionalPayload field
    body.appendData(
        $data.fromUTF8(
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="optionalPayload"' + CRLF + CRLF +
            optionalPayload + CRLF
        )
    );

    // file field header
    body.appendData(
        $data.fromUTF8(
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="file"; filename="' + fileMeta.filename + '"' + CRLF +
            'Content-Type: ' + fileMeta.contentType + CRLF + CRLF
        )
    );
    body.appendData(fileData);
    body.appendData($data.fromUTF8(CRLF));

    // closing boundary
    body.appendData($data.fromUTF8('--' + boundary + '--' + CRLF));

    return {
        bodyData: body,
        contentType: 'multipart/form-data; boundary=' + boundary,
    };
}

function buildCloudModelsToTry(config) {
    if (config.cloudModelPreset === 'auto') {
        return CLOUD_ASYNC_MODEL_CANDIDATES.slice();
    }

    if (config.cloudModelPreset === 'custom') {
        return [config.cloudCustomModelName];
    }

    return [config.cloudModelPreset];
}

function shouldRetryWithNextModel(config, error, modelsToTry, index) {
    if (!config || config.cloudModelPreset !== 'auto') {
        return false;
    }

    if (!isModelParameterError(error)) {
        return false;
    }

    return index + 1 < modelsToTry.length;
}

function isModelParameterError(error) {
    return !!(error && typeof error.message === 'string' && error.message.indexOf('模型传参错误') !== -1);
}

function buildAsyncOptionalPayload(config) {
    return {
        useDocOrientationClassify: !!config.useDocOrientationClassify,
        useDocUnwarping: !!config.useDocUnwarping,
        useChartRecognition: !!config.useChartRecognition,
    };
}

function parseAsyncJobCreateResponse(resp, config) {
    var serviceLabel = getServiceLabel(config);

    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', serviceLabel + '网络层返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求' + serviceLabel + '失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = resp.response && resp.response.statusCode;
    if (statusCode !== 200) {
        var troubleshooting = asyncJobsTroubleshootingLink(statusCode, resp.data);
        return {
            ok: false,
            error: makeServiceError(
                statusCode === 401 || statusCode === 403 ? 'secretKey' : 'network',
                serviceLabel + '返回异常状态码: ' + statusCode + appendUpstreamErrorSuffix(resp.data) + asyncJobsTroubleshootingSuffix(statusCode, resp.data),
                {
                    statusCode: statusCode,
                    data: resp.data,
                },
                troubleshooting
            ),
        };
    }

    if (!isPlainObject(resp.data) || !isPlainObject(resp.data.data)) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '提交成功但返回结构不符合预期。', {
                data: resp.data,
            }),
        };
    }

    var jobId = stringOrDefault(resp.data.data.jobId, '');
    if (!jobId) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '未返回 jobId。', {
                data: resp.data,
            }),
        };
    }

    return {
        ok: true,
        jobId: jobId,
    };
}

function pollAsyncJob(jobId, config, startedAtMs, done) {
    var elapsedSec = elapsedSeconds(startedAtMs);
    if (elapsedSec >= config.requestTimeoutSec) {
        done({
            ok: false,
            error: makeServiceError('network', '百度异步文档解析 jobs 轮询超时。', {
                jobId: jobId,
                timeoutSec: config.requestTimeoutSec,
            }),
        });
        return;
    }

    $http.request({
        method: 'GET',
        url: config.serverUrl + '/' + encodeURIComponent(jobId),
        header: buildRequestHeaders(config),
        timeout: singleAsyncRequestTimeout(config, startedAtMs),
        handler: function (resp) {
            var polled = parseAsyncJobStatusResponse(resp, config);
            if (!polled.ok) {
                done(polled);
                return;
            }

            if (polled.state === 'pending' || polled.state === 'running') {
                scheduleAsyncPoll(jobId, config, startedAtMs, done);
                return;
            }

            if (polled.state !== 'done') {
                done({
                    ok: false,
                    error: makeServiceError('api', '百度异步文档解析 jobs 返回未知状态: ' + polled.state, {
                        jobId: jobId,
                        data: polled.data,
                    }),
                });
                return;
            }

            downloadAsyncJsonResult(polled.jsonUrl, config, startedAtMs, function (downloaded) {
                if (!downloaded.ok) {
                    done(downloaded);
                    return;
                }

                downloaded.jobId = jobId;
                done(downloaded);
            });
        },
    });
}

function scheduleAsyncPoll(jobId, config, startedAtMs, done) {
    $timer.schedule({
        interval: ASYNC_POLL_INTERVAL_SEC,
        repeats: false,
        handler: function () {
            pollAsyncJob(jobId, config, startedAtMs, done);
        },
    });
}

function parseAsyncJobStatusResponse(resp, config) {
    var serviceLabel = getServiceLabel(config);

    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', serviceLabel + '轮询返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '轮询' + serviceLabel + '失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = resp.response && resp.response.statusCode;
    if (statusCode !== 200) {
        var troubleshooting = asyncJobsTroubleshootingLink(statusCode, resp.data);
        return {
            ok: false,
            error: makeServiceError(
                statusCode === 401 || statusCode === 403 ? 'secretKey' : 'network',
                serviceLabel + '轮询返回异常状态码: ' + statusCode + appendUpstreamErrorSuffix(resp.data) + asyncJobsTroubleshootingSuffix(statusCode, resp.data),
                {
                    statusCode: statusCode,
                    data: resp.data,
                },
                troubleshooting
            ),
        };
    }

    var payload = isPlainObject(resp.data) ? resp.data.data : null;
    if (!isPlainObject(payload)) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '轮询结果结构不符合预期。', {
                data: resp.data,
            }),
        };
    }

    var state = stringOrDefault(payload.state, '');
    if (!state) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '轮询结果缺少 state。', {
                data: resp.data,
            }),
        };
    }

    if (state === 'failed') {
        return {
            ok: false,
            error: makeServiceError(
                'api',
                stringOrDefault(payload.errorMsg, '百度异步文档解析 jobs 失败。'),
                {
                    data: payload,
                }
            ),
        };
    }

    if (state !== 'done') {
        return {
            ok: true,
            state: state,
            data: payload,
        };
    }

    var jsonUrl = payload.resultUrl && stringOrDefault(payload.resultUrl.jsonUrl, '');
    if (!jsonUrl) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '已完成但未返回 jsonUrl。', {
                data: payload,
            }),
        };
    }

    return {
        ok: true,
        state: state,
        jsonUrl: jsonUrl,
        data: payload,
    };
}

function downloadAsyncJsonResult(jsonUrl, config, startedAtMs, done) {
    var candidates = buildAsyncJsonDownloadCandidates(jsonUrl);
    var strategy = getAsyncJsonDownloadStrategy(config);

    if (strategy === 'relayOnly') {
        downloadAsyncJsonResultViaRelay(
            candidates,
            0,
            config,
            startedAtMs,
            function (relayed) {
                done(relayed);
            }
        );
        return;
    }

    downloadAsyncJsonResultWithCandidates(
        candidates,
        0,
        config,
        startedAtMs,
        function (downloaded) {
            if (downloaded.ok || strategy !== 'directThenRelay' || !shouldTryRelayDownload(downloaded.error, config)) {
                done(downloaded);
                return;
            }

            downloadAsyncJsonResultViaRelay(
                candidates,
                0,
                config,
                startedAtMs,
                function (relayed) {
                    if (!relayed.ok) {
                        relayed = appendRelayFailureHint(relayed);
                    }
                    done(relayed);
                }
            );
        }
    );
}

function downloadAsyncJsonResultWithCandidates(candidates, index, config, startedAtMs, done) {
    var requestUrl = candidates[index];
    if (!requestUrl) {
        done({
            ok: false,
            error: makeServiceError('network', '百度异步文档解析 jobs 结果下载地址为空。'),
        });
        return;
    }

    $http.request({
        method: 'GET',
        url: requestUrl,
        timeout: singleAsyncRequestTimeout(config, startedAtMs),
        handler: function (resp) {
            var parsed = parseAsyncJsonResultResponse(resp, config, requestUrl);
            if (
                !parsed.ok &&
                shouldRetryAsyncJsonDownload(resp, candidates, index)
            ) {
                downloadAsyncJsonResultWithCandidates(candidates, index + 1, config, startedAtMs, done);
                return;
            }

            if (parsed.ok) {
                parsed.jsonUrl = requestUrl;
            }
            done(parsed);
        },
    });
}

function downloadAsyncJsonResultViaRelay(candidates, index, config, startedAtMs, done) {
    var targetUrl = candidates[index];
    if (!targetUrl) {
        done({
            ok: false,
            error: makeServiceError(
                'network',
                '本机 relay 下载失败：没有可用的 jsonUrl 候选地址。'
            ),
        });
        return;
    }

    var relayRequestUrl = buildRelayFetchRequestUrl(config.asyncResultRelayUrl, targetUrl);
    $http.request({
        method: 'GET',
        url: relayRequestUrl,
        timeout: singleAsyncRequestTimeout(config, startedAtMs),
        handler: function (resp) {
            var parsed = parseRelayJsonResultResponse(resp, config, targetUrl);
            if (!parsed.ok && index + 1 < candidates.length) {
                downloadAsyncJsonResultViaRelay(candidates, index + 1, config, startedAtMs, done);
                return;
            }

            if (parsed.ok) {
                parsed.jsonUrl = targetUrl;
                parsed.downloadVia = 'localRelay';
            }
            done(parsed);
        },
    });
}

function buildAsyncJsonDownloadCandidates(jsonUrl) {
    var normalized = normalizeBceBosSignedUrl(jsonUrl);
    if (!normalized || normalized === jsonUrl) {
        return [jsonUrl];
    }

    return [jsonUrl, normalized];
}

function shouldRetryAsyncJsonDownload(resp, candidates, index) {
    if (index + 1 >= candidates.length) {
        return false;
    }

    if (!isPlainObject(resp)) {
        return false;
    }

    var statusCode = resp.response && resp.response.statusCode;
    return statusCode === 400 || statusCode === 403;
}

function shouldTryRelayDownload(error, config) {
    if (!config || config.serviceMode !== 'cloudAsync') {
        return false;
    }
    if (getAsyncJsonDownloadStrategy(config) !== 'directThenRelay') {
        return false;
    }
    if (!config.asyncResultRelayUrl) {
        return false;
    }

    var statusCode = getStatusCodeFromError(error);
    if (statusCode === 403) {
        return true;
    }

    var message = '';
    if (error && typeof error.message === 'string') {
        message = error.message.toLowerCase();
    }

    return message.indexOf('signature') !== -1 || message.indexOf('签名') !== -1;
}

function getAsyncJsonDownloadStrategy(config) {
    if (!config || config.serviceMode !== 'cloudAsync') {
        return DEFAULT_ASYNC_JSON_DOWNLOAD_STRATEGY;
    }

    var strategy = config.asyncJsonDownloadStrategy;
    if (typeof strategy === 'string' && ASYNC_JSON_DOWNLOAD_STRATEGY_SET[strategy]) {
        return strategy;
    }

    return DEFAULT_ASYNC_JSON_DOWNLOAD_STRATEGY;
}

function buildRelayFetchRequestUrl(relayBaseUrl, targetUrl) {
    var separator = relayBaseUrl.indexOf('?') >= 0 ? '&' : '?';
    return relayBaseUrl + separator + 'format=json&url=' + encodeURIComponent(targetUrl);
}

function parseRelayJsonResultResponse(resp, config, jsonUrl) {
    var serviceLabel = getServiceLabel(config) + ' relay';

    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', serviceLabel + '返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求本机 relay 失败。', {
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
                serviceLabel + '返回异常状态码: ' + statusCode + appendUpstreamErrorSuffix(resp.data),
                {
                    statusCode: statusCode,
                    data: resp.data,
                }
            ),
        };
    }

    var text = responseText(resp);
    if (!text && isPlainObject(resp.data)) {
        text = stringOrDefault(resp.data.text, '');
        if (!text) {
            text = stringOrDefault(resp.data.jsonl, '');
        }
    }

    if (!text) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '下载成功，但未拿到 JSONL 文本。', {
                data: resp.data,
            }),
        };
    }

    var parsed = extractTextsFromAsyncJsonl(text);
    if (!parsed.ok) {
        return parsed;
    }

    if (parsed.texts.length === 0) {
        return {
            ok: false,
            error: makeServiceError('notFound', '异步文档解析已完成，但 relay 未解析到可用文本。', {
                lineCount: parsed.lineCount,
            }),
        };
    }

    return {
        ok: true,
        texts: parsed.texts,
        pageCount: parsed.pageCount,
        jsonUrl: jsonUrl,
    };
}

function appendRelayFailureHint(result) {
    if (!result || !result.error || typeof result.error.message !== 'string') {
        return result;
    }
    result.error.message +=
        '。已尝试本机 relay 回退下载；请确认 relay 已启动（Async-JSONL-Relay-Start.command）后重试。';
    return result;
}

function getStatusCodeFromError(error) {
    if (!error || !isPlainObject(error.addition)) {
        return 0;
    }

    var code = error.addition.statusCode;
    if (typeof code === 'number' && isFinite(code)) {
        return code;
    }
    if (typeof code === 'string' && /^[0-9]+$/.test(code)) {
        return parseInt(code, 10);
    }
    return 0;
}

function normalizeBceBosSignedUrl(input) {
    if (typeof input !== 'string') {
        return input;
    }

    var questionMarkIndex = input.indexOf('?');
    if (questionMarkIndex < 0 || input.indexOf('bcebos.com') < 0) {
        return input;
    }

    var base = input.slice(0, questionMarkIndex);
    var query = input.slice(questionMarkIndex + 1);
    var parts = query.split('&');
    var changed = false;
    var i;

    for (i = 0; i < parts.length; i += 1) {
        var pair = parts[i];
        var equalIndex = pair.indexOf('=');
        if (equalIndex <= 0) {
            continue;
        }

        var key = pair.slice(0, equalIndex);
        var value = pair.slice(equalIndex + 1);
        if (key !== 'authorization') {
            continue;
        }

        var decoded = safeDecodeURIComponent(value);
        if (!decoded || decoded === value || decoded.indexOf('bce-auth-v1/') !== 0) {
            continue;
        }

        parts[i] = key + '=' + decoded;
        changed = true;
    }

    if (!changed) {
        return input;
    }

    return base + '?' + parts.join('&');
}

function safeDecodeURIComponent(input) {
    if (typeof input !== 'string' || !input) {
        return '';
    }

    try {
        return decodeURIComponent(input);
    } catch (error) {
        $log.error('decodeURIComponent failed', error);
        return '';
    }
}

function parseAsyncJsonResultResponse(resp, config, jsonUrl) {
    var serviceLabel = getServiceLabel(config);

    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', serviceLabel + '结果下载返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '下载' + serviceLabel + '结果失败。', {
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
                serviceLabel + '结果下载返回异常状态码: ' + statusCode + appendUpstreamErrorSuffix(resp.data),
                {
                    statusCode: statusCode,
                    data: resp.data,
                }
            ),
        };
    }

    var text = responseText(resp);
    if (!text) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '结果下载成功，但未拿到 JSONL 文本。', {
                data: resp.data,
            }),
        };
    }

    var parsed = extractTextsFromAsyncJsonl(text);
    if (!parsed.ok) {
        return parsed;
    }

    if (parsed.texts.length === 0) {
        return {
            ok: false,
            error: makeServiceError('notFound', '异步文档解析已完成，但未识别到可用文本。', {
                lineCount: parsed.lineCount,
            }),
        };
    }

    return {
        ok: true,
        texts: parsed.texts,
        pageCount: parsed.pageCount,
        jsonUrl: jsonUrl,
    };
}

function extractTextsFromAsyncJsonl(text) {
    var lines = text.split(/\r?\n/);
    var texts = [];
    var lineCount = 0;
    var pageCount = 0;
    var i;

    for (i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();
        if (!line) {
            continue;
        }

        lineCount += 1;

        var payload = null;
        try {
            payload = JSON.parse(line);
        } catch (error) {
            return {
                ok: false,
                error: makeServiceError('api', '异步文档解析返回的 JSONL 第 ' + lineCount + ' 行不是合法 JSON。', {
                    line: line.slice(0, 200),
                }),
            };
        }

        var result = isPlainObject(payload) ? payload.result : null;
        var lineTexts = extractTextsFromAsyncResult(result);
        var j;
        for (j = 0; j < lineTexts.length; j += 1) {
            if (texts.length >= MAX_TEXT_ITEMS) {
                return {
                    ok: true,
                    texts: texts,
                    lineCount: lineCount,
                    pageCount: pageCount,
                };
            }
            texts.push({ text: lineTexts[j] });
        }

        pageCount += 1;
    }

    return {
        ok: true,
        texts: texts,
        lineCount: lineCount,
        pageCount: pageCount,
    };
}

function extractTextsFromAsyncResult(result) {
    var texts = [];
    if (!isPlainObject(result)) {
        return texts;
    }

    if (Array.isArray(result.layoutParsingResults)) {
        var i;
        for (i = 0; i < result.layoutParsingResults.length; i += 1) {
            var item = result.layoutParsingResults[i];
            if (!isPlainObject(item)) {
                continue;
            }

            pushNormalizedText(texts, item.text);
            pushNormalizedText(texts, item.markdown && item.markdown.text);
            pushNormalizedText(texts, item.parsedText);
            if (texts.length >= MAX_TEXT_ITEMS) {
                return texts;
            }
        }
    }

    if (Array.isArray(result.ocrResults)) {
        var ocrTexts = extractTexts(result.ocrResults);
        var j;
        for (j = 0; j < ocrTexts.length; j += 1) {
            if (texts.length >= MAX_TEXT_ITEMS) {
                return texts;
            }
            pushNormalizedText(texts, ocrTexts[j] && ocrTexts[j].text);
        }
    }

    return texts;
}

function pushNormalizedText(texts, candidate) {
    if (!Array.isArray(texts)) {
        return;
    }

    var normalized = normalizeExtractedText(candidate);
    if (!normalized) {
        return;
    }

    texts.push(normalized);
}

function responseText(resp) {
    if (isPlainObject(resp.data)) {
        if (typeof resp.data.text === 'string' && resp.data.text) {
            return resp.data.text;
        }
        if (typeof resp.data.jsonl === 'string' && resp.data.jsonl) {
            return resp.data.jsonl;
        }
    }

    if (typeof resp.data === 'string' && resp.data) {
        return resp.data;
    }

    if ($data.isData(resp.data)) {
        try {
            return resp.data.toUTF8();
        } catch (error) {
            $log.error('toUTF8 failed', error);
        }
    }

    return '';
}

function validationImageData() {
    try {
        return $data.fromBase64(VALIDATION_IMAGE_BASE64);
    } catch (error) {
        $log.error('fromBase64 failed', error);
        return null;
    }
}

function detectUploadFileMeta(data) {
    if (!$data.isData(data) || data.length <= 0) {
        return null;
    }

    var hex = '';
    try {
        hex = data.toHex();
    } catch (error) {
        $log.error('toHex failed', error);
        return {
            filename: 'bob-capture.png',
            contentType: 'image/png',
        };
    }

    if (typeof hex !== 'string' || hex.length < 8) {
        return {
            filename: 'bob-capture.png',
            contentType: 'image/png',
        };
    }

    if (hex.indexOf('89504e470d0a1a0a') === 0) {
        return {
            filename: 'bob-capture.png',
            contentType: 'image/png',
        };
    }

    if (hex.indexOf('ffd8ff') === 0) {
        return {
            filename: 'bob-capture.jpg',
            contentType: 'image/jpeg',
        };
    }

    if (hex.indexOf('25504446') === 0) {
        return {
            filename: 'bob-capture.pdf',
            contentType: 'application/pdf',
        };
    }

    return {
        filename: 'bob-capture.png',
        contentType: 'image/png',
    };
}

function singleAsyncRequestTimeout(config, startedAtMs) {
    var remaining = config.requestTimeoutSec - elapsedSeconds(startedAtMs);
    return clamp(remaining, MIN_REQUEST_TIMEOUT_SEC, 15);
}

function elapsedSeconds(startedAtMs) {
    return Math.floor((new Date().getTime() - startedAtMs) / 1000);
}

function appendUpstreamErrorSuffix(data) {
    var message = extractUpstreamErrorMessage(data);
    if (!message) {
        return '';
    }

    return ' ' + message;
}

function asyncJobsTroubleshootingSuffix(statusCode, data) {
    var message = extractUpstreamErrorMessage(data);

    if (statusCode === 400 && message.indexOf('模型传参错误') !== -1) {
        return '。请改用“自动检测（推荐）”，或手动选择实测可用值 PaddleOCR-VL-1.5 / PaddleOCR-VL；如果你选了“自定义模型 ID”，请确认填写的是官方真实模型名。';
    }

    if (statusCode !== 404) {
        return '';
    }

    if (message.indexOf('仅支持 POST /ocr') === -1 && message.indexOf('接口不存在') === -1) {
        return '';
    }

    return '。这说明你填的是部署版 /ocr 服务地址，不是官方 jobs 入口；请把 OCR 服务地址改为 https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
}

function asyncJobsTroubleshootingLink(statusCode, data) {
    if (statusCode === 400) {
        var message = extractUpstreamErrorMessage(data);
        if (message.indexOf('模型传参错误') !== -1) {
            return 'https://ai.baidu.com/ai-doc/PADDLEOCR/Rlnanrvvm';
        }
    }

    if (statusCode === 401 || statusCode === 403) {
        return 'https://ai.baidu.com/ai-doc/AISTUDIO/slmkadt9z';
    }

    var suffix = asyncJobsTroubleshootingSuffix(statusCode, data);
    if (suffix) {
        return 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
    }

    return undefined;
}

function parseServerResponse(resp, config) {
    var serviceLabel = getServiceLabel(config);

    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', serviceLabel + '服务网络层返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求' + serviceLabel + '失败。', {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = resp.response && resp.response.statusCode;
    if (statusCode !== 200) {
        var upstreamMessage = extractUpstreamErrorMessage(resp.data);
        var errorType = statusCode === 401 || statusCode === 403 ? 'secretKey' : 'network';
        var errorMessage = serviceLabel + '返回异常状态码: ' + statusCode;
        if (upstreamMessage) {
            errorMessage += ' ' + upstreamMessage;
        }

        return {
            ok: false,
            error: makeServiceError(
                errorType,
                errorMessage,
                {
                    statusCode: statusCode,
                    data: resp.data,
                },
                statusCode === 401 || statusCode === 403 ? 'https://ai.baidu.com/ai-doc/AISTUDIO/slmkadt9z' : undefined
            ),
        };
    }

    if (!isPlainObject(resp.data)) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '响应不是合法 JSON 对象。', {
                data: resp.data,
            }),
        };
    }

    var data = resp.data;
    if (data.errorCode !== undefined && data.errorCode !== 0) {
        return {
            ok: false,
            error: makeServiceError(
                'api',
                stringOrDefault(data.errorMsg, stringOrDefault(data.message, serviceLabel + '返回错误。')),
                {
                    errorCode: data.errorCode,
                    logId: data.logId,
                }
            ),
        };
    }

    if (data.code !== undefined && data.code !== 0) {
        return {
            ok: false,
            error: makeServiceError(
                'api',
                stringOrDefault(data.msg, stringOrDefault(data.message, serviceLabel + '返回错误。')),
                {
                    errorCode: data.code,
                    logId: data.logId,
                }
            ),
        };
    }

    var normalizedPayload = normalizeServerPayload(data);
    if (!normalizedPayload) {
        return {
            ok: false,
            error: makeServiceError('api', serviceLabel + '结果结构不符合预期。', {
                data: data,
            }),
        };
    }

    return {
        ok: true,
        payload: normalizedPayload,
    };
}

function normalizeServerPayload(data) {
    if (!isPlainObject(data)) {
        return null;
    }

    if (isPlainObject(data.result) && Array.isArray(data.result.ocrResults)) {
        return {
            logId: data.logId,
            result: data.result,
        };
    }

    if (isPlainObject(data.result) && Array.isArray(data.result.ocr_results)) {
        return {
            logId: data.logId,
            result: {
                ocrResults: data.result.ocr_results,
            },
        };
    }

    if (Array.isArray(data.ocrResults)) {
        return {
            logId: data.logId,
            result: {
                ocrResults: data.ocrResults,
            },
        };
    }

    if (Array.isArray(data.ocr_results)) {
        return {
            logId: data.logId,
            result: {
                ocrResults: data.ocr_results,
            },
        };
    }

    if (isPlainObject(data.data)) {
        return normalizeServerPayload(data.data);
    }

    return null;
}

function parseCloudValidationResponse(resp) {
    if (!isPlainObject(resp)) {
        return {
            ok: false,
            error: makeServiceError('network', '云端服务商健康检查返回数据异常。', resp),
        };
    }

    if (resp.error) {
        return {
            ok: false,
            error: makeServiceError('network', '请求云端服务商健康检查失败。', {
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
    var message = '云端服务商健康检查状态码异常: ' + statusCode;
    if (statusCode === 404) {
        message = '云端服务商健康检查失败（HTTP 404）。请确认 Base URL 是 OpenAI 兼容入口。';
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
            error: makeServiceError('network', '云端服务商 OCR 返回数据异常。', resp),
        };
    }

    if (resp.error) {
        var networkStatusCode = getResponseStatusCode(resp);
        var networkErrorText = normalizeAnyToText(resp.error);
        var networkMessage = '请求云端服务商 OCR 失败。';
        if (networkStatusCode > 0) {
            networkMessage += ' 状态码: ' + networkStatusCode + '。';
        }
        if (networkErrorText) {
            networkMessage += ' ' + networkErrorText;
        }
        return {
            ok: false,
            error: makeServiceError('network', networkMessage, {
                error: resp.error,
                response: resp.response,
            }),
        };
    }

    var statusCode = getResponseStatusCode(resp);
    if (statusCode !== 200) {
        var remoteErrorMessage = extractRemoteErrorMessage(resp.data);
        var errorType = statusCode === 401 || statusCode === 403 ? 'secretKey' : 'api';
        var message = '云端服务商 OCR 返回异常状态码: ' + statusCode;
        if (statusCode === 404) {
            message = '云端服务商 OCR 请求返回 HTTP 404，请检查 Base URL / 接口路径配置。';
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
            error: makeServiceError('api', '云端服务商 OCR 响应不是合法 JSON 对象。', {
                data: resp.data,
            }),
        };
    }

    var text = extractCloudOcrText(resp.data);
    if (!text) {
        return {
            ok: false,
            error: makeServiceError('notFound', '云端服务商模型没有返回可解析文本。', {
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

function buildImageDataUrl(imageBase64, fileKind) {
    var mimeType = resolveImageMimeType(fileKind);
    return 'data:' + mimeType + ';base64,' + imageBase64;
}

function resolveImageMimeType(fileKind) {
    if (fileKind === 'jpg') {
        return 'image/jpeg';
    }
    return 'image/png';
}

function detectBase64FileKind(imageBase64) {
    if (typeof imageBase64 !== 'string') {
        return 'unknown';
    }

    var value = imageBase64.trim();
    if (!value) {
        return 'unknown';
    }

    if (/^data:image\/png;base64,/i.test(value) || value.indexOf('iVBORw0KGgo') === 0) {
        return 'png';
    }
    if (/^data:image\/jpe?g;base64,/i.test(value) || value.indexOf('/9j/') === 0) {
        return 'jpg';
    }
    if (/^data:application\/pdf;base64,/i.test(value) || value.indexOf('JVBERi0') === 0) {
        return 'pdf';
    }

    return 'unknown';
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

function normalizeAnyToText(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (isPlainObject(value)) {
        if (typeof value.message === 'string' && value.message.trim()) {
            return value.message.trim();
        }
        if (typeof value.localizedDescription === 'string' && value.localizedDescription.trim()) {
            return value.localizedDescription.trim();
        }
        if (typeof value.code === 'string' && value.code.trim()) {
            return value.code.trim();
        }
    }

    return '';
}
function extractTexts(ocrResults) {
    var texts = [];
    var i;
    for (i = 0; i < ocrResults.length; i += 1) {
        var page = ocrResults[i];
        if (!isPlainObject(page)) {
            continue;
        }

        var recTexts = extractRecTexts(page);
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

function extractRecTexts(page) {
    if (!isPlainObject(page)) {
        return null;
    }

    if (Array.isArray(page.rec_texts)) {
        return page.rec_texts;
    }

    if (isPlainObject(page.prunedResult) && Array.isArray(page.prunedResult.rec_texts)) {
        return page.prunedResult.rec_texts;
    }

    if (isPlainObject(page.pruned_result) && Array.isArray(page.pruned_result.rec_texts)) {
        return page.pruned_result.rec_texts;
    }

    return null;
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

function normalizeServerUrl(input, serviceMode) {
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

    if (serviceMode === 'cloudAsync') {
        if (/\/api\/v2\/ocr\/jobs$/i.test(value)) {
            return value;
        }

        if (/\/api\/v2\/ocr$/i.test(value)) {
            return value + '/jobs';
        }

        if (/\/api\/v2$/i.test(value)) {
            return value + '/ocr/jobs';
        }

        if (/\/api$/i.test(value)) {
            return value + '/v2/ocr/jobs';
        }

        return value + '/api/v2/ocr/jobs';
    }

    if (!/\/ocr$/i.test(value)) {
        value += '/ocr';
    }

    return value;
}

function normalizeRelayUrl(input) {
    if (typeof input !== 'string') {
        return '';
    }

    var value = input.trim();
    if (!value) {
        return '';
    }
    if (value.length < 10 || value.length > 2048) {
        return '';
    }
    if (!/^https?:\/\/[A-Za-z0-9._:-]+(\/.*)?$/.test(value)) {
        return '';
    }

    value = value.replace(/\/+$/, '');
    if (!/\/fetch-jsonl$/i.test(value)) {
        value += '/fetch-jsonl';
    }
    return value;
}

function resolveServerUrlOption(serviceMode) {
    if (serviceMode === 'local') {
        return getOptionString('localServerUrl', getOptionString('serverUrl', DEFAULT_SERVER_URL));
    }
    if (serviceMode === 'cloudAsync') {
        return getOptionString('baiduServerUrl', getOptionString('serverUrl', DEFAULT_BAIDU_SERVER_URL));
    }
    return getOptionString('serverUrl', DEFAULT_SERVER_URL);
}

function buildServerUrlErrorMessage(serviceMode) {
    if (serviceMode === 'local') {
        return '[本地] OCR 服务地址格式不正确，请填写 http:// 或 https:// 开头的 /ocr 地址。';
    }
    if (serviceMode === 'cloudAsync') {
        return '[百度] 服务地址格式不正确，请填写 http:// 或 https:// 开头的 /jobs 地址，或官方根地址。';
    }
    return 'OCR 服务地址格式不正确，请填写 http:// 或 https:// 开头的地址。';
}

function getServiceLabel(config) {
    if (config && config.serviceMode === 'cloudAsync') {
        return '百度异步文档解析 jobs';
    }
    if (config && config.serviceMode === 'providerCloud') {
        return '云端服务商 OCR';
    }
    return '本地 OCR 服务';
}

function extractUpstreamErrorMessage(data) {
    if (typeof data === 'string') {
        return data.trim();
    }

    if (!isPlainObject(data)) {
        return '';
    }

    if (isPlainObject(data.error) && typeof data.error.message === 'string') {
        return data.error.message.trim();
    }

    if (typeof data.error_msg === 'string' && data.error_msg.trim()) {
        return data.error_msg.trim();
    }

    if (typeof data.errorMsg === 'string' && data.errorMsg.trim()) {
        return data.errorMsg.trim();
    }

    if (typeof data.message === 'string' && data.message.trim()) {
        return data.message.trim();
    }

    if (typeof data.msg === 'string' && data.msg.trim()) {
        return data.msg.trim();
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

function parseMenuChoice(identifier, fallback, allowedValues) {
    var value = getOptionString(identifier, fallback);
    if (allowedValues && allowedValues[value]) {
        return value;
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

function getOptionStringAllowEmpty(identifier, fallback) {
    var value = $option[identifier];
    if (typeof value !== 'string') {
        return fallback;
    }
    return value.trim();
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
