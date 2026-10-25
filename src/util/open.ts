import { spawn } from "node:child_process";

function opener(url: string, platform: NodeJS.Platform): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", '""', url]];
  return ["xdg-open", [url]];
}

// Opens the URL in the default browser. Resolves to false when the opener cannot start; its exit code is not checked.
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [command, args] = opener(url, platform);
  return new Promise((resolve) => {
    try {
      // start reads the quoted window title verbatim, so cmd must get the arguments unquoted.
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: platform === "win32" });
      child.once("spawn", () => resolve(true));
      child.once("error", () => resolve(false));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}
