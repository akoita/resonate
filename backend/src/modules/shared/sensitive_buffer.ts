/**
 * SensitiveBuffer — Holds sensitive data (private keys) in a Buffer
 * that can be explicitly zeroed after use.
 *
 * Why not just use strings?
 * - JS strings are immutable and GC-managed — you can't overwrite their memory
 * - Buffers give us direct memory access to zero the contents
 * - After zero(), the key material is gone from process memory
 *
 * Usage:
 *   const key = new SensitiveBuffer(decryptedPrivateKey);
 *   try {
 *     await sign(key.toString());  // one-time read
 *   } finally {
 *     key.zero();  // overwrite memory with 0x00
 *   }
 */
export class SensitiveBuffer {
  private buffer: Buffer;
  private zeroed = false;

  constructor(data: string | Buffer) {
    this.buffer = typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.from(data); // copy — don't alias
  }

  /**
   * Read the sensitive data as a string.
   * Throws if already zeroed.
   */
  toString(): string {
    if (this.zeroed) {
      throw new Error("SensitiveBuffer has been zeroed — data is no longer available");
    }
    return this.buffer.toString("utf8");
  }

  /**
   * Read the sensitive data as a Buffer.
   * Returns a COPY — the internal buffer is not exposed.
   */
  toBuffer(): Buffer {
    if (this.zeroed) {
      throw new Error("SensitiveBuffer has been zeroed — data is no longer available");
    }
    return Buffer.from(this.buffer);
  }

  /**
   * Overwrite the buffer memory with zeros.
   * After this call, the data is irrecoverable.
   */
  zero(): void {
    if (!this.zeroed) {
      this.buffer.fill(0);
      this.zeroed = true;
    }
  }

  /**
   * Alias for zero().
   */
  dispose(): void {
    this.zero();
  }

  /**
   * Whether the buffer has been zeroed.
   */
  get isZeroed(): boolean {
    return this.zeroed;
  }

  /**
   * Length of the original data (available even after zeroing).
   */
  get length(): number {
    return this.buffer.length;
  }
}
