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
    const { response, runtime } = actionTools;

    const { tenantUrl } = runtime.getParameters({
        errorOutImmediately: true,
        errorMsg: 'Required parameters are missing',
    }, 'tenantUrl');

    const indexer = await runtime.getIndexer(tenantUrl);
    const result = await indexer.generatePreviewIndexUsingBs();
    return response.successResponse(result);
};

const main = (async (params) => actionHelper(params, actionMain));
// eslint-disable-next-line import/prefer-default-export
export { main };
