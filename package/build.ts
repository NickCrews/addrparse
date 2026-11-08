/**
 * Builds the `nerdress` npm package into an output directory (default `dist/`):
 *
 *   index.js      package/index.ts bundled by esbuild, with the crf model embedded as base64
 *   index.d.ts    package/index.ts's declarations
 *   package.json  package/package.json
 *   README.md     the repo's README.md plus a section on this release's model
 *   LICENSE       the repo's LICENSE plus the model attribution from LICENSING.md
 *
 *   pnpm package [--suite full] [--out dir] [--model models/crf/<key>.bin]
 *
 * The model is the suite's crf model from the models/ cache that `pnpm eval` and `pnpm docs`
 * share, trained on the default blend first if missing (a few minutes and ~1 GB for `full`).
 * `--model` embeds that file instead; the README still describes it as the suite's model, so pass
 * one that `pnpm eval crf --suite <suite>` trained at this commit.
 * Training reads `$NERDRESS_DATA_DIR` like the harness does. Publish with `npm publish dist`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import ts from "typescript";
import { SUITES, type SuiteName } from "../eval.config.ts";
import { load } from "../impls/crf/load.ts";
import { readAttribution } from "../docs/attribution.ts";
import { defaultWeights } from "../src/data/load.ts";
import { ROOT } from "../src/data/paths.ts";
import { implSourceHash } from "../src/eval/impl.ts";
import { ensureModel, gitInfo } from "../src/eval/models.ts";

const PKG = import.meta.dirname;
const REPO = "https://github.com/NickCrews/nerdress";

const { values: opts } = parseArgs({
  options: {
    suite: { type: "string", default: "full" },
    out: { type: "string", default: join(ROOT, "dist") },
    model: { type: "string" },
  },
});
if (!Object.hasOwn(SUITES, opts.suite!)) throw new Error(`unknown suite ${opts.suite}`);
const suite = opts.suite as SuiteName;
const config = SUITES[suite];
const out = resolve(opts.out!);
const log = (m: string) => process.stderr.write(m + "\n");

/** Wraps a paragraph to `width` columns. */
function wrap(text: string, width = 80): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].join("\n");
}

const modelPath = opts.model
  ? resolve(opts.model)
  : (
      await ensureModel({
        impl: "crf",
        implHash: implSourceHash("crf"),
        n: config.trainExamples,
        seed: config.seed,
        weights: defaultWeights(),
        log,
      })
    ).model;
const model = readFileSync(modelPath);
load(model); // throws on a model this code can't read
const modelSha = createHash("sha256").update(model).digest("hex");
const git = gitInfo();
if (!git.sha) throw new Error("not a git checkout; the README cites the commit");
if (git.dirty) log("warning: working tree has uncommitted changes; the README cites HEAD");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entry = join(PKG, "index.ts");
await build({
  entryPoints: [entry],
  outfile: join(out, "index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { __NERDRESS_MODEL__: JSON.stringify(model.toString("base64")) },
  absWorkingDir: ROOT,
  logLevel: "warning",
});

const dts = ts.transpileDeclaration(readFileSync(entry, "utf8"), {
  fileName: entry,
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext },
  reportDiagnostics: true,
});
if (dts.diagnostics?.length) {
  throw new Error(ts.formatDiagnostics(dts.diagnostics, ts.createCompilerHost({})));
}
if (/^\s*import\b/m.test(dts.outputText)) {
  throw new Error("index.d.ts imports another file; declare public types in package/index.ts");
}
writeFileSync(join(out, "index.d.ts"), dts.outputText);

const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { version: string };
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

const release = `

## This release's model

nerdress ${pkg.version} embeds a ${model.byteLength.toLocaleString("en-US")}-byte model (sha256
\`${modelSha}\`), the \`crf\` parser trained on the first
${config.trainExamples.toLocaleString("en-US")} examples of the default training blend, seed
${config.seed}, at commit [\`${git.sha.slice(0, 7)}\`](${REPO}/tree/${git.sha}). That commit's
\`src/data/\` and \`datasets/\` rebuild the training data from libpostal's 2017-03-04 snapshot.
`;
writeFileSync(join(out, "README.md"), readFileSync(join(ROOT, "README.md"), "utf8") + release);

writeFileSync(
  join(out, "LICENSE"),
  readFileSync(join(ROOT, "LICENSE"), "utf8") +
    "\n" +
    "-".repeat(80) +
    "\n\nThe model embedded in index.js (the base64 string) has this attribution:\n\n" +
    wrap(readAttribution()) +
    "\n\nThe model stores hashed features and weights, not address strings. If you\n" +
    "redistribute it, keep this notice with it.\n",
);

log(
  `built ${out} (nerdress ${pkg.version}, ${suite} model ` +
    `${model.byteLength.toLocaleString("en-US")} B, sha256 ${modelSha.slice(0, 12)}, ` +
    `commit ${git.sha.slice(0, 7)}${git.dirty ? "+dirty" : ""})`,
);
