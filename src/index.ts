/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Health check endpoint
  if (request.method === "GET" && (url.pathname === "/api/health" || url.pathname === "/api/ready")) {
    return new Response(
      JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        message: "xRelay is running",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      }
    );
  }

  // Default response
  return new Response(
    JSON.stringify({
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }
  );
}
