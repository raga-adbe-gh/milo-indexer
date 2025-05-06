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

const SHAREPOINT_TOKEN_ID = 'sp-auth';
const GLAAS_TOKEN_ID = 'glaas-auth';
const IMS_TOKEN_ID = 'ims-auth';
const IMS_PROXY_TOKEN_ID = 'ims-proxy';

const createTokenStorage = async (runtime) => {
    const { filesWrapper } = runtime;
    const FILES_BASE_PATH = 'auth-data/';
    const DEFAULT_VALID_ONE_HOUR = 3600000;
    const PADDING_10_SECONDS = 10000;
    const TOKEN_EXPIRES = '_token_expires_timestamp_';

    const getFilesPath = (id) => `${FILES_BASE_PATH}${id}.json`;

    /**
     * Read the token data from cache.
     *
     * @param dataId {string} key identifying the token
     * @returns {object} the token data or an empty object
     */
    const readData = async (dataId) => filesWrapper.readFileIntoObject(getFilesPath(dataId));

    /**
     * Caches the token.
     *
     * @param dataId {string} key identifying the data to be stored
     * @param tokenData {object} token and/or metadata to be stored
     */
    const storeData = async (dataId, tokenData) => {
        await filesWrapper.writeFile(getFilesPath(dataId), tokenData);
    };

    /**
     * Get an object holding an Auth Token and its expiration. The object has a single method "getToken", which will return the token, if valid
     * or use the "generateToken" function to request a new one, if the token is expired.
     *
     * @param tokenId {string} key for caching the token in aio-lib-files
     * @param generateToken {function} a function which returns an object containing the "token" and the "validFor" property
     * @param throwIfNoToken {boolean} throw an error, if the newly requested token is empty, defaults to true
     * @returns {object} containing the token, expiration (both inaccessible) and the "getToken" function
     */
    const getAuthToken = async (tokenId, generateToken, throwIfNoToken = true) => {
        let {
            token,
            [TOKEN_EXPIRES]: expires,
        } = await readData(tokenId);

        const getNewToken = async () => {
            const {
                token: newToken = '',
                validFor = DEFAULT_VALID_ONE_HOUR,
                expiresTimestamp,
            } = await generateToken();
            if (!newToken && throwIfNoToken) {
                throw new Error(`No token returned for ${tokenId}`);
            }
            token = newToken;
            if (expiresTimestamp) {
                expires = expiresTimestamp - PADDING_10_SECONDS;
            } else {
                expires = Date.now() - PADDING_10_SECONDS + validFor;
            }
            await storeData(tokenId, {
                [TOKEN_EXPIRES]: expires,
                token,
            });
        };

        const checkAndFetchToken = async () => {
            if (!expires || Date.now() > expires) {
                await getNewToken();
            }
        };

        await checkAndFetchToken();

        return {
            getToken: async () => {
                await checkAndFetchToken();
                return token;
            },
        };
    };

    return {
        getAuthToken,
        readData,
        storeData,
    };
};

export {
    createTokenStorage,
    GLAAS_TOKEN_ID,
    IMS_PROXY_TOKEN_ID,
    IMS_TOKEN_ID,
    SHAREPOINT_TOKEN_ID,
};
