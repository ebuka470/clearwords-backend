import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const SCRYPT_OPTIONS = {
    N: 16384,
    r: 8,
    p: 1
};

export async function hashPassword(password) {
    if (typeof password !== 'string') {
        throw new Error('Password must be a string');
    }

    const salt = crypto
        .randomBytes(SALT_LENGTH)
        .toString('hex');

    const derivedKey = await scrypt(
        password,
        salt,
        KEY_LENGTH,
        SCRYPT_OPTIONS
    );

    return `${salt}:${Buffer.from(derivedKey).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
    if (
        typeof password !== 'string' ||
        typeof storedHash !== 'string' ||
        !storedHash.includes(':')
    ) {
        return false;
    }

    const separatorIndex = storedHash.indexOf(':');

    const salt = storedHash.slice(0, separatorIndex);
    const keyHex = storedHash.slice(separatorIndex + 1);

    if (!salt || !keyHex) {
        return false;
    }

    let storedKey;

    try {
        storedKey = Buffer.from(keyHex, 'hex');
    } catch {
        return false;
    }

    if (!storedKey.length) {
        return false;
    }

    try {
        const derivedKey = await scrypt(
            password,
            salt,
            storedKey.length,
            SCRYPT_OPTIONS
        );

        const derivedBuffer = Buffer.from(derivedKey);

        if (storedKey.length !== derivedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            storedKey,
            derivedBuffer
        );
    } catch {
        return false;
    }
}

export function validatePassword(password) {
    if (typeof password !== 'string') {
        return 'Password is required';
    }

    if (password.length < 8) {
        return 'Password must be at least 8 characters';
    }

    if (password.length > 128) {
        return 'Password must be 128 characters or fewer';
    }

    return null;
}