import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import readline from 'node:readline';
import type { LaunchCommand } from './launchArgs';

export interface GameHooks {
  onLine(line: string): void;
  onExit(code: number | null): void;
  onError(err: Error): void;
}

/** Lanza un proceso Java sin shell. Con `detached` sobrevive al launcher (sin registro de salida). */
export function launchGame(cmd: LaunchCommand, cwd: string, hooks: GameHooks, detached = false): ChildProcess {
  const stdio: StdioOptions = detached ? 'ignore' : ['ignore', 'pipe', 'pipe'];
  const child = spawn(cmd.command, cmd.args, { cwd, shell: false, detached, stdio });
  child.on('error', hooks.onError);
  if (detached) {
    child.unref();
    return child;
  }
  for (const s of [child.stdout, child.stderr]) {
    if (s) readline.createInterface({ input: s }).on('line', hooks.onLine);
  }
  child.on('exit', (code) => hooks.onExit(code));
  return child;
}
