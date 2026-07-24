/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 响应体流式读取工具
 *
 * 防止恶意/异常目标网站返回超大响应体导致 Node 进程 OOM。
 * 流式读取并实时检查累计大小，超过限制立即中断流并抛出错误。
 *
 * 提供两种实现：
 * - readUndiciBodyWithLimit：处理 undici 的 BodyReadable（Node.js 流）
 * - readWebBodyWithLimit：处理 Web ReadableStream（fetch 响应体）
 */

/**
 * undici BodyReadable 最小接口
 *
 * 仅声明本模块需要的 on/destroy 方法，避免依赖 undici 内部类型。
 * 调用方需通过 `as unknown as UndiciBodyLike` 转换。
 */
export interface UndiciBodyLike {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  destroy(): void;
}

/**
 * 从 undici BodyReadable 读取响应体并限制大小
 *
 * @param body undici 响应体（可为 null）
 * @param maxSize 最大字节数
 * @returns 响应体字符串（utf-8 解码）
 * @throws Error 当响应体累计大小超过 maxSize
 */
export function readUndiciBodyWithLimit(
  body: UndiciBodyLike | null,
  maxSize: number,
): Promise<string> {
  if (!body) return Promise.resolve("");
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    body.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        body.destroy();
        reject(new Error(`Response body exceeds ${maxSize} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    body.on("error", reject);
  });
}

/**
 * 从 Web ReadableStream 读取响应体并限制大小
 *
 * @param body Web ReadableStream（可为 null）
 * @param maxSize 最大字节数
 * @returns 响应体字符串（utf-8 解码）
 * @throws Error 当响应体累计大小超过 maxSize
 */
export async function readWebBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxSize: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > maxSize) {
        await reader.cancel();
        throw new Error(`Response body exceeds ${maxSize} bytes`);
      }
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }
    return new TextDecoder("utf-8").decode(combined);
  } finally {
    reader.releaseLock();
  }
}
