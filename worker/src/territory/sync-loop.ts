/** One exchange at a time. A stream of progress events cannot postpone the next
 * exchange indefinitely; idle workstations still receive remote actions. */
export class TerritorySyncLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private task: Promise<void> | null = null;
  private due = Infinity;
  private stopped = false;
  constructor(private readonly exchange: () => Promise<void>, private readonly pollMs = 15000, private readonly actionMs = 1500) {}
  changed() { this.schedule(this.actionMs); }
  private schedule(delay: number) {
    if (this.stopped || this.due <= Date.now() + delay) return;
    clearTimeout(this.timer); this.due = Date.now() + delay;
    this.timer = setTimeout(() => { this.due = Infinity; void this.flush(); }, delay);
    this.timer.unref?.();
  }
  async flush() {
    if (this.task) return this.task;
    clearTimeout(this.timer); this.due = Infinity;
    this.task = this.exchange().finally(() => { this.task = null; this.schedule(this.pollMs); });
    return this.task;
  }
  async close() { this.stopped = true; clearTimeout(this.timer); await this.task; await this.exchange(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
