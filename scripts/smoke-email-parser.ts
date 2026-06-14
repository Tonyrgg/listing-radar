import assert from "node:assert/strict";

import { parseAlertEmail } from "@/lib/email-alerts/parser";

const html = `
  <article>
    <a href="https://www.idealista.it/immobile/123456/?utm_source=email">
      <img
        src="https://img.example/a.jpg"
        alt="Trilocale luminoso a Bitonto"
      >
      Trilocale luminoso a Bitonto
    </a>
    <p>165.000 euro - 96 m2 - 3 locali - Bitonto centro</p>
  </article>
`;

const rows = parseAlertEmail({
  sender: "Idealista <alert@idealista.it>",
  subject: "Nuovi immobili a Bitonto",
  html,
});

assert.equal(rows.length, 1);
assert.equal(rows[0]?.source, "idealista");
assert.equal(rows[0]?.sourceListingId, "123456");
assert.equal(rows[0]?.price, 165000);
assert.equal(rows[0]?.sqm, 96);
assert.equal(rows[0]?.rooms, 3);
assert.equal(
  rows[0]?.canonicalUrl,
  "https://www.idealista.it/immobile/123456/",
);
assert.equal(rows[0]?.imageUrl, "https://img.example/a.jpg");

const nestedEmail = `
  <table>
    <tr>
      <td>
        <table><tr><td>
          <a href="https://www.idealista.it/immobile/34103680/">
            <img
              src="https://img4.idealista.it/blur/500_375_mq/example.jpg"
              width="552"
              height="auto"
            >
          </a>
        </td></tr></table>
        <table><tr><td>
          <a href="https://www.idealista.it/immobile/34103680/">
            Trilocale in Via Valmara, 6, Castello di Brianza
          </a>
        </td></tr></table>
        <p>190.000 € - Privato - 110 m² - 3 stanze - 1º piano</p>
        <p>Appartamento con box, cantina e giardino privato.</p>
        <a href="https://www.idealista.it/immobile/34103680/">Contatta</a>
      </td>
    </tr>
  </table>
`;
const nestedRows = parseAlertEmail({
  sender: "Idealista <alert@idealista.it>",
  subject: "Nuovo trilocale per la tua ricerca",
  html: nestedEmail,
});

assert.equal(nestedRows.length, 1);
assert.equal(
  nestedRows[0]?.title,
  "Trilocale in Via Valmara, 6, Castello di Brianza",
);
assert.equal(nestedRows[0]?.price, 190000);
assert.equal(nestedRows[0]?.sqm, 110);
assert.equal(nestedRows[0]?.rooms, 3);
assert.equal(
  nestedRows[0]?.imageUrl,
  "https://img4.idealista.it/blur/500_375_mq/example.jpg",
);

console.log("Email alert parser smoke test passed.");
