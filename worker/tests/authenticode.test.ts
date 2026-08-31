import { describe, expect, it } from "vitest";

import {
  PortableExecutableError,
  WIN_CERT_TYPE_PKCS_SIGNED_DATA,
  describeAuthenticodePresence,
  inspectPortableExecutable,
  readCertificateEntries,
} from "../scripts/authenticode.js";

/**
 * Costruisce un PE32 minimo ma strutturalmente corretto. Serve a provare che il
 * controllo distingue un binario non firmato da uno firmato senza dipendere da
 * un installer reale, che non e' committabile.
 */
function buildPortableExecutable(options: {
  is64Bit?: boolean;
  certificateTableSize?: number;
  numberOfRvaAndSizes?: number;
  certificateEntries?: { length?: number; certificateType: number }[];
} = {}) {
  const is64Bit = options.is64Bit ?? false;
  const peOffset = 0x80;
  const optionalHeaderOffset = peOffset + 24;
  const dataDirectoryOffset = optionalHeaderOffset + (is64Bit ? 112 : 96);
  const headerSize = dataDirectoryOffset + 16 * 8;

  const header = Buffer.alloc(headerSize, 0);
  header.writeUInt16LE(0x5a4d, 0);
  header.writeUInt32LE(peOffset, 0x3c);
  header.writeUInt32LE(0x00004550, peOffset);
  header.writeUInt16LE(is64Bit ? 0x8664 : 0x014c, peOffset + 4);
  header.writeUInt16LE(is64Bit ? 0x20b : 0x10b, optionalHeaderOffset);
  header.writeUInt32LE(options.numberOfRvaAndSizes ?? 16, optionalHeaderOffset + (is64Bit ? 108 : 92));

  const entries = options.certificateEntries ?? [];
  if (entries.length === 0) {
    return { file: header, headerSize };
  }

  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const declared = entry.length ?? 8 + 16;
    const padded = Math.ceil(declared / 8) * 8;
    const block = Buffer.alloc(padded, 0);
    block.writeUInt32LE(declared, 0);
    block.writeUInt16LE(0x0200, 4);
    block.writeUInt16LE(entry.certificateType, 6);
    blocks.push(block);
  }
  const table = Buffer.concat(blocks);
  const securityOffset = dataDirectoryOffset + 4 * 8;
  header.writeUInt32LE(headerSize, securityOffset);
  header.writeUInt32LE(options.certificateTableSize ?? table.length, securityOffset + 4);

  return { file: Buffer.concat([header, table]), headerSize };
}

describe("inspectPortableExecutable", () => {
  it("riconosce un PE32 senza directory SECURITY come non firmato", () => {
    const { file } = buildPortableExecutable();
    const signature = inspectPortableExecutable(file);
    expect(signature.signed).toBe(false);
    expect(signature.is64Bit).toBe(false);
    expect(signature.certificateTableOffset).toBe(0);
    expect(signature.certificateTableSize).toBe(0);
  });

  it("legge la tabella dei certificati di un PE32+ firmato", () => {
    const { file, headerSize } = buildPortableExecutable({
      is64Bit: true,
      certificateEntries: [{ certificateType: WIN_CERT_TYPE_PKCS_SIGNED_DATA }],
    });
    const signature = inspectPortableExecutable(file);
    expect(signature.signed).toBe(true);
    expect(signature.is64Bit).toBe(true);
    expect(signature.certificateTableOffset).toBe(headerSize);
  });

  it("tratta come non firmato un binario che dichiara meno di cinque data directory", () => {
    const { file } = buildPortableExecutable({ numberOfRvaAndSizes: 4 });
    expect(inspectPortableExecutable(file).signed).toBe(false);
  });

  it("rifiuta un file che non e' un eseguibile Windows", () => {
    expect(() => inspectPortableExecutable(Buffer.alloc(1024, 0x41))).toThrow(PortableExecutableError);
  });

  it("rifiuta un header troncato invece di indovinare", () => {
    const { file } = buildPortableExecutable();
    expect(() => inspectPortableExecutable(file.subarray(0, 0x90))).toThrow(PortableExecutableError);
  });
});

describe("readCertificateEntries", () => {
  it("elenca le entry e distingue quelle Authenticode", () => {
    const { file } = buildPortableExecutable({
      certificateEntries: [{ certificateType: WIN_CERT_TYPE_PKCS_SIGNED_DATA }, { certificateType: 0x0001 }],
    });
    const entries = readCertificateEntries(file, inspectPortableExecutable(file));
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.isAuthenticode)).toEqual([true, false]);
  });

  it("rifiuta una tabella che eccede la fine del file", () => {
    const { file } = buildPortableExecutable({
      certificateEntries: [{ certificateType: WIN_CERT_TYPE_PKCS_SIGNED_DATA }],
      certificateTableSize: 4096,
    });
    expect(() => readCertificateEntries(file, inspectPortableExecutable(file))).toThrow(
      /oltre la fine del file/,
    );
  });

  it("rifiuta una entry con lunghezza dichiarata non valida", () => {
    const { file } = buildPortableExecutable({
      certificateEntries: [{ certificateType: WIN_CERT_TYPE_PKCS_SIGNED_DATA, length: 2 }],
    });
    expect(() => readCertificateEntries(file, inspectPortableExecutable(file))).toThrow(
      /lunghezza non valida/,
    );
  });
});

describe("describeAuthenticodePresence", () => {
  it("riporta assenza di firma per l'installer non firmato di oggi", () => {
    const { file } = buildPortableExecutable();
    const presence = describeAuthenticodePresence(file);
    expect(presence.signed).toBe(false);
    expect(presence.summary).toContain("nessuna firma");
  });

  it("riporta la firma quando esiste una entry PKCS_SIGNED_DATA", () => {
    const { file } = buildPortableExecutable({
      certificateEntries: [{ certificateType: WIN_CERT_TYPE_PKCS_SIGNED_DATA }],
    });
    expect(describeAuthenticodePresence(file).signed).toBe(true);
  });

  it("non considera firmato un file con tabella priva di entry Authenticode", () => {
    const { file } = buildPortableExecutable({ certificateEntries: [{ certificateType: 0x0001 }] });
    const presence = describeAuthenticodePresence(file);
    expect(presence.signed).toBe(false);
    expect(presence.entries).toHaveLength(1);
  });
});
