import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "listings",
  "listing_snapshots",
  "listing_sources",
  "listing_notes",
  "listing_actions",
  "reports",
  "scrape_runs",
  "scrape_errors",
  "incoming_listings",
  "email_ingestion_messages",
];
const PAGE_SIZE = 1000;

function requireEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

async function readTable(client, table) {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Unable to export ${table}: ${error.message}`);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function readAuthUsers(client) {
  const users = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Unable to export auth users: ${error.message}`);
    }

    users.push(...data.users);

    if (data.users.length < PAGE_SIZE) {
      return users;
    }
  }
}

const supabase = createClient(
  requireEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
const exportedAt = new Date();
const tables = {};

for (const table of TABLES) {
  tables[table] = await readTable(supabase, table);
}

const authUsers = await readAuthUsers(supabase);
const payload = {
  format: "listing-radar-json-backup",
  version: 1,
  exportedAt: exportedAt.toISOString(),
  tables,
  authUsers,
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const checksum = createHash("sha256").update(serialized).digest("hex");
const timestamp = exportedAt.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = path.join(process.cwd(), ".backups");
const backupPath = path.join(backupDirectory, `listing-radar-${timestamp}.json`);
const checksumPath = `${backupPath}.sha256`;

await mkdir(backupDirectory, { recursive: true });
await writeFile(backupPath, serialized, "utf8");
await writeFile(
  checksumPath,
  `${checksum}  ${path.basename(backupPath)}\n`,
  "utf8",
);

const tableCounts = Object.fromEntries(
  Object.entries(tables).map(([table, rows]) => [table, rows.length]),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      backupPath,
      checksumPath,
      tableCounts,
      authUsers: authUsers.length,
    },
    null,
    2,
  ),
);
