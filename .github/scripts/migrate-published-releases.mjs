#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mapping = JSON.parse(fs.readFileSync(path.join(root, "docs/releases/version-map.json"), "utf8")).versions;
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required");

const apply = process.argv.includes("--apply");
const verifyOnly = process.argv.includes("--verify");
if (apply && verifyOnly) throw new Error("use either --apply or --verify");

function run(command, args, { allowFailure = false, encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: encoding === null ? undefined : encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${String(result.stderr || result.stdout || "")}`,
    );
  }
  return result;
}

function ghJson(endpoint, { method = "GET", fields = [], allow404 = false } = {}) {
  const args = ["api", endpoint];
  if (method !== "GET") args.push("--method", method);
  for (const [kind, key, value] of fields) args.push(kind, `${key}=${value}`);
  const result = run("gh", args, { allowFailure: allow404 });
  if (result.status !== 0) return null;
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : null;
}

function remoteTagSha(tag) {
  const out = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { allowFailure: true });
  const line = String(out.stdout || "").trim();
  return line ? line.split(/\s+/)[0] : null;
}

function sourceTagSha(tag) {
  const result = run("git", ["rev-list", "-n1", tag], { allowFailure: true });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

function replaceAllLiteral(text, from, to) {
  return text.split(from).join(to);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$\{\}()|[\]\\]/g, "\\function canonicalizeText(text, item) {
  const rc = item.legacy.match(/-rc\.(\d+)$/i)?.[1];
  if (!rc) throw new Error(`invalid legacy version ${item.legacy}`);
  const assetVersion = item.legacy.replace(/-rc\.(\d+)$/i, "-RC$1");
  const variants = [
    [`v${assetVersion}`, `v${item.canonical}`],
    [`v${item.legacy}`, `v${item.canonical}`],
    [assetVersion, item.canonical],
    [item.legacyDisplay, item.canonical],
    [item.legacy, item.canonical],
    [`RC${rc}`, item.canonical],
    [`rc.${rc}`, item.canonical],
  ];
  let out = String(text ?? "");
  for (const [from, to] of variants) out = replaceAllLiteral(out, from, to);
  return out;
}");
}

function canonicalizeText(text, item) {
  const rc = item.legacy.match(/-rc\.(\d+)$/i)?.[1];
  if (!rc) throw new Error(`invalid legacy version ${item.legacy}`);
  const base = item.legacy.replace(/-rc\.\d+$/i, "");
  let out = String(text ?? "");

  // Cover every historical spelling used by old release assets:
  // 2.1.1-rc.8, 2.1.1-RC8, 2.1.1-rc8, 2.1.1.rc8, and v-prefixed forms.
  out = out.replace(
    new RegExp(`v${escapeRegex(base)}(?:[-_. ]?rc[.-]?${rc})`, "gi"),
    `v${item.canonical}`,
  );
  out = out.replace(
    new RegExp(`${escapeRegex(base)}(?:[-_. ]?rc[.-]?${rc})`, "gi"),
    item.canonical,
  );
  out = out.replace(new RegExp(`\\bRC[.-]?${rc}\\b`, "gi"), item.canonical);
  return out;
}

function isChecksumAsset(name) {
  return /SHA256SUMS\.txt$/i.test(name) || /\.sha256$/i.test(name);
}

function getReleaseByTag(tag) {
  return ghJson(`repos/${repo}/releases/tags/${tag}`, { allow404: true });
}

function getAssets(releaseId) {
  return ghJson(`repos/${repo}/releases/${releaseId}/assets?per_page=100`) || [];
}

function downloadAsset(assetId) {
  const result = run(
    "gh",
    ["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${assetId}`],
    { encoding: null },
  );
  return result.stdout;
}

function uploadAsset(tag, file) {
  run("gh", ["release", "upload", tag, file, "--clobber"]);
}

function assertRelease(item, release, assetCountBefore) {
  const expectedTag = `v${item.canonical}`;
  if (release.tag_name !== expectedTag) throw new Error(`${expectedTag}: release tag mismatch`);
  if (release.name !== `Ghost FTP ${item.canonical}`) throw new Error(`${expectedTag}: release name mismatch`);
  if (release.prerelease) throw new Error(`${expectedTag}: still marked prerelease`);
  const assets = getAssets(release.id);
  if (assets.length !== assetCountBefore) {
    throw new Error(`${expectedTag}: asset count changed ${assetCountBefore} -> ${assets.length}`);
  }
  const legacyRc = item.legacy.match(/-rc\.(\d+)$/i)?.[1];
  for (const asset of assets) {
    if (/2\.1\.1|RC\d+/i.test(asset.name)) {
      throw new Error(`${expectedTag}: legacy asset name remains: ${asset.name}`);
    }
  }
  if (legacyRc && new RegExp(`(?:2\\.1\\.1|RC${legacyRc}\\b)`, "i").test(release.body || "")) {
    throw new Error(`${expectedTag}: legacy version remains in release body`);
  }
}

run("git", ["fetch", "--tags", "--force"]);

for (const item of mapping) {
  const oldTag = `v${item.legacy}`;
  const newTag = `v${item.canonical}`;
  let release = getReleaseByTag(newTag) || getReleaseByTag(oldTag);
  if (!release) throw new Error(`release not found for ${oldTag} / ${newTag}`);

  const oldRemoteSha = remoteTagSha(oldTag);
  const newRemoteSha = remoteTagSha(newTag);
  const oldResolvedSha = oldRemoteSha ? (sourceTagSha(oldTag) || oldRemoteSha) : null;
  const newResolvedSha = newRemoteSha ? (sourceTagSha(newTag) || newRemoteSha) : null;

  if (oldResolvedSha && oldResolvedSha !== item.sourceSha) {
    throw new Error(`${oldTag} points to ${oldResolvedSha}, expected ${item.sourceSha}`);
  }
  if (newResolvedSha && newResolvedSha !== item.sourceSha) {
    throw new Error(`${newTag} points to ${newResolvedSha}, expected ${item.sourceSha}`);
  }

  const assetsBefore = getAssets(release.id);
  const binaryDigests = new Map(
    assetsBefore.filter(a => !isChecksumAsset(a.name)).map(a => [canonicalizeText(a.name, item), a.digest]),
  );

  if (verifyOnly) {
    assertRelease(item, release, assetsBefore.length);
    if (oldRemoteSha) throw new Error(`${oldTag}: legacy Git tag still exists`);
    if (!newRemoteSha) throw new Error(`${newTag}: canonical Git tag missing`);
    console.log(`verified ${newTag}`);
    continue;
  }

  console.log(`${apply ? "migrating" : "would migrate"} ${oldTag} -> ${newTag} at ${item.sourceSha}`);
  if (!apply) continue;

  // Download checksum assets before changing the release so their contents can
  // be rewritten to the canonical asset names without touching binary assets.
  const checksumBackups = [];
  for (const asset of assetsBefore.filter(a => isChecksumAsset(a.name))) {
    checksumBackups.push({
      asset,
      name: canonicalizeText(asset.name, item),
      bytes: downloadAsset(asset.id),
    });
  }

  const body = canonicalizeText(release.body || "", item);
  release = ghJson(`repos/${repo}/releases/${release.id}`, {
    method: "PATCH",
    fields: [
      ["-f", "tag_name", newTag],
      ["-f", "target_commitish", item.sourceSha],
      ["-f", "name", `Ghost FTP ${item.canonical}`],
      ["-f", "body", body],
      ["-F", "prerelease", "false"],
      ["-F", "draft", "false"],
    ],
  });

  // Updating a release to a new tag normally creates that tag. If GitHub
  // leaves the tag absent, create the ref through the REST API rather than
  // git push, which is blocked for historical commits containing workflows.
  if (!remoteTagSha(newTag)) {
    ghJson(`repos/${repo}/git/refs`, {
      method: "POST",
      fields: [
        ["-f", "ref", `refs/tags/${newTag}`],
        ["-f", "sha", item.sourceSha],
      ],
    });
  }
  if (remoteTagSha(newTag) !== item.sourceSha) {
    throw new Error(`${newTag}: canonical tag was not created at ${item.sourceSha}`);
  }

  // Rename binary assets in place so their bytes and GitHub digest remain
  // unchanged. Checksums are re-uploaded because their filename references
  // must change alongside the renamed assets.
  for (const asset of assetsBefore.filter(a => !isChecksumAsset(a.name))) {
    const newName = canonicalizeText(asset.name, item);
    if (newName !== asset.name) {
      ghJson(`repos/${repo}/releases/assets/${asset.id}`, {
        method: "PATCH",
        fields: [["-f", "name", newName]],
      });
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ghostftp-release-migrate-"));
  try {
    for (const backup of checksumBackups) {
      ghJson(`repos/${repo}/releases/assets/${backup.asset.id}`, { method: "DELETE" });
      const updated = canonicalizeText(Buffer.from(backup.bytes).toString("utf8"), item);
      const target = path.join(tmp, backup.name);
      fs.writeFileSync(target, updated);
      uploadAsset(newTag, target);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const migrated = getReleaseByTag(newTag);
  assertRelease(item, migrated, assetsBefore.length);

  for (const asset of getAssets(migrated.id).filter(a => !isChecksumAsset(a.name))) {
    const expectedDigest = binaryDigests.get(asset.name);
    if (!expectedDigest || asset.digest !== expectedDigest) {
      throw new Error(`${newTag}: binary asset digest changed for ${asset.name}`);
    }
  }

  if (remoteTagSha(oldTag)) {
    ghJson(`repos/${repo}/git/refs/tags/${oldTag}`, { method: "DELETE" });
  }
  if (remoteTagSha(oldTag)) throw new Error(`${oldTag}: legacy tag still exists after deletion`);
  console.log(`migrated and verified ${oldTag} -> ${newTag}`);
}

if (verifyOnly) console.log("all published releases use canonical 0.x versions");
