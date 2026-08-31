/**
 * Lettura della tabella dei certificati Authenticode direttamente dall'header
 * PE. Serve come prova deterministica, indipendente dal sistema operativo, che
 * un binario contenga o non contenga una firma incorporata: `signtool verify` e
 * `Get-AuthenticodeSignature` esistono soltanto su Windows, mentre questo
 * controllo funziona anche su un runner Linux o durante i test.
 *
 * Non sostituisce la validazione della catena, della scadenza e del timestamp:
 * quella resta compito di Windows. Qui rispondiamo a una sola domanda, ma senza
 * inferenze: la firma c'e' oppure no.
 */

const DOS_SIGNATURE = 0x5a4d; // "MZ"
const PE_SIGNATURE = 0x00004550; // "PE\0\0"
const PE32_MAGIC = 0x10b;
const PE32PLUS_MAGIC = 0x20b;
const SECURITY_DIRECTORY_INDEX = 4;
const DATA_DIRECTORY_ENTRY_SIZE = 8;
const CERTIFICATE_ENTRY_HEADER_SIZE = 8;

/** wCertificateType di WIN_CERTIFICATE: solo 0x0002 e' una firma Authenticode. */
export const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002;

export class PortableExecutableError extends Error {}

export interface CertificateEntry {
  /** Lunghezza dichiarata dell'entry, header WIN_CERTIFICATE incluso. */
  length: number;
  revision: number;
  certificateType: number;
  isAuthenticode: boolean;
}

export interface PortableExecutableSignature {
  is64Bit: boolean;
  machine: number;
  /** Offset **su file** della tabella dei certificati; 0 quando assente. */
  certificateTableOffset: number;
  certificateTableSize: number;
  signed: boolean;
}

function requireBytes(buffer: Buffer, offset: number, length: number, what: string) {
  if (offset < 0 || offset + length > buffer.length) {
    throw new PortableExecutableError(`Header PE troncato: ${what} non leggibile.`);
  }
}

/**
 * Legge la directory SECURITY dell'header PE. Bastano i primi kilobyte del
 * file: non serve scaricare l'installer completo per sapere se e' firmato.
 */
export function inspectPortableExecutable(buffer: Buffer): PortableExecutableSignature {
  requireBytes(buffer, 0, 0x40, "header DOS");
  if (buffer.readUInt16LE(0) !== DOS_SIGNATURE) {
    throw new PortableExecutableError("Il file non e' un eseguibile Windows: manca la firma DOS 'MZ'.");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  requireBytes(buffer, peOffset, 24, "header COFF");
  if (buffer.readUInt32LE(peOffset) !== PE_SIGNATURE) {
    throw new PortableExecutableError("Il file non e' un eseguibile Windows: manca la firma 'PE\\0\\0'.");
  }

  const machine = buffer.readUInt16LE(peOffset + 4);
  const optionalHeaderOffset = peOffset + 24;
  requireBytes(buffer, optionalHeaderOffset, 2, "optional header");
  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  if (magic !== PE32_MAGIC && magic !== PE32PLUS_MAGIC) {
    throw new PortableExecutableError(`Optional header PE non riconosciuto: magic 0x${magic.toString(16)}.`);
  }

  const is64Bit = magic === PE32PLUS_MAGIC;
  const numberOfRvaAndSizesOffset = optionalHeaderOffset + (is64Bit ? 108 : 92);
  requireBytes(buffer, numberOfRvaAndSizesOffset, 4, "NumberOfRvaAndSizes");
  const numberOfRvaAndSizes = buffer.readUInt32LE(numberOfRvaAndSizesOffset);
  if (numberOfRvaAndSizes <= SECURITY_DIRECTORY_INDEX) {
    // Nessuna directory SECURITY dichiarata: il binario non puo' essere firmato.
    return { is64Bit, machine, certificateTableOffset: 0, certificateTableSize: 0, signed: false };
  }

  const dataDirectoryOffset = optionalHeaderOffset + (is64Bit ? 112 : 96);
  const securityOffset = dataDirectoryOffset + SECURITY_DIRECTORY_INDEX * DATA_DIRECTORY_ENTRY_SIZE;
  requireBytes(buffer, securityOffset, DATA_DIRECTORY_ENTRY_SIZE, "directory SECURITY");
  const certificateTableOffset = buffer.readUInt32LE(securityOffset);
  const certificateTableSize = buffer.readUInt32LE(securityOffset + 4);

  return {
    is64Bit,
    machine,
    certificateTableOffset,
    certificateTableSize,
    // Nella directory SECURITY il primo campo e' un offset su file, non un RVA.
    signed: certificateTableOffset > 0 && certificateTableSize > 0,
  };
}

/**
 * Percorre le entry WIN_CERTIFICATE della tabella. Un installer firmato ne
 * espone almeno una di tipo PKCS_SIGNED_DATA; la firma dual sha1+sha256 di
 * electron-builder resta comunque una sola entry, perche' la seconda firma e'
 * annidata come attributo non autenticato.
 */
export function readCertificateEntries(
  file: Buffer,
  signature: PortableExecutableSignature,
): CertificateEntry[] {
  if (!signature.signed) return [];

  const tableStart = signature.certificateTableOffset;
  const tableEnd = tableStart + signature.certificateTableSize;
  if (tableEnd > file.length) {
    throw new PortableExecutableError(
      "Tabella dei certificati oltre la fine del file: il binario e' troncato o corrotto.",
    );
  }

  const entries: CertificateEntry[] = [];
  let cursor = tableStart;
  while (cursor + CERTIFICATE_ENTRY_HEADER_SIZE <= tableEnd) {
    const length = file.readUInt32LE(cursor);
    if (length < CERTIFICATE_ENTRY_HEADER_SIZE || cursor + length > tableEnd) {
      throw new PortableExecutableError("Entry WIN_CERTIFICATE con lunghezza non valida.");
    }
    const certificateType = file.readUInt16LE(cursor + 6);
    entries.push({
      length,
      revision: file.readUInt16LE(cursor + 4),
      certificateType,
      isAuthenticode: certificateType === WIN_CERT_TYPE_PKCS_SIGNED_DATA,
    });
    // Ogni entry e' allineata a 8 byte.
    cursor += Math.ceil(length / 8) * 8;
  }

  if (entries.length === 0) {
    throw new PortableExecutableError("Tabella dei certificati dichiarata ma priva di entry leggibili.");
  }
  return entries;
}

export interface AuthenticodePresence {
  signed: boolean;
  entries: CertificateEntry[];
  summary: string;
}

/** Riassume in una riga cosa contiene il file, senza mai inferire un esito. */
export function describeAuthenticodePresence(file: Buffer): AuthenticodePresence {
  const signature = inspectPortableExecutable(file);
  if (!signature.signed) {
    return { signed: false, entries: [], summary: "nessuna firma Authenticode incorporata" };
  }
  const entries = readCertificateEntries(file, signature);
  const authenticode = entries.filter((entry) => entry.isAuthenticode);
  if (authenticode.length === 0) {
    return {
      signed: false,
      entries,
      summary: `tabella certificati presente ma senza entry PKCS_SIGNED_DATA (${entries.length} entry)`,
    };
  }
  return {
    signed: true,
    entries,
    summary: `firma Authenticode presente (${authenticode.length} entry, ${signature.certificateTableSize} byte)`,
  };
}
