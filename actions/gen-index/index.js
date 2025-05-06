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
    const { request, response, runtime } = actionTools;

    const result = {};

    const ow = runtime.getOpenWhisk();
    const parameters = request.getParsedQueryParameters();
    if (!parameters.tenantUrl) {
        return response.errorResponse('Tenant URL is required! (e.g https://main--cc--adobecom.aem.page)');
    }

    if (parameters?.usesp) {
        result.activationId = await ow.startAction('update-index-crawl-sp', { tenantUrl: parameters.tenantUrl });
        result.used = 'sharepoint';
    } else {
        result.activationId = await ow.startAction('update-index-using-bulkstatus', { tenantUrl: parameters.tenantUrl});
        result.used = 'bulkstatus';
    }

    return response.successResponse(result);
};

const main = (async (params) => actionHelper(params, actionMain));
// eslint-disable-next-line import/prefer-default-export
export { main };
