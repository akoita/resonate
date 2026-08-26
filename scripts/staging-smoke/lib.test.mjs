import test from "node:test";
import assert from "node:assert/strict";

import {
  SmokeError,
  readWithLagRetry,
  writeWithLagRetry,
} from "./lib.mjs";

function logger() {
  return { messages: [], info(step, message) { this.messages.push({ step, message }); } };
}

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("writeWithLagRetry retries a simulation revert and succeeds", async () => {
  let calls = 0;
  const run = logger();
  const wallet = {
    async writeContract() {
      calls += 1;
      if (calls === 1) {
        const simulation = namedError("ContractFunctionExecutionError", "execution reverted: stale replica");
        simulation.cause = namedError("EstimateGasExecutionError", "execution reverted: stale replica");
        throw simulation;
      }
      return "0xsimulation-success";
    },
  };

  const hash = await writeWithLagRetry(wallet, {}, "chain-create", run, 3, 0);

  assert.equal(hash, "0xsimulation-success");
  assert.equal(calls, 2);
  assert.match(run.messages[0].message, /simulation reverted/);
});

test("writeWithLagRetry retries a nested nonce-too-low error and succeeds", async () => {
  let calls = 0;
  const run = logger();
  const wallet = {
    async writeContract() {
      calls += 1;
      if (calls === 1) {
        const wrapped = new Error("wallet submission failed");
        wrapped.cause = namedError("RpcRequestError", "nonce too low: next nonce 341, tx nonce 339");
        throw wrapped;
      }
      return "0xnonce-success";
    },
  };

  const hash = await writeWithLagRetry(wallet, {}, "cancel", run, 3, 0);

  assert.equal(hash, "0xnonce-success");
  assert.equal(calls, 2);
  assert.match(run.messages[0].message, /stale nonce/);
});

test("writeWithLagRetry exhausts bounded nested nonce retries with the cancel step", async () => {
  let calls = 0;
  const outerMessage = "wallet submission failed while cancelling";
  const wallet = {
    async writeContract() {
      calls += 1;
      const wrapped = new Error(outerMessage);
      wrapped.cause = namedError("RpcRequestError", "nonce too low: next nonce 341, tx nonce 339");
      throw wrapped;
    },
  };

  await assert.rejects(
    writeWithLagRetry(wallet, {}, "cancel", logger(), 4, 0),
    (error) => {
      assert.ok(error instanceof SmokeError);
      assert.equal(error.step, "cancel");
      assert.equal(error.message, outerMessage);
      return true;
    },
  );
  assert.equal(calls, 4);
});

test("writeWithLagRetry fails non-transient contract and transaction errors immediately", async () => {
  const hardContractRevert = namedError("ContractFunctionExecutionError", "execution reverted: CampaignNotFunded");
  hardContractRevert.cause = namedError("ContractFunctionRevertedError", "execution reverted: CampaignNotFunded");
  const failures = [
    new Error("contract reverted: CampaignNotFunded"),
    new Error("transaction underpriced"),
    hardContractRevert,
  ];

  for (const failure of failures) {
    let calls = 0;
    const wallet = {
      async writeContract() {
        calls += 1;
        throw failure;
      },
    };

    await assert.rejects(
      writeWithLagRetry(wallet, {}, "release", logger(), 5, 0),
      (error) => {
        assert.ok(error instanceof SmokeError);
        assert.equal(error.step, "release");
        assert.equal(error.message, failure.message);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("readWithLagRetry retries a nested unhealthy-backend provider error and succeeds", async () => {
  let calls = 0;
  const run = logger();
  const value = await readWithLagRetry(async () => {
    calls += 1;
    if (calls < 3) {
      const wrapped = new Error("RPC Request failed");
      wrapped.cause = new Error("no backend is currently healthy to serve traffic");
      throw wrapped;
    }
    return 84532;
  }, "preflight", run, 3, 0);

  assert.equal(value, 84532);
  assert.equal(calls, 3);
  assert.equal(run.messages.length, 2);
});

test("readWithLagRetry reports the step after transient errors are exhausted", async () => {
  let calls = 0;
  const message = "no backend is currently healthy to serve traffic";

  await assert.rejects(
    readWithLagRetry(async () => {
      calls += 1;
      throw new Error(message);
    }, "preflight", logger(), 2, 0),
    (error) => {
      assert.ok(error instanceof SmokeError);
      assert.equal(error.step, "preflight");
      assert.equal(error.message, message);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("readWithLagRetry fails non-transient RPC errors without retrying", async () => {
  let calls = 0;
  const message = "invalid RPC params for balanceOf";

  await assert.rejects(
    readWithLagRetry(async () => {
      calls += 1;
      throw new Error(message);
    }, "preflight", logger(), 5, 0),
    (error) => {
      assert.ok(error instanceof SmokeError);
      assert.equal(error.step, "preflight");
      assert.equal(error.message, message);
      return true;
    },
  );
  assert.equal(calls, 1);
});
