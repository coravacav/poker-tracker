import { parseMoneyToCents } from "./money";

export type ParsedChipFastEntryItem = {
  label: string;
  valueCents: number;
};

export type ChipFastEntryParseResult =
  | { ok: true; items: ParsedChipFastEntryItem[] }
  | { ok: false; error: string };

const CHIP_COLOR_HEX_BY_NAME: Record<string, string> = {
  aqua: "#00ffff",
  black: "#000000",
  blue: "#0000ff",
  brown: "#a52a2a",
  cyan: "#00ffff",
  "dark blue": "#000080",
  fuchsia: "#ff00ff",
  gold: "#ffd700",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  "light blue": "#add8e6",
  lime: "#00ff00",
  magenta: "#ff00ff",
  maroon: "#800000",
  navy: "#000080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  purple: "#800080",
  red: "#ff0000",
  silver: "#c0c0c0",
  tan: "#d2b48c",
  teal: "#008080",
  white: "#ffffff",
  yellow: "#ffff00"
};

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function splitAt(line: string, index: number, separatorLength = 1): [string, string] {
  return [line.slice(0, index), line.slice(index + separatorLength)];
}

function splitChipLine(line: string): [string, string] | null {
  for (const separator of ["=", ":", "\t"]) {
    const index = line.indexOf(separator);
    if (index >= 0) {
      return splitAt(line, index, separator.length);
    }
  }

  const commaIndex = line.indexOf(",");
  if (commaIndex >= 0) {
    const possibleLabel = line.slice(0, commaIndex);
    if (!/[$\d]/.test(possibleLabel)) {
      return splitAt(line, commaIndex);
    }
  }

  const whitespaceMatch = line.match(
    /^(.*?)\s+((?:\$\s*)?-?[\d.,]+)$/
  );
  return whitespaceMatch ? [whitespaceMatch[1], whitespaceMatch[2]] : null;
}

export function suggestedChipColorHex(label: string): string {
  return CHIP_COLOR_HEX_BY_NAME[normalizeLabel(label).toLocaleLowerCase()] ?? "#ffffff";
}

export function parseChipFastEntry(input: string): ChipFastEntryParseResult {
  const lines = input
    .split(/\r\n?|\n/)
    .map((text, index) => ({ lineNumber: index + 1, text: text.trim() }))
    .filter((line) => line.text.length > 0);

  if (lines.length === 0) {
    return { ok: false, error: "Enter at least one chip color and value." };
  }

  const items: ParsedChipFastEntryItem[] = [];
  const seenLabels = new Set<string>();

  for (const line of lines) {
    const parts = splitChipLine(line.text);
    if (!parts) {
      return {
        ok: false,
        error: `Line ${line.lineNumber}: use “Color = value” (for example, “Red = 5”).`
      };
    }

    const label = normalizeLabel(parts[0]);
    const valueInput = parts[1].trim();
    if (!label) {
      return {
        ok: false,
        error: `Line ${line.lineNumber}: enter a chip color name.`
      };
    }

    const valueCents = parseMoneyToCents(valueInput);
    if (!valueCents || valueCents <= 0 || !Number.isSafeInteger(valueCents)) {
      return {
        ok: false,
        error: `Line ${line.lineNumber}: enter a positive USD value for ${label}.`
      };
    }

    const normalizedLabel = label.toLocaleLowerCase();
    if (seenLabels.has(normalizedLabel)) {
      return {
        ok: false,
        error: `Line ${line.lineNumber}: chip color name “${label}” duplicates an earlier line.`
      };
    }

    seenLabels.add(normalizedLabel);
    items.push({ label, valueCents });
  }

  return { ok: true, items };
}
