const rateLimitMap = new Map();

function rateLimiter(limit = 100, windowMs = 900000) {
    return function(req, res, next) {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const key = `${ip}:${req.path}`;
        const now = Date.now();

        const record = rateLimitMap.get(key) || {
            count: 0,
            resetTime: now + windowMs
        };

        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + windowMs;
        }

        record.count++;
        rateLimitMap.set(key, record);

        if (record.count > limit) {
            return res.status(429).json({
                error: 'Too many requests, please try again later',
                reset: new Date(record.resetTime).toISOString(),
                limit: limit,
                remaining: 0
            });
        }

        if (rateLimitMap.size > 10000) {
            const now = Date.now();
            for (const [k, v] of rateLimitMap) {
                if (now > v.resetTime) {
                    rateLimitMap.delete(k);
                }
            }
        }

        next();
    };
}

module.exports = { rateLimiter };