import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

const rules = [
  {
    name: 'variant="editorial-outline"',
    pattern: /(?<![\w-])variant=(["'])editorial-outline\1/g,
    replace: 'variant=$1outline$1',
  },
  {
    name: 'variant="editorial-ghost"',
    pattern: /(?<![\w-])variant=(["'])editorial-ghost\1/g,
    replace: 'variant=$1ghost$1',
  },
  {
    name: 'variant="editorial"',
    pattern: /(?<![\w-])variant=(["'])editorial\1/g,
    replace: 'variant=$1default$1',
  },
  {
    name: 'size="icon-sm"',
    pattern: /(?<![\w-])size=(["'])icon-sm\1/g,
    replace: 'size=$1icon$1',
  },
  {
    name: 'size="icon-xs"',
    pattern: /(?<![\w-])size=(["'])icon-xs\1/g,
    replace: 'size=$1icon$1',
  },
  {
    name: 'size="editorial"',
    pattern: /(?<![\w-])size=(["'])editorial\1/g,
    replace: "",
  },
  {
    name: 'size="sm"',
    pattern: /(?<![\w-])size=(["'])sm\1/g,
    replace: "",
  },
  {
    name: 'size="xs"',
    pattern: /(?<![\w-])size=(["'])xs\1/g,
    replace: "",
  },
  {
    name: "font-serif",
    pattern: /font-serif/g,
    replace: "font-display",
  },
  {
    name: "text-[9px]",
    pattern: /text-\[9px\]/g,
    replace: "text-xs",
  },
  {
    name: "text-[10px]",
    pattern: /text-\[10px\]/g,
    replace: "text-xs",
  },
  {
    name: "text-[11px]",
    pattern: /text-\[11px\]/g,
    replace: "text-xs",
  },
  {
    name: "text-[12px]",
    pattern: /text-\[12px\]/g,
    replace: "text-xs",
  },
];

function filesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      filesUnder(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const counts = Object.fromEntries(rules.map((rule) => [rule.name, 0]));
let filesChanged = 0;

for (const file of filesUnder(srcRoot)) {
  const original = readFileSync(file, "utf8");
  let next = original;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    next = next.replace(rule.pattern, (match, quote) => {
      counts[rule.name] += 1;
      if (rule.replace.includes("$1")) return rule.replace.replaceAll("$1", quote);
      return rule.replace;
    });
  }
  if (next !== original) {
    writeFileSync(file, next);
    filesChanged += 1;
  }
}

let total = 0;
for (const rule of rules) {
  const count = counts[rule.name];
  total += count;
  console.log(`${rule.name}: ${count}`);
}
console.log(`files: ${filesChanged}`);
console.log(`total: ${total}`);
