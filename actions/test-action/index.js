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
import actionHelper from '../action.js';

const actionMain = async (actionTools) => {
    return testSched(actionTools);
};

const testIndexer = async (actionTools) => {
    const { request, response, runtime } = actionTools;

    const result = {};

    const parameters = request.getParsedQueryParameters();
    if (!parameters.tenantUrl) {
        return response.errorResponse('Tenant URL is required! (e.g https://main--cc--adobecom.aem.page)');
    }
    const indexer = await runtime.getIndexerHelper(runtime, parameters.tenantUrl);
    result.response = await indexer.generatePreviewIndex();
    return response.successResponse(result);
};

const testSched = async (actionTools) => {
    const { response, runtime } = actionTools;
    const { logger } = runtime;
    const result = {};

    const {
        supportedTenants = '',
    } = runtime.getParameters({
        throwOnMissingParameter: false,
    }, 'supportedTenants');    
    if (!supportedTenants) {
        return response.errorResponse('No tenants are supported!');
    }
    let supportedTenantsList = supportedTenants.split(',').map((s) => s.trim());

    // Check the update indexer tracker
    const indexerHelper = await runtime.getIndexerHelper();
    let tracker = await indexerHelper.getIndexerTracker();
    // Read the entries and add if none found
    await supportedTenantsList.reduce(async (acc, t) => {
        await acc;
        tracker = await indexerHelper.updateIndexerTracker(t, 'STOPPED');
    }, Promise.resolve());

    const indexData = Object.keys(tracker).reduce((acc, t) => {
        const oneHourAgoDate = new Date(Date.now() - (60 * 60 * 1000));
        if (tracker[t].status === 'RUNNING' && tracker[t].at >= oneHourAgoDate) {
            acc.skip = true;
            acc.at = tracker[t].at;
            acc.tenant = t;
        } else if (!acc.skip && acc.at > tracker[t].at && tracker[t].status === 'STOPPED') {
            acc.at = tracker[t].at;
            acc.tenant = t;
        }
        return acc;
    }, { at: Date.now(), skip: false });

    if (indexData.skip || !indexData.tenant) {
        return response.errorResponse(`Tenant (${indexData.tenant || '-'}) is in progress or status mismatched`);
    }
    
    const tenantUrl = `https://main--${indexData.tenant}--adobecom.aem.page/`;
    logger.info(`Triggering index for ${tenantUrl}`);
    const indexer = await runtime.getIndexer(tenantUrl);
    result.response = await indexer.generatePreviewIndex();
    return response.successResponse(result);
};

const main = (async (params) => actionHelper(params, actionMain));
// eslint-disable-next-line import/prefer-default-export
export { main };
