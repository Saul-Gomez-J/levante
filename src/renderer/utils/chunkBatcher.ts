/**
 * ChunkBatcher - Batches streaming chunks using requestAnimationFrame
 *
 * Groups chunks that arrive within a ~16ms window (one frame at 60fps)
 * to reduce React re-renders and improve perceived smoothness.
 *
 * @example
 * ```ts
 * const batcher = new ChunkBatcher<UIMessageChunk>((chunks) => {
 *   for (const chunk of chunks) {
 *     controller.enqueue(chunk);
 *   }
 * });
 *
 * // Add chunks as they arrive
 * batcher.add(chunk);
 *
 * // Cleanup when done
 * batcher.destroy();
 * ```
 */
export class ChunkBatcher<T> {
  private buffer: T[] = [];
  private frameId: number | null = null;
  private callback: (chunks: T[]) => void;
  private isDestroyed = false;

  constructor(callback: (chunks: T[]) => void) {
    this.callback = callback;
  }

  /**
   * Add a chunk to the buffer.
   * Schedules a flush on the next animation frame if not already scheduled.
   */
  add(chunk: T): void {
    if (this.isDestroyed) return;

    this.buffer.push(chunk);

    // Schedule flush on next animation frame if not already scheduled
    if (this.frameId === null) {
      this.frameId = requestAnimationFrame(() => {
        this.flush();
      });
    }
  }

  /**
   * Immediately flush all buffered chunks to the callback.
   */
  flush(): void {
    if (this.buffer.length > 0) {
      const chunks = this.buffer;
      this.buffer = [];
      this.callback(chunks);
    }
    this.frameId = null;
  }

  /**
   * Cancel pending frame and flush remaining chunks.
   * Call this when the stream ends.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    // Flush any remaining chunks
    this.flush();
  }

  /**
   * Check if there are pending chunks in the buffer.
   */
  get hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Get the current buffer size.
   */
  get pendingCount(): number {
    return this.buffer.length;
  }
}
