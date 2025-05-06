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

import xlsx from 'xlsx';

const LOCALE_SPLIT = /[\n\r,]+/;

const listSplit = (localeString) => (localeString ? localeString.split(LOCALE_SPLIT).map((locale) => locale.trim()).filter((locale) => locale) : []);

const getUrlParts = (url, allowEmptyPaths = false) => {
    const urlParts = url.split('--');
    if (urlParts.length !== 3) {
        return null;
    }
    let edsPageIndex = urlParts[2].indexOf('.hlx.page');
    let sdl = '.hlx.';
    if (edsPageIndex < 0) {
        edsPageIndex = urlParts[2].indexOf('.aem.page');
        if (edsPageIndex >= 0) {
            sdl = '.aem.';
        }
    }
    if (edsPageIndex < 0 || edsPageIndex + (allowEmptyPaths ? 8 : 9) >= urlParts[2].length) {
        return null;
    }
    return {
        urlBranch: urlParts[0].slice(8), // remove "https://"
        urlRepo: urlParts[1],
        urlOwner: urlParts[2].slice(0, edsPageIndex),
        urlPathRemainder: urlParts[2].slice(edsPageIndex + 9), // 9 === ".hlx.page".length
        sdl
    };
};

const delay = (time) => new Promise((resolve) => {
    setTimeout(resolve, time);
});

const inParallel = async (elements, processElement, logger, ignoreResults = true, passParameter = null, numParallel = 5) => {
    const queue = [];
    queue.push(...elements);
    const workers = [];
    const workersLimit = Math.min(elements.length, numParallel);

    const processQueue = async () => {
        const result = [];
        let element = queue.pop();
        while (element) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const exec = await processElement(element, passParameter);
                if (!ignoreResults && exec) {
                    result.push(exec);
                }
            } catch (error) {
                logger.error(`Error processing element ${element}: ${error.message}\n`);
            }
            element = queue.pop();
        }
        return result;
    };

    for (let i = 0; i < workersLimit; i += 1) {
        workers.push(processQueue());
    }
    if (ignoreResults) {
        return Promise.all(workers);
    }
    const results = await Promise.all(workers);
    return results.reduce((prev, curr) => prev.concat(curr), []);
};

const errorOut = (message, statusCode = 500) => {
    const err = new Error(message);
    err.sendStatus = statusCode;
    throw err;
};

const simpleImsRequest = async (runtime, clientSecret, clientId, imsToken) => {
    const { imsUrl, requestWrapper } = runtime;
    return requestWrapper.formPostRequest(imsUrl, {
        grant_type: 'authorization_code',
        client_secret: clientSecret,
        client_id: clientId,
        code: imsToken,
    });
};

const fetchText = async (url, runtime) => {
    const authClient = await runtime.getAuthRequestClient();
    const finalUrl = authClient.getFinalUrl(url);
    const headers = {
        ...(await authClient.getAuthHeaders()),
    };
    const content = await runtime.requestWrapper.doRequest(finalUrl, { method: 'GET', headers }, 30000, 'plain');
    if (content.statusCode !== 200) {
        runtime.logger.error(`Error while fetching ${url}: ${content.statusCode} - ${content.statusText}`);
        return '';
    }
    return content.body.toString();
};

const getJsonFromUrl = async (url, runtime) => {
    const rawJson = await fetchText(url, runtime);
    return JSON.parse(rawJson);
};

const isMultiSheet = (json) => json[':type'] === 'multi-sheet' && json[':names'];

const json2excel = async (json) => {
    const workbook = xlsx.utils.book_new();
    function appendWorksheet(sheetName, sheetJson) {
        const { data } = sheetJson;
        if (data?.length >= 0) {
            const worksheet = xlsx.utils.json_to_sheet(data);
            xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
    }
    if (isMultiSheet(json)) {
        json[':names'].forEach((name) => {
            appendWorksheet(`helix-${name}`, json[name]);
        });
    } else {
        appendWorksheet('helix-default', json);
    }
    return xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
};

const getEntirePreviewJson = async (url, runtime) => {
    let json = await getJsonFromUrl(url, runtime);
    if (!isMultiSheet(json)) {
        const urlWithParams = new URL(url);
        urlWithParams.searchParams.append('sheet', 'default');
        urlWithParams.searchParams.append('sheet', 'dnt');
        urlWithParams.searchParams.append('sheet', 'non-default');
        json = await getJsonFromUrl(urlWithParams.href, runtime);
        if (json['non-default']) {
            let areSheetsAdded = false;
            const { data } = json['non-default'];
            if (data?.length > 0) {
                data.forEach((jsonObject) => {
                    const { sheetname } = jsonObject;
                    if (sheetname) {
                        areSheetsAdded = true;
                        urlWithParams.searchParams.append('sheet', sheetname);
                    }
                });
            }
            if (areSheetsAdded) {
                json = await getJsonFromUrl(urlWithParams.href, runtime);
            }
        }
    }
    return json;
};

const fetchPreviewContent = async (url, runtime) => (url.endsWith('.json') ? getEntirePreviewJson(url, runtime) : fetchText(url, runtime));

const badRequest = (message) => {
    const err = new Error(message);
    err.sendStatus = 400;
    throw err;
};

const clearErrors = async (runtime, lang) => {
    const projectState = await runtime.getProjectState();
    const errorList = await projectState.getErrorFileList(lang);
    const warningList = await projectState.getWarningFileList(lang);
    if (errorList.length > 0 || warningList.length > 0) {
        const doneList = await projectState.getDoneFileList(lang);
        await inParallel([...errorList, ...warningList], async (file) => {
            if (doneList.includes(file.split('/').pop())) {
                await runtime.filesWrapper.deleteObject(file);
            }
        }, runtime.logger);
        await projectState.clearCacheForLang(lang);
    }
};

const getTenantFromRepo = (repo) => repo?.replace(/-/g, '_').toUpperCase();

function handleExtension(path) {
    const pidx = path.lastIndexOf('/');
    const fld = path.substring(0, pidx + 1);
    let fn = path.substring(pidx + 1);

    if (fn.endsWith('.xlsx')) {
        fn = fn.replace('.xlsx', '.json');
    }
    if (fn.toLowerCase() === 'index.docx') {
        fn = '';
    }
    if (fn.endsWith('.docx')) {
        fn = fn.substring(0, fn.lastIndexOf('.'));
    }

    fn = fn
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-|-$/g, '');

    return `${fld}${fn}`;
}

const langCountriesMap = {
    en: ['apac', 'uk', 'in']
};

const getLangCountriesMap = () => langCountriesMap;

const getLangCountries = () => Object.keys(langCountriesMap);

const getCountryPaths = (lang) => langCountriesMap[lang]?.map((country) => `/${lang}/${country}`);

export {
    getUrlParts,
    listSplit,
    delay,
    inParallel,
    isMultiSheet,
    errorOut,
    simpleImsRequest,
    fetchText,
    fetchPreviewContent,
    json2excel,
    badRequest,
    clearErrors,
    getTenantFromRepo,
    handleExtension,
    getLangCountriesMap,
    getLangCountries,
    getCountryPaths,
};
