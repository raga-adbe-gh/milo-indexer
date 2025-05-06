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

import maskData from 'maskdata';

const JSON_MASK_CONFIG = {
    passwordFields: ['password', 'IPAAS_API_KEY', 'IMS_TOKEN', 'IMS_CLIENT_SECRET', 'IMS_ACCESS_TOKEN', 'spCertContent'],
    passwordMaskOptions: {
        maskWith: '*',
        maxMaskedCharacters: 12,
        unmaskedEndCharacters: 3,
    }
};

const createLogHelper = (logger) => {
    const maskObject = (obj) => JSON.stringify(maskData.maskJSON2(obj, JSON_MASK_CONFIG), null, 2);

    const debug = (msg) => logger.debug(msg);
    const info = (msg) => logger.info(msg);
    const warn = (msg) => logger.warn(msg);
    const error = (msg) => logger.error(msg);

    const debugUnmasked = (obj) => logger.debug(maskObject(obj));
    const infoUnmasked = (obj) => logger.info(maskObject(obj));
    const warnUnmasked = (obj) => logger.warn(maskObject(obj));
    const errorUnmasked = (obj) => logger.error(maskObject(obj));

    return {
        debug,
        info,
        warn,
        error,
        debugUnmasked,
        infoUnmasked,
        warnUnmasked,
        errorUnmasked,
    };
};

export default createLogHelper;
