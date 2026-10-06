import { OmtError } from "../util/errors.ts";

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

function stripComments(text: string, source: string): string[] {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        i += text[i] === "\\" ? 2 : 1;
      }
      i++;
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
      i++;
      while (i < chars.length && chars[i] !== '"' && chars[i] !== "\n") {
        i += chars[i] === "\\" ? 2 : 1;
      }
      i++;
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
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.replace(/, ".*" is not valid JSON$/s, "").replace(/ in JSON at position \d+.*$/s, "");
    throw parseError(body, source, errorOffset(json), reason);
  }
}
