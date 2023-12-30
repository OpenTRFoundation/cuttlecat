import {createReadStream, readFileSync} from "fs";
import readline from "readline";
import {
    addDays as doAddDays,
    differenceInDays,
    eachDayOfInterval,
    format as doFormatDate,
    parse as doParseDate,
    startOfDay,
    subDays as doSubDays
} from "date-fns";

import {format as doFormatDateTz} from "date-fns-tz";
import lodash from "lodash";

export function formatDate(d:Date):string {
    return doFormatDate(d, "yyyy-MM-dd");
}

export function parseDate(s:string):Date {
    if (!s) {
        throw new Error("Date string is empty");
    }
    const date = doParseDate(s, "yyyy-MM-dd", now());
    return startOfDay(date);
}

export function now() {
    return new Date();
}

export function nowTimestamp() {
    return formatTimeStamp(now());
}

export function formatTimeStamp(date:Date) {
    return doFormatDate(date, "yyyy-MM-dd-HH-mm-ss");
}

/**
 * Returns ISO timestamp of given date but ignores the timezone of the current locale.
 */
export function formatISOTimeStampIgnoreTimezone(date:Date) {
    return doFormatDateTz(date, "yyyy-MM-dd'T'HH:mm:ss+00:00", {timeZone: "UTC"});
}

/**
 * See tests for examples.
 * @param start
 * @param end
 */
export function splitPeriodIntoHalves(start:Date, end:Date) {
    const periodLength = differenceInDays(end, start);
    if (periodLength < 1) {
        return [{
            start: start,
            end: end,
        }];
    }

    const firstHalfLength = Math.floor(periodLength / 2);

    return [
        {start: start, end: addDays(start, firstHalfLength)},
        {start: addDays(start, firstHalfLength + 1), end: end},
    ];
}

type DateRange = {
    start:Date;
    end:Date;
}

export function isPowerOfTwo(n:number):boolean {
    if (n <= 0) {
        return false;
    }
    // Using bitwise AND to check if only one bit is set to 1
    return (n & (n - 1)) === 0;
}

export function splitPeriodIntoParts(start:Date, end:Date, partCount:number):DateRange[] {
    if (!isPowerOfTwo(partCount)) {
        throw new Error(`partCount must be a power of 2: ${partCount}`);
    }
    if (partCount < 1) {
        throw new Error(`Invalid partCount: ${partCount}`);
    }
    if (differenceInDays(end, start) < 0) {
        throw new Error(`End date must be after start date: ${formatDate(start)}, ${formatDate(end)}`);
    }

    if (partCount == 1) {
        return [{
            start: start,
            end: end,
        }];
    }
    if (partCount == 2) {
        return splitPeriodIntoHalves(start, end);
    }

    const halves = splitPeriodIntoHalves(start, end)
    const ret = [];
    for (const half of halves) {
        ret.push(...splitPeriodIntoParts(half.start, half.end, partCount / 2));
    }
    return ret;
}

/**
 * Returns all days in the period, inclusive.
 * If the period is 1 day, then the same day is returned.
 * If the end date doesn't fit the step, then the last day before the end date that fits the step is returned.
 * For example, for <2023-01-01, 2023-01-04> and a step=2, the result is <2023-01-01, 2023-01-03>.
 *
 * @param start
 * @param end
 * @param step
 */
export function daysInPeriod(start:Date, end:Date, step:number) {
    try {
        const dates = eachDayOfInterval({start: start, end: end}, {step: step});
        for (let i = 0; i < dates.length; i++) {
            dates[i] = startOfDay(dates[i]);
        }
        return dates;
    } catch (e) {
        throw new Error(`Failed to get days in period <${formatDate(start)}, ${formatDate(end)}>, step=${step}: ${e}`);
    }
}

export function addDays(start:Date, days:number):Date {
    return doAddDays(start, days);
}

export function subtractDays(start:Date, days:number):Date {
    return doSubDays(start, days);
}

export async function readSlurpJsonFile<T>(filePath:string, callback:(lineObject:T) => void):Promise<void> {
    const fileStream = createReadStream(filePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const lineObject:T = JSON.parse(line);
        callback(lineObject);
    }
}

export function readSlurpJsonFileSync<T>(filePath:string):T[] {
    const ret:T[] = [];

    const fileContent = readFileSync(filePath, "utf8");
    const lines = fileContent.split("\n");
    for (let line of lines) {
        line = line.trim();
        if (!line) {
            continue;
        }
        const lineObject:T = JSON.parse(line);
        ret.push(lineObject);
    }

    return ret;
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * @param min
 * @param max
 * @param randGenerator
 */
export function getRandomInt(min:number, max:number, randGenerator?:() => number):number {
    const rand = randGenerator ? randGenerator() : Math.random();

    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(rand * (max - min + 1)) + min;
}

export function sortByKey<T>(dict:{ [key:string]:T }) {
    const sorted:{ [key:string]:T } = {};
    Object.keys(dict).sort().forEach(function (key) {
        sorted[key] = dict[key];
    });
    return sorted;
}

export function shuffleDictionary<T>(dict:{ [key:string]:T }) {
    const keys = lodash.shuffle(Object.keys(dict));
    const shuffled:{ [key:string]:T } = {};
    for (const key of keys) {
        shuffled[key] = dict[key];
    }
    return shuffled;
}
