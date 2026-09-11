/** Bounded regular-file reads shared by catalog and candidate validation. */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/**
 * Read a regular file with a complete-byte cap; reject symlinks and non-files.
 * @param path - deployment-owned or operation-owned absolute file path.
 * @param limit - maximum complete file size in bytes.
 * @returns Complete bytes after the file handle closes.
 */
export async function boundedFile(path: string, limit: number): Promise<Buffer> {
  if (!(await lstat(path)).isFile()) throw new Error('bundle preparation: expected a regular file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!(await file.stat()).isFile()) throw new Error('bundle preparation: expected a regular file')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const result = await file.read(buffer, size, buffer.length - size, null)
      if (result.bytesRead === 0) break
      size += result.bytesRead
    }
    if (size > limit) throw new Error('bundle preparation: file exceeds byte limit')
    return buffer.subarray(0, size)
  } finally {
    await file.close()
  }
}
