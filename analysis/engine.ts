import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { EngineScore } from "../lib/chess/evaluation";

/**
 * Stockfish, over a pipe.
 *
 * The engine is a separate executable spoken to in UCI, not a library. That is
 * the brief's "the Stockfish worker should be isolated from the live game
 * server", and it is also the cleanest footing under Stockfish's GPL: the club
 * runs the distro's engine, and nothing of it is compiled into this codebase.
 * `STOCKFISH_PATH` points at it; the default is `stockfish` on PATH.
 *
 * Nothing here knows what a blunder is. It reports what the engine said, and
 * `lib/chess/evaluation.ts` decides what that means.
 */

export type EngineOptions = {
  /** Command to spawn. Default: STOCKFISH_PATH, else "stockfish". */
  command?: string;
  /** Search depth. Fixed rather than timed so an analysis is reproducible. */
  depth?: number;
  threads?: number;
  /** Hash table, in MB. Small: these are eight children's games. */
  hashMb?: number;
  /** How long to wait for one position before giving up. */
  timeoutMs?: number;
};

export type PositionAnalysis = {
  /** Score for the side to move in the position given. */
  score: EngineScore;
  /** The engine's preferred move, in UCI, or null in a finished position. */
  bestUci: string | null;
};

export const DEFAULT_DEPTH = 16;

export class EngineError extends Error {}

/**
 * A running engine. Positions are analysed one at a time, in order — UCI is a
 * conversation, not a request/response API, so a second `go` before the first
 * `bestmove` would interleave two searches on one pipe.
 */
export class Engine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  /** Resolves when the engine is ready for the next command. */
  private busy: Promise<unknown> = Promise.resolve();

  private readonly command: string;
  readonly depth: number;
  private readonly threads: number;
  private readonly hashMb: number;
  private readonly timeoutMs: number;

  /** Reported by the engine at startup: "Stockfish 17.1". */
  name = "unknown engine";

  constructor(options: EngineOptions = {}) {
    // `||`, not `??`: an unset STOCKFISH_PATH and an explicitly empty one
    // (the documented "search PATH instead" value in .env.example) must both
    // fall through, and `??` only catches the former.
    this.command =
      options.command || process.env.STOCKFISH_PATH || "stockfish";
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.threads = options.threads ?? 1;
    this.hashMb = options.hashMb ?? 64;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async start(): Promise<void> {
    if (this.child) return;

    try {
      this.child = spawn(this.command, [], { stdio: "pipe" });
    } catch (err) {
      throw new EngineError(
        `Could not start "${this.command}": ${String(err)}`,
      );
    }

    this.child.on("error", (err) => {
      // A missing binary arrives here rather than as a throw from spawn.
      this.failure = new EngineError(
        `Could not start "${this.command}": ${err.message}. ` +
          `Install Stockfish, or set STOCKFISH_PATH.`,
      );
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.onLine(line));

    this.send("uci");
    await this.awaitLine((line) => line === "uciok");

    this.send(`setoption name Threads value ${this.threads}`);
    this.send(`setoption name Hash value ${this.hashMb}`);
    this.send("setoption name UCI_AnalyseMode value true");
    await this.ready();
  }

  /** Wait for the engine to finish digesting what it has been told. */
  private async ready(): Promise<void> {
    this.send("isready");
    await this.awaitLine((line) => line === "readyok");
  }

  /**
   * Analyse one position, given as the start position plus the moves that
   * reached it. Moves rather than a FEN so the engine sees the same repetition
   * and fifty-move history the game had — the same reason `positionAfter()`
   * replays rather than loading a FEN.
   */
  analyse(moves: string[]): Promise<PositionAnalysis> {
    // Serialise: one search at a time on one pipe.
    const run = this.busy.then(() => this.analyseNow(moves));
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async analyseNow(moves: string[]): Promise<PositionAnalysis> {
    if (!this.child) throw new EngineError("Engine is not running.");
    if (this.failure) throw this.failure;

    this.send(
      moves.length === 0
        ? "position startpos"
        : `position startpos moves ${moves.join(" ")}`,
    );

    let score: EngineScore | null = null;
    let bestUci: string | null = null;

    const onInfo = (line: string) => {
      const parsed = parseInfo(line);
      // Keep the deepest score seen; the last `info` before `bestmove` is the
      // engine's final word, and shallower lines arrive first.
      if (parsed) score = parsed;
    };

    this.send(`go depth ${this.depth}`);
    const best = await this.awaitLine(
      (line) => line.startsWith("bestmove"),
      onInfo,
    );

    const move = best.split(/\s+/)[1];
    bestUci = move && move !== "(none)" ? move : null;

    if (!score) {
      // A mated or stalemated position: the engine reports no score at all.
      return { score: { kind: "cp", cp: 0 }, bestUci: null };
    }

    return { score, bestUci };
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.send("quit");
    this.lines?.close();

    const child = this.child;
    this.child = null;
    this.lines = null;

    await new Promise<void>((resolve) => {
      const done = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.on("exit", () => {
        clearTimeout(done);
        resolve();
      });
    });
  }

  // --- the pipe ----------------------------------------------------------

  private failure: EngineError | null = null;
  private waiters: ((line: string) => void)[] = [];
  private observers: ((line: string) => void)[] = [];

  private send(command: string) {
    this.child?.stdin.write(`${command}\n`);
  }

  private onLine(line: string) {
    if (line.startsWith("id name ")) this.name = line.slice(8).trim();
    for (const observe of this.observers) observe(line);
    for (const waiter of [...this.waiters]) waiter(line);
  }

  /**
   * Resolve on the first line matching `match`, passing every line to
   * `observe` on the way — which is how `info` lines are collected while
   * waiting for `bestmove`.
   */
  private awaitLine(
    match: (line: string) => boolean,
    observe?: (line: string) => void,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new EngineError(
            `The engine went quiet for ${this.timeoutMs}ms. Is "${this.command}" really Stockfish?`,
          ),
        );
      }, this.timeoutMs);

      const waiter = (line: string) => {
        if (!match(line)) return;
        cleanup();
        resolve(line);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== waiter);
        if (observe) {
          this.observers = this.observers.filter((o) => o !== observe);
        }
      };

      if (observe) this.observers.push(observe);
      this.waiters.push(waiter);
    });
  }
}

/**
 * The score out of one `info` line, for the side to move.
 *
 * `lowerbound` and `upperbound` lines are skipped: they are the engine
 * mid-thought, and a bound taken for a score reads as a wild swing.
 */
export function parseInfo(line: string): EngineScore | null {
  if (!line.startsWith("info ")) return null;
  if (line.includes("lowerbound") || line.includes("upperbound")) return null;

  const mate = /\bscore mate (-?\d+)\b/.exec(line);
  if (mate) return { kind: "mate", moves: Number(mate[1]) };

  const cp = /\bscore cp (-?\d+)\b/.exec(line);
  if (cp) return { kind: "cp", cp: Number(cp[1]) };

  return null;
}
