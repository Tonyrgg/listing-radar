import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function sourceFiles(patterns: string[]) {
  return execFileSync("git", ["ls-files", ...patterns], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("sistema di design", () => {
  it("tiene i token allineati su web, worker ed estensione", () => {
    const source = read("src/styles/tokens.css");

    for (const copy of [
      "worker/src/desktop/renderer/tokens.css",
      "extension/tokens.css",
    ]) {
      const generated = read(copy);
      expect(
        generated.includes(source),
        `${copy} non corrisponde a src/styles/tokens.css. Esegui npm run design:sync.`,
      ).toBe(true);
    }
  });

  it("rispetta le soglie di contrasto dichiarate", () => {
    expect(() =>
      execFileSync("node", ["scripts/check-design-contrast.mjs"], {
        cwd: root,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("non lascia colori scritti a mano nei componenti", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(["app/**/*.tsx", "src/**/*.tsx"])) {
      const content = read(file);

      /* I valori letterali vanno nei token, non nei componenti.
       * Restano ammessi il nero/bianco puri usati per velature e ombre. */
      const literals = [
        ...content.matchAll(/\boklch\(/g),
        ...content.matchAll(/(?<![\w-])#[0-9a-fA-F]{3,8}\b/g),
      ];

      if (literals.length > 0) {
        offenders.push(`${file} (${literals.length})`);
      }
    }

    expect(offenders, `Colori letterali fuori dai token:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("non lascia la tavolozza di default di Tailwind nell'interfaccia", () => {
    const offenders: string[] = [];
    const palette =
      /\b(?:bg|text|border|ring|divide)-(?:red|green|blue|amber|yellow|orange|slate|gray|zinc|neutral|stone|emerald|teal|sky|indigo|violet|purple|fuchsia|pink|rose|lime|cyan)-\d{2,3}\b/g;

    for (const file of sourceFiles(["app/**/*.tsx", "src/**/*.tsx"])) {
      const matches = read(file).match(palette);
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(", ")}`);
    }

    expect(offenders, `Colori Tailwind grezzi:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("non apre schede nuove del browser per i link interni", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(["app/**/*.tsx", "src/**/*.tsx"])) {
      const content = read(file);

      for (const match of content.matchAll(/<(?:Link|a)\s[^>]*?>/g)) {
        const tag = match[0];
        const internal = /href=(?:"\/|\{`\/|\{"\/)/.test(tag);
        if (internal && /target=\{?"_blank"\}?/.test(tag)) {
          offenders.push(`${file}: ${tag.slice(0, 90)}…`);
        }
      }
    }

    expect(offenders, `Link interni che escono dall'app:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("non usa la finestra di conferma del browser", () => {
    const offenders = sourceFiles(["app/**/*.tsx", "src/**/*.tsx"]).filter((file) =>
      /window\.confirm\s*\(/.test(read(file)),
    );

    expect(offenders, `window.confirm ancora presente in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("dà un titolo a ogni pagina", () => {
    const offenders = sourceFiles(["app/**/page.tsx"]).filter(
      (file) => !/export const metadata|generateMetadata/.test(read(file)),
    );

    expect(offenders, `Pagine senza titolo:\n${offenders.join("\n")}`).toEqual([]);
  });
});
