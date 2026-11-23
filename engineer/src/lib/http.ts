import "server-only";
import { BundleError } from "@/review/bundle.ts";
import { describeError } from "./claude";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Wrap a route handler so every failure becomes a JSON error a person can read. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof BundleError) return Response.json({ error: err.message }, { status: 400 });
      console.error("[engineer]", err);
      return Response.json({ error: describeError(err) }, { status: 502 });
    }
  };
}

export async function readJson<T>(req: Request, maxBytes = 4_000_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "That's too large to send from the browser. Use the command line for very large backups.");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, "The request wasn't valid JSON.");
  }
}

export const str = (v: unknown, max = 100_000): string => (typeof v === "string" ? v.slice(0, max) : "");
