import { stat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import extensionManifest from "@/extension/manifest.json";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION_ROOT = path.join(process.cwd(), "extension");
const PACKAGE_ROOT = "listing-radar-extension";
const ZIP_VERSION = extensionManifest.version.replace(/[^0-9A-Za-z.-]/g, "-");

type ZipEntry = {
  name: string;
  data: Buffer;
  modifiedAt: Date;
};

let crcTable: Uint32Array | null = null;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  crcTable = table;
  return table;
}

function crc32(data: Buffer) {
  const table = getCrcTable();
  let value = 0xffffffff;

  for (const byte of data) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

async function collectExtensionFiles(directory: string, relativePath = ""): Promise<ZipEntry[]> {
  const items = await readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(
    items
      .filter((item) => !item.name.startsWith("."))
      .map(async (item) => {
        const absolutePath = path.join(directory, item.name);
        const nextRelativePath = path.posix.join(
          relativePath,
          item.name.replaceAll(path.sep, "/"),
        );

        if (item.isDirectory()) {
          return collectExtensionFiles(absolutePath, nextRelativePath);
        }

        if (!item.isFile()) {
          return [];
        }

        const [fileStat, data] = await Promise.all([
          stat(absolutePath),
          readFile(absolutePath),
        ]);

        return [
          {
            name: path.posix.join(PACKAGE_ROOT, nextRelativePath),
            data,
            modifiedAt: fileStat.mtime,
          },
        ];
      }),
  );

  return entries.flat().sort((left, right) => left.name.localeCompare(right.name));
}

function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const { date, time } = toDosDateTime(entry.modifiedAt);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function canDownloadExtension() {
  const authRequired =
    process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";

  if (!authRequired) {
    return true;
  }

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();

  return Boolean(
    data.user &&
      (!allowedEmail || data.user.email?.toLowerCase() === allowedEmail),
  );
}

export async function GET() {
  if (!(await canDownloadExtension())) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const entries = await collectExtensionFiles(EXTENSION_ROOT);
  const zip = createZip(entries);

  return new Response(zip, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="listing-radar-extension-v${ZIP_VERSION}.zip"`,
      "Content-Length": String(zip.length),
      "Content-Type": "application/zip",
    },
  });
}
