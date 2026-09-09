import * as path from 'path';

const payloadCache = new Map<string, any>();

export function mergePayloadCache(file: string, payload: any) {
    payloadCache.set(file, payload);
    return payload;
}

export function forgetWaveLayout(file: string) {
    const variants = new Set([file, file.replace(/\\/g, '/'), path.resolve(file), path.resolve(file).replace(/\\/g, '/')]);
    for (const key of [...payloadCache.keys()]) {
        if (variants.has(key) || variants.has(key.replace(/\\/g, '/'))) {
            payloadCache.delete(key);
        }
    }
}

export function hasWaveLayout(file: string): boolean {
    const variants = new Set([file, file.replace(/\\/g, '/'), path.resolve(file), path.resolve(file).replace(/\\/g, '/')]);
    return [...payloadCache.keys()].some(key => variants.has(key) || variants.has(key.replace(/\\/g, '/')));
}
