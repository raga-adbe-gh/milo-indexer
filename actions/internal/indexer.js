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
import { getUrlParts, } from './tools.js';

const initIndexer = async (runtime, tenantUrl) => {
    const { logger, filesWrapper, hlxAdmin } = runtime;
    const { urlRepo: tenant } = getUrlParts(tenantUrl);
    const siteConfig = await runtime.getLangSiteConfig(tenantUrl);
    const hlxAdminAuthKeyId = `adobecom--${tenant}`;
    const rootPath = siteConfig.getRootPath();
    const sharepoint = await runtime.getSharePoint();
    const { ignorePaths = '' } = runtime.getParameters({ throwOnMissingParameter: false, }, 'ignorePaths'); 
    const ignorePathList = ignorePaths.split(',').map((s) => s.trim());


    const generatePreviewIndexFromSp = async () => {
        const result = {};
    
        logger.info(`Crawling tenant=${tenant} with rootPath=${rootPath}`);
        result.indexFiles = await sharepoint.crawlLangCountry(tenant, rootPath);
        logger.info(`Index files ${JSON.stringify(result.indexFiles)}`);
    
        result.previewPaths = result.indexFiles.map((file) => `adobecom/${tenant}/main${rootPath.length === 1 ? 0 : file.substr(rootPath.length === 1 ? 0 : rootPath.length)}`.replace('.xlsx', '.json'));
        logger.info(`Preview paths ${JSON.stringify(result.previewPaths)}`);
    
        const { failedPaths = [] } = await hlxAdmin.triggerBulkPreview(result.previewPaths, hlxAdminAuthKeyId);
        logger.info(`Failed paths ${JSON.stringify(failedPaths)}`);
    
        result.failedPaths = failedPaths;
        return result;
    }

    const generatePreviewIndexUsingBs = async () => {
        const result = {};
        const previewCallback = async (path) => hlxAdmin.triggerBulkStatusPreview(
            path,
            `adobecom/${tenant}/main`,
            hlxAdminAuthKeyId
        );
        logger.info(`Generating preview index for ${tenant} with rootPath ${rootPath}`);
        result.indexFiles = await sharepoint.generatePreviewIndex(
            tenant,
            rootPath,
            previewCallback,
            rootPath
        );
        result.previewPaths = result.indexFiles.map((file) => `adobecom/${tenant}/main${
            rootPath.length === 1 ? 0 : file.substr(rootPath.length === 1 ? 0 : rootPath.length)
        }`.replace('.xlsx', '.json'));
        logger.info(`Triggering bulk preview for ${result.previewPaths}`);
        const { failedPaths = [] } = await hlxAdmin.triggerBulkPreview(
            result.previewPaths,
            hlxAdminAuthKeyId
        );
        logger.info(`Bulk preview failed for ${failedPaths}`);
        result.failedPaths = failedPaths;        
        return result;
}


    const getPreviewedPerCountryPath = async () => {
        const lastDate = (await filesWrapper.readFileIntoObject(`countryIndex/${tenant}/last-date.json`)).lastDate || new Date();
        const logsInfo = await hlxAdmin.extractLogs(`adobecom/${tenant}/main`, lastDate, hlxAdminAuthKeyId);
        // logger.info(`logsInfo ${JSON.stringify(logsInfo)}`)
        const allCountryPaths = siteConfig.getAllCountryPaths();
        logger.info(`allCountryPaths ${JSON.stringify(allCountryPaths)}`)
        const itemsPerCountryPath = {};
        // Map files per paths
        allCountryPaths.forEach((path) => {
            const found = logsInfo?.paths?.filter((p) => p.indexOf(`${path}/`) >= 0);
            if (found?.length > 0) {
                const filtered = found.filter((f) => {
                    const toIgnore = ignorePathList.find((p) => f.includes(p))
                    return !toIgnore;
                });
                if ( filtered.length ) {
                    itemsPerCountryPath[path] = itemsPerCountryPath[path] || [];
                    itemsPerCountryPath[path].push(...filtered);
                }
            }
        });
        // logger.info(`Got mapping paths: ${JSON.stringify(itemsPerCountryPath)}`);
        return {logsInfo, itemsPerCountryPath};
    }

    const updatePreviewIndexFile = async (itemsPerCountryPath) => {
        const indexFiles = [];
        // logger.info(`itemsPerCountryPath ${JSON.stringify(itemsPerCountryPath)}`);
        await Object.keys(itemsPerCountryPath).reduce(async (acc, key) => {
            await acc;
            const [, lang, country]  = key.split('/');
            const currentData = await siteConfig.fetchPreviewIndex(lang, country) || [];
            if (currentData?.length > 0) {
                // logger.info(`Key file : ${JSON.stringify(currentData)}`);
                const fullData = [...new Set([...(currentData||[]), ...itemsPerCountryPath[key]])];
                // logger.info(`fullData file : ${JSON.stringify(fullData)}`);
                const indexFile = await sharepoint.updatePreviewIndex(tenant, rootPath, lang, country, fullData);
                logger.info(`Index file : ${indexFile}`);
                indexFiles.push(indexFile);
            }
        }, Promise.resolve());
        return indexFiles;
    }

    const previewIndexFiles = async (indexFiles) => {
        logger.info(`Index files : ${JSON.stringify(indexFiles)}`);
        let failedPaths = undefined;
        const previewPaths = indexFiles.map((file) => `adobecom/${tenant}/main${rootPath.length === 1 ? 0 : file.substr(rootPath.length === 1 ? 0 : rootPath.length)}`.replace('.xlsx', '.json'));
        if (previewPaths?.length > 0) {
            const resp = await hlxAdmin.triggerBulkPreview(previewPaths, hlxAdminAuthKeyId);
            failedPaths = resp.failedPaths;
        }
        return { failedPaths };
    }

    const generatePreviewIndex = async () => {
        const {logsInfo, itemsPerCountryPath} = await getPreviewedPerCountryPath();
        const indexFiles = await updatePreviewIndexFile(itemsPerCountryPath);
        const previewIndexFilesResp = await previewIndexFiles(indexFiles);
        await filesWrapper.writeFile(`countryIndex/${tenant}/last-date.json`, { lastDate: logsInfo.to, paths: logsInfo.paths });
        return {itemsPerCountryPath, indexFiles, previewIndexFilesResp};
    }

    return {
        generatePreviewIndexFromSp,
        generatePreviewIndexUsingBs,
        generatePreviewIndex,
    }
};

export default initIndexer;
