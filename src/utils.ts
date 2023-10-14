import {
    addDays as doAddDays,
    differenceInDays,
    eachDayOfInterval,
    format as doFormatDate,
    parse as doParseDate,
    startOfDay,
    subDays as doSubDays
} from "date-fns";

export function formatDate(d:Date):string {
    return doFormatDate(d, "yyyy-MM-dd");
}

export function parseDate(s:string):Date {
    if (!s) {
        throw new Error("Date string is empty");
    }
    let date = doParseDate(s, "yyyy-MM-dd", new Date());
    return startOfDay(date);
}

export function nowTimestamp() {
    return formatTimeStamp(new Date());
}

export function formatTimeStamp(date:Date) {
    return doFormatDate(date, "yyyy-MM-dd-HH-mm-ss");
}

export function splitPeriodIntoHalves(start:Date, end:Date) {
    const periodLength = differenceInDays(end, start);
    if (periodLength < 1) {
        return [];
    }

    const firstHalfLength = Math.floor(periodLength / 2);

    return [
        {start: start, end: addDays(start, firstHalfLength)},
        {start: addDays(start, firstHalfLength + 1), end: end},
    ];
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
    let dates = eachDayOfInterval({start: start, end: end}, {step: step});
    for (let i = 0; i < dates.length; i++) {
        dates[i] = startOfDay(dates[i]);
    }
    return dates;
}

export function addDays(start:Date, days:number):Date {
    return doAddDays(start, days);
}

export function subtractDays(start:Date, days:number):Date {
    return doSubDays(start, days);
}
