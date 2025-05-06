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

import { getUrlParts } from './tools.js';

/**
 * Read the config object and return an object with utility functions.
 * The lastModified date of the cached lib-files config.json and the lastModified date of the
 * Sharepoint file (head-request) will be compared and updated, in case the Sharepoint file is newer.
 * If the config is not present in lib-files, the Sharepoint file will be retrieved and stored.
 *
 * @param runtime {object} the runtime helper
 * @param tenantUrl {string} the tenant URL to determine the Sharepoint URL
 * @returns {object} wrapper object around the config
 */

const initLangSiteConfig = async (runtime, tenantUrl, authMode = 'none') => {
    const { logger, requestWrapper } = runtime;

    const { urlRepo, urlOwner } = getUrlParts(tenantUrl);
    const helixAuthKeyId = `${urlOwner}--${urlRepo}`;
    const configData = {
        helixAuthKeyId,
        languages: [],
        langCountriesMap: {},
        countryPathsByLanguage: {},
        allCountryPaths: [],
    };
    const configUrl = `https://main--${urlRepo}--${urlOwner}.hlx.page/.milo/config.json`;

    const authClient = await runtime.getAuthRequestClient(authMode);
    const finalUrl = authClient.getFinalUrl(configUrl);
    const headers = await authClient.getAuthHeaders(helixAuthKeyId);

    const fetchConfigFromSharepoint = async () => {
        try {
            const response = await requestWrapper.doRequest(finalUrl, { method: 'GET', headers });
            if (response.statusCode === 200) {
                return await response.json;
            }
        } catch (err) {
            logger.error(`Error while reading Sharepoint Loc config: ${err.message}`);
        }
        return null;
    };

    const tenantConfig = await fetchConfigFromSharepoint();
    if (tenantConfig?.configs?.data) {
        tenantConfig.configs.data.forEach((entry) => {
            if (entry.key === 'prod.sharepoint.driveId') {
                configData.driveId = entry.value;
            } else if (entry.key === 'prod.sharepoint.rootMapping') {
                entry.value = entry.value ?? '/';
                configData.rootMapping = entry.value.startsWith('/') ? entry.value : `/${entry.value}`;
            } else if (entry.key === 'prod.sharepoint.siteId') {
                configData.siteId = entry.value;
            }
        });
    }

    if (tenantConfig?.langcountries?.data) {
        tenantConfig.langcountries.data.forEach( ({language: lang, countries: countriesStr} ) => {
            configData.languages.push(lang);
            configData.langCountriesMap[lang] = countriesStr.split(",");
            configData.countryPathsByLanguage[lang] = countriesStr.split(",").map((country) => `/${lang}/${country}`);
            configData.allCountryPaths = Object.values(configData.countryPathsByLanguage).flat();
        });
    }

    logger.debug(`configData  ${JSON.stringify(configData)}`);

    const fetchPreviewIndex = async (lang, country) => {
        try {
            const url = `https://main--${urlRepo}--${urlOwner}.hlx.page/${lang}/${country}/preview-index.json`;
            const response = await requestWrapper.doRequest(url, { method: 'GET', headers }, 60000, 'json', null, [404]);
            if (response.statusCode === 200) {
                const resp = response.json;
                if (resp?.data?.length) {
                    const urls = resp.data.map((e) => e.URL);
                    logger.info(`URLS ${JSON.stringify(urls)}`);
                    return urls;
                }
            } else if (response.statusCode === 404) {
                return [];
            }
        } catch (err) {
            logger.error(`Error while reading Sharepoint Loc config: ${err.message}`);
        }
        return null;
    };    


    return {
        getConfigData: () => configData,
        getDriveId: () => configData.driveId,
        getSiteId: () => configData.siteId,
        getRootPath: () => configData.rootMapping,
        getLangCountriesMap: () => configData.langCountriesMap,
        getLanguages: () => configData.languages,
        getLangCountries: () => configData.languages,
        getCountryPaths: (lang) => configData.countryPathsByLanguage[lang],
        getCountryPathsByLanguage: () => configData.countryPathsByLanguage,
        getAllCountryPaths: () => configData.allCountryPaths,
        fetchPreviewIndex,
    };
};

export default initLangSiteConfig;