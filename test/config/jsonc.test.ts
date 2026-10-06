import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "../../src/config/jsonc.ts";
import { OmtError } from "../../src/util/errors.ts";

function parseFails(text: string, message: string | RegExp): void {
  assert.throws(
    () => parseJsonc(text, "cfg.jsonc"),
    (error: unknown) => {
      assert.ok(error instanceof OmtError);
      assert.equal(error.code, "jsonc_parse");
      if (typeof message === "string") assert.equal(error.message, message);
      else assert.match(error.message, message);
      return true;
    },
  );
}

test("plain JSON parses", () => {
  assert.deepEqual(parseJsonc('{"a": [1, true, null, "x"]}', "f"), { a: [1, true, null, "x"] });
});

test("line and block comments are ignored", () => {
  const text = `// head
{
  "a": 1, // tail
  /* block
     over lines */ "b": /* inline */ 2
}`;
  assert.deepEqual(parseJsonc(text, "f"), { a: 1, b: 2 });
});

test("comment markers inside strings are text", () => {
  const text = '{"url": "https://x.dev/a", "c": "/* not */", "e": "q\\"//x"}';
  assert.deepEqual(parseJsonc(text, "f"), { url: "https://x.dev/a", c: "/* not */", e: 'q"//x' });
});

test("trailing commas before } and ] are allowed, also with comments between", () => {
  assert.deepEqual(parseJsonc('{"a": [1, 2,], "b": {"c": 1,},}', "f"), { a: [1, 2], b: { c: 1 } });
  assert.deepEqual(parseJsonc('{"a": 1, // last\n}', "f"), { a: 1 });
  assert.deepEqual(parseJsonc('{"a": 1, /* x */ }', "f"), { a: 1 });
});

test("a comma inside a string is kept", () => {
  assert.deepEqual(parseJsonc('{"a": ",}"}', "f"), { a: ",}" });
});

test("a UTF-8 byte order mark is stripped", () => {
  assert.deepEqual(parseJsonc('\uFEFF{"a": 1}', "f"), { a: 1 });
});

test("a syntax error reports source, line, and column", () => {
  parseFails('{\n  "a": 1\n  "b": 2\n}', /^cfg\.jsonc:3:3: /);
  parseFails('{"a": }', /^cfg\.jsonc:1:7: /);
  parseFails("[1 2]", /^cfg\.jsonc:1:4: /);
  parseFails("", /^cfg\.jsonc:1:1: /);
});

test("error positions stay the same after comments are blanked", () => {
  parseFails('// one\n/* two\n three */ {"a": x}', /^cfg\.jsonc:3:17: /);
});

test("error positions after a byte order mark count from the first real character", () => {
  parseFails('\uFEFF{"a" 1}', /^cfg\.jsonc:1:6: /);
});

test("an unterminated block comment is an error at its start", () => {
  parseFails('{\n  "a": 1 /* open', "cfg.jsonc:2:10: unterminated block comment");
});

test("two values in a row are an error", () => {
  parseFails('{"a": 1}\n{"b": 2}', /^cfg\.jsonc:2:1: /);
});
