// Runs once when the Next.js server starts: the autopilot's timer starts with
// it, so scheduled posts go out without the dashboard open in a browser.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startServerAutopilot } = await import("./server/app");
  startServerAutopilot();
}
