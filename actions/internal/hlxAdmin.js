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

import { delay } from './tools.js';

const createHlxAdmin = (runtime) => {
    const { logger, requestWrapper } = runtime;

    const MAX_BULK_PREVIEW_STATUS_CHECKS = 100;
    const BULK_PREVIEW_STATUS_CHECK_INTERVAL = 8;
    const PREVIEW_JOB_SUCCESS_STATUS_CODES = [200, 304];

    const doTriggerSinglePreview = async (path, headers = {}) => {
        const adminRequest = await requestWrapper.doRequest(`https://admin.hlx.page/preview/${path}`, { method: 'POST', headers }, 30000);
        if (adminRequest.statusCode !== 200) {
            logger.error(`Unable to trigger preview for ${path} - ${adminRequest.statusCode} - ${adminRequest.statusText}`);
            return path;
        }
        return '';
    };

    const executeBulkPreviewJobRequest = async (relativePaths, repoPath, headers) => {
        const adminResponse = await requestWrapper.doRequest(`https://admin.hlx.page/preview/${repoPath}/*`,
            {
                method: 'POST',
                body: JSON.stringify({ paths: relativePaths }),
                headers: { ...headers, 'Content-Type': 'application/json' }
            },
            30000);
        if (adminResponse.statusCode !== 202) {
            logger.error(`Unable to trigger bulk preview for HTML Flow - ${adminResponse.statusCode} - ${adminResponse.statusText}`);
            return null;
        }
        const responseJson = await adminResponse.json;
        return responseJson.links?.self;
    };

    const executeBulkPreviewJobStatusRequest = async (scheduledPreviewJob, headers) => {
        let jobStatusJson;
        const getBulkPreviewJobStatus = async (retryAttempt = 1) => {
            const waitAndRecheckJobStatus = async () => {
                await delay(BULK_PREVIEW_STATUS_CHECK_INTERVAL * 1000);
                await getBulkPreviewJobStatus(retryAttempt + 1);
            };
            const jobDetailsResponse = await requestWrapper.doRequest(`${scheduledPreviewJob}/details`, { headers }, 30000);
            const jobDetailsReceived = jobDetailsResponse.statusCode === 200;
            if (!jobDetailsReceived && retryAttempt <= MAX_BULK_PREVIEW_STATUS_CHECKS) {
                logger.debug(`Retry Attempt - Job is not received # ${retryAttempt}`);
                await waitAndRecheckJobStatus();
            } else if (jobDetailsReceived) {
                jobStatusJson = await jobDetailsResponse.json;
                logger.debug(`Bulk Preview Job Details - state - ${JSON.stringify(jobStatusJson.state)} progress ${JSON.stringify(jobStatusJson.progress)}`);
                if (jobStatusJson.state !== 'stopped' && !jobStatusJson.cancelled && retryAttempt <= MAX_BULK_PREVIEW_STATUS_CHECKS) {
                    logger.debug(`Retry Attempt - Job is in progress # ${retryAttempt}`);
                    await waitAndRecheckJobStatus();
                }
            }
        };
        await getBulkPreviewJobStatus();
        return jobStatusJson;
    };

    const doTriggerBulkPreview = async (paths, headers = {}) => {
        logger.debug(`In bulk preview method ${paths}`);
        if (!paths || paths.length === 0) {
            return { errorMsg: 'No paths to preview.', failedPaths: [] };
        }
        const repoPath = paths[0].split('/').slice(0, 3).join('/');
        const relativePaths = paths.map((path) => path.replace(repoPath, ''));
        logger.debug(`In bulk preview - Repo Path: ${repoPath} , Relative Paths: ${relativePaths}`);
        const scheduledPreviewJob = await executeBulkPreviewJobRequest(relativePaths, repoPath, headers);
        if (!scheduledPreviewJob) {
            logger.error('Unable to get bulk preview job information');
            return { errorMsg: 'Unable to get bulk preview job information.', failedPaths: paths };
        }
        logger.info(`Bulk Preview Job Scheduled ${scheduledPreviewJob}`);
        const jobStatusJson = await executeBulkPreviewJobStatusRequest(scheduledPreviewJob, headers);
        if (jobStatusJson && jobStatusJson.state === 'stopped' && !jobStatusJson.cancelled) {
            logger.debug(`Bulk Preview Job End Details - state - ${JSON.stringify(jobStatusJson.state)} progress ${JSON.stringify(jobStatusJson.progress)}`);
            const failedPathsWithErrorCode = new Map();
            jobStatusJson.data?.resources?.filter((res) => !PREVIEW_JOB_SUCCESS_STATUS_CODES.includes(res.status)).forEach((res) => {
                failedPathsWithErrorCode.set(`${repoPath}${res.path}`, res.status);
            });
            return failedPathsWithErrorCode.size === 0 ? { errorMsg: '', failedPaths: [] } :
                { errorMsg: 'Preview Failed for some pages.', failedPaths: [...failedPathsWithErrorCode.keys()], failedPathsWithErrorCode };
        }
        const errorMsg = `Bulk Preview Job ${scheduledPreviewJob} did not run successfully`;
        logger.error(`${errorMsg}${jobStatusJson ? `Current state ${JSON.stringify(jobStatusJson.state)} progress ${JSON.stringify(jobStatusJson.progress)}` : ''}`);
        return { errorMsg, failedPaths: paths };
    };

    const triggerSinglePreview = async (path, authKeyId = '') => {
        const headers = { ...runtime.getHlxAdminAuthHeader(authKeyId) };
        return (await doTriggerSinglePreview(path, headers)) === '';
    };

    const triggerBulkPreview = async (paths, authKeyId = '') => {
        const headers = { ...runtime.getHlxAdminAuthHeader(authKeyId) };
        return doTriggerBulkPreview(paths, headers);
    };


    const extractLogs = async (repo, from, authKeyId = '') => {
        let to = new Date().toISOString();
        const paths = [];
        const headers = runtime.getHlxAdminAuthHeader(authKeyId);
        const url = `https://admin.hlx.page/log/${repo}?from=${from}`;
        let logs = await requestWrapper.doRequest(url, { headers }, 30000);
        while (logs?.statusCode === 200) {
            const resp = logs.json;
            logger.info(`Extract Logs ${url} : ${JSON.stringify(resp)}`);
            resp.entries.forEach((entry) => {
                if (entry.route === 'preview') {
                    if (entry.path) {
                        paths.push(entry.path);
                    } if (entry.paths?.length > 0) {
                        entry.paths.forEach((path) => {
                            paths.push(path);
                        });
                    }
                }
            });
            to = resp.to;
            logs = null;
            if (resp.links?.next) {
                // eslint-disable-next-line no-await-in-loop
                logs = await requestWrapper.doRequest(resp.links.next, { headers }, 30000);
            }
        }
        return { paths: [...new Set(paths)], to };
    };

    const triggerBulkStatusPreview = async (path, repo, authKeyId = '') => {
        const startDate = Date.now();
        let allDone = false;
        const headers = runtime.getHlxAdminAuthHeader(authKeyId);
        const payload = {
            select: [
                'preview'
            ],
            paths: [`${path}/*`]
        };
        const bulkStatusJob = await requestWrapper.doRequest(`https://admin.hlx.page/status/${repo}/*`,
            {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { ...headers, 'Content-Type': 'application/json' }
            }, 30000);
        if (bulkStatusJob?.statusCode === 200 || bulkStatusJob?.statusCode === 202) {
            const statusResponse = bulkStatusJob.json;
            // Wait for status to be updated
            while (!allDone && (Date.now() - startDate) < 1000 * 60 * 10) {
                // eslint-disable-next-line no-await-in-loop
                const bulkStatus = await requestWrapper.doRequest(`${statusResponse.links.self}/details`, { headers }, 30000);
                if (bulkStatus?.statusCode === 200) {
                    const resp = bulkStatus.json;
                    if (resp.state === 'stopped' && !resp.cancelled) {
                        allDone = true;
                        return {
                            paths: resp.data?.resources?.map((r) => r.path) || [],
                        };
                    }
                }
                // eslint-disable-next-line no-await-in-loop
                await delay(5000);
            }
        }
        return { errorMsg: `Bulk status not found and status call responded with ${bulkStatusJob?.statusCode}` };
    };

    return {
        triggerSinglePreview,
        triggerBulkPreview,
        extractLogs,
        triggerBulkStatusPreview,
    };
};

export default createHlxAdmin;
