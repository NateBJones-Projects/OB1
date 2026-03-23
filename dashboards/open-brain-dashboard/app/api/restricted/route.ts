import { NextRequest, NextResponse } from "next/server";
import { getSession, requireSession, AuthError } from "@/lib/auth";

const RESTRICTED_PASSPHRASE_HASH = process.env.RESTRICTED_PASSPHRASE_HASH ?? "";

async function hashPassphrase(passphrase: string): Promise<string> {
  const encoded = new TextEncoder().encode(passphrase);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** POST — verify passphrase and unlock restricted content */
export async function POST(request: NextRequest) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  if (!RESTRICTED_PASSPHRASE_HASH) {
    return NextResponse.json(
      { error: "Restricted passphrase not configured on server" },
      { status: 503 }
    );
  }

  const body = await request.json();
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";

  if (!passphrase) {
    return NextResponse.json(
      { error: "Passphrase is required" },
      { status: 400 }
    );
  }

  const inputHash = await hashPassphrase(passphrase);

  if (inputHash !== RESTRICTED_PASSPHRASE_HASH) {
    return NextResponse.json(
      { error: "Incorrect passphrase" },
      { status: 401 }
    );
  }

  const session = await getSession();
  session.restrictedUnlocked = true;
  await session.save();

  return NextResponse.json({ unlocked: true });
}

/** DELETE — re-lock restricted content */
export async function DELETE() {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const session = await getSession();
  session.restrictedUnlocked = false;
  await session.save();

  return NextResponse.json({ unlocked: false });
}

/** GET — check current restricted unlock status */
export async function GET() {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const session = await getSession();
  const configured = !!RESTRICTED_PASSPHRASE_HASH;
  return NextResponse.json({
    unlocked: session.restrictedUnlocked === true,
    configured,
  });
}
