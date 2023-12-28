import assert from "assert";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {printIsLatestFileComplete} from "./latestQueueComplete.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('printLatestFileComplete', () => {
    describe('#printIsLatestFileComplete()', function () {
        it('should write true when complete', function () {
            assert(printIsLatestFileComplete(join(__dirname, "..", "test", "latestQueueComplete", "complete")));
        });
        it('should write false when incomplete', function () {
            assert(!printIsLatestFileComplete(join(__dirname, "..", "test", "latestQueueComplete", "incomplete")));
        });
        it('should write true when dir is blank', function () {
            assert(printIsLatestFileComplete(join(__dirname, "..", "test", "latestQueueComplete", "blank")));
        });
        it('should throw error when dir does not exist', function () {
            assert.throws(() => printIsLatestFileComplete(join(__dirname, "..", "test", "latestQueueComplete", "does-not-exist")));
        });
    });
});
