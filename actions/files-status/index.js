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

import actionHelper from '../action.js';

const actionMain = async (actionTools) => {
    const { request, response, runtime } = actionTools;
    const { filesWrapper, logger } = runtime;

    const showContent = request.getParsedQueryParameters()['show-content'];
    if (showContent) {
        const fileContent = await filesWrapper.readFileIntoBuffer(showContent);
        try {
            return response.successResponse({
                fileName: showContent,
                fileContent: JSON.parse(fileContent.toString()),
            });
        } catch (err) {
            return response.successResponse({
                fileName: showContent,
                fileContent: fileContent.toString('base64'),
            });
        }
    }

    const showContentDetails = request.getParsedQueryParameters()['show-content-details'];
    if (showContentDetails) {
        const fileContent = await filesWrapper.readFileIntoBuffer(showContentDetails);
        const fileContentDetails = await filesWrapper.readProperties(showContentDetails);
        try {
            return response.successResponse({
                fileName: showContent,
                fileContent: JSON.parse(fileContent.toString()),
                metadata: fileContentDetails,
            });
        } catch (err) {
            return response.successResponse({
                fileName: showContent,
                fileContent: fileContent.toString('base64'),
                metadata: fileContentDetails,
            });
        }
    }

    const { files } = request.getParsedQueryParameters();
    if (files) {
        const allFiles = await filesWrapper.listFiles(`/${files}/`);
        const result = allFiles.map((fileProperty) => fileProperty.name);
        return response.successResponse(result);
    }

    return response.successResponse({ status: 'no action specified' });
};

const main = (async (params) => actionHelper(params, actionMain));
// eslint-disable-next-line import/prefer-default-export
export { main };
