import {join} from "path";
import expectedOutput from './test-data/locations-expected.json';
import assert from "assert";

const originalEnv = Object.assign({}, process.env);

after(() => {
    process.env = originalEnv;
});

describe('locationGeneration', () => {
    describe('#main()', function () {
        it('should generate proper output', function () {
            process.env.LOCATIONS_MASTER_FILE = join(__dirname, "test-data", "locations-master.json");
            process.env.LOCATIONS_ADDITIONAL_FILE = join(__dirname, "test-data", "locations-additional.json");
            process.env.LOCATIONS_EXCLUDE_FILE = join(__dirname, "test-data", "locations-exclude.json");
            process.env.OUTPUT_FILE = join(__dirname, "test-data", "locations.json");

            require("./generate").main();

            const generated = require("./test-data/locations.json");

            assert.deepEqual(generated, expectedOutput);
        });
    });
});
