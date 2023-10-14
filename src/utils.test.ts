import assert from "assert";
import {daysInPeriod, formatDate, formatTimeStamp, parseDate, splitPeriodIntoHalves} from "./utils";

describe('utils', function () {
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
            let dates = daysInPeriod(start, end, 1);
            assert.equal(dates.length, 2);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
            assert.equal(formatTimeStamp(dates[1]), formatTimeStamp(end));
        });
        it('should return the same day, if the start==end', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-01");
            let dates = daysInPeriod(start, end, 1);
            assert.equal(dates.length, 1);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
        });
        it('should return the start day, if the start+step > end', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-03");
            let dates = daysInPeriod(start, end, 10);
            assert.equal(dates.length, 1);
            assert.equal(formatTimeStamp(dates[0]), formatTimeStamp(start));
        });
        it('should not return days after end date', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-04");
            let dates = daysInPeriod(start, end, 2);
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
    describe('#splitPeriodIntoHalves()', function () {
        it('should return halved period', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-04");
            const halves = splitPeriodIntoHalves(start, end);
            assert.equal(halves.length, 2);
            assert.equal(formatTimeStamp(halves[0].start), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[0].end), formatTimeStamp(parseDate("2023-11-02")));
            assert.equal(formatTimeStamp(halves[1].start), formatTimeStamp(parseDate("2023-11-03")));
            assert.equal(formatTimeStamp(halves[1].end), formatTimeStamp(parseDate("2023-11-04")));
        });
        it('should return halved period with odd number of days', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-03");
            const halves = splitPeriodIntoHalves(start, end);
            assert.equal(halves.length, 2);
            assert.equal(formatTimeStamp(halves[0].start), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[0].end), formatTimeStamp(parseDate("2023-11-02")));
            assert.equal(formatTimeStamp(halves[1].start), formatTimeStamp(parseDate("2023-11-03")));
            assert.equal(formatTimeStamp(halves[1].end), formatTimeStamp(parseDate("2023-11-03")));
        });
        it('should return halved period for 2 day period', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-02");
            const halves = splitPeriodIntoHalves(start, end);
            assert.equal(halves.length, 2);
            assert.equal(formatTimeStamp(halves[0].start), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[0].end), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[1].start), formatTimeStamp(parseDate("2023-11-02")));
            assert.equal(formatTimeStamp(halves[1].end), formatTimeStamp(parseDate("2023-11-02")));
        });
        it('should return halved period with 9 day period', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-09");
            const halves = splitPeriodIntoHalves(start, end);
            assert.equal(halves.length, 2);
            assert.equal(formatTimeStamp(halves[0].start), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[0].end), formatTimeStamp(parseDate("2023-11-05")));
            assert.equal(formatTimeStamp(halves[1].start), formatTimeStamp(parseDate("2023-11-06")));
            assert.equal(formatTimeStamp(halves[1].end), formatTimeStamp(parseDate("2023-11-09")));
        });
        it('should return halved period with 10 day period', function () {
            const start = parseDate("2023-11-01");
            const end = parseDate("2023-11-10");
            const halves = splitPeriodIntoHalves(start, end);
            assert.equal(halves.length, 2);
            assert.equal(formatTimeStamp(halves[0].start), formatTimeStamp(parseDate("2023-11-01")));
            assert.equal(formatTimeStamp(halves[0].end), formatTimeStamp(parseDate("2023-11-05")));
            assert.equal(formatTimeStamp(halves[1].start), formatTimeStamp(parseDate("2023-11-06")));
            assert.equal(formatTimeStamp(halves[1].end), formatTimeStamp(parseDate("2023-11-10")));
        });
        it('should return null, if start==end', function () {
            const start = parseDate("2023-11-01");
            const halves = splitPeriodIntoHalves(start, start);
            assert.equal(halves.length, 0);
        });
    });
});
