import { vi } from "vitest";

export function createMockFetch() {
  return vi.fn((_url: string, _options?: RequestInit) => {
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

export function createMockResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
