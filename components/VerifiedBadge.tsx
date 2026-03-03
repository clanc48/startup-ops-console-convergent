
"use client";

import { Badge } from "@/components/ui/Badge";

export default function VerifiedBadge({ verified }: { verified?: boolean }) {
  if (verified === true) return <Badge tone="good">Verified ✓</Badge>;
  return <Badge tone="warn">Unverified</Badge>;
}
