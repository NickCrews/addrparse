/**
 * Trained-model cache shared by `pnpm eval` and the docs build: models/<impl>/<key>.bin, keyed
 * by the impl's source hash, training data hash (which covers the blend), seed and size, next to
 * a <key>.train.json with the training metrics and when, at which commit and on which machine
 * they were measured.
 * Also the child-process runner and the git/machine records that runs and the cache share.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { hashSplit } from "../data/load.ts";
import { MODELS_DIR, ROOT } from "../data/paths.ts";
import type { Task, TrainArgs } from "./child.ts";
import type { RunResult } from "./results.ts";

export type Training = NonNullable<RunResult["metrics"]["training"]>;

export const sha256 = (buf: Uint8Array | string) => createHash("sha256").update(buf).digest("hex");

/** Runs `child.ts <task>` in a fresh process and returns its RESULT. */
export function runChild<T>(task: Task, args: object, nodeFlags: string[] = []): Promise<T> {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      ...nodeFlags,
      join(import.meta.dirname, "child.ts"),
      task,
      JSON.stringify(args),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice("RESULT ".length)) as T);
      else reject(new Error(`${task} child exited with ${signal ?? code}`));
    });
  });
}

/** Trains in a fresh process, with heap room for the largest suites' training sets. */
export const trainInChild = (args: TrainArgs) =>
  runChild<Omit<Training, "cached" | "measured">>("train", args, ["--max-old-space-size=16384"]);

export function gitInfo(): RunResult["git"] {
  const git = (...args: string[]) => spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  // Saved runs are results, not code; they don't make the tree dirty.
  const status = git("status", "--porcelain", "--", ".", ":!results");
  return {
    sha: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim() !== "" : true,
  };
}

export function machineInfo(): RunResult["machine"] {
  return {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.availableParallelism(),
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
    load: os.loadavg()[0],
  };
}

export interface ModelRequest {
  impl: string;
  /** `implSourceHash(impl)`. */
  implHash: string;
  /** Train on the first `n` examples of the train split blended by `weights`. */
  n: number;
  /** Dataset → weight (`resolveBlend`). */
  weights: Record<string, number>;
  seed: number;
  /** Train even when a cached model exists. */
  retrain?: boolean;
  log(message: string): void;
}

/** Path of the cached model for `req`, training it first unless it is cached. */
export async function ensureModel(req: ModelRequest) {
  const { impl, implHash, n, seed, weights } = req;
  const trainHash = await hashSplit("train", n, weights);
  const key = sha256([implHash, trainHash, seed, n].join("|")).slice(0, 16);
  const dir = join(MODELS_DIR, impl);
  const model = join(dir, `${key}.bin`);
  const metaPath = join(dir, `${key}.train.json`);
  if (!req.retrain && existsSync(model) && existsSync(metaPath)) {
    const training = JSON.parse(readFileSync(metaPath, "utf8")) as Training;
    training.measured ??= { at: statSync(metaPath).mtime.toISOString() };
    return { model, trainHash, training: { ...training, cached: true } };
  }
  mkdirSync(dir, { recursive: true });
  const t0 = performance.now();
  req.log(`  train ${n.toLocaleString("en-US")} examples …`);
  const measured = { at: new Date().toISOString(), git: gitInfo(), machine: machineInfo() };
  const result = {
    measured,
    ...(await trainInChild({ impl, split: "train", n, seed, weights, out: model })),
  };
  writeFileSync(metaPath, JSON.stringify(result, null, 2) + "\n");
  req.log(`  train done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  return { model, trainHash, training: { ...result, cached: false } };
}
