type Client = { controller: ReadableStreamDefaultController; teamId: string };
const clients = new Set<Client>();

export function addClient(controller: ReadableStreamDefaultController, teamId: string): () => void {
  const client = { controller, teamId };
  clients.add(client);
  return () => clients.delete(client);
}

export function broadcastEvent(teamId: string, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(msg);
  for (const c of clients) {
    if (c.teamId === teamId) {
      try { c.controller.enqueue(encoded); } catch { clients.delete(c); }
    }
  }
}
