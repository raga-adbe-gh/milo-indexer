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

import AioLogger from '@adobe/aio-lib-core-logging';
import { hrtime } from 'process';
import requestHelper from './request.js';
import responseHelper from './response.js';
import initRuntime from './runtime.js';

/**
 * Create the main action helper, that will initialize the requestHelper, responseHelper and the AIO Logger
 *
 * @param params {object}: AIO params for the action
 * @param actionMain {function}: the main function of the action to execute
 * @param loggerName {string}: logger prefix; defaults to "main"
 * @returns {object} the response
 */
const actionHelper = async (params, actionMain, loggerName = 'main') => {
    const hrtimeToMillis = (time = [0, 0]) => Math.round(time[0] * 1e3 + time[1] / 1e6);
    const startTime = hrtime();
    const {
        __ow_query: queryParams = '',
        __ow_method: originalMethod = '',
        __ow_headers: headers = {},
        __ow_body: rawBody,
        LOG_LEVEL: logLevel = 'info',
    } = params;
    const userToken = headers['user-token'];

    const logger = AioLogger(loggerName, { level: logLevel });
    const request = requestHelper(queryParams, originalMethod, headers, rawBody);
    const response = responseHelper(request);

    if (request.isCorsPreflight()) {
        return response.corsResponse();
    }

    const extraParams = { userToken };
    const runtime = await initRuntime(params, request.getParsedQueryParameters(), extraParams, logger);
    let logActivationMessage = null;
    const logActivation = (msg) => {
        logActivationMessage = msg;
    };
    const doLogActivation = async () => {
        if (logActivationMessage && runtime.getProjectKey()) {
            await runtime.filesWrapper.writeFile(`${runtime.getProjectKey()}/activations/${Date.now()}.json`, {
                // eslint-disable-next-line no-underscore-dangle
                activationId: process.env.__OW_ACTIVATION_ID,
                message: logActivationMessage,
            });
        }
    };

    const createLogEntry = async (message) => {
        const projectKey = runtime.getProjectKey();
        if (!message || !projectKey) return;
        const { locUserEmailId: user = '' } = await runtime.getBasicUserInfo();
        const existingObject = await runtime.filesWrapper.readFileIntoObject(`${projectKey}/access.log`);
        const content = {
            // eslint-disable-next-line no-underscore-dangle
            activationId: process.env.__OW_ACTIVATION_ID,
            message,
            user,
            timestamp: new Date().toISOString(),
        };
        let updatedArray;
        if (Array.isArray(existingObject)) {
            updatedArray = existingObject;
            updatedArray.push(content);
        } else if (existingObject && Object.keys(existingObject).length > 0) {
            updatedArray = [existingObject, content];
        } else {
            updatedArray = [content];
        }
        await runtime.filesWrapper.writeFile(`${projectKey}/access.log`, updatedArray);
    };

    const authenticateUser = async () => {
        const {
            allowedUsers = ''
        } = runtime.getParameters({
            throwOnMissingParameter: false,
        }, 'allowedUsers');

        if (userToken) {
            const userInfo = await runtime.getUserProfile();
            if (!allowedUsers) {
                return true;
            }
            const mailCheck = RegExp(allowedUsers, 'i');
            return mailCheck.test(userInfo?.mail);
        }
        return !allowedUsers;
    };

    try {
        // Authenticate User
        const isValid = await authenticateUser();
        if (!isValid) {
            return response.errorResponse('Unauthorized', 401);
        }

        return await actionMain({
            request,
            response,
            runtime,
            logActivation,
            createLogEntry,
        });
    } catch (err) {
        const message = err.sendMessage ? `${err.sendMessage}: ${err.message}` : err.message;
        logger.error(`Action failed: ${message}\nStack:${err.stack}`);
        const errorCode = err.sendStatus ? err.sendStatus : 500;
        return response.errorResponse(message, errorCode);
    } finally {
        await runtime.requestWrapper.done();
        await doLogActivation();
        logger.info(`executed action in ${hrtimeToMillis(hrtime(startTime))}ms`);
    }
};

export default actionHelper;
