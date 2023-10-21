import {join} from "path";
import expectedOutput from './test-data/locations-expected.json';
import assert from "assert";

describe('locationGeneration', () => {
    describe('#main()', function () {
        it('should generate proper output', function () {
            require("./generate").start({
                locationsMasterFile: join(__dirname, "test-data", "locations-master.json"),
                locationsAdditionalFile: join(__dirname, "test-data", "locations-additional.json"),
                locationsExcludeFile: join(__dirname, "test-data", "locations-exclude.json"),
                outputFile: join(__dirname, "test-data", "locations.json"),
            });

            const generated = require("./test-data/locations.json");

            assert.deepEqual(generated, expectedOutput);
        });
    });
});
