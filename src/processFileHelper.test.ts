import assert from "assert";
import {dirname} from 'path';
import {fileURLToPath} from 'url';

import {ProcessFileHelper} from "./processFileHelper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ProcessFileHelper', function () {
    describe('#getLatestProcessStateDirectory()', function () {
        it('should return latest correct stuff!', function () {
            const processFileHelper = new ProcessFileHelper(__dirname + "/test/processFileHelper");
            assert.equal(processFileHelper.getLatestProcessStateDirectory(), "2023-01-01-00-00-00");
            assert.equal(processFileHelper.getProcessStateFilePath("2023-01-01-00-00-00"), __dirname + "/test/processFileHelper/2023-01-01-00-00-00/state.json");
            assert.equal(processFileHelper.getProcessOutputFilePath("2023-01-01-00-00-00", "2102-12-12-12-12-12"), __dirname + "/test/processFileHelper/2023-01-01-00-00-00/output-2102-12-12-12-12-12.json");
            assert.deepEqual(processFileHelper.getProcessOutputFiles("2023-01-01-00-00-00"), ["output-2023-01-01-00-00-00.json"]);
        });
        it('should return null when latest file does not exist!', function () {
            const processFileHelper = new ProcessFileHelper(__dirname + "/test/processFileHelperEmpty");
            assert.deepEqual(processFileHelper.getProcessStateDirectories(), []);
        });
        it('should throw an error when data dir does not exist!', function () {
            const processFileHelper = new ProcessFileHelper(__dirname + "/test/does-not-exist");
            assert.throws(() => processFileHelper.getProcessStateDirectories(), Error);
        });
    });
});
