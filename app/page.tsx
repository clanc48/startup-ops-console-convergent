
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      router.push(data.session ? "/game" : "/login");
    })();
  }, [router]);

  return <main style={{ padding: 24, color: "#e9edf5", background: "#0b1220", minHeight: "100vh" }}>Loading…</main>;
}
