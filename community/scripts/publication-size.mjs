// Use decimal MB, which is stricter than a 15 MiB interpretation of Figma's
// publishing limit. Measure source files, never their ZIP download size.
export const PUBLICATION_LIMIT = 15_000_000;
export function checkPublicationSize(files) {
  const bytes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, Buffer.byteLength(content)]));
  const totalBytes = Object.values(bytes).reduce((total, size) => total + size, 0);
  if (totalBytes >= PUBLICATION_LIMIT)
    throw new Error(`Figma 发布代码共 ${totalBytes} 字节，必须小于 ${PUBLICATION_LIMIT} 字节。请先减少构建体积。`);
  return {limitBytes: PUBLICATION_LIMIT, totalBytes, remainingBytes: PUBLICATION_LIMIT - totalBytes, files: bytes};
}
