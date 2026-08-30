import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const README_LIMIT = 10_000;
const readmeUrl = new URL("../README.md", import.meta.url);

test("root README stays within the qq-workflows injection limit", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  const codePoints = Array.from(readme).length;
  assert.ok(codePoints < README_LIMIT,
    `README has ${codePoints} Unicode code points; expected fewer than ${README_LIMIT}`);
  assert.match(readme, /\[Provider usage\]\(docs\/provider-usage\.md\)/);
});
