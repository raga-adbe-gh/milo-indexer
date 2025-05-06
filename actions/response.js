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

const responseHelper = (request) => {
    const getCorsResponseHeaders = () => {
        const { corsMethod, corsHeaders, origin } = request.getRequestCorsHeaders();
        return {
            ...(corsMethod && { 'access-control-allow-methods': corsMethod }),
            ...(corsHeaders && { 'access-control-allow-headers': corsHeaders }),
            ...(origin && { 'access-control-allow-origin': origin }),
            vary: 'origin',
        };
    };

    // todo: incomplete
    const isOriginAllowed = () => true;

    /**
     * Return CORS response to preflight request; headers will only be present, if origin is allowed.
     *
     * @returns {object} response object
     */
    const corsResponse = () => ({
        ...(isOriginAllowed() && { headers: getCorsResponseHeaders() }),
        statusCode: 204,
    });

    /**
     * Returns an error response as AIO specific JSON object
     *
     * @param message {string} error message to send
     * @param statusCode {number} status code; defaults to 500
     * @param moreInfo {object} adds additional information as JSON (instead of "stringifying" such info in the error message); defaults to empty object
     * @returns {object} response object
     */
    const errorResponse = (message, statusCode = 500, moreInfo = {}) => ({
        error: {
            headers: {
                ...getCorsResponseHeaders(),
            },
            statusCode,
            body: {
                error: message,
                // eslint-disable-next-line no-underscore-dangle
                activationId: process.env.__OW_ACTIVATION_ID,
                ...moreInfo,
            },
        },
    });

    /**
     * Returns a success response
     *
     * @param body {string|object} the response body to send
     * @param additionalHeaders {object} additional headers to send; defaults to empty object
     * @returns {object} response object
     */
    const successResponse = (body, statusCodeOverride = 200, additionalHeaders = {}) => ({
        body,
        statusCode: statusCodeOverride,
        headers: {
            'content-type': 'application/json',
            ...getCorsResponseHeaders(),
            ...additionalHeaders,
        },
    });

    /**
     * Returns an empty (201) response
     *
     * @param additionalHeaders {object} additional headers to send; defaults to empty object
     * @returns {object} response object
     */
    const emptyResponse = (additionalHeaders = {}, created = true) => ({
        statusCode: created ? 201 : 204,
        headers: {
            'content-type': 'application/json',
            ...getCorsResponseHeaders(),
            ...additionalHeaders,
        },
    });

    return {
        corsResponse,
        emptyResponse,
        errorResponse,
        successResponse,
    };
};

export default responseHelper;
