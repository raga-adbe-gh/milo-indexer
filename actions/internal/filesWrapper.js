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

import Files from '@adobe/aio-lib-files';
import streamLib from 'stream';

const initFilesWrapper = async (logger) => {
    const files = await Files.init();

    const readFileInternal = async (filePath, logFileNotFound = true, options = {}) => {
        try {
            return await files.read(filePath, options);
        } catch (err) {
            if (logFileNotFound) {
                logger.error(`Error while reading file ${filePath}: ${err.message}`);
            }
            return null;
        }
    };

    const readFileIntoObject = async (filePath, logFileNotFound = true, options = {}) => {
        const data = await readFileInternal(filePath, logFileNotFound, options);
        try {
            return data ? JSON.parse(data.toString()) : {};
        } catch (err) {
            if (logFileNotFound) {
                logger.error(`Error while parsing file content of ${filePath}: ${err.message}`);
            }
            return {};
        }
    };

    const readProperties = async (filePath) => {
        try {
            return await files.getProperties(filePath);
        } catch (err) {
            logger.error(`Error while reading metadata of ${filePath}: ${err.message}`);
            return null;
        }
    };

    /**
     * Return the file as Buffer or an empty Buffer, when reading the file errored out.
     *
     * @param filePath {string} path to the file to read
     * @param logFileNotFound {boolean} whether a failure to read the file should be logged - defaults to true
     * @param options {object} aio-lib-files "remoteReadOptions" - default to an empty object
     * @returns {Buffer} the buffer with the file's content
     */
    const readFileIntoBuffer = async (filePath, logFileNotFound = true, options = {}) => {
        const data = await readFileInternal(filePath, logFileNotFound, options);
        return data ?? Buffer.alloc(0);
    };

    const writeFile = async (filePath, content) => {
        let finalData = content;
        if (!Buffer.isBuffer(content) && typeof content !== 'string' && !(content instanceof String)) {
            finalData = JSON.stringify(content);
        }
        try {
            await files.write(filePath, finalData);
        } catch (err) {
            logger.error(`Error while writing file ${filePath}: ${err.message}`);
        }
    };

    const createReadStream = async (filePath, options = {}) => files.createReadStream(filePath, options);

    const writeFileFromStream = async (filePath, stream) => {
        try {
            if (stream instanceof streamLib.Readable) {
                const chunks = [];
                // eslint-disable-next-line no-restricted-syntax
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                await files.write(filePath, Buffer.concat(chunks));
                const fileProps = await files.getProperties(filePath);
                if (!fileProps || !fileProps?.contentLength) {
                    return 'Error: Failed to determine the file size of the stored document.';
                }
                return null;
            }
            return 'Error: Unexpected stream.';
        } catch (err) {
            return `Error while writing file ${filePath}: ${err.message}`;
        }
    };

    const deleteObject = async (filePath) => {
        try {
            await files.delete(filePath);
        } catch (err) {
            logger.error(`Error while deleting ${filePath}: ${err.message}`);
        }
    };

    const listFiles = async (filePath) => {
        try {
            return files.list(filePath);
        } catch (err) {
            logger.error(`Error while listing files: ${err.message}`);
            return [];
        }
    };

    /**
     * List files in a folder with pagination support, up to 4000 files per page.
     * @param folderPath {string} The path to the folder to list files from.
     * @param limit {number} The maximum number of files to list per page.
     * @param marker {string} The continuation token to use for pagination.
     * @returns {Promise<{items: Array<{name: string, createdOn: string, lastModified: string}>, continuationToken: string}>} The list of files and the continuation token.
     */
    const listFilesPaginated = async (folderPath, limit = 4000, marker = null) => {
        try {
            const prefix = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;
            const items = [];
            const pageOpts = { maxPageSize: Math.min(limit, 5000) }; // Ensure limit doesn't exceed 5000
            if (marker) {
                pageOpts.continuationToken = marker;
            }
            const iterator = files.containerClientPrivate.listBlobsFlat({ prefix }).byPage(pageOpts);
            const response = (await iterator.next()).value;
            if (!response?.segment?.blobItems) {
                throw new Error('Invalid response from blob storage');
            }
            response.segment.blobItems.forEach((item) => {
                items.push({ name: item.name, createdOn: item.createdOn, lastModified: item.lastModified });
            });
            return {
                items,
                continuationToken: response.continuationToken,
            };
        } catch (err) {
            logger.error(`Error while listing files in ${folderPath}: ${err.message}`);
            return {
                items: [],
                continuationToken: null
            };
        }
    };

    const fileExists = async (filePath) => {
        const fileList = await listFiles(filePath);
        return !Array.isArray(fileList) || fileList.length !== 0;
    };

    return {
        writeFileFromStream,
        readFileIntoObject,
        readProperties,
        createReadStream,
        listFiles,
        listFilesPaginated,
        fileExists,
        writeFile,
        deleteObject,
        readFileIntoBuffer,
    };
};

export default initFilesWrapper;
