/* ***********************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 * Copyright 2022 Adobe
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

import querystring from 'querystring';
/**
 * Initialize the request helper
 *
 * @param queryParams {string} the query string of the request
 * @param originalMethod {string} HTTP request method
 * @param headers {object} the request headers as Map
 * @param rawBody {string} the request body
 * @returns {object} request helper
 */
const requestHelper = (queryParams, originalMethod, headers, rawBody) => {
    const method = `${originalMethod}`.toUpperCase();

    /**
     * Get the HTTP method (all uppercase)
     *
     * @returns {string} HTTP method
     */
    const getMethod = () => method;

    const parseSafe = (str, decodeFirst = false) => {
        try {
            let input = str;
            if (decodeFirst) {
                input = Buffer.from(str, 'base64').toString();
            }
            return JSON.parse(input);
        } catch (err) {
            return null;
        }
    };

    const parseBody = () => {
        if (rawBody) {
            if (typeof rawBody === 'object') {
                return rawBody;
            }
            let parsed = parseSafe(rawBody, true);
            if (!parsed) {
                parsed = parseSafe(rawBody);
            }
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        }
        return null;
    };

    let parsedBody;
    /**
     * Get the parsed request body as parsed JSON.
     *
     * @returns {object} parsed JSON or null
     */
    const getBody = () => {
        if (parsedBody === undefined) {
            parsedBody = parseBody();
        }
        return parsedBody;
    };

    /**
     * Returns the request body as is.
     *
     * According to {@link https://github.com/apache/openwhisk/blob/master/docs/webactions.md#http-context OpenWhisk}:
     * The request body entity, as a base64 encoded string when content is binary or JSON object/array, or plain string otherwise.
     *
     * @returns {string} the request body
     */
    const getRawBody = () => rawBody;

    /**
     * Determines if a request is a CORS preflight request:
     * - OPTIONS request method
     * - "access-control-request-headers", "access-control-request-method", and "origin" request headers present
     *
     * @returns {boolean} true if CORS preflight request
     */
    const isCorsPreflight = () => getMethod() === 'OPTIONS' && 'access-control-request-headers' in headers && 'access-control-request-method' in headers && 'origin' in headers;

    /**
     * Determines if the request is a POST request and does non-empty request body.
     *
     * @returns {boolean} true for POST requests with non-empty body
     */
    const isNonEmptyPostRequest = () => getMethod() === 'POST' && !!rawBody;

    /**
     * Determines if the request is a POST request and does have empty request body.
     *
     * @returns {boolean} true for POST requests with empty body
     */
    const isEmptyPostRequest = () => getMethod() === 'POST' && !rawBody;

    /**
     * Returns request headers relevant for CORS
     *
     * @returns {object} CORS headers
     */
    const getRequestCorsHeaders = () => ({
        corsMethod: headers['access-control-request-method'],
        corsHeaders: headers['access-control-request-headers'],
        origin: headers.origin,
    });

    const getQueryString = () => queryParams;

    let parsedParameters;
    const getParsedQueryParameters = () => {
        if (!parsedParameters) {
            parsedParameters = querystring.parse(queryParams);
        }
        return parsedParameters;
    };

    const getHeaderByName = (name) => headers[name.toLowerCase()];

    return {
        getBody,
        getMethod,
        getRawBody,
        getQueryString,
        getParsedQueryParameters,
        getRequestCorsHeaders,
        isCorsPreflight,
        isEmptyPostRequest,
        isNonEmptyPostRequest,
        getHeaderByName,
    };
};

export default requestHelper;
