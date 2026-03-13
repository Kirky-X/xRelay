import { vi } from 'vitest';

export function createMockFetch() {
  return vi.fn((url: string, options?: RequestInit) => {
    return Promise.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  });
}

export function createMockResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
