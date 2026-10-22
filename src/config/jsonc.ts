import { errorMessage, OmtError } from "../util/errors.ts";

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function parseError(text: string, source: string, offset: number, reason: string): OmtError {
  const { line, column } = position(text, offset);
  return new OmtError("jsonc_parse", `${source}:${line}:${column}: ${reason}`);
}

function blank(char: string): string {
  return char === "\n" || char === "\r" ? char : " ";
}

function skipString(chars: ArrayLike<string>, start: number): number {
  let i = start + 1;
  while (i < chars.length && chars[i] !== '"' && chars[i] !== "\n") {
    i += chars[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

function stripComments(text: string, source: string): string[] {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i = skipString(text, i);
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = blank(text[i] as string);
        i++;
      }
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw parseError(text, source, i, "unterminated block comment");
      for (let j = i; j < end + 2; j++) out[j] = blank(text[j] as string);
      i = end + 2;
    } else {
      i++;
    }
  }
  return out;
}

function stripTrailingCommas(chars: string[]): void {
  let i = 0;
  while (i < chars.length) {
    const char = chars[i];
    if (char === '"') {
      i = skipString(chars, i);
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      while (j < chars.length && /\s/.test(chars[j] as string)) j++;
      if (chars[j] === "}" || chars[j] === "]") chars[i] = " ";
    }
    i++;
  }
}

// JSON.parse does not report a position for every error, so this scanner finds the offset of the first one.
function errorOffset(json: string): number {
  let i = 0;
  const fail = (): never => {
    throw i;
  };
  const ws = () => {
    while (i < json.length && " \t\n\r".includes(json[i] as string)) i++;
  };
  const expect = (char: string) => {
    if (json[i] !== char) fail();
    i++;
  };
  const string = () => {
    expect('"');
    for (;;) {
      const char = json[i];
      if (char === undefined || char < " ") fail();
      i++;
      if (char === '"') return;
      if (char === "\\") {
        const escape = json[i];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(json.slice(i + 1, i + 5))) fail();
          i += 5;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          i++;
        } else {
          fail();
        }
      }
    }
  };
  const value = (): void => {
    ws();
    const char = json[i];
    if (char === "{") {
      i++;
      ws();
      if (json[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        string();
        ws();
        expect(":");
        value();
        ws();
        if (json[i] === "}") {
          i++;
          return;
        }
        expect(",");
      }
    }
    if (char === "[") {
      i++;
      ws();
      if (json[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (json[i] === "]") {
          i++;
          return;
        }
        expect(",");
      }
    }
    if (char === '"') return string();
    for (const literal of ["true", "false", "null"]) {
      if (json.startsWith(literal, i)) {
        i += literal.length;
        return;
      }
    }
    const number = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    number.lastIndex = i;
    if (!number.test(json)) fail();
    i = number.lastIndex;
  };
  try {
    value();
    ws();
    return i;
  } catch (offset) {
    return offset as number;
  }
}

export function parseJsonc(text: string, source: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const chars = stripComments(body, source);
  stripTrailingCommas(chars);
  const json = chars.join("");
  try {
    return JSON.parse(json);
  } catch (error) {
    const reason = errorMessage(error).replace(/, ".*" is not valid JSON$/s, "").replace(/ in JSON at position \d+.*$/s, "");
    throw parseError(body, source, errorOffset(json), reason);
  }
}

interface Member {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
  comma: number | undefined; // offset of the comma after the value
}

function skipSpace(chars: string[], i: number): number {
  while (i < chars.length && /\s/.test(chars[i] as string)) i++;
  return i;
}

function skipValue(chars: string[], i: number): number {
  if (chars[i] === '"') return skipString(chars, i);
  if (chars[i] === "{" || chars[i] === "[") {
    let depth = 0;
    while (i < chars.length) {
      const char = chars[i];
      if (char === '"') {
        i = skipString(chars, i);
        continue;
      }
      if (char === "{" || char === "[") depth++;
      if (char === "}" || char === "]") depth--;
      i++;
      if (depth === 0) return i;
    }
    return i;
  }
  while (i < chars.length && !/[\s,}\]]/.test(chars[i] as string)) i++;
  return i;
}

// Comments are blanked in `chars`, so the offsets match the original text.
function rootMembers(chars: string[]): { open: number; close: number; members: Member[] } {
  const open = skipSpace(chars, 0);
  const members: Member[] = [];
  let i = skipSpace(chars, open + 1);
  while (chars[i] === '"') {
    const keyStart = i;
    const keyEnd = skipString(chars, i);
    const key = JSON.parse(chars.slice(keyStart, keyEnd).join("")) as string;
    const valueStart = skipSpace(chars, skipSpace(chars, keyEnd) + 1);
    const valueEnd = skipValue(chars, valueStart);
    i = skipSpace(chars, valueEnd);
    const comma = chars[i] === "," ? i : undefined;
    members.push({ key, keyStart, valueStart, valueEnd, comma });
    if (comma === undefined) break;
    i = skipSpace(chars, comma + 1);
  }
  return { open, close: skipSpace(chars, i), members };
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

// The whitespace before the key when the key starts its line.
function indentOf(text: string, member: Member | undefined): string | undefined {
  if (member === undefined) return undefined;
  const before = text.slice(lineStart(text, member.keyStart), member.keyStart);
  return /^[ \t]*$/.test(before) ? before : undefined;
}

// The end of the line at `offset` (before its "\r\n" or "\n") when only spaces and complete one-line comments
// follow there, else undefined. `offset` must lie outside strings and comments.
function endOfLine(text: string, offset: number): number | undefined {
  let i = offset;
  for (;;) {
    const char = text[i];
    if (char === undefined || char === "\n") return i;
    if (char === "\r" && text[i + 1] === "\n") return i;
    if (char === " " || char === "\t") {
      i++;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      if (end === -1) return text.length;
      return text[end - 1] === "\r" ? end - 1 : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end === -1 || text.slice(i, end).includes("\n")) return undefined;
      i = end + 2;
    } else {
      return undefined;
    }
  }
}

// Removes one member and the comma it needs, and keeps every comment. A property alone on its line takes the line with it.
function removeMember(body: string, members: Member[], index: number): string {
  const member = members[index] as Member;
  const own = member.comma;
  const comma = own ?? members[index - 1]?.comma;
  let start = member.keyStart;
  let end = member.valueEnd;
  const last = own ?? member.valueEnd - 1;
  const rest = body.slice(member.valueEnd, last + 1);
  const lineEnd = /^[ \t]*,?$/.test(rest) ? /^[ \t]*(\r?\n)/.exec(body.slice(last + 1)) : null;
  if (indentOf(body, member) !== undefined && lineEnd !== null) {
    start = lineStart(body, member.keyStart);
    end = last + 1 + lineEnd[0].length;
  }
  const ranges: [number, number][] = [[start, end]];
  if (comma !== undefined && (comma < start || comma >= end)) ranges.push([comma, comma + 1]);
  ranges.sort((a, b) => b[0] - a[0]);
  let out = body;
  for (const [from, to] of ranges) out = out.slice(0, from) + out.slice(to);
  return out;
}

function insertMember(body: string, chars: string[], open: number, close: number, members: Member[], key: string, json: string): string {
  const anchor = members.findLast((entry) => entry.key === "version" || entry.key === "defaults");
  const indent = indentOf(body, anchor ?? members[0]) ?? "  ";
  const property = `${JSON.stringify(key)}: ${json}`;
  const nl = body.includes("\r\n") ? "\r\n" : "\n";
  if (anchor !== undefined) {
    const comma = anchor.comma;
    const after = comma === undefined ? anchor.valueEnd : comma + 1;
    const lineEnd = endOfLine(body, after);
    const insert = lineEnd ?? after;
    const trailing = comma === undefined ? "" : ",";
    const added = lineEnd === undefined ? ` ${property}${trailing}` : `${nl}${indent}${property}${trailing}`;
    return comma === undefined
      ? body.slice(0, after) + "," + body.slice(after, insert) + added + body.slice(insert)
      : body.slice(0, insert) + added + body.slice(insert);
  }
  if (members.length > 0) {
    const insert = endOfLine(body, open + 1) ?? open + 1;
    return body.slice(0, insert) + `${nl}${indent}${property},` + body.slice(insert);
  }
  const multiline = chars.slice(open + 1, close).includes("\n");
  return body.slice(0, open + 1) + `${nl}${indent}${property}` + (multiline ? "" : nl) + body.slice(open + 1);
}

// Sets, adds, or (with undefined) removes one top-level key of a JSONC object. Every other byte stays.
// A new key goes after "version" or "defaults", whichever is last, or first in the object.
// With duplicate keys, a set replaces the last one and removes the others, and a removal removes them all.
export function setTopLevelValue(text: string, key: string, value: unknown | undefined): string {
  const bom = text.charCodeAt(0) === 0xfeff ? "﻿" : "";
  let body = bom === "" ? text : text.slice(1);
  const root = parseJsonc(body, "config");
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new OmtError("jsonc_edit", "cannot edit the config: its root is not an object");
  }
  const json = value === undefined ? undefined : JSON.stringify(value);
  const scan = () => {
    const chars = stripComments(body, "config");
    return { chars, ...rootMembers(chars) };
  };
  const first = scan();
  let members = first.members;
  const lastIndex = members.findLastIndex((member) => member.key === key);
  const member = members[lastIndex];
  if (json !== undefined && member === undefined) {
    body = insertMember(body, first.chars, first.open, first.close, members, key, json);
  } else if (json !== undefined && member !== undefined) {
    body = body.slice(0, member.valueStart) + json + body.slice(member.valueEnd);
  }
  for (;;) {
    ({ members } = scan());
    const matches = members.flatMap((entry, index) => (entry.key === key ? [index] : []));
    if (matches.length === 0 || (json !== undefined && matches.length === 1)) break;
    body = removeMember(body, members, matches[0] as number);
  }
  return bom + body;
}
