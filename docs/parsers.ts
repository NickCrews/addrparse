/**
 * Turns the model bytes embedded in the page back into parsers. Runs in the browser (the
 * playground) and in Node (test/docs.test.ts), so it uses only web-standard APIs. Each
 * entry's `load` is the implementation's own runtime entry point, the same code the harness
 * measures as the browser bundle.
 */
import { load as loadCrf } from "../impls/crf/load.ts";
import { load as loadLookup } from "../impls/lookup/load.ts";
import type { Parser } from "../src/types.ts";

/** Implementations whose parser runs in the page. */
export const LOADERS: Record<string, (bytes: Uint8Array) => Parser> = {
  crf: loadCrf,
  lookup: loadLookup,
};

export interface EmbeddedModel {
  impl: string;
  /** The model bytes, gzipped, then base64-encoded. */
  gzipBase64: string;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadEmbedded(m: EmbeddedModel): Promise<Parser> {
  const loader = LOADERS[m.impl];
  if (!loader) throw new Error(`no in-page loader for ${m.impl}`);
  return loader(await gunzip(fromBase64(m.gzipBase64)));
}
