/** One exchange at a time. A stream of progress events cannot postpone the next
 * exchange indefinitely; idle workstations still receive remote actions. */
export class TerritorySyncLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private task: Promise<void> | null = null;
  private due = Infinity;
  private stopped = false;
  private generation = 0;
  constructor(private readonly exchange: () => Promise<void>, private readonly pollMs = 3000, private readonly actionMs = 100) {}
  changed() { this.generation++; this.schedule(this.actionMs); }
  private schedule(delay: number) {
    if (this.stopped || this.due <= Date.now() + delay) return;
    clearTimeout(this.timer); this.due = Date.now() + delay;
    this.timer = setTimeout(() => { this.due = Infinity; void this.flush().catch(() => undefined); }, delay);
    this.timer.unref?.();
  }
  async flush() {
    if (this.task) return this.task;
    clearTimeout(this.timer); this.due = Infinity;
    const generation = this.generation;
    this.task = Promise.resolve().then(this.exchange).finally(() => {
      this.task = null;
      // Changes committed while a request was in flight were not necessarily
      // included in its acknowledgement. Send them promptly, not at idle cadence.
      this.schedule(this.generation !== generation ? this.actionMs : this.pollMs);
    });
    return this.task;
  }
  async close() { this.stopped = true; clearTimeout(this.timer); await this.task; await this.exchange(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
