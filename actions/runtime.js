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

import createLogHelper from './internal/logHelper.js';
import createOWHelper from './internal/owHelper.js';
import createRequestWrapper from './internal/requestWrapper.js';
import initFilesWrapper from './internal/filesWrapper.js';
import initSharePoint from './internal/sharepoint.js';
import createAuthRequestClient from './internal/authRequest.js';
import createHlxAdmin from './internal/hlxAdmin.js';
import initLangSiteConfig from './internal/langSiteConfig.js';
import initIndexer from './internal/indexer.js';
import initIndexerHelper from './internal/indexerHelper.js';


const initRuntime = async (params, queryParams, extraParams, aioLogger) => {
    const { userToken } = extraParams;

    const logger = createLogHelper(aioLogger);
    const filesWrapper = await initFilesWrapper(logger);

    const getParameters = (errorConfig = {}, ...keys) => {
        const throwOnMissingParameter = errorConfig?.throwOnMissingParameter ?? true;
        const errorMsg = errorConfig?.errorMsg ?? 'Missing required parameter';
        const errorOutImmediately = errorConfig?.errorOutImmediately ?? true;
        const errors = [];
        const parameters = keys.reduce((acc, originalKey) => {
            const doParseInt = originalKey.startsWith('Int:');
            const name = doParseInt ? originalKey.substring(4) : originalKey;
            const value = params[name];
            if (value) {
                acc[name] = doParseInt ? parseInt(value, 10) : value;
            } else {
                if (throwOnMissingParameter) {
                    if (errorOutImmediately) {
                        throw new Error(`Missing parameter: ${name}`);
                    } else {
                        errors.push(name);
                    }
                }
                acc[name] = undefined;
            }
            return acc;
        }, {});
        if (errors.length > 0) {
            logger.warn(`${errorMsg}: ${errors.join(', ')}`);
            throw new Error(`${errorMsg}: ${errors.join(', ')}`);
        }
        return parameters;
    };

    const hlxAdminAuthKeys = (() => {
        const { 'apiKeyAdobecom--milo': adobeMilo } = getParameters({ throwOnMissingParameter: false }, 'apiKeyAdobecom--milo');
        const { 'apiKeyAdobecom--news': adobeNews } = getParameters({ throwOnMissingParameter: false }, 'apiKeyAdobecom--news');
        const { 'apiKeyAdobecom--express-milo': adobeExpressMilo } = getParameters({ throwOnMissingParameter: false }, 'apiKeyAdobecom--express-milo');
        return {
            ...(adobeMilo ? { 'adobecom--milo': adobeMilo } : {}),
            ...(adobeNews ? { 'adobecom--news': adobeNews } : {}),
            ...(adobeExpressMilo ? { 'adobecom--express-milo': adobeExpressMilo } : {}),
        };
    })();

    const getAllAdminKeys = () => structuredClone(hlxAdminAuthKeys);

    const getHlxAdminAuthHeader = (keyId) => {
        if (keyId) {
            const apiKey = hlxAdminAuthKeys[keyId];
            if (apiKey) {
                return { authorization: `token ${apiKey}` };
            }
        }
        return {};
    };

    const requestTimeouts = {
        min: params.requestTimeoutMin ?? 200,
        max: params.requestTimeoutMax ?? 60000,
        default: params.requestTimeoutDefault ?? 10000,
        retries: params.requestRetries ?? 5,
        waitInBetween: params.waitInBetweenRetries ?? 1000,
    };

    // eslint-disable-next-line no-underscore-dangle
    const getRuntimeBaseUrl = () => `https://${process.env.__OW_NAMESPACE}.adobeioruntime.net/api/v1/web/miloindexer-0.0.1`;

    const self = {
        logger,
        filesWrapper,
        getParameters,
        getHlxAdminAuthHeader,
        getRuntimeBaseUrl,
        getAllAdminKeys,
    };

    self.requestWrapper = createRequestWrapper(self, params?.fetchMode, requestTimeouts);
    self.hlxAdmin = createHlxAdmin(self);

    let sharePoint;

    self.getSharePoint = async (driveId = '', siteId = '', forceReset = false) => {
        if (!sharePoint || forceReset) {
            sharePoint = await initSharePoint(self, driveId, siteId);
        }
        return sharePoint;
    };

    let langSiteConfig;
    self.getLangSiteConfig = async (tenantUrl, authMode = 'always-auth') => {
        if (!langSiteConfig) {
            langSiteConfig = await initLangSiteConfig(self, tenantUrl, authMode);
            await self.getSharePoint(langSiteConfig.getDriveId(), langSiteConfig.getSiteId() || '', true);
        }
        return langSiteConfig;
    };

    let openWhisk;
    self.getOpenWhisk = () => {
        if (!openWhisk) {
            openWhisk = createOWHelper(self);
        }
        return openWhisk;
    };

    let indexerHelper;
    self.getIndexerHelper = async () => {
        if (!indexerHelper) {
            indexerHelper = await initIndexerHelper(self);
        }
        return indexerHelper;
    };

    let indexer = {};
    self.getIndexer = async (tenantUrl) => {
        if (!initIndexer[tenantUrl]) {
            indexer[tenantUrl] = await initIndexer(self, tenantUrl);
        }
        return indexer[tenantUrl];
    };


    let authRequestClient;
    self.getAuthRequestClient = async (helixAuthKeyId = '', authMode = null) => {
        if (!authRequestClient) {
            authRequestClient = createAuthRequestClient(self, helixAuthKeyId, authMode);
        }
        return authRequestClient;
    };

    self.getUserToken = () => userToken;

    let userProfile;
    self.getUserProfile = async () => {
        if (!userProfile) {
            const sharepoint = await self.getSharePoint();
            userProfile = await sharepoint.getUserProfile(self.getUserToken());
        }
        return userProfile;
    };

    self.getBasicUserInfo = () => {
        const locUserEmailId = params.locUserEmailId || userProfile?.mail;
        const locLdap = params.locLdap || locUserEmailId?.replace(/^([^@]+)@.*/, '$1');
        const basicUserInfo = {
            locUserDisplayName: params.locUserDisplayName || userProfile?.displayName,
            locUserEmailId,
            locLdap,
        };
        return basicUserInfo.locUserEmailId ? basicUserInfo : {};
    };

    self.getAdditionalConfig = (key) => {
        if (!key) return null;
        return params[key];
    };

    return self;
};

export default initRuntime;
