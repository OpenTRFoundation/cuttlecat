import {formatDate, parseDate} from "../../utils";
import {expect} from "chai";
import {QueueConfig} from "./config";
import * as log from "../../log";
import {Command} from "./command";
import {TaskSpec} from "./task";
import {join} from "path";

// disable logging for tests
log.setLevel("warn");


function fakeNow():Date {
    return parseDate("2023-01-31");
}

function getKeysSortedByLocation(unresolved:{ [key:string]:TaskSpec }) {
    return Object.keys(unresolved).sort((a, b) => {
        return unresolved[a].location.localeCompare(unresolved[b].location);
    });
}

describe('focusProjectCandidateSearch unit test', () => {
    describe('#createNewProcessState()', function () {
        it('should create new process state for ./test-data/locations-json file', function () {
            const config:QueueConfig = {
                locationJsonFile: join(__dirname, "test-data", "locations.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(state.errored).to.be.empty;
            expect(state.archived).to.be.empty;
            expect(state.resolved).to.be.empty;
            expect(state.completionDate).to.be.null;
            expect(state.completionError).to.be.null;
            expect(formatDate(state.startDate)).to.be.equal(formatDate(fakeNow()));
            expect(state.startingConfig).to.be.equal(config);
            expect(state.outputFileName).to.be.equal("foo.json");
            expect(state.unresolved).to.be.not.empty;
            expect(Object.keys(state.unresolved)).to.have.lengthOf(3);

            const keys = getKeysSortedByLocation(state.unresolved);

            for (let i = 0; i < keys.length; i++) {
                // fixed
                expect(state.unresolved[keys[i]].id).to.be.not.null;
                expect(state.unresolved[keys[i]].parentId).to.be.null;
                expect(state.unresolved[keys[i]].originatingTaskId).to.be.null;
                // depends on input
                expect(state.unresolved[keys[i]].minFollowers).to.be.equal(config.minFollowers);
                expect(state.unresolved[keys[i]].minRepos).to.be.equal(config.minRepositories);
            }

            expect(state.unresolved[keys[0]].location).to.be.equal("Adana");
            expect(state.unresolved[keys[1]].location).to.be.equal("TR");
            expect(state.unresolved[keys[2]].location).to.be.equal("Turkey");
        });
        it('should create new process state for the sample output file of locationGeneration', function () {
            const config:QueueConfig = {
                locationJsonFile: join(__dirname, "..", "locationGeneration", "test-data", "locations.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            const state = command.createNewProcessState("foo.json", fakeNow);
            expect(Object.keys(state.unresolved)).to.have.lengthOf(22);

            let locations = Object.values(state.unresolved).map((o) => o.location);
            locations.sort(
                (a, b) => {
                    return a.localeCompare(b);
                }
            )

            expect(locations).to.deep.equal([
                "Adana",
                "Afyon",
                "Afyonkarahisar",
                "Afyonkarahısar",
                "Aladag",
                "Aladağ",
                "Basmakci",
                "Basmakçi",
                "Başmakci",
                "Başmakçi",
                "Basmakcı",
                "Basmakçı",
                "Başmakcı",
                "Başmakçı",
                "Ceyhan",
                "TR",
                "Turkey",
                "Turkiye",
                "Türkiye",
                "Turkıye",
                "Türkıye",
                "Zonguldak",
            ]);
        });
        it('should throw error when location file does not exist', function () {
            const config:QueueConfig = {
                locationJsonFile: join(__dirname, "test-data", "i-do-not-exist.json"),
                minFollowers: 1,
                minRepositories: 1,
            };
            let command = new Command(<any>{}, config, <any>{});
            expect(() => {
                command.createNewProcessState("foo.json", fakeNow);
            }).to.throw(Error);
        });
    });
});
