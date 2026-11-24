import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_DEFS,
  KEY_NAMES,
  SERVICES,
  applySavedKeys,
  cleanKey,
  deriveMaster,
  hostingValue,
  keyDef,
  kidOf,
  mask,
  newLedger,
  newStoredMaster,
  seal,
  storedMaster,
  unseal,
} from "../src/lib/keys-core.ts";
import { KEY_SERVICE_IDS, matchKeyService } from "../src/lib/copilot/screens.ts";

const def = (name: string) => {
  const d = keyDef(name);
  assert.ok(d, name);
  return d;
};

test("sealed keys open only with the right key and name", () => {
  const master = storedMaster(newStoredMaster());
  assert.ok(master);
  const value = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
  const sealed = seal("ANTHROPIC_API_KEY", value, master, "db");
  assert.equal(kidOf(sealed), "db");
  assert.ok(!sealed.includes(value) && !sealed.includes("abcdefghij"), "no plain text in the stored value");
  assert.equal(unseal("ANTHROPIC_API_KEY", sealed, { db: master }), value);
  // Bound to its name: can't be moved to another key.
  assert.equal(unseal("STRIPE_SECRET_KEY", sealed, { db: master }), null);
  // Wrong or missing encryption key.
  assert.equal(unseal("ANTHROPIC_API_KEY", sealed, { db: storedMaster(newStoredMaster()) }), null);
  assert.equal(unseal("ANTHROPIC_API_KEY", sealed, {}), null);
  // Tampering is detected.
  const parts = sealed.split(".");
  const flipped = parts[4][0] === "A" ? `B${parts[4].slice(1)}` : `A${parts[4].slice(1)}`;
  assert.equal(unseal("ANTHROPIC_API_KEY", [...parts.slice(0, 4), flipped].join("."), { db: master }), null);
  // Every seal is different (random IV).
  assert.notEqual(seal("ANTHROPIC_API_KEY", value, master, "db"), sealed);
});

test("SECRETS_KEY derives a stable encryption key", () => {
  const a = deriveMaster("correct horse battery staple, but longer");
  assert.equal(a.length, 32);
  assert.deepEqual(deriveMaster("correct horse battery staple, but longer"), a);
  assert.notDeepEqual(deriveMaster("something else entirely"), a);
  const sealed = seal("RESEND_API_KEY", "re_123456789abcdef", a, "env");
  assert.equal(kidOf(sealed), "env");
  assert.equal(unseal("RESEND_API_KEY", sealed, { env: a }), "re_123456789abcdef");
  assert.equal(unseal("RESEND_API_KEY", sealed, { db: a }), null, "kid must match");
  assert.equal(storedMaster("too-short"), undefined);
});

test("previews never show more than a prefix and the last 4 characters", () => {
  assert.equal(mask("sk-ant-api03-abcdefghijklmnopqrstuvwxyzAb12"), "sk-ant-api03-••••Ab12");
  assert.equal(mask("sk_live_51Habcdefghijklmnop9xYz"), "sk_live_••••9xYz");
  assert.equal(mask("AIzaSyD-1234567890abcdefghijkLmNo"), "AIza••••LmNo");
  assert.equal(mask("0123456789abcdef0123"), "••••0123");
  assert.equal(mask("short"), "••••");
  assert.equal(mask("Sam <sam@agency.com>", false), "Sam <sam@agency.com>");
  for (const v of ["sk_1234567890abcdef1234567890abcdef", "whsec_abcdefghijklmnopqrstuvwx", "re_abcdefghijklmnop_qrstuv"]) {
    const m = mask(v);
    const shown = m.replace("••••", "");
    assert.ok(shown.length <= Math.min(10, v.length / 2), `${m} shows too much`);
  }
});

test("pasted values are cleaned up and checked", () => {
  assert.deepEqual(cleanKey(def("ANTHROPIC_API_KEY"), '  "sk-ant-api03-xyz"  '), { value: "sk-ant-api03-xyz" });
  assert.deepEqual(cleanKey(def("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY=sk-ant-api03-xyz"), { value: "sk-ant-api03-xyz" });
  assert.ok("error" in cleanKey(def("ANTHROPIC_API_KEY"), "sk-proj-abc"));
  assert.ok("error" in cleanKey(def("ANTHROPIC_API_KEY"), "sk-ant-abc def"), "no spaces in keys");
  assert.ok("error" in cleanKey(def("ANTHROPIC_API_KEY"), ""));
  assert.ok("error" in cleanKey(def("ANTHROPIC_API_KEY"), 42));
  const pk = cleanKey(def("STRIPE_SECRET_KEY"), "pk_live_abc123");
  assert.ok("error" in pk && /publishable/.test(pk.error), "a publishable key is refused with a clear reason");
  assert.deepEqual(cleanKey(def("STRIPE_SECRET_KEY"), "rk_test_abc123"), { value: "rk_test_abc123" });
  assert.deepEqual(cleanKey(def("PAYPAL_MODE"), "Live"), { value: "live" });
  assert.ok("error" in cleanKey(def("PAYPAL_MODE"), "production"));
  assert.deepEqual(cleanKey(def("RESEND_FROM"), "Sam Rivera <sam@agency.com>"), { value: "Sam Rivera <sam@agency.com>" });
  assert.ok("error" in cleanKey(def("RESEND_FROM"), "Sam Rivera"));
});

test("only service keys can be saved, never the app's own settings", () => {
  assert.equal(new Set(KEY_NAMES).size, KEY_NAMES.length);
  assert.deepEqual(
    KEY_DEFS.map((d) => d.name),
    [...KEY_NAMES]
  );
  for (const blocked of ["APP_PASSWORD", "DATABASE_URL", "POSTGRES_URL", "CRON_SECRET", "SECRETS_KEY", "DATA_DIR", "NODE_ENV"]) assert.equal(keyDef(blocked), undefined, blocked);
  for (const d of KEY_DEFS) assert.ok(SERVICES.some((s) => s.id === d.service), d.name);
  assert.deepEqual(SERVICES.map((s) => s.id), [...KEY_SERVICE_IDS], "the copilot knows the same services");
});

test("a saved key wins, and Remove brings the hosting value back", () => {
  const env: Record<string, string | undefined> = { STRIPE_SECRET_KEY: "sk_test_hosting", OTHER: "x" };
  const ledger = newLedger();
  applySavedKeys(env, { STRIPE_SECRET_KEY: "sk_live_saved", ANTHROPIC_API_KEY: "sk-ant-saved" }, ledger);
  assert.equal(env.STRIPE_SECRET_KEY, "sk_live_saved");
  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-saved");
  assert.equal(hostingValue(env, ledger, "STRIPE_SECRET_KEY"), "sk_test_hosting");
  assert.equal(hostingValue(env, ledger, "ANTHROPIC_API_KEY"), undefined);
  // Syncing again changes nothing.
  applySavedKeys(env, { STRIPE_SECRET_KEY: "sk_live_saved", ANTHROPIC_API_KEY: "sk-ant-saved" }, ledger);
  assert.equal(env.STRIPE_SECRET_KEY, "sk_live_saved");
  assert.equal(hostingValue(env, ledger, "STRIPE_SECRET_KEY"), "sk_test_hosting");
  // Removed: Stripe goes back to the hosting key, Claude to unset.
  applySavedKeys(env, {}, ledger);
  assert.equal(env.STRIPE_SECRET_KEY, "sk_test_hosting");
  assert.ok(!("ANTHROPIC_API_KEY" in env), "unset, not the string 'undefined'");
  assert.equal(env.OTHER, "x");
  assert.equal(ledger.applied.size, 0);
  assert.equal(ledger.original.size, 0);
});

test("a hosting value that changes underneath (env reload) is respected", () => {
  const env: Record<string, string | undefined> = { RESEND_API_KEY: "re_old_hosting" };
  const ledger = newLedger();
  applySavedKeys(env, { RESEND_API_KEY: "re_saved" }, ledger);
  // Something reloads the env files and puts a new hosting value back.
  env.RESEND_API_KEY = "re_new_hosting";
  applySavedKeys(env, { RESEND_API_KEY: "re_saved" }, ledger);
  assert.equal(env.RESEND_API_KEY, "re_saved", "the saved key still wins");
  applySavedKeys(env, {}, ledger);
  assert.equal(env.RESEND_API_KEY, "re_new_hosting", "and Remove restores the newest hosting value");
});

test("the copilot spots requests about keys", () => {
  assert.equal(matchKeyService("add my Stripe key")?.id, "stripe");
  assert.equal(matchKeyService("where do I put the ElevenLabs API key?")?.id, "elevenlabs");
  assert.equal(matchKeyService("I have a Claude key")?.id, "claude");
  assert.equal(matchKeyService("paste my google places api key")?.id, "places");
  assert.equal(matchKeyService("set up paypal client id")?.id, "paypal");
  assert.equal(matchKeyService("open stripe payments"), null, "not about a key");
  assert.equal(matchKeyService("what's my key metric"), null, "no service named");
});
