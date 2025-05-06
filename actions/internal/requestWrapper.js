/* ***********************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 * Copyright 2023 Adobe
 * All Rights Reserved.
 *
 * NOTICE: All information contained herein is, and remains
 * the property of Adobe and its suppliers, if any. The intellectual
 * and technical concepts contained herein are proprietary to Adobe
 * and its suppliers and are protected by all applicable intellectual
 * property laws, including trade secret and copyright laws.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from Adobe.
 ************************************************************************* */

import fetch from 'node-fetch';

const createRequestWrapper = (runtime, fetchMode, requestTimeouts) => {
    const callLog = [];
    const { filesWrapper, logger } = runtime;
    const useCallLog = fetchMode === 'logging';

    const sanitizeTimeout = (timeout) => {
        if (!timeout || Number.isNaN(Number(timeout))) {
            return requestTimeouts.default;
        }
        if (timeout < requestTimeouts.min) {
            return requestTimeouts.min;
        }
        if (timeout > requestTimeouts.max) {
            return requestTimeouts.max;
        }
        return timeout;
    };

    const handleError = (err, url) => {
        if (err.message === 'TimeoutError') {
            err.sendStatus = 504;
            err.sendMessage = `Request to ${url} timed out`;
        } else {
            err.sendStatus = 500;
            err.sendMessage = `An error occurred while retrieving ${url}`;
        }
        return err;
    };

    const addCallLog = (toAdd) => {
        if (useCallLog) {
            callLog.push(toAdd);
        }
    };

    const delay = (time) => new Promise((resolve) => {
        setTimeout(resolve, time);
    });

    const getMillisToSleep = (retryHeaderString) => {
        if (typeof retryHeaderString === 'string') {
            const millisToSleep = Math.round(parseFloat(retryHeaderString) * 1000);
            if (!Number.isNaN(millisToSleep)) {
                return millisToSleep;
            }
            return new Date(retryHeaderString) - new Date();
        }
        return -1;
    };

    const handleResponse = async (url, response, responseMode) => {
        const handleCallLog = (code, text, body) => {
            if (useCallLog) {
                addCallLog({
                    url,
                    responseCode: code,
                    responseText: text,
                    responseBody: body,
                });
            }
        };
        const { status, statusText, headers } = response;
        if (responseMode === 'ignoreBody') {
            handleCallLog(status, statusText, 'n/a');
            return {
                statusCode: status,
                statusText,
                body: null,
                headers,
                json: null,
            };
        }
        if (responseMode === 'direct') {
            handleCallLog(status, statusText, 'n/a');
            return response;
        }
        const body = await response.text();
        handleCallLog(status, statusText, body.slice(0, 200));
        let json;
        if (responseMode === 'json') {
            try {
                json = JSON.parse(body);
            } catch (err) {
                json = null;
            }
        }
        return {
            statusCode: status,
            statusText,
            body,
            headers,
            json,
        };
    };

    const raceRequest = async (url, options, timeout) => Promise.race([
        fetch(url, options),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TimeoutError')), timeout);
        }),
    ]);

    const raceRequestSafe = async (url, options, timeout) => {
        try {
            return await raceRequest(url, options, timeout);
        } catch (err) {
            return {
                status: 600,
                statusText: err.message,
                text: () => err.message,
            };
        }
    };

    const noRetry = (statusCode, additionalNoRetryCodes) => statusCode < 400 || statusCode === 401 || statusCode === 403 || additionalNoRetryCodes?.includes(statusCode);

    const executeRequest = async (url, options, timeout, streamReInit, additionalNoRetryCodes) => {
        let waitInterval = requestTimeouts.waitInBetween;
        let newUrl;
        let newBody;
        let error;
        for (let r = 0; r < requestTimeouts.retries; r += 1) {
            waitInterval *= 2;
            if (streamReInit) {
                // eslint-disable-next-line no-await-in-loop
                ({ newUrl, newBody, error } = await streamReInit());
                if (error) {
                    throw new Error(error);
                }
                if (newBody) {
                    options.body = newBody;
                }
            }
            // eslint-disable-next-line no-await-in-loop
            const response = await raceRequestSafe(newUrl ?? url, options, timeout);
            if (noRetry(response.status, additionalNoRetryCodes) || r === requestTimeouts.retries - 1) {
                return response;
            }
            const retryIn = response.status === 429 ? getMillisToSleep(response.headers?.get?.('Retry-After') ?? '') : -1;
            const delayBy = retryIn > 0 ? retryIn + 250 : waitInterval;

            // todo: see if additional logging for 409/423 can be removed, once the root causes have been identified
            let responseText = '';
            const is409or423 = response.status === 409 || response.status === 423;
            if (is409or423) {
                // eslint-disable-next-line no-await-in-loop
                responseText = await response.text();
            }
            logger.warn(`${response.status} for ${url} response${is409or423 ? ` (${response.statusText})` : ''} - retrying (${r + 1}/${requestTimeouts.retries}) in ${delayBy}ms\n${responseText}`);
            // eslint-disable-next-line no-await-in-loop
            await delay(delayBy);
        }
        return null;
    };

    /**
     * Performs an HTTP request using the "node-fetch" library, but automatically adds a configurable connection timeout.
     *
     * @param url {string} the URL for the request
     * @param options {object} request options, e.g. body, headers or method
     * @param timeout {number} timeout for the request, will be sanitized to be between 200ms and 60s; defaults to 10s
     * @throws Will throw an error, if the timeout has been reached ("AbortError") or if any other error is thrown by "node-fetch"
     * @returns {object} the response
     */
    const doRequest = async (url, options, timeout = requestTimeouts.default, responseMode = 'json', streamReInit = null, additionalNoRetryCodes = []) => {
        try {
            const response = await executeRequest(url, options, sanitizeTimeout(timeout), streamReInit, additionalNoRetryCodes);
            if (!response) {
                return Promise.reject(new Error('No Response'));
            }
            if (response?.status === 400) {
                const printHeaders = !response.headers ? '' : [...response.headers]
                    .filter(([name]) => ['x-request-id'].includes(name.toLowerCase()))
                    .map(([name, value]) => `${name}=${value}`);
                logger.warn(`Bad request to ${url}: ${printHeaders} / ${JSON.stringify(options?.body)}`);
            }
            return handleResponse(url, response, responseMode);
        } catch (err) {
            throw handleError(err, url);
        }
    };

    /**
     * Perform an "urlencoded" POST request and return a JSON object on success.
     *
     * @param url {string} the URL for the request
     * @param bodyObject  {object} an object of key/value pairs that will be urlencoded and form the request's body
     * @param additionalHeaders {object} (optional) additional headers (by default only Accept and Content-Type are defined)
     * @param timeout {number} (optional) timeout for the request; defaults to 10000ms
     * @returns {object} the JSON or null for non-200 responses
     */
    const formPostRequest = async (url, bodyObject, additionalHeaders = {}, timeout = requestTimeouts.default) => {
        /**
         * Converting the object to an "urlencoded string". The format is: key1 = value1 & key2 = value2 & ... (without the spaces).
         *
         * @param data the object containing the key/value pairs.
         * @returns {string} urlencoded string
         */
        const encodeBody = (data) => Object.entries(data)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');

        const encodedBody = encodeBody(bodyObject);
        return doRequest(url, {
            method: 'POST',
            body: encodedBody,
            headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                ...additionalHeaders,
            }
        }, timeout);
    };

    const done = async () => {
        if (useCallLog && callLog.length > 0) {
            await filesWrapper.writeFile(`${runtime.getProjectKey() ?? 'no-project'}/fetchLog.${Date.now()}.json`, callLog);
        }
    };

    return {
        doRequest,
        formPostRequest,
        done,
    };
};

export default createRequestWrapper;
