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

import { createTokenStorage, IMS_PROXY_TOKEN_ID } from './tokenStorage.js';
import { simpleImsRequest } from './tools.js';

const createAuthRequestClient = (runtime, mode = 'none') => {
    let authMode = mode;

    const getAuthHeadersForAlwaysAuth = async (authKeyId) => (
        { ...runtime.getHlxAdminAuthHeader(authKeyId) }
    );

    const getAuthHeaders = async (authKeyId = null) => {
        if (authMode === 'always-auth') {
            return getAuthHeadersForAlwaysAuth(authKeyId);
        }
        return {};
    };

    const setMode = (newMode) => {
        authMode = newMode;
    };

    const getFinalUrl = (originalUrl) => originalUrl;

    return {
        getAuthHeaders,
        getFinalUrl,
        setMode
    };
};

export default createAuthRequestClient;
