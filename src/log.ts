import winston, {transports} from "winston";

let logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({timestamp, level, message, service}) => {
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
    let child = logger.child({service: name});
    child.defaultMeta = {
        "service": name,
    };
    return child;
}
