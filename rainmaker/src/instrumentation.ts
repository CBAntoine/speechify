// Runs once when a server starts, before it takes requests: puts the API keys
// saved in Settings > API keys into effect, so they last through restarts and
// redeploys until they're removed.

export async function register() {
  // `next dev` loads them on the first request instead: importing the store
  // here makes its hot reload refresh pages in a loop.
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { syncSavedKeys } = await import("./lib/store");
  // Don't hold up startup for long if the database is slow; reads retry.
  await Promise.race([
    syncSavedKeys(true).catch((err) => console.error("[rainmaker] couldn't load saved API keys at startup", err)),
    new Promise<void>((resolve) => setTimeout(resolve, 8000).unref()),
  ]);
}
