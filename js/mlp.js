// Encrypted .mlp files, compatible with the mlp tool (https://github.com/EldinBegano/mask-decryption, see its SPEC.md):
//   "MLP1" | version | flags (v2 only) | ext length | ext | nonce (12) | mtime, atime (if flagged) | AES-256-GCM ciphertext + tag
// A version 2 header is bound to its ciphertext as GCM additional authenticated data.

const MLP_MAGIC = [0x4d, 0x4c, 0x50, 0x31];
const MLP_FLAG_TIMESTAMPS = 1;
const MLP_FLAG_COMPRESSED = 2;
const MLP_KEY_SIZE = 32;
const MLP_NONCE_SIZE = 12;
const MLP_TAG_SIZE = 16;
const MLP_TIMESTAMP_SIZE = 12;

class MlpAuthError extends Error {}

let zstdPromise = null;

function isEncryptedMlp(bytes) {
    return bytes.length >= MLP_MAGIC.length && MLP_MAGIC.every((byte, i) => bytes[i] === byte);
}

function readMlpHeader(bytes) {
    let pos = MLP_MAGIC.length;
    const take = (length) => {
        if (pos + length > bytes.length) {
            throw new Error('the file is truncated');
        }
        pos += length;
        return bytes.subarray(pos - length, pos);
    };

    const version = take(1)[0];
    if (version !== 1 && version !== 2) {
        throw new Error(`unsupported .mlp format version ${version}`);
    }
    const flags = version === 2 ? take(1)[0] : 0;
    if (flags & ~(MLP_FLAG_TIMESTAMPS | MLP_FLAG_COMPRESSED)) {
        throw new Error('it was made by a newer version of mlp');
    }
    const ext = new TextDecoder().decode(take(take(1)[0]));
    const nonce = take(MLP_NONCE_SIZE);
    if (flags & MLP_FLAG_TIMESTAMPS) {
        take(2 * MLP_TIMESTAMP_SIZE);
    }
    if (bytes.length - pos < MLP_TAG_SIZE) {
        throw new Error('the file is truncated');
    }

    return { version, ext, nonce, compressed: (flags & MLP_FLAG_COMPRESSED) !== 0, size: pos };
}

async function decryptMlp(bytes, key) {
    const header = readMlpHeader(bytes);
    const params = { name: 'AES-GCM', iv: header.nonce };
    if (header.version === 2) {
        params.additionalData = bytes.subarray(0, header.size);
    }

    let data;
    try {
        data = new Uint8Array(await crypto.subtle.decrypt(params, key, bytes.subarray(header.size)));
    } catch {
        throw new MlpAuthError('wrong key, or the file is damaged');
    }
    if (header.compressed) {
        data = (await loadZstd()).decompress(data);
    }
    return { ext: header.ext, data };
}

async function encryptMlp(data, ext, key) {
    // Same as mlp: keep the zstd-compressed form only if it is actually smaller
    const packed = (await loadZstd()).compress(data, 3);
    const compressed = packed.length < data.length;
    const extBytes = new TextEncoder().encode(ext);
    if (extBytes.length > 255) {
        throw new Error('the file extension is too long');
    }
    // The browser can't advance mlp's nonce counter file, so it uses a random nonce, which is mlp's own fallback
    const nonce = crypto.getRandomValues(new Uint8Array(MLP_NONCE_SIZE));

    const header = new Uint8Array(MLP_MAGIC.length + 3 + extBytes.length + MLP_NONCE_SIZE + 2 * MLP_TIMESTAMP_SIZE);
    header.set(MLP_MAGIC);
    header.set([2, MLP_FLAG_TIMESTAMPS | (compressed ? MLP_FLAG_COMPRESSED : 0), extBytes.length], MLP_MAGIC.length);
    header.set(extBytes, MLP_MAGIC.length + 3);
    header.set(nonce, MLP_MAGIC.length + 3 + extBytes.length);

    // mtime and atime are both the time of saving: int64 seconds + uint32 nanoseconds, big-endian
    const now = Date.now();
    const timestamps = new DataView(header.buffer, header.length - 2 * MLP_TIMESTAMP_SIZE);
    for (const offset of [0, MLP_TIMESTAMP_SIZE]) {
        timestamps.setBigInt64(offset, BigInt(Math.floor(now / 1000)));
        timestamps.setUint32(offset + 8, (now % 1000) * 1e6);
    }

    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: header }, key, compressed ? packed : data);
    const file = new Uint8Array(header.length + ciphertext.byteLength);
    file.set(header);
    file.set(new Uint8Array(ciphertext), header.length);
    return file;
}

function loadZstd() {
    if (!zstdPromise) {
        zstdPromise = Zstd.load();
    }
    return zstdPromise;
}

async function importKeyfile(file) {
    if (file.size !== MLP_KEY_SIZE) {
        throw new Error(`${file.name} is not an mlp keyfile (a keyfile is exactly ${MLP_KEY_SIZE} bytes).`);
    }
    // Not extractable: the page can encrypt and decrypt with it, but can never read the key bytes back
    return crypto.subtle.importKey('raw', await file.arrayBuffer(), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function useKeyStore(mode, action) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('mlp-editor', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('keys');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('keys', mode);
            const request = action(transaction.objectStore('keys'));
            transaction.oncomplete = () => {
                db.close();
                resolve(request.result);
            };
            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };
        };
    });
}

async function loadStoredKey() {
    return (await useKeyStore('readonly', store => store.get('keyfile'))) || null;
}

function storeKey(key) {
    return useKeyStore('readwrite', store => store.put(key, 'keyfile'));
}

function forgetStoredKey() {
    return useKeyStore('readwrite', store => store.delete('keyfile'));
}
