import { NextResponse } from "next/server";

// This endpoint was used during early local experimentation.
// It is intentionally disabled for the take-home submission.
export async function POST() {
 return new NextResponse("Not found", { status:404 });
}
