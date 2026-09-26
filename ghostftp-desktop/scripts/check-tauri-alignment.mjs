#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const cargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");

const rustMatch = cargo.match(/^tauri\s*=\s*\{\s*version\s*=\s*"([^"]+)"/m);
if (!rustMatch) throw new Error("src-tauri/Cargo.toml: tauri version requirement not found");

const minor = (value) => {
  const m = String(value).match(/(\d+)\.(\d+)/);
  if (!m) throw new Error(`could not parse Tauri major/minor from ${value}`);
  return `${m[1]}.${m[2]}`;
};

const rustReq = rustMatch[1];
const apiSpec = pkg.dependencies?.["@tauri-apps/api"];
const cliSpec = pkg.devDependencies?.["@tauri-apps/cli"];
const apiResolved = lock.packages?.["node_modules/@tauri-apps/api"]?.version;
const cliResolved = lock.packages?.["node_modules/@tauri-apps/cli"]?.version;

for (const [label, value] of Object.entries({ rustReq, apiSpec, cliSpec, apiResolved, cliResolved })) {
  if (!value) throw new Error(`missing ${label} Tauri version metadata`);
}

const expected = minor(rustReq);
for (const [label, value] of [["frontend API", apiResolved], ["frontend CLI", cliResolved]]) {
  if (minor(value) !== expected) {
    throw new Error(`Tauri version mismatch: Rust ${rustReq} expects ${expected}.x but ${label} resolved to ${value}`);
  }
}

// Use a tilde train so npm/Cargo patch updates stay available while a future
// minor release cannot silently create the mismatch that breaks Tauri bundling.
for (const [label, spec] of [["@tauri-apps/api", apiSpec], ["@tauri-apps/cli", cliSpec]]) {
  if (!String(spec).startsWith(`~${expected}.`)) {
    throw new Error(`${label} must stay on the ~${expected}.x train; found ${spec}`);
  }
}
if (rustReq !== "=2.11.5") {
  throw new Error(`Rust tauri must stay pinned to the last verified core patch (=2.11.5); found ${rustReq}`);
}

console.log(`Tauri alignment OK: Rust ${rustReq}, API ${apiResolved}, CLI ${cliResolved}`);
