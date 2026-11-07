/** Runtime half of the CRF: parses with a model made by index.ts's `train`. */
import type { Parser } from "../../src/types.ts";
import { CrfParser, decode } from "./model.ts";

export function load(bytes: Uint8Array): Parser {
  return new CrfParser(decode(bytes));
}
