// Runs one JavaScript expression in Patch's dashboard on the emulator and prints the result as JSON.
// Usage: node cdp-eval.mjs "window.PatchAndroid.screenAccess()"
import { evaluate } from "./cdp.mjs";

try {
  console.log(JSON.stringify(await evaluate(process.argv[2])));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
