import assert from "assert";
import {expect} from "chai";
import {endOfDay} from "date-fns";
import {
    daysInPeriod,
    formatDate,
    formatISOTimeStampIgnoreTimezone,
    formatTimeStamp,
    parseDate,
    splitPeriodIntoParts
} from "./utils.js";

describe('utils', function () {
    describe('#formatISOTimeStampIgnoreTimezone()', function () {
        it('should format date as ISO timestamp', function () {
            assert.equal(formatISOTimeStampIgnoreTimezone(parseDate("2023-11-01")), "2023-11-01T00:00:00+00:00");
            assert.equal(formatISOTimeStampIgnoreTimezone(endOfDay(parseDate("2023-11-01"))), "2023-11-01T23:59:59+00:00");
        });
    });
    describe('#formatDate()', function () {
        it('should format date as YYYY-MM-DD', function () {
            assert.equal(formatDate(new Date(2023, 10, 1)), "2023-11-01");
        });
        it('should throw error when nothing is given', function () {
            assert.throws(() => formatDate(<any>undefined), Error);
        });
    });
    describe('#parseDate()', function () {
        it('should parse date as YYYY-MM-DD', function () {
            assert.equal(formatDate(parseDate("2023-11-01")), "2023-11-01");
        });
        it('should throw error when nothing is given', function () {
            assert.throws(() => parseDate(<any>undefined), Error);
        });
    });
    describe('#formatTimeStamp()', function () {
        it('should format date', function () {
            assert.equal(formatTimeStamp(parseDate("2023-11-01")), "2023-11-01-00-00-00");
        });
        it('should throw error when nothing is given', function () {
            assert.throws(() => formatTimeStamp(<any>undefined), Error);
        });
    });
    describe('#daysInPeriod()', function () {
        it('should return days in period, inclusive', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-02");
            const dates = daysInPeriod(start, end, 1);
            assert.equal(dates.length, 2);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
            assert.equal(formatTimeStamp(dates[1]), formatTimeStamp(end));
        });
        it('should return the same day, if the start==end', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-01");
            const dates = daysInPeriod(start, end, 1);
            assert.equal(dates.length, 1);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
        });
        it('should return the start day, if the start+step > end', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-03");
            const dates = daysInPeriod(start, end, 10);
            assert.equal(dates.length, 1);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
        });
        it('should not return days after end date', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-04");
            const dates = daysInPeriod(start, end, 2);
            assert.equal(dates.length, 2);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
            assert.equal(formatTimeStamp(dates[1]), formatTimeStamp(parseDate("2023-11-03")));
        });
        it('should throw exception if start>end', function () {
            const start = parseDate("2023-11-02");
            const end = parseDate("2023-11-01");
            assert.throws(() => daysInPeriod(start, end, 1), Error);
        });
        it('should throw exception if step<=0', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-02");
            assert.throws(() => daysInPeriod(start, end, 0), Error);
        });
    });
    describe('#splitPeriodIntoParts()', function () {
        type TestCase = {
            partCount:number,
            startDate:string,
            endDate:string,
            expectedParts:string[][],
            error:boolean
        };

        function testCase(partCount:number, start:string, end:string, ...expectedParts:string[]) {
            if (expectedParts.length % 2 != 0) {
                throw new Error(`Expected parts must be even, but got ${expectedParts.length}`);
            }
            const t:TestCase = {
                partCount: partCount,
                startDate: start,
                endDate: end,
                expectedParts: [],
                error: false,
            }

            for (let i = 0; i < expectedParts.length; i = i + 2) {
                const part = [expectedParts[i], expectedParts[i + 1]];
                t.expectedParts.push(part);
            }

            return t;
        }

        function testCaseWithError(partCount:number, start:string, end:string) {
            const t:TestCase = {
                partCount: partCount,
                startDate: start,
                endDate: end,
                expectedParts: [],
                error: true,
            }

            return t;
        }

        const TestCases:TestCase[] = [
            // ---- SPLIT TO 1/2 ----
            // basic case
            testCase(2, "2023-11-01", "2023-11-04", "2023-11-01", "2023-11-02", "2023-11-03", "2023-11-04"),
            // odd number of days
            testCase(2, "2023-11-01", "2023-11-03", "2023-11-01", "2023-11-02", "2023-11-03", "2023-11-03"),
            // 2 day period
            testCase(2, "2023-11-01", "2023-11-02", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02"),
            // 9 day period
            testCase(2, "2023-11-01", "2023-11-09", "2023-11-01", "2023-11-05", "2023-11-06", "2023-11-09"),
            // 10 day period
            testCase(2, "2023-11-01", "2023-11-10", "2023-11-01", "2023-11-05", "2023-11-06", "2023-11-10"),
            // start==end
            testCase(2, "2023-11-01", "2023-11-01", "2023-11-01", "2023-11-01"),
            // ---- SPLIT TO 1/4 ----
            // basic case
            testCase(4, "2023-11-01", "2023-11-04", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-04"),
            // not-matching number of days
            testCase(4, "2023-11-01", "2023-11-06", "2023-11-01", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-05", "2023-11-06", "2023-11-06"),
            // 4 day period
            testCase(4, "2023-11-01", "2023-11-04", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-04"),
            // 9 day period
            testCase(4, "2023-11-01", "2023-11-09", "2023-11-01", "2023-11-03", "2023-11-04", "2023-11-05", "2023-11-06", "2023-11-07", "2023-11-08", "2023-11-09"),
            // 10 day period
            testCase(4, "2023-11-01", "2023-11-10", "2023-11-01", "2023-11-03", "2023-11-04", "2023-11-05", "2023-11-06", "2023-11-08", "2023-11-09", "2023-11-10"),
            // start==end
            testCase(4, "2023-11-01", "2023-11-01", "2023-11-01", "2023-11-01"),
            // 2 day period
            testCase(4, "2023-11-01", "2023-11-02", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02"),
            // 3 day period
            testCase(4, "2023-11-01", "2023-11-03", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02", "2023-11-03", "2023-11-03"),
            // ---- SPLIT TO 1/8 ----
            // basic case
            testCase(8, "2023-11-01", "2023-11-08", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-04", "2023-11-05", "2023-11-05", "2023-11-06", "2023-11-06", "2023-11-07", "2023-11-07", "2023-11-08", "2023-11-08"),
            // short length
            testCase(8, "2023-11-01", "2023-11-04", "2023-11-01", "2023-11-01", "2023-11-02", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-04"),
            // 1 day extra
            testCase(8, "2023-11-01", "2023-11-09", "2023-11-01", "2023-11-02", "2023-11-03", "2023-11-03", "2023-11-04", "2023-11-04", "2023-11-05", "2023-11-05", "2023-11-06", "2023-11-06", "2023-11-07", "2023-11-07", "2023-11-08", "2023-11-08", "2023-11-09", "2023-11-09"),

            // ---- error cases ----
            testCaseWithError(0, "2023-11-01", "2023-11-03"),
            testCaseWithError(0.75, "2023-11-01", "2023-11-03"),
            testCaseWithError(1, "2023-11-01", "2023-10-31"),
            testCaseWithError(3, "2023-11-01", "2023-11-03"),
            testCaseWithError(-1, "2023-11-01", "2023-11-03"),
            testCaseWithError(-2, "2023-11-01", "2023-11-03"),
        ];

        for (const t of TestCases) {
            if (t.error) {
                it(`should throw error for splitting ${t.partCount} parts of period <${t.startDate}, ${t.endDate}>`, function () {
                    expect(() => splitPeriodIntoParts(parseDate(t.startDate), parseDate(t.endDate), t.partCount)).to.throw();
                });
            } else {
                it(`should return ${t.expectedParts.length} parts for splitting ${t.partCount} parts of period <${t.startDate}, ${t.endDate}>`, function () {
                    const parts = splitPeriodIntoParts(parseDate(t.startDate), parseDate(t.endDate), t.partCount);

                    // build a string representation of the parts
                    const partsStr:string[] = [];
                    for (const part of parts) {
                        partsStr.push(`[${formatDate(part.start)}, ${formatDate(part.end)}]`);
                    }

                    // build a string representation of the expected parts
                    const expectedPartsStr:string[] = [];
                    for (const part of t.expectedParts) {
                        expectedPartsStr.push(`[${part[0]}, ${part[1]}]`);
                    }

                    expect(partsStr).to.deep.equal(expectedPartsStr, `start=${t.startDate}, end=${t.endDate}, partCount=${t.partCount}`);
                    // for (let i = 0; i < parts.length; i++) {
                    //     const part = parts[i];
                    //     const expectedPart = t.expectedParts[i];
                    //     assert.equal(formatTimeStamp(part.start), formatTimeStamp(parseDate(expectedPart[0])));
                    //     assert.equal(formatTimeStamp(part.end), formatTimeStamp(parseDate(expectedPart[1])));
                    // }
                });
            }

        }
    });
});
