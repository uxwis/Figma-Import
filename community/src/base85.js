// RFC 1924 digits, with '<' replaced by ':' so an HTML raw-text payload can
// never contain a tag or enter the script parser's escaped-text states.
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;:=>?@^_`{|}~';

export function encodeBase85(bytes) {
  const chunks = [];
  let chunk = '';
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let value = bytes[offset] * 0x1000000 + (bytes[offset + 1] || 0) * 0x10000 +
      (bytes[offset + 2] || 0) * 0x100 + (bytes[offset + 3] || 0);
    let group = '';
    for (let digit = 0; digit < 5; digit++) {
      group = alphabet[value % 85] + group;
      value = Math.floor(value / 85);
    }
    chunk += group;
    if (chunk.length >= 32768) { chunks.push(chunk); chunk = ''; }
  }
  chunks.push(chunk);
  return chunks.join('');
}

export function decodeBase85(text, byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || text.length !== Math.ceil(byteLength / 4) * 5)
    throw new Error('Invalid embedded source length');
  const digits = new Int16Array(128).fill(-1);
  for (let index = 0; index < alphabet.length; index++) digits[alphabet.charCodeAt(index)] = index;
  const bytes = new Uint8Array(byteLength);
  for (let offset = 0, output = 0; offset < text.length; offset += 5, output += 4) {
    let value = 0;
    for (let index = offset; index < offset + 5; index++) {
      const code = text.charCodeAt(index);
      if (code >= digits.length || digits[code] < 0) throw new Error('Invalid embedded source digit');
      value = value * 85 + digits[code];
    }
    if (value > 0xffffffff) throw new Error('Invalid embedded source group');
    for (let index = 3; index >= 0; index--) {
      if (output + index < byteLength) bytes[output + index] = value & 255;
      value = Math.floor(value / 256);
    }
  }
  return bytes;
}
