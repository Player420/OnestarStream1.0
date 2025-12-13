// src/app/identity/api/create-app-vault/route.ts
import { NextResponse } from "next/server";
// TODO: Implement these modules when PQ cryptography is ready
// import { deriveKeyFromPassword } from "../../../lib/pq/derive";
// import { encryptVault } from "../../../lib/pq/encrypt";
// import { loadIdentity, saveIdentity } from "../../../lib/identity/store";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  try {
    const { appId, password } = await req.json();

    if (!appId || !password) {
      return NextResponse.json(
        { error: "Missing appId or password" },
        { status: 400 }
      );
    }

    // TODO: Implement PQ-secure vault creation
    // This endpoint requires lib/pq/derive, lib/pq/encrypt, and lib/identity/store
    return NextResponse.json(
      { error: "Vault creation not yet implemented - PQ modules pending" },
      { status: 501 }
    );

    // Original implementation (commented out until modules exist):
    // const identity = await loadIdentity();
    // if (!identity) {
    //   return NextResponse.json(
    //     { error: "Identity not initialized" },
    //     { status: 500 }
    //   );
    // }
    // const appKey = await deriveKeyFromPassword(password);
    // const vaultId = randomUUID();
    // const emptyVault = { records: [] };
    // const encryptedVault = await encryptVault(emptyVault, appKey);
    // identity.vaults[appId] = {
    //   vaultId,
    //   encrypted: encryptedVault,
    // };
    // await saveIdentity(identity);
    // return NextResponse.json({ ok: true, vaultId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
