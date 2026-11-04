import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setTorch, torchSupported } from "../react/src/lib/torch.ts";

test("torchSupported is true only with an explicit torch capability", () => {
  assert.equal(torchSupported({ getCapabilities: () => ({ torch: true }) }), true);
  assert.equal(torchSupported({ getCapabilities: () => ({ torch: false }) }), false);
  assert.equal(torchSupported({ getCapabilities: () => ({}) }), false);
  assert.equal(torchSupported({}), false);
  assert.equal(torchSupported(null), false);
  assert.equal(torchSupported(undefined), false);
  assert.equal(
    torchSupported({ getCapabilities: () => { throw new Error("denied"); } }),
    false,
  );
});

test("setTorch applies the advanced torch constraint", async () => {
  let sent: unknown = null;
  await setTorch({ applyConstraints: async (c) => { sent = c; } }, true);
  assert.deepEqual(sent, { advanced: [{ torch: true }] });
  await setTorch({ applyConstraints: async (c) => { sent = c; } }, false);
  assert.deepEqual(sent, { advanced: [{ torch: false }] });
});

test("setTorch throws when the track cannot take constraints", async () => {
  await assert.rejects(setTorch({}, true), /torch unsupported/);
  await assert.rejects(setTorch(null, true), /torch unsupported/);
  await assert.rejects(
    setTorch({ applyConstraints: async () => { throw new Error("OverconstrainedError"); } }, true),
    /OverconstrainedError/,
  );
});
