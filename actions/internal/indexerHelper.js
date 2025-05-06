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
const initIndexerHelper = async (runtime) => {
    const { logger, filesWrapper } = runtime;
    const trackerFile = 'tracker/progress.json';

    const getIndexerTracker = async () => filesWrapper.readFileIntoObject(trackerFile);

    const updateIndexerTracker = async (tenant, status) => {
        const trackerData = await filesWrapper.readFileIntoObject(trackerFile);
        trackerData[tenant] = { status, at: Date.now() };
        await filesWrapper.writeFile(trackerFile, trackerData);
        return trackerData;
    }

    const resetIndexerTracker = async (tenant) => {
        const trackerData = await filesWrapper.readFileIntoObject(trackerFile);
        trackerData[tenant] = { status: 'STOPPED', at: Date.now() };
        await filesWrapper.writeFile(trackerFile, trackerData);
        return trackerData;
    }

    return {
        getIndexerTracker,
        updateIndexerTracker,
        resetIndexerTracker,
    }
};

export default initIndexerHelper;
