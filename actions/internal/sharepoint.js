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

import msal from '@azure/msal-node';
import crypto from 'crypto';
import { createTokenStorage, SHAREPOINT_TOKEN_ID } from './tokenStorage.js';
import { handleExtension, json2excel, getLangCountriesMap, getLangCountries, getCountryPaths } from './tools.js';

const GRAPH_URL_BASE = 'https://graph.microsoft.com/v1.0/';
const MAX_CHILDREN = 5000;

const initSharePoint = async (runtime, useDriveId = '', siteId = '') => {
    const { logger, filesWrapper, requestWrapper } = runtime;
    const tokenStorage = await createTokenStorage(runtime);

    const parseCert = (content, password) => crypto.createPrivateKey({
        key: content,
        passphrase: password,
        format: 'pem'
    }).export({
        format: 'pem',
        type: 'pkcs8'
    });
 
    const parseConfig = () => {
        const {
            spClientId,
            spTenantId,
            spCertPassword,
            spCertThumbprint,
            spCertContent: rawCertContent,
        } = runtime.getParameters(
            {
                errorOutImmediately: false,
                errorMsg: 'Required parameters are missing',
            },
            'spClientId',
            'spTenantId',
            'spCertPassword',
            'spCertThumbprint',
            'spCertContent',
        );
        const certContent = rawCertContent.replace(/\\n/g, '\n');
        return {
            authConfig: {
                auth: {
                    clientId: spClientId,
                    authority: `https://login.microsoftonline.com/${spTenantId}`,
                    knownAuthorities: ['login.microsoftonline.com'],
                    clientCertificate: {
                        privateKey: parseCert(certContent, spCertPassword),
                        thumbprint: spCertThumbprint,
                    }
                }
            }
        };
    };

    const { authConfig } = parseConfig();
    const authClient = new msal.ConfidentialClientApplication(authConfig);

    const driveUrlPortion = useDriveId ? `s/${useDriveId}` : '';
    const graphBaseUrl = `${GRAPH_URL_BASE}drive${driveUrlPortion}`;

    const requestNewSpToken = async () => {
        const tokenResponse = await authClient.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default']
        });
        return {
            token: tokenResponse.accessToken,
            expiresTimestamp: tokenResponse.expiresOn.getTime(),
        };
    };

    const spAuthToken = await tokenStorage.getAuthToken(SHAREPOINT_TOKEN_ID, requestNewSpToken);

    const getAuthToken = async () => spAuthToken.getToken();

    const defaultHeaders = async () => ({
        Authorization: `Bearer ${await getAuthToken()}`,
        'User-Agent': 'NONISV|Adobe|Miloc/0.0.1',
    });

    const doesFileExist = async (relativePath) => {
        const fileResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}`, {
            method: 'GET',
            headers: await defaultHeaders(),
        }, 5000, 'ignoreBody');
        return fileResponse.statusCode === 200;
    };

    const downloadFile = async (relativePath, storagePath, contentTypeOverride = null) => {
        const contentType = contentTypeOverride ?? `application/vnd.openxmlformats-officedocument.${relativePath.endsWith('.docx') ? 'wordprocessingml.document' : 'spreadsheetml.sheet'}`;
        const fileResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}:/content`, {
            method: 'GET',
            headers: {
                ...(await defaultHeaders()),
                'content-type': contentType,
            },
        }, 60000, 'direct');
        if (fileResponse.status === 200) {
            return filesWrapper.writeFileFromStream(storagePath, fileResponse.body);
        }
        const message = `File: ${relativePath} does not exist.`;
        logger.error(`${message} - status: ${fileResponse.status} - body: ${await fileResponse.body}`);
        return message;
    };

    const getFileMetadata = async (relativePath) => {
        const fileResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}:/listItem/fields`, {
            method: 'GET',
            headers: await defaultHeaders(),
        }, 10000, 'json', null, [404]);
        if (fileResponse.statusCode === 200) {
            return fileResponse.json;
        }
        logger.error(`Error during SharePoint file metadata request of ${relativePath} (${fileResponse.statusCode}): ${fileResponse.body}`);
        return fileResponse;
    };

    const lookupUserById = async (userId) => {
        const url = `${GRAPH_URL_BASE}/sites/${siteId}/lists('User Information List')/items/${userId}/fields`;
        const detailsResponse = await requestWrapper.doRequest(url, {
            method: 'GET',
            headers: await defaultHeaders(),
        });
        if (detailsResponse.statusCode === 200) {
            return detailsResponse.json;
        }
        logger.error(`Error during SharePoint user lookup ${userId} (${detailsResponse.statusCode}): ${detailsResponse.body}`);
        return null;
    };

    const getCheckOutUserDetails = async (relativePath) => {
        const { CheckoutUserLookupId: userId = '' } = (await getFileMetadata(relativePath)) ?? {};
        if (userId) {
            const userDetails = await lookupUserById(userId);
            if (userDetails) {
                return `${userDetails.Title} - ${userDetails.EMail}`;
            }
        }
        return '';
    };

    const getUploadStatus = async (fileResponse, relativePath) => {
        if (fileResponse.statusCode !== 200 && fileResponse.statusCode !== 201) {
            const sharePointResponse = fileResponse.json;
            let message = sharePointResponse !== null ? sharePointResponse?.error?.message ?? 'unknown' : (fileResponse.text?.() || fileResponse.statusText);
            if (fileResponse.statusCode === 423) {
                if (message.includes('checked-out')) {
                    const formattedUserDetails = await getCheckOutUserDetails(relativePath);
                    if (formattedUserDetails) {
                        message = `${message} (${formattedUserDetails})`;
                    }
                }
                message = `${message} - to resolve this, please [see the docs](https://milo.adobe.com/docs/authoring/localization#breaking-locked-files).`;
            }
            return `Error during SharePoint file upload of ${relativePath} (${fileResponse.statusCode}): ${message}`;
        }
        return null;
    };

    const generateUploadSession = async (relativePath, fileSize) => {
        let error;
        const sessionResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}:/createUploadSession`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(await defaultHeaders()),
            },
            body: JSON.stringify({
                '@microsoft.graph.conflictBehavior': 'replace',
                fileSize,
                name: relativePath.split('/').pop(),
            })
        }, 10000);
        if (sessionResponse.statusCode !== 200) {
            error = `Error during SharePoint file upload session request of ${relativePath} (${sessionResponse.statusCode}): \n${sessionResponse?.json?.error?.message ?? 'unknown'}`;
        }
        const uploadUrl = sessionResponse?.json?.uploadUrl;
        if (!uploadUrl) {
            error = `No upload URL given: \n${JSON.stringify(sessionResponse?.json ?? {}, null, 2)}`;
        }
        return {
            error,
            uploadUrl,
        };
    };

    const uploadViaSession = async (relativePath, fileBuffer, fileSize, contentType) => {
        logger.info('Uploading file via UploadSession.');
        const fileResponse = await requestWrapper.doRequest('not-needed-here', {
            method: 'PUT',
            headers: {
                Prefer: 'bypass-shared-lock',
                'Content-Length': fileSize,
                'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
                'content-type': contentType,
                ...(await defaultHeaders()),
            },
        }, 60000, 'json', async () => {
            const { error, uploadUrl } = await generateUploadSession(relativePath, fileSize);
            return {
                error,
                newUrl: uploadUrl,
                newBody: fileBuffer,
            };
        }, [423]);
        return getUploadStatus(fileResponse, relativePath);
    };

    const uploadItemContent = async (item, fileBuffer, contentType) => {
        const url = item.id ? `${graphBaseUrl}/items/${item.id}/content` : `${graphBaseUrl}/root:/${item.relativePath}:/content`;
        const fileResponse = await requestWrapper.doRequest(url, {
            method: 'PUT',
            headers: {
                'content-type': contentType,
                ...(await defaultHeaders()),
            },
            body: fileBuffer
        }, 60000, 'json', null, [423]);
        if (fileResponse.statusCode !== 200 && fileResponse.statusCode !== 201) {
            const sharePointResponse = fileResponse.json;
            const message = sharePointResponse !== null ? sharePointResponse?.error?.message ?? 'unknown' : (fileResponse.text?.() || fileResponse.statusText);
            return {
                ok: false,
                message: `Error during SharePoint file upload of ${item.id || item.relativePath} (${fileResponse.statusCode}): ${message}`,
            };
        }
        return {
            ok: true,
            id: fileResponse.json.id,
            name: fileResponse.json.name,
            webUrl: fileResponse.json.webUrl,
        };
    };

    const uploadFileContentById = async (id, fileBuffer, contentType) => uploadItemContent({ id }, fileBuffer, contentType);

    const uploadFileContent = async (relativePath, fileBuffer, contentType) => uploadItemContent({ relativePath }, fileBuffer, contentType);

    const updateMetadata = async (relativePath, metadata, customMetadata = {}) => {
        const payload = customMetadata;
        if (metadata) {
            payload.RolloutVersion = metadata.rolloutVersion;
            payload.Rollout = metadata.rolloutTime;
        }
        const fileResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}:/listItem/fields`, {
            method: 'PATCH',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(await defaultHeaders()),
            },
            body: JSON.stringify(payload),
        });
        if (fileResponse.statusCode === 200) {
            return null;
        }
        const errorMsg = `Error during SharePoint metadata update request of ${relativePath} (${fileResponse.statusCode})`;
        logger.error(`${errorMsg}: ${fileResponse.body}\n${JSON.stringify(payload)}`);
        return errorMsg;
    };

    const getFileVersionInfo = async (relativePath) => {
        const fileResponse = await requestWrapper.doRequest(`${graphBaseUrl}/root:/${relativePath}:/versions/current`, {
            method: 'GET',
            headers: await defaultHeaders(),
        });
        if (fileResponse.statusCode === 200) {
            return fileResponse.json.id;
        }
        logger.error(`Could not get file version ${relativePath}: (${fileResponse.status}): ${fileResponse.body}`);
        return null;
    };

    const getUserProfile = async (accessToken) => {
        if (!accessToken) return null;
        const loginResponse = await requestWrapper.doRequest(`${GRAPH_URL_BASE}me`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
        });
        if (loginResponse.statusCode === 200) {
            return loginResponse.json;
        }
        return null;
    };

    const isFilePatternMatched = (p) => {
        const {
            ignorePaths = ''
        } = runtime.getParameters({
            throwOnMissingParameter: false,
        }, 'ignorePaths');
    
        const ignorePathList = ignorePaths.split(',').map((s) => s.trim());
    
        return ignorePathList.find((ip) => p.includes(ip));
    };


    const crawlPath = async (folders) => {
        const allFiles = [];
        const headers = await defaultHeaders();
        while (folders.length !== 0) {
            const folder = folders.shift();
            logger.info(`Crawling ${folder}`);
            const uri = `${graphBaseUrl}/root:${folder}:/children?$top=${MAX_CHILDREN}`;
            // eslint-disable-next-line no-await-in-loop
            const res = await requestWrapper.doRequest(uri, {
                method: 'GET',
                headers,
            }, 10000, 'json', null, [404]);
            if (res.statusCode === 200) {
                // eslint-disable-next-line no-await-in-loop
                const { json } = res;
                // eslint-disable-next-line no-await-in-loop
                const driveItems = json.value;
                for (let di = 0; di < driveItems?.length; di += 1) {
                    const item = driveItems[di];
                    const itemPath = `${item.parentReference.path.split(':')[1]}/${item.name}`;
                    if (!isFilePatternMatched(itemPath)) {
                        if (item.folder) {
                            // it is a folder
                            logger.info(`Item Path ${itemPath}`);
                            folders.push(itemPath);
                        } else {
                            const convertedPath = handleExtension(itemPath);
                            allFiles.push(convertedPath);
                        }
                    } else {
                        logger.info(`Ignored from crawl: ${itemPath}`);
                    }
                }
            }
        }
        return allFiles;
    };

    const indexExcelData = (urls) => {
        if (!urls || !urls.length) return null;
        return {
            ':version': 3,
            ':names': [
                'urls',
            ],
            ':type': 'multi-sheet',
            urls: {
                total: urls?.length || 0,
                offset: 0,
                limit: urls?.length || 0,
                data: urls?.map((URL) => ({ URL })),
            },
        };
    }

    const updatePreviewIndex = async (tenant, rootFolder, lang, country, files) => {
        const indexFile = `${rootFolder}/${lang}/${country}/preview-index.xlsx`;
        const excelContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const excelData = indexExcelData(files);
        if (excelData) {
            await filesWrapper.writeFile(`countryIndex/${tenant}/${lang}-${country}.json`, files);
            logger.info(`Excel Data ${JSON.stringify(excelData)}`);
            const excel = await json2excel(excelData);
            if (excel) {
                const resp = await uploadFileContent(indexFile, excel, excelContentType);
                if (!resp.ok) {
                    logger.info(`Failed simple upload of ${indexFile} `);
                    const resp2 = await uploadViaSession(indexFile, excel, excel.length, excelContentType);
                    if (resp2) {
                        logger.info(`Failed uploadViaSession of ${indexFile} with ${JSON.stringify(resp2)}`);
                    }
                }
            }
        }
        return indexFile;
    };

    const crawlLangCountry = async (tenant, siteRoot = '/') => {
        const rootFolder = siteRoot.length > 1 ? siteRoot.replace(/\/$/, '') : siteRoot;
        const allLangs = getLangCountries();
        const langCountryFiles = {};
        const indexFiles = [];
        await allLangs.reduce(async (acc1, lang) => {
            await acc1;
            await (getLangCountriesMap()[lang]).reduce(async (acc2, country) => {
                await acc2;
                const files = await crawlPath([`${rootFolder}/${lang}/${country}`]);
                langCountryFiles[`${lang}/${country}`] = files.map((f) => f.substring(rootFolder.length === 1 ? 0 : rootFolder.length));
                const indexFile = await updatePreviewIndex(tenant, rootFolder, lang, country, langCountryFiles[`${lang}/${country}`]);
                indexFiles.push(indexFile);
                return langCountryFiles;
            }, Promise.resolve([]));
            // Writing this to a XLS File
            return indexFiles;
        }, Promise.resolve([]));
        return indexFiles;
    };

    const generatePreviewIndex = async (tenant, siteRoot = '/', callback = async () => ({ paths: [] })) => {
        const rootFolder = siteRoot.length > 1 ? siteRoot.replace(/\/$/, '') : siteRoot;
        const allLangs = getLangCountries();
        const langCountryFiles = {};
        const indexFiles = [];
        await allLangs.reduce(async (acc1, lang) => {
            await acc1;
            await (getLangCountriesMap()[lang]).reduce(async (acc2, country) => {
                await acc2;
                logger.info(`Generating preview index for ${lang}/${country}`);
                const statusResponse = await callback(`/${lang}/${country}`);
                logger.info(`Status response: ${JSON.stringify(statusResponse)}`);
                langCountryFiles[`${lang}/${country}`] = statusResponse.paths;
                logger.info(`Preview index for ${lang}/${country} generated: ${langCountryFiles[`${lang}/${country}`]?.length > 0}`);
                if (langCountryFiles[`${lang}/${country}`]?.length > 0) {
                    const indexFile = await updatePreviewIndex(tenant, rootFolder, lang, country, langCountryFiles[`${lang}/${country}`]);
                    indexFiles.push(indexFile);
                }
                return langCountryFiles;
            }, Promise.resolve([]));
            // Writing this to a XLS File
            return indexFiles;
        }, Promise.resolve([]));
        return indexFiles;
    };

    return {
        getAuthToken,
        doesFileExist,
        downloadFile,
        uploadFileContent,
        uploadFileContentById,
        getFileMetadata,
        updateMetadata,
        getFileVersionInfo,
        getUserProfile,
        crawlLangCountry,
        updatePreviewIndex,
        generatePreviewIndex,
    };
};

export default initSharePoint;
