import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relativePath: string) {
  /* I fine riga cambiano fra sistemi: il contenuto no. */
  return readFileSync(path.join(root, relativePath), "utf8")
    .split(String.fromCharCode(13))
    .join("");
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

  it("tiene i sette atomi in un file solo", () => {
    /* Gli atomi sono il contratto fra le pagine vecchie e quelle riscritte:
     * una pagina che ne inventa uno suo riporta il prodotto al mosaico. */
    const atoms = read("src/components/ui/atoms.tsx");

    for (const name of ["Dato", "Periodo", "Fonte", "Movimento", "Stato", "Impronta", "Giudizio"]) {
      expect(
        atoms.includes(`export function ${name}(`),
        `L'atomo ${name} non è più esportato da atoms.tsx.`,
      ).toBe(true);
    }
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

  it("non ridisegna a mano i controlli dei moduli", () => {
    /* Un campo di testo aveva tre altezze, tre raggi e tre fondi: le classi
     * del modulo dei Segnali, quelle del commerciale e sedici copie scritte a
     * mano nelle barre dei filtri. Adesso l'aspetto sta in `controlClass()`. */
    const offenders = sourceFiles(["app/**/*.tsx", "src/**/*.tsx"]).filter((file) => {
      if (file.endsWith("src/components/ui/primitives.tsx")) return false;

      return /min-h-11 w-full rounded-/.test(read(file));
    });

    expect(
      offenders,
      `Controlli ridisegnati a mano invece di usare Testo/Scelta: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("non ripete due volte la navigazione di sezione", () => {
    /* Per sei pagine la barra delle sezioni compariva due volte: una dentro
     * l'intestazione, una scritta a mano subito sotto. Nessuno se ne accorge
     * leggendo il codice — si vede solo a schermo. */
    const offenders = sourceFiles(["app/**/page.tsx"]).filter((file) => {
      const source = read(file);

      /* Una barra passata come `nav={<…SectionNav />}` è al suo posto: dentro
       * l'intestazione. Una scritta da sola nel corpo della pagina è la copia. */
      const sciolte = source
        .split(/<(?:Matching|Lifecycle)SectionNav\s*\/>/)
        .slice(0, -1)
        .filter((prima) => !prima.trimEnd().endsWith("nav={"));

      return sciolte.length > 0;
    });

    expect(offenders, `La barra delle sezioni è ripetuta in: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("dà un titolo a ogni pagina", () => {
    const offenders = sourceFiles(["app/**/page.tsx"]).filter((file) => {
      const source = read(file);

      /* Una pagina che rimanda altrove non arriva mai a mostrare un titolo. */
      if (/permanentRedirect\(|redirect\(/.test(source)) return false;

      return !/export const metadata|generateMetadata/.test(source);
    });

    expect(offenders, `Pagine senza titolo:\n${offenders.join("\n")}`).toEqual([]);
  });
});
