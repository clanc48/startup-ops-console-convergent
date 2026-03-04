"use client";

import { useEffect } from "react";
import { installAuthBridgeListener } from "@/lib/authBridge";

/**
 * Installs a client-side Supabase auth listener that keeps server cookies
 * (SSR/session for route handlers) in sync with the client session.
 */
export function AuthBridgeBootstrap() {
 useEffect(() => {
 const sub = installAuthBridgeListener();
 return () => sub.unsubscribe();
 }, []);

 return null;
}
