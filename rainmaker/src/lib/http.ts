import "server-only";
import { describeError } from "@/lib/claude/client";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

export function fail(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : describeError(err);
  if (status >= 500) console.error("[rainmaker]", err);
  return Response.json({ error: message }, { status });
}

/** Wrap a route handler so every error becomes a JSON { error } response. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err);
    }
  };
}

export type IdParams = { params: Promise<{ id: string }> };
