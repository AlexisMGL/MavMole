"use strict";

const path = require("node:path");
const { cp, mkdir, readdir, rm } = require("node:fs/promises");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const source = path.join(root, "public");
const destination = path.join(root, "dist");

async function build() {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "js"), { recursive: true });
  await mkdir(path.join(destination, "css"), { recursive: true });

  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => cp(path.join(source, entry.name), path.join(destination, entry.name))),
  );

  const scripts = (await readdir(path.join(source, "js"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(source, "js", entry.name));
  await esbuild.build({
    entryPoints: scripts,
    outdir: path.join(destination, "js"),
    bundle: false,
    legalComments: "none",
    minify: true,
    sourcemap: false,
    target: ["es2022"],
  });
  await esbuild.build({
    entryPoints: [path.join(source, "css", "style.css")],
    outfile: path.join(destination, "css", "style.css"),
    bundle: false,
    legalComments: "none",
    minify: true,
    sourcemap: false,
    target: ["chrome100", "firefox100", "safari16"],
  });
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
