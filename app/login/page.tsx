"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { bridgeSessionToCookies } from "@/lib/authBridge";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      // Always bridge the session to HttpOnly cookies immediately after auth.
      await bridgeSessionToCookies();

      router.push("/game");
    } catch (e: any) {
      setErr(e?.message ?? "Auth failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1>{mode === "login" ? "Login" : "Create account"}</h1>

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <button disabled={busy} type="submit">
          {busy ? "Working…" : mode === "login" ? "Login" : "Sign up"}
        </button>
      </form>

      <hr style={{ margin: "16px 0" }} />

      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer" }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}
      </button>
    </main>
  );
}
