import {createLogger as winstonCreateLogger, format, transports} from "winston";

let logger = winstonCreateLogger({
    "format": format.combine(
        format.timestamp(),
        format.printf(({timestamp, level, message, service}) => {
            return `[${timestamp}] ${service} - ${level}: ${message}`;
        })
    ),
    transports: [
        // empty initially
    ],
    defaultMeta: {
        "service": "root",
    }
});

export function setLevel(level:string) {
    logger = logger.add(new transports.Console({
        level,
    }));
}

export function createLogger(name:string) {
    const child = logger.child({service: name});
    child.defaultMeta = {
        "service": name,
    };
    return child;
}
