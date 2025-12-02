import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const SHARE_PATH = path.join(process.cwd(), "shares.json");

async function runMigration() {
  try {
    const raw = await fs.readFile(SHARE_PATH, "utf8");
    let parsed: any[] = [];

    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      parsed = [];
    }

    console.log(`Loaded ${parsed.length} share records...`);

    const migrated = parsed.map((s) => {
      return {
        shareId: s.shareId ?? s.id ?? randomUUID(),
        mediaId: s.mediaId ?? "",
        recipient: s.recipient ?? "",
        downloadable: s.downloadable ?? true,
        packageId: s.packageId ?? (s.mediaId ? `pkg_${s.mediaId}` : randomUUID()),
        createdAt: s.createdAt ?? new Date().toISOString(),
        acceptedAt: s.acceptedAt ?? null,
        rejectedAt: s.rejectedAt ?? null,
        sender: s.sender ?? null,
      };
    });

    await fs.writeFile(
      SHARE_PATH,
      JSON.stringify(migrated, null, 2),
      "utf8"
    );

    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

runMigration();
