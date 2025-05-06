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

import openwhisk from 'openwhisk';

const createOWHelper = (runtime) => {
    const ow = openwhisk();

    const startAction = async (actionName, params) => {
        const basicUserInfo = runtime.getBasicUserInfo();
        const paramsUpdated = { ...basicUserInfo, ...params };
        const invokation = await ow.actions.invoke({
            name: `miloindexer-0.0.1/__${actionName}`,
            blocking: false,
            result: false,
            params: paramsUpdated,
        });
        return invokation?.activationId;
    };

    const getActivation = async (id) => {
        try {
            return await ow.activations.get({ activationId: id });
        } catch (error) {
            runtime.logger.error(`Error: ${error.message}`);
            return null;
        }
    };

    return {
        getActivation,
        startAction,
    };
};

export default createOWHelper;
