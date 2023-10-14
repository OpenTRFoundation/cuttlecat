import assert from "assert";
import FileSystem from "./fileSystem";

describe('fileSystem', function () {
    describe('#getLatestProcessStateFile()', function () {
        it('should return latest correct stuff!', function () {
            const fileSystem = new FileSystem(__dirname, "test/fileSystem", "test-state-", ".json", "test-output-", ".txt");
            assert.equal(fileSystem.getDataDirectoryAbsolutePath(), __dirname + "/test/fileSystem");
            assert.equal(fileSystem.getLatestProcessStateFile(), __dirname + "/test/fileSystem/test-state-2023-01-01.json");
            assert.equal(fileSystem.getPathOfNewProcessStateFile().startsWith(__dirname + "/test/fileSystem/test-state-"), true);
            assert.equal(fileSystem.getPathOfNewProcessStateFile().endsWith(".json"), true);
            assert.equal(fileSystem.getNewProcessOutputFileName().startsWith("test-output-"), true);
            assert.equal(fileSystem.getNewProcessOutputFileName().endsWith(".txt"), true);
            assert.equal(fileSystem.getOutputFilePath("foo.txt"), __dirname + "/test/fileSystem/foo.txt");
        });
        it('should return null when latest file does not exist!', function () {
            const fileSystem = new FileSystem(__dirname, "test", "test-state-", ".json", "test-output-", ".txt");
            assert.equal(fileSystem.getLatestProcessStateFile(), null);
        });
        it('should throw an error when data dir does not exist!', function () {
            const fileSystem = new FileSystem(__dirname, "test/does-not-exist", "test-state-", ".json", "test-output-", ".txt");
            assert.throws(() => fileSystem.getLatestProcessStateFile(), Error);
        });
    });
});
