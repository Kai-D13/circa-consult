import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");
const supabaseUrl = process.env.CIRCA_SUPABASE_URL || "https://wbbjxaegcubhyxgemucj.supabase.co";
const publishableKey = process.env.CIRCA_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_qg-vekzhhsnX90Aj5YUUWg_t9KiR_bN";

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) throw new Error("CIRCA_SUPABASE_URL không hợp lệ.");
if (!publishableKey.startsWith("sb_publishable_")) throw new Error("CIRCA_SUPABASE_PUBLISHABLE_KEY không hợp lệ.");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "xlsx.full.min.js"]) {
  await writeFile(path.join(output, file), await readFile(path.join(root, file)));
}
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await writeFile(path.join(output, "config.js"), `window.CIRCA_ADMIN_CONFIG = Object.freeze(${JSON.stringify({
  supabaseUrl,
  supabasePublishableKey: publishableKey,
  expectedSheetNames: ["consultation_rules", "Sheet2"],
}, null, 2)});\n`);
console.log(`Admin Portal build hoàn tất: ${output}`);

