import { connectToCrmChrome } from "../src/services/chrome.js";

const durationMs = Math.max(1_000, Number(process.argv[2] ?? 300_000));
const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const startedAt = Date.now();
let lastSignature = "";

function phoneKind(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^(?:0039|39)(?=\d{9,10}$)/, "");
  return !digits ? "empty" : digits.startsWith("3") ? "mobile" : digits.startsWith("0") ? "landline" : "other";
}

try {
  while (Date.now() - startedAt < durationMs) {
    const dialogs = page.locator('[role="dialog"]').filter({ visible: true });
    if (await dialogs.count()) {
      const dialog = dialogs.last();
      const snapshot = await dialog.evaluate((root) => {
        return {
          heading: root.querySelector("h1,h2,h3")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          fields: Array.from(root.querySelectorAll("input:enabled")).map((element) => {
            const id = element.getAttribute("id");
            const label = (id ? root.querySelector(`label[for="${CSS.escape(id)}"]`) : null)?.textContent
              ?? element.closest("c-picklist, lightning-input, .slds-form-element")?.querySelector("label")?.textContent
              ?? "";
            return { label: label.replace(/\s+/g, " ").trim(), value: (element as HTMLInputElement).value };
          }),
          picklists: Array.from(root.querySelectorAll("c-picklist")).map((component) => ({
            label: component.querySelector("label")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
            value: (component.querySelector('input[role="textbox"]') as HTMLInputElement | null)?.value
              ?? component.querySelector('button[role="combobox"]')?.textContent?.replace(/\s+/g, " ").trim()
              ?? "",
          })),
          options: Array.from(document.querySelectorAll('[role="option"]')).filter((option) => {
            const style = getComputedStyle(option);
            return style.display !== "none" && style.visibility !== "hidden";
          }).map((option) => ({
            attrs: Array.from(option.attributes).map((attribute) => [attribute.name, attribute.value]),
            descendants: Array.from(option.querySelectorAll("*")).flatMap((node) => Array.from(node.attributes).map((attribute) => [node.tagName.toLowerCase(), attribute.name, attribute.value])),
          })),
        };
      });
      const piercedOptions = await page.locator('[role="option"]').filter({ visible: true }).evaluateAll((elements) => elements.map((option) => ({
        attrs: Array.from(option.attributes).map((attribute) => [attribute.name, attribute.value]),
        descendants: Array.from(option.querySelectorAll("*")).flatMap((node) => Array.from(node.attributes).map((attribute) => [node.tagName.toLowerCase(), attribute.name, attribute.value])),
      })));
      const safe = {
        atMs: Date.now() - startedAt,
        route: new URL(page.url()).pathname.replace(/\b[A-Z0-9]{15}(?:[A-Z0-9]{3})?\b/gi, "[ID]"),
        heading: snapshot.heading,
        fields: snapshot.fields.map((field) => ({
          label: field.label,
          value: /quota/i.test(field.label) ? field.value : /telefon|cellular/i.test(field.label) ? phoneKind(field.value) : field.value ? "set" : "empty",
        })),
        picklists: snapshot.picklists,
        options: [...snapshot.options, ...piercedOptions].map((option) => ({
          attrs: option.attrs.map(([name, value]) => [name, /[A-Z0-9]{15,18}/i.test(value) ? "[ID]" : value]),
          descendants: option.descendants.map(([tag, name, value]) => [tag, name, /[A-Z0-9]{15,18}/i.test(value) ? "[ID]" : value]),
        })),
      };
      const signature = JSON.stringify({ ...safe, atMs: 0 });
      if (signature !== lastSignature) process.stdout.write(`${JSON.stringify(safe)}\n`);
      lastSignature = signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  await tabs.browser.close().catch(() => undefined);
}
