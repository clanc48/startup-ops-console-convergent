
"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export function useRealtimeQuarters(gameId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!gameId) return;

    const channel = supabase
      .channel(`quarters:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quarters", filter: `game_id=eq.${gameId}` },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, onChange]);
}
