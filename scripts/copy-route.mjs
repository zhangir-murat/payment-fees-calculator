import { copyFile, mkdir } from "node:fs/promises";

const route = new URL("../dist/fee-calculator/", import.meta.url);
await mkdir(route, { recursive: true });
await copyFile(new URL("../dist/index.html", import.meta.url), new URL("index.html", route));
