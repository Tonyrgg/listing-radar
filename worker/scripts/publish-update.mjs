import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repository = "Tonyrgg/listing-radar";
const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const version = packageData.version;
const tag = `property-worker-v${version}`;
const localInstallerName = `Property Data Worker Setup ${version}.exe`;
const installerAsset = `Property-Data-Worker-Setup-${version}.exe`;
const manifestAsset = "property-worker-manifest.json";
const installerPath = path.join(workerRoot, "release", localInstallerName);
const installer = await readFile(installerPath);
const chunkSize = 32 * 1024 * 1024;
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-release-"));

async function command(executable, args, options = {}) {
  const result = await execFileAsync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return result.stdout.trim();
}

async function ensurePublishedSourceMatchesInstaller() {
  const worktree = await command("git", ["status", "--porcelain"]);
  if (worktree) throw new Error("La release e bloccata: il worktree contiene modifiche non committate.");
  const localHead = await command("git", ["rev-parse", "HEAD"]);
  const defaultBranch = await command("gh", ["api", `repos/${repository}`, "--jq", ".default_branch"]);
  const remoteHead = await command("gh", ["api", `repos/${repository}/commits/${defaultBranch}`, "--jq", ".sha"]);
  if (localHead !== remoteHead) throw new Error(`La release e bloccata: HEAD non coincide con ${defaultBranch} remoto.`);
  return localHead;
}

async function readRelease() {
  try {
    const raw = await command("gh", ["release", "view", tag, "--repo", repository, "--json", "tagName,isDraft,assets"]);
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error && String(error.stderr).toLowerCase().includes("release not found")) return null;
    throw error;
  }
}

try {
  const commit = await ensurePublishedSourceMatchesInstaller();
  const chunks = [];
  for (let offset = 0, index = 0; offset < installer.length; offset += chunkSize, index += 1) {
    const body = installer.subarray(offset, Math.min(offset + chunkSize, installer.length));
    const name = `property-worker-${version}-part-${String(index).padStart(3, "0")}.bin`;
    const outputPath = path.join(temporaryDirectory, name);
    await writeFile(outputPath, body, { mode: 0o600 });
    chunks.push({
      name,
      path: outputPath,
      size: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }

  const publicInstallerPath = path.join(temporaryDirectory, installerAsset);
  await copyFile(installerPath, publicInstallerPath);
  const manifest = {
    version,
    fileName: localInstallerName,
    installerAsset,
    size: installer.length,
    sha256: createHash("sha256").update(installer).digest("hex"),
    releaseDate: new Date().toISOString(),
    chunks: chunks.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
  };
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(temporaryDirectory, manifestAsset);
  await writeFile(manifestPath, manifestContents, { encoding: "utf8", mode: 0o600 });

  const existing = await readRelease();
  if (existing && !existing.isDraft) throw new Error(`La release ${tag} e gia pubblicata e non verra sovrascritta.`);
  if (!existing) {
    await command("gh", [
      "release", "create", tag,
      "--repo", repository,
      "--draft",
      "--target", commit,
      "--title", `Property Data Worker ${version}`,
      "--notes", "Aggiornamento stabile di Property Data Worker.",
    ]);
  }

  const uploadPaths = [publicInstallerPath, ...chunks.map((chunk) => chunk.path), manifestPath];
  await command("gh", ["release", "upload", tag, ...uploadPaths, "--repo", repository, "--clobber"]);

  const uploaded = await readRelease();
  if (!uploaded?.isDraft) throw new Error("La release non e rimasta in bozza durante la verifica.");
  const expectedAssets = new Map([
    [installerAsset, installer.length],
    ...chunks.map((chunk) => [chunk.name, chunk.size]),
    [manifestAsset, Buffer.byteLength(manifestContents)],
  ]);
  const uploadedAssets = new Map(uploaded.assets.map((asset) => [asset.name, asset.size]));
  for (const [name, expectedSize] of expectedAssets) {
    if (uploadedAssets.get(name) !== expectedSize) {
      throw new Error(`Asset GitHub mancante o incompleto: ${name}. La bozza non verra pubblicata.`);
    }
  }

  await command("gh", ["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
  console.log(`Release ${tag} pubblicata e verificata su GitHub (${chunks.length} parti, ${installer.length} byte).`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
