import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ensureExecutablePermissions } from "../src/runner/ptyPreflight.js";

test("ensureExecutablePermissions adds execute bits when missing", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "claws-pty-preflight-")
  );
  const filePath = path.join(tempDir, "spawn-helper");
  fs.writeFileSync(filePath, "#!/bin/sh\necho ok\n", { mode: 0o644 });

  const result = ensureExecutablePermissions(filePath);
  const mode = fs.statSync(filePath).mode & 0o777;

  assert.equal(result.changed, true);
  assert.equal(result.executable, true);
  assert.equal(mode, 0o755);
});

test("ensureExecutablePermissions keeps executable files unchanged", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "claws-pty-preflight-")
  );
  const filePath = path.join(tempDir, "spawn-helper");
  fs.writeFileSync(filePath, "#!/bin/sh\necho ok\n", { mode: 0o755 });

  const result = ensureExecutablePermissions(filePath);
  const mode = fs.statSync(filePath).mode & 0o777;

  assert.equal(result.changed, false);
  assert.equal(result.executable, true);
  assert.equal(mode, 0o755);
});
