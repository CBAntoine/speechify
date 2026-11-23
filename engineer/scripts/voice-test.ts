/**
 * Run the engineer's conversation tests (src/voice/tests.ts) in ElevenLabs and
 * print the results. Run `npm run voice:sync` first so the tests match the code.
 *
 *   ELEVENLABS_API_KEY=... npm run voice:test
 *   npm run voice:test -- --repeat 3        run each test three times
 *   npm run voice:test -- --only password   only tests whose name contains "password"
 */
import { parseArgs } from "node:util";
import { eleven, fail, readSaved, requireKey } from "./eleven.ts";

interface TestRun {
  test_id: string;
  test_name?: string;
  status: string;
  condition_result?: { result?: string; rationale?: { summary?: string; messages?: string[] } };
}
interface Invocation {
  id: string;
  test_runs?: TestRun[];
}

const UNFINISHED = new Set(["pending", "running", "queued"]);

async function main() {
  requireKey();
  const { values } = parseArgs({ options: { repeat: { type: "string", default: "1" }, only: { type: "string" } } });
  const repeat = Math.min(50, Math.max(1, Number.parseInt(values.repeat ?? "1", 10) || 1));
  const saved = readSaved();
  if (!saved.agent_id || !saved.test_ids) fail("No agent or tests saved in voice-agent.json. Run npm run voice:sync first.");
  const wanted = Object.entries(saved.test_ids).filter(([name]) => !values.only || name.toLowerCase().includes(values.only.toLowerCase()));
  if (!wanted.length) fail(`No test name contains "${values.only}".`);

  const started = await eleven<Invocation>("POST", `/v1/convai/agents/${saved.agent_id}/run-tests`, {
    tests: wanted.map(([, id]) => ({ test_id: id })),
    repeat_count: repeat,
  });
  console.log(`Running ${wanted.length} tests${repeat > 1 ? `, ${repeat} times each` : ""} (${started.id})...`);

  let run = started;
  const deadline = Date.now() + 15 * 60_000;
  while ((run.test_runs ?? []).some((r) => UNFINISHED.has(r.status))) {
    if (Date.now() > deadline) fail(`Still running after 15 minutes. Check ${started.id} in the ElevenLabs dashboard.`);
    await new Promise((r) => setTimeout(r, 5_000));
    run = await eleven<Invocation>("GET", `/v1/convai/test-invocations/${started.id}`);
  }

  let failedTests = 0;
  for (const [name, id] of wanted) {
    const runs = (run.test_runs ?? []).filter((r) => r.test_id === id);
    const passed = runs.filter((r) => r.status === "passed").length;
    const ok = runs.length > 0 && passed === runs.length;
    if (!ok) failedTests++;
    console.log(`${ok ? "pass" : "FAIL"}  ${name} (${passed}/${runs.length})`);
    for (const r of runs.filter((x) => x.status !== "passed")) {
      const why = r.condition_result?.rationale?.summary || r.condition_result?.rationale?.messages?.join(" ") || r.status;
      console.log(`      ${why}`);
    }
  }
  console.log(failedTests ? `${failedTests} of ${wanted.length} tests failed.` : `All ${wanted.length} tests passed.`);
  if (failedTests) process.exit(1);
}

main().catch(fail);
