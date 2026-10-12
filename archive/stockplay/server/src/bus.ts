import type { Response } from 'express';

export type ServerEvent =
  | { kind: 'tick'; payload: unknown }
  | { kind: 'alerts'; payload: unknown }
  | { kind: 'settings'; payload: unknown }
  | { kind: 'book'; payload: unknown };

/** Fan-out for Server-Sent Events. Every dashboard and control page holds one
 *  connection and receives the same stream, so two open tabs stay in step. */
export class EventBus {
  private clients = new Set<Response>();

  add(res: Response): void {
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  get size(): number {
    return this.clients.size;
  }

  emit(event: ServerEvent): void {
    const frame = `event: ${event.kind}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        /* the socket is already gone */
      }
    }
    this.clients.clear();
  }
}
