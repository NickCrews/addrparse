/** Prose about each implementation for the Models tab. Numbers come from run files, not here. */
export interface ImplNotes {
  summary: string;
  architecture: string;
  pros: string[];
  cons: string[];
  use: string;
}

export const IMPL_NOTES: Record<string, ImplNotes> = {
  crf: {
    summary: "Linear-chain conditional random field. The recommended parser.",
    architecture:
      "Splits the text on whitespace and labels each token. Each token gets hashed features of " +
      "itself and its neighbours: lowercased word, character shape, prefixes and suffixes, " +
      "position, and membership in lexicons of street types, directionals, unit types and state " +
      "codes. Trained by stochastic gradient descent on log-likelihood with an L1 penalty, which " +
      "sets most weights to zero; the rest are stored as 16-bit integers. Parsing is Viterbi " +
      "decoding over typed arrays. The confidence is the probability of the chosen labeling, " +
      "from forward-backward.",
    pros: [
      "Highest exact match of the TypeScript parsers.",
      "Uses context, so an ambiguous word (N as directional or name, Park as street or city) is labeled by its neighbours.",
      "Confidence is a probability that ranks parses, so callers can send low-confidence parses to review.",
      "Labels junk text NotAddress, so it can abstain.",
      "Microsecond parses, small model and bundle, no dependencies.",
      "The model stores feature hashes and weights, not street or place names.",
    ],
    cons: [
      "Labels whole tokens, so it can't split a token holding two parts, such as Apt4.",
      "Training is far slower and uses far more memory than lookup's (see the training rows).",
      "US formats only.",
    ],
    use: "The default for parsing US addresses in a browser or Node.",
  },
  lookup: {
    summary: "Context-free baseline: a table from word to label.",
    architecture:
      "Each lowercased token gets the label it had most often in training; tokens not seen in " +
      "training get the most common label overall. The confidence is the share of tokens seen in " +
      "training.",
    pros: ["Tiny code, trains in seconds.", "Easy to inspect: the model is a JSON table."],
    cons: [
      "No context: a word gets one label wherever it appears, so most multi-word addresses have an error.",
      "The model is a vocabulary of street and place names, so it is large and holds part of the training data.",
      "The confidence doesn't separate right parses from wrong ones well.",
    ],
    use: "A floor for other parsers to beat. Not for real use.",
  },
  usaddress: {
    summary:
      "datamade/usaddress: a Python CRF (python-crfsuite) trained on hand-labeled US addresses.",
    architecture:
      "A CRF over tokens with hand-written features, trained on hand-labeled addresses. " +
      "This repo's label names follow usaddress; its finer labels are folded into " +
      "ours, and labels with no counterpart (building names, landmarks, intersections, " +
      "recipients) are dropped. Runs in Python, so it is measured for accuracy only and doesn't " +
      "run in this page.",
    pros: [
      "Mature and widely used; hand-labeled training data.",
      "Labels intersections, landmarks and recipients, which this label set lacks.",
    ],
    cons: [
      "Python only.",
      "Scored against gold derived from libpostal's data, so its own labeling conventions count as errors here.",
      "No confidence score.",
    ],
    use: "Python pipelines that already depend on it, or need its extra labels.",
  },
  libpostal: {
    summary:
      "openvenues/libpostal: a C library with a CRF trained on worldwide OSM and OpenAddresses data.",
    architecture:
      "A CRF trained on addresses from OpenStreetMap and OpenAddresses in many countries and " +
      "languages. Its fields are coarse (the whole street is one `road` field); " +
      "they are split into this repo's labels by the same rules that derive the gold labels. Needs " +
      "the C library and a ~2 GB data directory, so it is measured for accuracy only and doesn't " +
      "run in this page.",
    pros: [
      "Worldwide coverage and address normalization (expansion of abbreviations).",
      "The coarse exact match scores it without the label-splitting rules.",
    ],
    cons: [
      "Needs a native library and ~2 GB of data; not usable in a browser.",
      "Trained on the same lines as this repo's gold, dev and test included, so its score here is optimistic.",
      "No confidence score through the Python bindings used here.",
    ],
    use: "Server-side parsing of non-US addresses, or when normalization matters more than fine labels.",
  },
};
